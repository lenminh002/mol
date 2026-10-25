"use client";

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
  const tone = isDrug ? "text-amber-700" : region ? "cursor-pointer text-brand" : "text-foreground";
  const dot = isDrug
    ? "border-amber-700 bg-amber-700"
    : region
      ? "border-brand bg-brand"
      : "border-muted-foreground bg-background";
  return (
    <div
      onMouseEnter={() => region && setHighlight(region)}
      onMouseLeave={() => region && setHighlight(null)}
      title={region ? "Highlight in the cell" : undefined}
      className={`relative py-1 text-sm leading-snug ${tone}`}
    >
      <span className={`absolute -left-5 top-[0.65rem] size-[7px] rounded-full border ${dot}`} />
      {label}
    </div>
  );
}

function Edge({ hop, citation }: { hop: PathHop; citation?: Citation }) {
  return (
    <div className="py-0.5 text-[11.5px] italic leading-snug text-muted-foreground">
      {hop.relation}
      {citation && (
        <a
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          title={citation.title}
          className="ml-1.5 border-b border-dotted border-muted-foreground text-[10.5px] not-italic hover:border-brand hover:text-brand"
        >
          {citation.pmid ? `PMID ${citation.pmid}` : citation.id.split(":")[0]}
        </a>
      )}
    </div>
  );
}

// The judge's causal chain from the drug to its effects, as a vertical timeline.
export function ReasoningGraph() {
  const { result } = useSim();
  if (!result || result.reasoning_path.length === 0) return null;
  const citations = new Map(result.citations.map((c) => [c.id, c]));
  const drugNames = [result.drug.name, result.reasoning_path[0].from].map((n) => n.toLowerCase());

  return (
    <section>
      <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Reasoning path</h3>
      <p className="mt-1 text-xs italic text-muted-foreground">Hover a cell region to see it.</p>
      <div className="mt-3 flex flex-col gap-4">
        {chains(result.reasoning_path).map((chain, i) => (
          <div key={i} className="relative flex flex-col pl-5 before:absolute before:bottom-3 before:left-[3px] before:top-3 before:w-px before:bg-input">
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
    </section>
  );
}
