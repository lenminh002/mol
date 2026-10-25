"use client";

import { ArrowDown } from "lucide-react";
import { useSim } from "@/lib/store";
import type { CellLocation, Citation, PathHop } from "@/lib/types";

const REGIONS: Record<string, CellLocation> = {
  membrane: "membrane",
  "plasma membrane": "membrane",
  cytoplasm: "cytoplasm",
  cytosol: "cytoplasm",
  nucleus: "nucleus",
  mitochondria: "mitochondria",
  mitochondrion: "mitochondria",
  er: "er",
  "endoplasmic reticulum": "er",
};

function regionOf(node: string): CellLocation | null {
  return REGIONS[node.trim().toLowerCase()] ?? null;
}

// Consecutive hops form a chain when one hop's target is the next hop's source.
function chains(path: PathHop[]): PathHop[][] {
  const out: PathHop[][] = [];
  for (const hop of path) {
    const last = out.at(-1)?.at(-1);
    if (last && last.to.trim().toLowerCase() === hop.from.trim().toLowerCase()) out.at(-1)!.push(hop);
    else out.push([hop]);
  }
  return out;
}

// `drugNames` holds the user-facing name plus the path's first node, which is the drug under whatever
// name the knowledge graph uses (e.g. "Acetylsalicylic acid" for aspirin).
function Node({ label, drugNames }: { label: string; drugNames: string[] }) {
  const { setHighlight } = useSim();
  const region = regionOf(label);
  const l = label.toLowerCase();
  const isDrug = drugNames.some((d) => l.includes(d) || (l.length > 4 && d.includes(l)));
  const tone = isDrug
    ? "border-yellow-300/60 text-yellow-200"
    : region
      ? "border-brand/60 text-brand cursor-pointer"
      : "border-border text-foreground";
  return (
    <span
      onMouseEnter={() => region && setHighlight(region)}
      onMouseLeave={() => region && setHighlight(null)}
      title={region ? "Highlight in the cell" : undefined}
      className={`w-fit max-w-full rounded-md border bg-background/60 px-2 py-1 text-xs ${tone}`}
    >
      {label}
    </span>
  );
}

function Edge({ hop, citation }: { hop: PathHop; citation?: Citation }) {
  return (
    <div className="flex items-center gap-1.5 py-0.5 pl-3 text-[11px] text-muted-foreground">
      <ArrowDown className="size-3 shrink-0" />
      <span className="italic">{hop.relation}</span>
      {citation && (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          title={citation.title}
          className="rounded border px-1 py-px text-[10px] hover:border-brand hover:text-brand"
        >
          {citation.pmid ? `PMID ${citation.pmid}` : citation.id.split(":")[0]}
        </a>
      )}
    </div>
  );
}

// The judge's causal chain from the drug to its effects, as a small flow diagram.
export function ReasoningGraph() {
  const { result } = useSim();
  if (!result || result.reasoning_path.length === 0) return null;
  const citations = new Map(result.citations.map((c) => [c.id, c]));
  const drugNames = [result.drug.name, result.reasoning_path[0].from].map((n) => n.toLowerCase());

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium">
        Reasoning path <span className="font-normal text-muted-foreground">· hover a cell region to see it</span>
      </div>
      <div className="flex flex-col gap-3">
        {chains(result.reasoning_path).map((chain, i) => (
          <div key={i} className="flex flex-col">
            <Node label={chain[0].from} drugNames={drugNames} />
            {chain.map((hop, j) => (
              <div key={j} className="flex flex-col">
                <Edge hop={hop} citation={hop.source_id ? citations.get(hop.source_id) : undefined} />
                <Node label={hop.to} drugNames={drugNames} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
