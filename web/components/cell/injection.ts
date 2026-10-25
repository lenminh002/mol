import { DRUG_ENTRY, membraneRadiusAt } from "./layout";
import { PHASE, smoothstep } from "./effectTimeline";

// Pure functions of the playback clock, so scrubbing the timeline in either direction
// always shows the right needle, dent and plunger.

export const NEEDLE_DIR = DRUG_ENTRY.clone().normalize(); // outward axis through the entry point
export const NEEDLE_CONTACT = NEEDLE_DIR.clone().multiplyScalar(membraneRadiusAt(NEEDLE_DIR));

const START_HEIGHT = 2.4; // how far outside the membrane the needle begins
export const NEEDLE_DEPTH = 0.6; // how far the tip sits inside the cell while injecting
const MAX_DENT = 0.32;

/** Where the drug leaves the needle, just inside the membrane. */
export const INJECTION_POINT = NEEDLE_CONTACT.clone().addScaledVector(NEEDLE_DIR, -NEEDLE_DEPTH);

/** Inward displacement of the membrane under the needle: pressed in, then a damped spring-back. */
export function membraneDent(t: number): number {
  if (t <= PHASE.needleArrive) return 0;
  if (t < PHASE.pierce) return MAX_DENT * smoothstep((t - PHASE.needleArrive) / (PHASE.pierce - PHASE.needleArrive));
  const tau = t - PHASE.pierce;
  return tau > 1.4 ? 0 : MAX_DENT * Math.exp(-6 * tau) * Math.cos(14 * tau);
}

export const DENT_END = PHASE.pierce + 1.4;

/** Needle tip position along the outward axis, relative to the resting membrane surface. */
export function needleHeight(t: number): number {
  if (t < PHASE.needleArrive) return START_HEIGHT * (1 - smoothstep(t / PHASE.needleArrive));
  if (t < PHASE.pierce) return -membraneDent(t);
  if (t < PHASE.injectStart) return -MAX_DENT - (NEEDLE_DEPTH - MAX_DENT) * smoothstep((t - PHASE.pierce) / (PHASE.injectStart - PHASE.pierce));
  if (t < PHASE.injectEnd) return -NEEDLE_DEPTH;
  const out = smoothstep((t - PHASE.injectEnd) / (PHASE.withdrawEnd - PHASE.injectEnd));
  return -NEEDLE_DEPTH + (START_HEIGHT + NEEDLE_DEPTH) * out * out;
}

/** 0 = plunger fully back, 1 = syringe emptied. */
export function plungeAmount(t: number): number {
  return smoothstep((t - PHASE.injectStart) / (PHASE.injectEnd - PHASE.injectStart));
}

export function needleOpacity(t: number): number {
  return smoothstep(t / 0.4) * (1 - smoothstep((t - (PHASE.withdrawEnd - 0.6)) / 0.6));
}
