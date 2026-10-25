---
status: done
created: 2026-10-25
updated: 2026-10-25
tags: [cell-view, camera, bug-fix]
related: []
---

## Context
Inside the cell, left-drag doesn't orbit the camera, but outside it does. In `web/components/cell/CellScene.tsx` the squish-grab handler raycasts against `proxy`, an invisible membrane mesh (`SphereGeometry` scaled by `membraneRadiusAt`). The material is `THREE.DoubleSide` (line 80), so from inside the cell the ray hits the membrane's inner wall. The handler (line ~249-254) then sets `control.mouseButtons.left` and `control.touches.one` to `ACTION.NONE` and starts a squish drag, which steals the gesture from `CameraControls`. Outside the cell, empty-background clicks miss the proxy, so orbit works.

## Change
1. `web/components/cell/CellScene.tsx:80`: change the proxy material to `side: THREE.FrontSide`.
   - `SphereGeometry` faces point outward. The per-vertex radial rescale (lines 74-78) and the later squish deformation preserve that, so the winding is correct.
   - Raycasts honor material side, so only the outer surface can be grabbed. Squishing from outside is unchanged. From inside, the ray passes through the membrane, `hit` is undefined, and left-drag stays mapped to orbit.
2. Confirm `proxy` is used for nothing else that needs back-face hits. It only appears in the grab raycast (line 249) and its own setup and dispose code.
3. Fallback if FrontSide misbehaves (for example, a camera sitting just outside the surface): in the pointer-down handler, skip the grab when the camera is inside the membrane. Compare `camera.position.length()` against `membraneRadiusAt(camera.position.clone().normalize())`.

## Verification
- `preview_start` the web dev server and open the cell view.
- Outside the cell: dragging the cell still squishes it, and dragging the background still orbits.
- Zoom inside the cell (scroll or W): left-drag now orbits, including fully over the top and bottom.
- Check the console for errors.
- Optionally run `npm run lint` and `npm run build` in `web/`.

## Housekeeping
Per AGENTS.md, save a copy of this plan as `wiki/plans/active/cell-inside-orbit-fix.md` with frontmatter on implementation. First scan the active plans for overlap; `target-copies.md` is modified in the working tree.
