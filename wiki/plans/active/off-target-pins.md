---
status: active
created: 2026-10-25
updated: 2026-10-25
tags: [cell, targets, api, ui]
related: ["[[effect-timeline]]"]
---

# Show off-targets as extra pins in the cell view

## Related
- builds-on: [[effect-timeline]] — same cell scene; primary target still drives needle, particles and waves

## Context
Drugs usually bind several proteins, but the cell view shows one pin per run. The frontend already draws a `Hotspot` per entry in `result.targets`; the judge only returns the primary. Goal: primary stays the main pin, evidence-backed off-targets get distinct pins, labels and a legend row.

## Steps
1. Backend: `Target.role` (`primary` | `off_target`, default primary); judge prompt asks for up to 3 evidence-backed off-targets; `_assemble` passes role (off-targets get no PDB/docking).
2. Hand-edit `api/cache/imatinib-bcrabl.json` with LCK (cytoplasm) and NTRK1 (membrane) from the cached debate text.
3. Frontend: mirror `role` in `types.ts`; `Hotspot` variant (smaller, ring only, neutral colour, no bind flash); spread pins in `hotspotPosition`; lighter off-target labels; legend rows "Main target" / "Off-target".
4. `MoleculePanel`: off-targets without `pdb_id` show "No structure available"; clicking them only flies the camera.
5. Verify: pytest, tsc, eslint, preview imatinib + atorvastatin + an old history run.

## Done
- Backend `role` field, judge prompt, `_assemble`; imatinib cache gets LCK + NTRK1; `api/tests/test_targets.py` (pytest 49 passed)
- Frontend pins/labels/legend/spacing; off-target click flies the camera only; main target still opens molecule view
- Verified in preview with imatinib (patched history response); old single-target runs unchanged

## Open
- Fresh live run to confirm the judge actually returns <=3 evidence-backed off-targets (costs model calls) — not run
- Other demo caches (aspirin COX-2 etc.) not extended
