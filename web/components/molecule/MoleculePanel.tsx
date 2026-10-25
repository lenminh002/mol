"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/sse";
import { DIRECTION_TINT } from "@/components/cell/layout";
import { useSim } from "@/lib/store";
import { MoleculeView, type Comparison, type StructureInfo, type ViewMode } from "./MoleculeView";

const DIRECTION_LABEL = { up: "↑ Increases", down: "↓ Decreases", block: "⛔ Blocks" } as const;

// Molecule view for the selected target: Mol* canvas plus binding-site details.
export function MoleculePanel() {
  const { result, selectedTarget, selectTarget } = useSim();
  const target = result?.targets.find((t) => t.name === selectedTarget) ?? result?.targets[0];
  const [info, setInfo] = useState<StructureInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResidues, setShowResidues] = useState(false);
  const [mode, setMode] = useState<ViewMode>("drug");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const onReady = useCallback(() => setLoading(false), []);

  useEffect(() => {
    if (!target?.pdb_id) return;
    setInfo(null);
    setComparison(null);
    setMode("drug");
    setError(null);
    setLoading(true);
    fetch(`${API_URL}/structure/${target.pdb_id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`API error ${r.status}`)))
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [target?.pdb_id]);

  if (!target) return null;

  // Effects at this target's organelle; effects carry no direct target link.
  const modes: [ViewMode, string][] = info?.apo
    ? [["apo", "Unbound"], ["drug", "With drug"], ["overlay", "Overlay"]]
    : [["empty", "Without drug"], ["drug", "With drug"]];
  const caption =
    mode === "drug"
      ? `${result?.drug.name} sits in the pocket and touches ${info?.residue_count} residues.`
      : mode === "apo"
        ? `Unbound structure (${info?.apo?.label}): the pocket is empty.`
        : mode === "overlay"
          ? "Drug-bound (teal) over unbound (violet): where they differ, the protein moved."
          : `Empty pocket: ${info?.residue_count} residues line the site.`;

  const effects = (result?.effects ?? [])
    .filter((e) => e.organelle === target.cell_location)
    .sort((a, b) => b.magnitude * b.confidence - a.magnitude * a.confidence)
    .slice(0, 2);

  return (
    <div className="absolute inset-0 bg-background">
      {info && <MoleculeView info={info} poseUrl={target.pose_pdb_url} mode={mode} onReady={onReady} onCompare={setComparison} />}

      {!target.pdb_id && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          No experimental structure is known for {target.name}.
        </p>
      )}
      {error && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-destructive">{error}</p>
      )}
      {target.pdb_id && loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading {target.pdb_id}…
        </div>
      )}

      <div className="scroll-thin absolute bottom-16 left-3 right-3 top-3 flex max-w-sm flex-col gap-2 overflow-y-auto">
        <Button variant="outline" size="sm" className="w-fit" onClick={() => selectTarget(null)}>
          <ArrowLeft /> Back to cell
        </Button>
        <div className="rounded-md border bg-card/95 p-3 text-xs">
          <div className="text-sm font-medium">
            {result?.drug.name} <span className="text-muted-foreground">→ {target.name}</span>
          </div>
          {info && <div className="mt-0.5 text-muted-foreground">Showing: {info.focus.label}</div>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {target.pdb_id && (
              <a href={`https://www.rcsb.org/structure/${target.pdb_id}`} target="_blank" rel="noreferrer">
                <Badge variant="outline">PDB {target.pdb_id}</Badge>
              </a>
            )}
            {target.uniprot && (
              <a href={`https://www.uniprot.org/uniprotkb/${target.uniprot}`} target="_blank" rel="noreferrer">
                <Badge variant="outline">UniProt {target.uniprot}</Badge>
              </a>
            )}
            {target.binding_score != null && (
              <Badge variant="outline" title="DiffDock confidence is a ranking score, not a binding affinity">
                DiffDock confidence {target.binding_score.toFixed(2)} (estimate)
              </Badge>
            )}
            {result?.drug.mw != null && <Badge variant="outline">MW {result.drug.mw}</Badge>}
            {result?.drug.logp != null && <Badge variant="outline">logP {result.drug.logp}</Badge>}
          </div>
          {info && (
            <div className="mt-3">
              <div className="inline-flex rounded-md border p-0.5">
                {modes.map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`rounded px-2.5 py-1 ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-muted-foreground">{caption}</p>
              {info.apo && mode !== "drug" && comparison && (
                <p className="mt-1 text-muted-foreground">
                  After superposing {info.pdb_id} on {info.apo.pdb_id}: RMSD {comparison.rmsd.toFixed(2)} Å over {comparison.aligned} aligned atoms
                  {comparison.meanShift != null && `, pocket residues shifted ${comparison.meanShift.toFixed(2)} Å on average`}
                  {comparison.moved.length > 0 &&
                    `. Most moved: ${comparison.moved
                      .slice(0, 3)
                      .map((m) => `${m.resname}${m.resseq} (${m.shift.toFixed(1)} Å)`)
                      .join(", ")}.`}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <Legend color="#d97706" label="Drug" />
                <Legend color="#0d9488" label="Binding-site residues" />
                <Legend color="#b8c9c0" label="Rest of protein" />
                {info.apo && <Legend color="#7c3aed" label={`Unbound ${info.apo.pdb_id}`} />}
              </div>
            </div>
          )}
          {!target.pose_pdb_url && target.pdb_id && (
            <p className="mt-2 text-muted-foreground">Pose shown is the experimental crystal structure.</p>
          )}
        </div>
        {effects.length > 0 && (
          <div className="rounded-md border bg-card/95 p-3 text-xs">
            <div className="mb-1.5 font-medium">What binding changes</div>
            <ul className="flex flex-col gap-2">
              {effects.map((e, i) => (
                <li key={i}>
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: DIRECTION_TINT[e.direction] }} className="font-medium">
                      {DIRECTION_LABEL[e.direction]}
                    </span>
                    <span className="font-medium">{e.pathway}</span>
                    <span className="text-muted-foreground">· {Math.round(e.confidence * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded bg-border">
                    <div
                      className="h-full rounded"
                      style={{ width: `${Math.round(e.magnitude * 100)}%`, background: DIRECTION_TINT[e.direction] }}
                    />
                  </div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground" title={e.explanation}>{e.explanation}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {info && info.residues.length > 0 && (
        <div className="scroll-thin absolute bottom-3 left-3 right-3 max-h-[40%] overflow-y-auto rounded-md border bg-card/95 text-xs">
          <button
            onClick={() => setShowResidues((v) => !v)}
            className="flex w-full items-center gap-1.5 p-2.5 text-left"
          >
            <ChevronDown className={`size-3.5 transition-transform ${showResidues ? "" : "-rotate-90"}`} />
            <span className="font-medium">
              {info.residue_count} {info.focus.ligands ? "binding-site" : "interface"} residues
            </span>
            <span className="truncate text-muted-foreground">
              within 5 Å · closest: {info.residues.slice(0, 4).map((r) => `${r.resname}${r.resseq}`).join(", ")}
            </span>
          </button>
          {showResidues && (
            <div className="flex flex-wrap gap-1 px-2.5 pb-2.5">
              {info.residues.map((r) => (
                <span
                  key={`${r.chain}${r.resname}${r.resseq}`}
                  title={`${r.distance} Å`}
                  className="rounded border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {r.resname}
                  {r.resseq}
                  <span className="opacity-60">:{r.chain}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
