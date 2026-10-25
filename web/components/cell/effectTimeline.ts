import type { Effect } from "@/lib/types";

// Seconds on the shared playback clock. The cell is injected first, the drug finds its
// target, then each effect spreads outward in the order the panel's judge listed them.
export const PHASE = {
  needleArrive: 1.5, // needle tip reaches the membrane and starts pressing in
  pierce: 2.2, // membrane gives way
  injectStart: 2.6, // plunger starts moving
  injectEnd: 4.5,
  withdrawEnd: 5.5, // needle is gone
  bind: 6.6, // drug has docked at the target; peak of the binding flash
  cascadeStart: 7.6, // first effect begins to change the cell
} as const;

const STAGGER = 1.8; // seconds between successive effects
const RAMP = 3; // seconds for one effect to reach full strength
const HOLD = 2.5; // seconds to linger on the final state

export interface EffectTiming {
  onset: number;
  ramp: number;
}

export function smoothstep(x: number) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

// The API carries no time information, so order alone drives onset: the judge lists the
// target's own effect first and the downstream consequences after it.
export function effectTimings(effects: Effect[]): EffectTiming[] {
  return effects.map((_, index) => ({ onset: PHASE.cascadeStart + index * STAGGER, ramp: RAMP }));
}

export function timelineDuration(effects: Effect[]): number {
  const timings = effectTimings(effects);
  const last = timings[timings.length - 1];
  return last ? last.onset + last.ramp + HOLD : PHASE.cascadeStart + RAMP + HOLD;
}

/** 0 before the effect starts, 1 once it has fully taken hold. */
export function effectProgress(timing: EffectTiming, t: number): number {
  return smoothstep((t - timing.onset) / timing.ramp);
}

export function phaseLabel(t: number, duration: number): string {
  if (t >= duration) return "Final state";
  if (t < PHASE.injectStart) return "Needle approaches";
  if (t < PHASE.injectEnd) return "Injecting drug";
  if (t < PHASE.cascadeStart) return "Drug reaches its target";
  return "Effects spreading";
}
