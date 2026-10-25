"use client";

import { useMemo, useRef } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { effectTimings, phaseLabel, PHASE } from "@/components/cell/effectTimeline";
import { replayPlayback, seekPlayback, setPlaybackSpeed, setPlaying, usePlayback } from "@/components/cell/playback";
import { useSim } from "@/lib/store";

const SPEEDS = [0.5, 1, 2];

const clock = (s: number) => `0:${String(Math.floor(s)).padStart(2, "0")}`;

// Play / pause / scrub the injection and the effects that follow it.
export function EffectTimeline() {
  const result = useSim((s) => s.result);
  const { t, playing, speed, duration } = usePlayback();
  const resumeAfterScrub = useRef(false);
  const onsets = useMemo(() => effectTimings(result?.effects ?? []).map((timing) => timing.onset), [result]);
  if (!result) return null;

  const button = "rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand";
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  const marks = [PHASE.injectStart, PHASE.bind, ...onsets];

  return (
    <div className="p-2.5" role="group" aria-label="Effect timeline">
      <div className="flex items-center gap-1">
        <button onClick={() => setPlaying(!playing)} className={button} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button onClick={replayPlayback} className={button} aria-label="Replay from the injection" title="Replay"><RotateCcw size={13} /></button>
        <button onClick={() => setPlaybackSpeed(nextSpeed)} className={`${button} font-mono text-[10px]`} aria-label={`Speed ${speed}x`} title="Playback speed">{speed}×</button>
        <span className="ml-auto text-[11px] font-medium">{phaseLabel(t, duration)}</span>
      </div>
      <div className="relative mt-2">
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={t}
          aria-label="Timeline position"
          onPointerDown={() => { resumeAfterScrub.current = playing; setPlaying(false); }}
          onPointerUp={() => { if (resumeAfterScrub.current) setPlaying(true); resumeAfterScrub.current = false; }}
          onChange={(e) => seekPlayback(Number(e.target.value))}
          className="h-1 w-full cursor-pointer accent-brand"
        />
        <div className="pointer-events-none absolute inset-x-0 top-3 h-1" aria-hidden>
          {marks.map((mark, i) => <span key={i} className="absolute h-1 w-px bg-border" style={{ left: `${(mark / duration) * 100}%` }} />)}
        </div>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground"><span>{clock(t)}</span><span>{clock(duration)}</span></div>
    </div>
  );
}
