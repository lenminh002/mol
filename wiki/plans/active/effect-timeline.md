---
status: active
created: 2026-10-24
updated: 2026-10-24
tags: [ui, cell, animation, effects]
related: []
---

# Effect timeline: needle injection, then gradual cell change

## Context
Drug effects were static: they switched on the instant a result arrived. Now a shared playback clock drives a needle injection, a drug-binding moment, signal waves, and per-organelle effects that build up gradually, with a scrubber and legend sync.

## Done
- `playback.ts` shared clock + `usePlayback`; `effectTimeline.ts` phases and per-effect onset (judge order, 1.8s apart, 3s ramp)
- `Needle.tsx` + `injection.ts`: syringe presses/dents membrane, pierces, plunges, withdraws
- `DrugParticles.tsx`: released from the needle, travel and dock at the target (seeded, scrubbable)
- `SignalWave.tsx`: orb + ring from target to each affected organelle at its onset
- `Organelles.tsx`/`layout.ts` `liveAnim`: gradual tint/glow/scale/darken per direction
- `EffectTimeline.tsx` (play/pause/replay/speed/scrub) and `EffectLegend.tsx` cards light up in sequence

## Open
- Only the strongest effect per organelle drives the 3D look (weaker ones only show in the legend)
- Tune glow/tint strengths and check other presets (imatinib, atorvastatin, tamoxifen, lisinopril)
