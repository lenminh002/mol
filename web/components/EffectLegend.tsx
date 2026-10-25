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
    <ul className="scroll-thin absolute bottom-28 left-4 z-10 flex max-h-[38%] max-w-[calc(100%-2rem)] flex-col gap-1.5 overflow-y-auto sm:bottom-20 sm:max-w-[min(22rem,calc(100%-13rem))] lg:bottom-28 lg:max-w-[calc(100%-2rem)] xl:bottom-20 xl:max-w-[min(22rem,calc(100%-13rem))]">
      {result.effects.map((e, i) => (
        <li
          key={i}
          onMouseEnter={() => setHighlight(e.organelle)}
          onMouseLeave={() => setHighlight(null)}
          className={`cursor-default rounded border bg-card/95 px-2.5 py-1.5 text-[11px] leading-relaxed ${STATUS_STYLE[e.status]}`}
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
