import * as THREE from "three";
import type { CellLocation, Direction, Effect, EffectStatus } from "@/lib/types";

export const MEMBRANE_RADIUS = 3;
export const MEMBRANE_HEIGHT = 1.8;
export const MICRONS_PER_UNIT = 5;
export const NUCLEUS_RADIUS = 0.75;

// A whole, flattened animal cell. This radial function is also the source of truth
// for target anchors, placement rejection, and the CPU interaction proxy.
export function membraneRadiusAt(dir: THREE.Vector3): number {
  const theta = Math.atan2(dir.z, dir.x);
  const outline = MEMBRANE_RADIUS *
    (1 + 0.045 * Math.sin(theta * 3 + 0.4) + 0.025 * Math.cos(theta * 5 - 0.8));
  const length = dir.length() || 1;
  const x = dir.x / length;
  const y = dir.y / length;
  const z = dir.z / length;
  const bump =
    0.018 * Math.sin(2.1 * x + 1.3) * Math.sin(1.7 * y + 0.4) +
    0.014 * Math.sin(2.6 * z - 0.8) * Math.cos(1.9 * x) +
    0.009 * Math.sin(3.4 * y + 2.2 * z);
  return (1 + bump) / Math.sqrt((x * x + z * z) / (outline * outline) + y * y / (MEMBRANE_HEIGHT * MEMBRANE_HEIGHT));
}

export const GOLGI_POSITION = new THREE.Vector3(1.05, 0.05, -0.8);
export const CENTROSOME_POSITION = new THREE.Vector3(0.52, 0.3, -0.25);

// Where each organelle lives inside the cell. Hotspots and effects key off these.
export const ORGANELLES: Record<CellLocation, { position: THREE.Vector3; color: string; label: string }> = {
  membrane: { position: new THREE.Vector3(2.3, 0.45, 1.3), color: "#d89a52", label: "Cell membrane" },
  nucleus: { position: new THREE.Vector3(-0.45, 0.1, 0.05), color: "#bca6c8", label: "Nucleus" },
  cytoplasm: { position: new THREE.Vector3(-1.2, -0.65, 1.05), color: "#e4cfaa", label: "Cytoplasm" },
  mitochondria: { position: new THREE.Vector3(1.1, 0.55, 1.0), color: "#c87758", label: "Mitochondria" },
  er: { position: new THREE.Vector3(-1.55, 0.25, -0.1), color: "#88a99e", label: "Endoplasmic reticulum" },
};

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function insideCell(point: THREE.Vector3, clearance = 0): boolean {
  const distance = point.length();
  return distance < membraneRadiusAt(point) - clearance;
}

export interface MitochondrionPlacement {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: number;
}

// Dimensions are physical; 160 is a representative abundance, rather than a
// claim about a particular human cell type. The first logical instance is fixed.
export const MITOCHONDRIA: MitochondrionPlacement[] = (() => {
  const random = seededRandom(73421);
  const placements: MitochondrionPlacement[] = [{
    position: ORGANELLES.mitochondria.position,
    rotation: new THREE.Euler(0.35, 0.2, 0.9),
    scale: 1.1,
  }];
  for (let attempt = 0; placements.length < 160 && attempt < 30000; attempt++) {
    const position = new THREE.Vector3((random() - 0.5) * 5.6, (random() - 0.5) * 3.1, (random() - 0.5) * 5.6);
    if (!insideCell(position, 0.23)) continue;
    const nuclearDistance = position.distanceTo(ORGANELLES.nucleus.position);
    if (nuclearDistance < 1.37 || position.distanceTo(GOLGI_POSITION) < 0.65) continue;
    if (placements.some((other) => other.position.distanceToSquared(position) < 0.035)) continue;
    placements.push({
      position,
      rotation: new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI),
      scale: 0.78 + random() * 0.55,
    });
  }
  return placements;
})();

// Retain this convenient tuple interface for consumers of the old layout.
export const MITO_POSITIONS: [THREE.Vector3, THREE.Euler][] = MITOCHONDRIA.map(({ position, rotation }) => [position, rotation]);

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

const DIRECTION_TINT: Record<Direction, string> = { up: "#368d69", down: "#5a87bd", block: "#c55e54" };

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
