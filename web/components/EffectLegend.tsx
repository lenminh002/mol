"use client";

import { useMemo } from "react";
import { effectProgress, effectTimings } from "@/components/cell/effectTimeline";
import { usePlayback } from "@/components/cell/playback";
import { useSim } from "@/lib/store";

const DIRECTION = { up: "↑", down: "↓", block: "⛔" } as const;
const STATUS_STYLE = {
  agreed: "border-brand/50",
  disputed: "border-destructive/60 border-dashed",
  speculative: "border-border border-dotted opacity-70",
} as const;

// Effect list in the reasoning sidebar; hovering one highlights its organelle in 3D.
export function EffectLegend() {
  const { result, setHighlight } = useSim();
  const { t } = usePlayback();
  const timings = useMemo(() => effectTimings(result?.effects ?? []), [result]);
  if (!result) return null;

  return (
    <ul className="flex flex-col gap-1.5">
      {result.effects.map((e, i) => (
        <li
          key={i}
          onMouseEnter={() => setHighlight(e.organelle)}
          onMouseLeave={() => setHighlight(null)}
          style={{ opacity: 0.4 + 0.6 * effectProgress(timings[i], t) }}
          className={`relative cursor-default overflow-hidden rounded border bg-transparent px-2.5 py-1.5 text-[11px] leading-relaxed ${STATUS_STYLE[e.status]}`}
        >
          <span className="mr-1">{DIRECTION[e.direction]}</span>
          <span className="font-medium">{e.pathway}</span>
          <span className="text-muted-foreground">
            {" "}
            · {e.organelle} · {e.status} · {Math.round(e.confidence * 100)}%
          </span>
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand" style={{ transform: `scaleX(${effectProgress(timings[i], t) * (0.4 + 0.6 * e.magnitude)})` }} />
        </li>
      ))}
    </ul>
  );
}
