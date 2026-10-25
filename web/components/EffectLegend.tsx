"use client";

import { useSim } from "@/lib/store";

const DIRECTION = { up: "↑", down: "↓", block: "⛔" } as const;
const STATUS_STYLE = {
  agreed: "border-brand/50",
  disputed: "border-destructive/60 border-dashed",
  speculative: "border-border border-dotted opacity-70",
} as const;

// Effect list overlaid on the cell; hovering one highlights its organelle in 3D.
export function EffectLegend() {
  const { result, setHighlight } = useSim();
  if (!result) return null;

  return (
    <ul className="absolute bottom-3 left-3 flex max-w-md flex-col gap-1.5">
      {result.effects.map((e, i) => (
        <li
          key={i}
          onMouseEnter={() => setHighlight(e.organelle)}
          onMouseLeave={() => setHighlight(null)}
          className={`cursor-default rounded-md border bg-card/85 px-2 py-1 text-xs backdrop-blur ${STATUS_STYLE[e.status]}`}
        >
          <span className="mr-1">{DIRECTION[e.direction]}</span>
          <span className="font-medium">{e.pathway}</span>
          <span className="text-muted-foreground">
            {" "}
            · {e.organelle} · {e.status} · {Math.round(e.confidence * 100)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
