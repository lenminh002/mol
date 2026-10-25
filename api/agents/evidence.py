"""Shared evidence board for one simulation.

Both debaters call tools through this board, so:
- every tool call is streamed to the UI as a `tool_call` event,
- every citable fact gets a stable source id (pmid:…, pubchem:…, pdb:…, dock:…, uniprot:…),
- results are cached on disk, so the skeptic re-reading what the proposer fetched costs nothing,
- the judge can only cite ids that really exist on the board.
"""

import asyncio
import json
from collections.abc import Callable
from typing import Any

from tools import graph
from tools.docking import run_docking
from tools.drug import get_drug
from tools.literature import search_literature
from tools.target import get_target


class EvidenceBoard:
    def __init__(self, emit: Callable[[dict], None]):
        self.emit = emit
        self.citations: dict[str, dict] = {}  # source id -> {id, title, url, pmid}
        self.drugs: dict[str, dict] = {}  # lowercased name -> get_drug result
        self.targets: dict[str, dict] = {}  # lowercased name -> get_target result
        self.docking: dict[str, dict] = {}  # lowercased target name -> run_docking result
        self.paths: list[list[dict]] = []  # mechanism paths found in the knowledge graph

    def cite(self, sid: str, title: str, url: str, pmid: str | None = None) -> str:
        self.citations.setdefault(sid, {"id": sid, "title": title, "url": url, "pmid": pmid})
        return sid

    async def _call(self, agent: str, tool: str, args: dict, fn: Callable[..., Any]) -> Any:
        self.emit({"type": "tool_call", "agent": agent, "tool": tool, "args": args})
        return await asyncio.to_thread(fn, **args)

    # --- tools (return JSON strings for the models) ------------------------------

    async def drug_info(self, agent: str, name: str) -> str:
        try:
            d = await self._call(agent, "drug_info", {"name": name}, get_drug)
        except Exception as e:  # noqa: BLE001 — tool errors go back to the model as text
            return json.dumps({"error": str(e)})
        self.drugs[name.lower()] = d
        d = {**d, "source_id": self.cite(f"pubchem:{d['cid']}", f"PubChem: {name}", d["pubchem_url"])}
        return json.dumps(d)

    async def target_info(self, agent: str, name: str) -> str:
        try:
            t = await self._call(agent, "target_info", {"name": name}, get_target)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"error": str(e)})
        self.targets[name.lower()] = t
        ids = [self.cite(f"uniprot:{t['uniprot']}", f"UniProt {t['uniprot']}: {t['name']}",
                         f"https://www.uniprot.org/uniprotkb/{t['uniprot']}")]
        if t.get("pdb_id"):
            ids.append(self.cite(f"pdb:{t['pdb_id']}", f"PDB {t['pdb_id']}: {t['name']} structure",
                                 f"https://www.rcsb.org/structure/{t['pdb_id']}"))
        return json.dumps({**t, "source_ids": ids})

    async def dock(self, agent: str, drug_name: str, target_name: str) -> str:
        drug = self.drugs.get(drug_name.lower())
        if drug is None:
            await self.drug_info(agent, drug_name)
            drug = self.drugs.get(drug_name.lower())
        if drug is None:
            return json.dumps({"error": f"Could not resolve '{drug_name}' to a small molecule"})
        try:
            r = await self._call(agent, "dock", {"smiles": drug["smiles"], "target_name": target_name}, run_docking)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"error": f"Docking unavailable: {e}"})
        self.docking[target_name.lower()] = r
        sid = self.cite(f"dock:{r['pdb_id'] or target_name}", f"DiffDock pose: {drug_name} → {r['target']}",
                        f"https://www.rcsb.org/structure/{r['pdb_id']}" if r["pdb_id"] else "")
        return json.dumps({**r, "source_id": sid})

    async def literature(self, agent: str, query: str) -> str:
        try:
            papers = await self._call(agent, "search_literature", {"query": query}, search_literature)
        except Exception as e:  # noqa: BLE001
            return json.dumps({"error": str(e)})
        out = []
        for p in papers:
            sid = self.cite(p["source_id"], p["title"], p["url"], p.get("pmid"))
            out.append({"source_id": sid, "type": p["source"], "title": p["title"], "year": p.get("year"),
                        "text": p["text"][:1500]})
        return json.dumps(out)

    # --- knowledge graph ------------------------------------------------------------

    def _cite_graph(self, result: dict) -> dict:
        """Register citations for every source id in a graph result (hetionet:<edge type>, curated:<entry>)."""
        ids = set()
        for t in result.get("triples", []) + result.get("path", []) + result.get("other_targets", []):
            ids.add(t["source_id"])
        if result.get("side_effect_source_id"):
            ids.add(result["side_effect_source_id"])
        for sid in ids:
            if (c := graph.citation(sid)) is not None:
                self.cite(sid, c["title"], c["url"])
        return result

    async def graph_neighbors(self, agent: str, entity: str) -> str:
        r = await self._call(agent, "knowledge_graph", {"name": entity, "limit": 25}, graph.neighbors)
        return json.dumps(self._cite_graph(r))

    async def graph_path(self, agent: str, drug: str, region: str, via: str | None = None) -> str:
        r = await self._call(agent, "mechanism_path", {"drug": drug, "region": region, "via": via}, graph.find_path)
        if "path" in r:
            self.paths.append(r["path"])
        return json.dumps(self._cite_graph(r))

    async def graph_off_targets(self, agent: str, drug: str, primary: str | None = None) -> str:
        r = await self._call(agent, "off_targets", {"drug": drug, "primary": primary}, graph.off_targets)
        return json.dumps(self._cite_graph(r))

    def summary(self) -> str:
        """Compact digest of everything gathered, for the judge."""
        return json.dumps(
            {
                "drugs": self.drugs,
                "targets": self.targets,
                "docking": self.docking,
                "knowledge_graph_paths": self.paths,
                "sources": list(self.citations.values()),
            },
            indent=1,
        )
