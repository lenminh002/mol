---
status: active
created: 2026-10-24
updated: 2026-10-24
tags: [ui, sidebar, design]
related: []
---

# Redesign the left "Setup" sidebar to match Mol's vibe

## Context
The expanded left sidebar ([DrugPanel.tsx](web/components/DrugPanel.tsx)) reads as generic shadcn: three identical full-width bordered grey buttons/inputs ("New chat", "Run", fields), tiny uppercase labels, and flat history cards. Mol's vibe is warm paper, fine rules, quiet ink, a teal brand (`--brand #0f766e`), and an italic Instrument Serif wordmark (`font-heading`). The sidebar has no hierarchy (Run, the primary action, looks the same as New chat) and doesn't use the serif or the teal at all.

Scope: visual-only restyle of the expanded state of `DrugPanel`. No behavior, state, or collapsed rail changes.

## Design direction
"Lab notebook" feel: serif headings, hairline rules instead of boxes, teal reserved for the one primary action.

1. **Header row** – replace the bare chevron + "SETUP" with a serif italic `Setup` title (`font-heading text-xl italic`) at left, collapse chevron (icon-only, `aria-label` kept) at right. Hairline `border-b` beneath.
2. **New chat** – demote to a ghost/text button (`variant="ghost"`, left-aligned, `Plus` icon, muted text, hover `bg-muted`), so it no longer competes with Run.
3. **Section label** – "Understood as" / "Or set it up" becomes a serif italic subheading (`font-heading text-base`) instead of 10px caps; keep the caps style only for tiny meta (History).
4. **Fields** – labeled pairs ("Drug", "Target") with small caps labels above, inputs with `bg-background`, `h-9`, `rounded-md`, subtle inner border `border-input`, teal focus ring (already `--ring`). Helper "Not right? Edit the fields and run again." becomes a muted italic note with a small teal `Sparkles`/`Pencil` dot-icon, shown only when `fromPrompt`.
5. **Run** – primary: `variant="default"` (teal fill, white text), full width, `Play` icon, disabled state unchanged. Only filled element in the sidebar.
6. **History** – section header with caps label + a count; "Clear all" as small muted text button. Items become borderless rows separated by hairlines (`divide-y`), text `text-sm`, 2-line clamp, left teal accent bar (`border-l-2 border-transparent hover:border-brand`) on hover, delete `X` only visible on row hover/focus (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`). Empty state: one muted italic line.
7. **Rhythm** – container `gap-6 p-4`; sections separated by hairlines (`border-border`), no nested card-in-card.

## Files
- Modify: [web/components/DrugPanel.tsx](web/components/DrugPanel.tsx) (markup/classNames only; `SectionLabel` helper adjusted, add a small `SectionTitle`/`Field` helper locally).
- Reuse as-is: `Button` ([ui/button.tsx](web/components/ui/button.tsx)) variants `default`/`ghost`, `Input` ([ui/input.tsx](web/components/ui/input.tsx)), tokens in [globals.css](web/app/globals.css) (`--brand`, `--border`, `font-heading`). No new tokens needed.
- Optional follow-up for consistency: apply the same header/serif-title treatment to [DebatePanel.tsx](web/components/DebatePanel.tsx) ("Reasoning") so both sidebars match — not part of this change unless requested.

## Constraints to preserve
- `collapsed` width transition, `inert`, `aria-*` attributes, vertical "Setup" rail button.
- Datalist autocomplete, `parsed` → fields sync, `fromPrompt` conditional copy, `running` disables.
- Mobile (`max-lg`) stacking behavior.

## Verification
1. `./dev.sh` (web on :3000); open via `preview_start`, expand the sidebar.
2. Screenshot at desktop and at `mobile` preset; compare against the current screenshot for hierarchy (Run is the only teal-filled element).
3. Exercise: type a drug (datalist), run a preset so "Understood as" + helper note appear, hover/focus history rows (delete X reveal, keyboard focus visible), Clear all, New chat, collapse/expand animation.
4. `cd web && npm run lint` and `npx tsc --noEmit`; check console for errors.

## Housekeeping (on execution)
Per AGENTS.md, save this plan as `wiki/plans/active/sidebar-redesign.md` with frontmatter (no `wiki/` folder exists yet in this repo, so create `wiki/plans/active/` or run `/wiki-init` first).
