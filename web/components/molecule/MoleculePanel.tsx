"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";
import { MoleculeView, type StructureInfo } from "./MoleculeView";

// Molecule view for the selected target: Mol* canvas plus binding-site details.
export function MoleculePanel() {
  const { result, selectedTarget, selectTarget } = useSim();
  const target = result?.targets.find((t) => t.name === selectedTarget) ?? result?.targets[0];
  const [info, setInfo] = useState<StructureInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showResidues, setShowResidues] = useState(false);
  const onReady = useCallback(() => setLoading(false), []);

  useEffect(() => {
    if (!target?.pdb_id) return;
    setInfo(null);
    setError(null);
    setLoading(true);
    fetch(`${API_URL}/structure/${target.pdb_id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(`API error ${r.status}`)))
      .then(setInfo)
      .catch((e) => setError(String(e)));
  }, [target?.pdb_id]);

  if (!target) return null;

  return (
    <div className="absolute inset-0 bg-background">
      {info && <MoleculeView info={info} poseUrl={target.pose_pdb_url} onReady={onReady} />}

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

      <div className="absolute left-3 right-3 top-3 flex max-w-sm flex-col gap-2">
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
          {!target.pose_pdb_url && target.pdb_id && (
            <p className="mt-2 text-muted-foreground">Pose shown is the experimental crystal structure.</p>
          )}
        </div>
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
