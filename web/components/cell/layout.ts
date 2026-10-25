import * as THREE from "three";
import type { CellLocation, Direction, Effect, EffectStatus } from "@/lib/types";

export const MEMBRANE_RADIUS = 3;

// Where each organelle lives inside the cell. Hotspots and effects key off these.
export const ORGANELLES: Record<CellLocation, { position: THREE.Vector3; color: string; label: string }> = {
  membrane: { position: new THREE.Vector3(2.55, 1.15, 1.0), color: "#5eead4", label: "Membrane" },
  nucleus: { position: new THREE.Vector3(0.2, 0.15, -0.2), color: "#a78bfa", label: "Nucleus" },
  cytoplasm: { position: new THREE.Vector3(-1.3, -1.0, 0.9), color: "#94a3b8", label: "Cytoplasm" },
  mitochondria: { position: new THREE.Vector3(-1.5, 0.9, 0.6), color: "#fb923c", label: "Mitochondria" },
  er: { position: new THREE.Vector3(1.25, -0.9, 0.5), color: "#f472b6", label: "Endoplasmic reticulum" },
};

// Mitochondria scattered around the cytoplasm; the first one is the hotspot anchor.
export const MITO_POSITIONS: [THREE.Vector3, THREE.Euler][] = [
  [ORGANELLES.mitochondria.position, new THREE.Euler(0.4, 0.2, 0.9)],
  [new THREE.Vector3(-0.6, -1.8, -0.9), new THREE.Euler(1.2, 0.3, 0.1)],
  [new THREE.Vector3(1.6, 1.3, -1.0), new THREE.Euler(0.2, 1.1, 0.5)],
  [new THREE.Vector3(-1.9, -0.2, -1.2), new THREE.Euler(0.9, 0.7, 1.4)],
];

export const DRUG_ENTRY = new THREE.Vector3(5.5, 2.4, 2.2);

export interface OrganelleAnim {
  intensity: number; // emissive multiplier: >1 brighter, <1 dimmer
  pulse: number; // pulse speed, 0 = steady
  flicker: boolean; // disputed effects
  dashed: boolean; // speculative effects
  blocked: boolean;
  tint: string | null;
}

const NEUTRAL: OrganelleAnim = { intensity: 1, pulse: 0, flicker: false, dashed: false, blocked: false, tint: null };

const DIRECTION_TINT: Record<Direction, string> = { up: "#4ade80", down: "#60a5fa", block: "#f87171" };

// Collapse effects[] into one animation per organelle. Stronger, more confident effects win.
export function organelleAnims(effects: Effect[]): Record<CellLocation, OrganelleAnim> {
  const out = Object.fromEntries(
    (Object.keys(ORGANELLES) as CellLocation[]).map((k) => [k, { ...NEUTRAL }]),
  ) as Record<CellLocation, OrganelleAnim>;
  const weight: Partial<Record<CellLocation, number>> = {};

  for (const e of effects) {
    const w = e.magnitude * e.confidence;
    if ((weight[e.organelle] ?? -1) >= w) continue;
    weight[e.organelle] = w;
    out[e.organelle] = {
      intensity: e.direction === "up" ? 1.6 + e.magnitude : e.direction === "down" ? 0.5 - 0.3 * e.magnitude : 1.4,
      pulse: e.direction === "up" ? 2 + 2 * e.magnitude : e.direction === "block" ? 1 : 0,
      flicker: statusIs(e.status, "disputed"),
      dashed: statusIs(e.status, "speculative"),
      blocked: e.direction === "block",
      tint: DIRECTION_TINT[e.direction],
    };
  }
  return out;
}

function statusIs(s: EffectStatus, v: EffectStatus) {
  return s === v;
}

// Brightness factor for the current frame, shared by every organelle mesh.
export function animFactor(anim: OrganelleAnim, t: number, highlighted: boolean): number {
  let f = anim.intensity;
  if (anim.pulse) f *= 0.75 + 0.25 * Math.sin(t * anim.pulse * Math.PI);
  if (anim.flicker) f *= Math.sin(t * 13) * Math.sin(t * 7.3) > 0.2 ? 0.35 : 1;
  if (highlighted) f *= 1.4 + 0.4 * Math.sin(t * 6);
  return f;
}
