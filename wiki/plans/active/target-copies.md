---
status: active
created: 2026-10-25
updated: 2026-10-25
tags: [cell, targets, ui]
related: ["[[off-target-pins]]", "[[effect-timeline]]"]
---

# Target pin: effect colour + "many copies" cloud

## Related
- builds-on: [[off-target-pins]] — same pins; off-targets stay grey
- builds-on: [[effect-timeline]] — copies appear after `PHASE.bind` on the shared clock

## Context
The target pin was red or teal only (red whenever its organelle had a block effect), and one pin read as "one molecule". Now the pin takes its organelle effect's direction colour, and ~14 small dots of the same colour appear in the target's organelle after binding.

## Done
- `Hotspot` colour = fixed purple `TARGET_COLOR` (was organelle effect tint; it clashed with the green "Increased" tint); `TargetCopies.tsx` instanced dots per region, follow squish, scrubbable
- Brief glow on the target organelle at bind (`OrganelleAnim.target`)
- Legend row "Small dots: more copies"

## Open
- Not checked: lisinopril (membrane), imatinib (cytoplasm), mitochondria targets
- ER/cytoplasm tooltip can overlap the target label
