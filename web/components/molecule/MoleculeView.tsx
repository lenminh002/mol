"use client";

import { useEffect, useRef, useState } from "react";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec } from "molstar/lib/mol-plugin/spec";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { StructureSelection } from "molstar/lib/mol-model/structure";
import type { Structure } from "molstar/lib/mol-model/structure";
import { alignAndSuperpose } from "molstar/lib/mol-model/structure/structure/util/superposition";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import type { StructureHierarchyRef, StructureRef } from "molstar/lib/mol-plugin-state/manager/structure/hierarchy-state";
import { Color } from "molstar/lib/mol-util/color";
import { API_URL } from "@/lib/sse";

export type ViewMode = "drug" | "empty" | "apo" | "overlay";

export interface ApoInfo {
  pdb_id: string;
  chain: string;
  label: string;
  structure_url: string;
}

export interface Comparison {
  rmsd: number; // whole-chain RMSD after superposition (Å)
  aligned: number; // atoms used for the fit
  moved: { resname: string; resseq: number; shift: number }[]; // binding-site residues, largest shift first
  meanShift: number | null; // mean CA shift over the binding-site residues
}

export interface StructureInfo {
  pdb_id: string;
  apo?: ApoInfo;
  structure_url: string;
  focus: { ligands?: string[]; chain?: string; label: string };
  residues: { chain: string; resname: string; resseq: string; distance: number }[];
  residue_count: number;
}

interface Props {
  info: StructureInfo;
  poseUrl?: string | null; // docked pose (SDF), drawn on top of the crystal structure
  mode: ViewMode;
  onReady?: () => void;
  onCompare?: (c: Comparison | null) => void;
}

const BACKGROUND = Color(0xefece6);
const DRUG_COLOR = Color(0xd97706);
const SITE_COLOR = Color(0x0d9488);
const APO_COLOR = Color(0x7c3aed);
const APO_PROTEIN_COLOR = Color(0xc4b5fd);
const PROTEIN_COLOR = Color(0xb8c9c0);

// Drug side of the structure: crystal ligands, our drug component and the docked pose.
type Refs = {
  hierarchy: PluginContext["managers"]["structure"]["hierarchy"];
  holo: StructureRef;
  apoIndex: number | null; // position in hierarchy.current.structures; refs are rebuilt after a transform
  drug: StructureHierarchyRef[];
  site: ReturnType<typeof StructureSelection.toLociWithSourceUnits> | null;
};

// Mol* rendering engine embedded without its own UI, so it sits inside our layout.
export function MoleculeView({ info, poseUrl, mode, onReady, onCompare }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<(Refs & { plugin: PluginContext }) | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const onCompareRef = useRef(onCompare);
  onCompareRef.current = onCompare;

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
          const hierarchy = plugin.managers.structure.hierarchy;
          const drugRefs: StructureHierarchyRef[] = [];

          // Fade the protein so the pocket and the drug stand out.
          const polymer = ref.components.filter((c) => c.key?.includes("polymer"));
          await plugin.managers.structure.component.updateRepresentationsTheme(polymer, {
            color: "uniform",
            colorParams: { value: PROTEIN_COLOR },
          });

          // Binding-site residues (within 5 Å of the drug) in teal.
          const siteTests = info.residues.map((r) =>
            MS.struct.generator.atomGroups({
              "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), r.chain]),
              "residue-test": MS.core.rel.eq([MS.ammp("auth_seq_id"), parseInt(r.resseq, 10)]),
            }),
          );
          let siteLoci: Refs["site"] = null;
          if (siteTests.length) {
            const siteExpr = MS.struct.combinator.merge(siteTests);
            const site = await plugin.builders.structure.tryCreateComponentFromExpression(
              ref.cell, siteExpr, "mol-site", { label: "Binding site" },
            );
            if (site) {
              await plugin.builders.structure.representation.addRepresentation(site, {
                type: "ball-and-stick",
                color: "uniform",
                colorParams: { value: SITE_COLOR },
                typeParams: { sizeFactor: 0.18 },
              });
              await plugin.builders.structure.representation.addRepresentation(site, {
                type: "molecular-surface",
                color: "uniform",
                colorParams: { value: SITE_COLOR },
                typeParams: { alpha: 0.25 },
              });
            }
            siteLoci = StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(siteExpr, structure));
          }

          if (loci.elements.length > 0) {
            if (ligands?.length) {
              // Amber matches the drug particles in the cell view.
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
          // Crystal ligands and the docked pose are also "the drug".
          const current = hierarchy.current.structures;
          drugRefs.push(...(current[0]?.components ?? []).filter((c) => c.key?.includes("ligand") || c.cell.obj?.label === "Drug"));
          if (current[1]) drugRefs.push(current[1]);

          let apoIndex: number | null = null;
          if (info.apo) {
            try {
              const apo = await loadApo(plugin, info, structure);
              apoIndex = apo?.index ?? null;
              onCompareRef.current?.(apo?.comparison ?? null);
            } catch (e) {
              console.warn("Could not load the unbound structure", e); // keep the holo view working
            }
          }
          if (disposed) return;
          refs.current = { plugin, hierarchy, holo: current[0], apoIndex, drug: drugRefs, site: siteLoci };
          applyMode(refs.current, modeRef.current);
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
  }, [info, poseUrl, onReady]);

  // Switch views without rebuilding the scene, and frame the pocket so the change is visible.
  useEffect(() => {
    const r = refs.current;
    if (!r) return;
    applyMode(r, mode);
    if (r.site && r.site.elements.length > 0) r.plugin.managers.camera.focusLoci(r.site, { extraRadius: 4, durationMs: 500 });
  }, [mode]);

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

// Holo scene, unbound structure and drug each have their own visibility; order matters because
// showing a parent shows its whole subtree.
function applyMode(r: Refs & { plugin: PluginContext }, mode: ViewMode) {
  const holoVisible = mode !== "apo";
  const drugVisible = mode === "drug" || mode === "overlay";
  r.hierarchy.toggleVisibility([r.holo], holoVisible ? "show" : "hide");
  r.hierarchy.toggleVisibility(r.drug, holoVisible && drugVisible ? "show" : "hide");
  const apo = r.apoIndex != null ? r.hierarchy.current.structures[r.apoIndex] : null;
  if (apo) r.hierarchy.toggleVisibility([apo], mode === "apo" || mode === "overlay" ? "show" : "hide");
}

function chainCA(structure: Structure, chain: string) {
  const expr = MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), chain]),
    "atom-test": MS.core.rel.eq([MS.ammp("label_atom_id"), "CA"]),
  });
  return StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(expr, structure));
}

// Cα positions of one chain, straight from PDB text: independent of how Mol* transforms its copy.
function pdbCA(text: string, chain: string) {
  const out = new Map<number, { resname: string; xyz: Vec3 }>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("ATOM") || line.slice(12, 16) !== " CA " || line[21] !== chain) continue;
    out.set(parseInt(line.slice(22, 26), 10), {
      resname: line.slice(17, 20).trim(),
      xyz: Vec3.create(parseFloat(line.slice(30, 38)), parseFloat(line.slice(38, 46)), parseFloat(line.slice(46, 54))),
    });
  }
  return out;
}

// Loads the unbound structure, superposes it on the drug-bound chain by sequence alignment, and
// reports how far the binding-site residues moved.
async function loadApo(plugin: PluginContext, info: StructureInfo, holo: Structure): Promise<{ index: number; comparison: Comparison | null } | null> {
  const apo = info.apo!;
  const holoChain = info.focus.chain ?? "A";
  const before = plugin.managers.structure.hierarchy.current.structures.length;
  const data = await plugin.builders.data.download({ url: `${API_URL}/${apo.structure_url}`, isBinary: false });
  const traj = await plugin.builders.structure.parseTrajectory(data, "pdb");
  await plugin.builders.structure.hierarchy.applyPreset(traj, "default", { representationPreset: "polymer-cartoon" });
  const ref = plugin.managers.structure.hierarchy.current.structures[before];
  const apoStructure = ref?.cell.obj?.data;
  if (!ref || !apoStructure) return null;

  const holoLoci = chainCA(holo, holoChain);
  const apoLoci = chainCA(apoStructure, apo.chain);
  const [fit] = alignAndSuperpose([holoLoci, apoLoci]);
  if (!fit) return { index: before, comparison: null };


  await plugin.runTask(
    plugin.state.data.updateTree(
      plugin.state.data.build().to(ref.cell).insert(StateTransforms.Model.TransformStructureConformation, {
        transform: { name: "matrix", params: { data: fit.bTransform, transpose: false } },
      }),
    ),
  );
  const fresh = () => plugin.managers.structure.hierarchy.current.structures[before]; // rebuilt by the transform
  await plugin.managers.structure.component.updateRepresentationsTheme(fresh().components, {
    color: "uniform",
    colorParams: { value: APO_PROTEIN_COLOR },
  });

  // Residue numbering can differ between entries, so pair each drug-bound pocket residue with the nearest
  // residue of the same type in the superposed unbound structure. Only residues on the fitted chain:
  // the unbound structure may be a monomer while the pocket also takes residues from other chains.
  const [holoText, apoText] = await Promise.all(
    [info.structure_url, apo.structure_url].map((u) => fetch(`${API_URL}/${u}`).then((r) => r.text())),
  );
  const holoCA = pdbCA(holoText, holoChain);
  const apoCA = [...pdbCA(apoText, apo.chain)].map(([seq, v]) => ({
    seq,
    resname: v.resname,
    xyz: Vec3.transformMat4(Vec3(), v.xyz, fit.bTransform),
  }));
  const moved: Comparison["moved"] = [];
  const apoSeqs: number[] = [];
  for (const r of info.residues.filter((x) => x.chain === holoChain)) {
    const home = holoCA.get(parseInt(r.resseq, 10));
    if (!home) continue;
    let best: { seq: number; d: number } | null = null;
    for (const c of apoCA) {
      if (c.resname !== r.resname) continue;
      const d = Vec3.distance(home.xyz, c.xyz);
      if (!best || d < best.d) best = { seq: c.seq, d };
    }
    if (!best || best.d > 6) continue; // no counterpart nearby: skip rather than report a bogus shift
    apoSeqs.push(best.seq);
    moved.push({ resname: r.resname, resseq: parseInt(r.resseq, 10), shift: best.d });
  }
  moved.sort((x, y) => y.shift - x.shift);

  // Matched unbound residues in violet, to read against the teal drug-bound ones.
  if (apoSeqs.length) {
    const siteExpr = MS.struct.combinator.merge(
      apoSeqs.map((seq) =>
        MS.struct.generator.atomGroups({
          "chain-test": MS.core.rel.eq([MS.ammp("auth_asym_id"), apo.chain]),
          "residue-test": MS.core.rel.eq([MS.ammp("auth_seq_id"), seq]),
        }),
      ),
    );
    const site = await plugin.builders.structure.tryCreateComponentFromExpression(fresh().cell, siteExpr, "mol-apo-site", {
      label: "Apo binding site",
    });
    if (site) {
      await plugin.builders.structure.representation.addRepresentation(site, {
        type: "ball-and-stick",
        color: "uniform",
        colorParams: { value: APO_COLOR },
        typeParams: { sizeFactor: 0.18 },
      });
    }
  }

  const comparison: Comparison = {
    rmsd: fit.rmsd,
    aligned: fit.nAlignedElements,
    moved: moved.slice(0, 5),
    meanShift: moved.length ? moved.reduce((t, m) => t + m.shift, 0) / moved.length : null,
  };
  return { index: before, comparison };
}
