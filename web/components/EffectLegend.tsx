"use client";

import { useMemo } from "react";
import { effectProgress, effectTimings } from "@/components/cell/effectTimeline";
import { usePlayback } from "@/components/cell/playback";
import { useSim } from "@/lib/store";

const DIRECTION = { up: "↑", down: "↓", block: "⛔" } as const;
const STATUS_STYLE = {
  agreed: { text: "text-foreground", bar: "bg-brand" },
  disputed: { text: "text-destructive", bar: "bg-destructive" },
  speculative: { text: "text-muted-foreground italic", bar: "bg-muted-foreground/60" },
} as const;

// Effect list in the reasoning sidebar; hovering one highlights its organelle in 3D.
export function EffectLegend() {
  const { result, setHighlight } = useSim();
  const { t } = usePlayback();
  const timings = useMemo(() => effectTimings(result?.effects ?? []), [result]);
  if (!result) return null;

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Effects</h3>
      <ul className="flex flex-col">
        {result.effects.map((e, i) => {
          const style = STATUS_STYLE[e.status];
          const progress = effectProgress(timings[i], t);
          return (
            <li
              key={i}
              onMouseEnter={() => setHighlight(e.organelle)}
              onMouseLeave={() => setHighlight(null)}
              style={{ opacity: 0.4 + 0.6 * progress }}
              className="grid cursor-default grid-cols-[1rem_1fr_auto] items-start gap-x-2 py-2.5"
            >
              <span className="text-brand">{DIRECTION[e.direction]}</span>
              <div className="min-w-0">
                <div className={`text-sm leading-snug ${style.text}`}>{e.pathway}</div>
                <div className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                  {e.organelle}
                  {e.status !== "agreed" && ` · ${e.status}`}
                </div>
              </div>
              <span className="font-mono text-xs text-muted-foreground">{Math.round(e.confidence * 100)}%</span>
              <div className="col-span-3 mt-2 h-0.5 bg-border">
                <div
                  aria-hidden
                  className={`h-full origin-left ${style.bar} ${e.status === "speculative" ? "opacity-60" : ""}`}
                  style={{ transform: `scaleX(${progress * (0.4 + 0.6 * e.magnitude)})` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
