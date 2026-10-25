"use client";

import { useEffect, useRef, useState } from "react";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection } from "molstar/lib/mol-model/structure";
import { Color } from "molstar/lib/mol-util/color";
import { API_URL } from "@/lib/sse";

export interface StructureInfo {
  pdb_id: string;
  structure_url: string;
  focus: { ligands?: string[]; chain?: string; label: string };
  residues: { chain: string; resname: string; resseq: string; distance: number }[];
  residue_count: number;
}

interface Props {
  info: StructureInfo;
  poseUrl?: string | null; // docked pose (SDF), drawn on top of the crystal structure
  onReady?: () => void;
}

const BACKGROUND = Color(0x070b14);
const DRUG_COLOR = Color(0xfde047);

// Mol* rendering engine embedded without its own UI, so it sits inside our layout.
export function MoleculeView({ info, poseUrl, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const plugin = new PluginContext(DefaultPluginSpec());
    // A fresh canvas per mount: a canvas returns the same WebGL context forever, so after a dispose
    // (React's dev double-mount) reusing it would hand Mol* a lost context.
    const container = containerRef.current!;
    const canvas = document.createElement("canvas");
    canvas.className = "h-full w-full";
    container.prepend(canvas);

    (async () => {
      try {
        await plugin.init();
        if (disposed) return; // unmounted during init (React dev double-mount): canvas is already detached
        const ok = await plugin.initViewerAsync(canvas, container);
        if (disposed) return;
        if (!ok) throw new Error("WebGL could not start the molecule viewer");
        plugin.canvas3d?.setProps({
          renderer: { backgroundColor: BACKGROUND },
          camera: { helper: { axes: { name: "off", params: {} } } },
        });

        const data = await plugin.builders.data.download({ url: `${API_URL}/${info.structure_url}`, isBinary: false });
        const trajectory = await plugin.builders.structure.parseTrajectory(data, "pdb");
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, "default", {
          representationPreset: "polymer-and-ligand",
        });

        // Crystallographic waters only clutter the binding site.
        const components = plugin.managers.structure.hierarchy.current.structures[0]?.components ?? [];
        const water = components.filter((c) => c.cell.obj?.label?.toLowerCase().includes("water"));
        if (water.length) await plugin.managers.structure.hierarchy.remove(water);

        if (poseUrl) {
          const pose = await plugin.builders.data.download({ url: `${API_URL}/${poseUrl}`, isBinary: false });
          const poseTraj = await plugin.builders.structure.parseTrajectory(pose, "sdf");
          await plugin.builders.structure.hierarchy.applyPreset(poseTraj, "default");
        }
        if (disposed) return;

        // Select the drug (or the interface chain) and focus on it. Focus mode also draws the
        // surrounding residues and the non-covalent interactions.
        const ref = plugin.managers.structure.hierarchy.current.structures[0];
        const structure = ref?.cell.obj?.data;
        if (ref && structure) {
          const { ligands, chain } = info.focus;
          const tests: Record<string, ReturnType<typeof MS.core.rel.eq>> = {};
          if (ligands?.length) tests["residue-test"] = MS.core.set.has([MS.set(...ligands), MS.ammp("label_comp_id")]);
          if (chain) tests["chain-test"] = MS.core.rel.eq([MS.ammp("auth_asym_id"), chain]);
          const expression = MS.struct.generator.atomGroups(tests);

          const loci = StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(expression, structure));
          if (loci.elements.length > 0) {
            if (ligands?.length) {
              // The drug in Mol yellow (matches the drug particles in the cell view).
              const drug = await plugin.builders.structure.tryCreateComponentFromExpression(
                ref.cell, expression, "mol-drug", { label: "Drug" },
              );
              if (drug) {
                await plugin.builders.structure.representation.addRepresentation(drug, {
                  type: "ball-and-stick",
                  color: "uniform",
                  colorParams: { value: DRUG_COLOR },
                  typeParams: { sizeFactor: 0.32 },
                });
              }
              plugin.managers.structure.focus.setFromLoci(loci);
            }
            plugin.managers.camera.focusLoci(loci, { extraRadius: ligands?.length ? 6 : 2, durationMs: 800 });
          }
        }
        onReady?.();
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
          onReady?.();
        }
      }
    })();

    return () => {
      disposed = true;
      plugin.dispose();
      canvas.remove();
    };
  }, [info.structure_url, info.focus, poseUrl, onReady]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-sm text-destructive">
          Could not load the structure: {error}
        </div>
      )}
    </div>
  );
}
