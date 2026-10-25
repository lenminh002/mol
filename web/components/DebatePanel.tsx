"use client";

import { useEffect, useRef } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReasoningGraph } from "@/components/ReasoningGraph";
import { TurnText } from "@/components/TurnText";
import { useRunSimulation } from "@/lib/run";
import { useSim } from "@/lib/store";
import type { AgentName, EffectStatus, SimulationResult } from "@/lib/types";

const AGENTS: Record<AgentName, { label: string; model: string; color: string }> = {
  proposer: { label: "Pharmacologist", model: "Claude", color: "text-claude border-claude/40" },
  skeptic: { label: "Skeptic", model: "Gemini", color: "text-gemini border-gemini/40" },
  judge: { label: "Judge", model: "Claude", color: "text-brand border-brand/40" },
};

const STATUS_STYLE: Record<EffectStatus, string> = {
  agreed: "border-brand/50 text-brand",
  disputed: "border-destructive/60 text-destructive",
  speculative: "border-border text-muted-foreground",
};

// How the panel resolved: counts per status and the mean confidence of the effects.
function VerdictSummary({ result }: { result: SimulationResult }) {
  const counts = result.effects.reduce<Partial<Record<EffectStatus, number>>>(
    (acc, e) => ({ ...acc, [e.status]: (acc[e.status] ?? 0) + 1 }),
    {},
  );
  const mean = result.effects.length
    ? result.effects.reduce((sum, e) => sum + e.confidence, 0) / result.effects.length
    : 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(["agreed", "disputed", "speculative"] as const).map(
        (s) =>
          counts[s] && (
            <Badge key={s} variant="outline" className={STATUS_STYLE[s]}>
              {counts[s]} {s}
            </Badge>
          ),
      )}
      <Badge variant="outline" title="Mean confidence across effects">
        confidence {Math.round(mean * 100)}%
      </Badge>
      <Badge variant="outline">{result.citations.length} sources</Badge>
    </div>
  );
}

export function DebatePanel() {
  const { debate, toolCalls, status, statusMessage, result, input } = useSim();
  const run = useRunSimulation();
  const citations = new Map(result?.citations.map((c) => [c.id, c]) ?? []);
  const scroller = useRef<HTMLElement>(null);
  const running = status === "running";

  // Follow the debate as it streams; jump back to the verdict when it lands.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (result) el.scrollTo({ top: 0, behavior: "smooth" });
    else if (running) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [debate.length, result, running]);

  return (
    <aside ref={scroller} className="scroll-thin flex flex-col gap-3 overflow-y-auto rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reasoning</h2>
        <div className="flex items-center gap-1.5">
          {result?.from_cache && input.preset && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              title="Run the debate again with live model calls (about 1–2 minutes)"
              onClick={() => run({ preset: input.preset, fresh: true })}
            >
              <RotateCw className="size-3" /> Run live
            </Button>
          )}
          {result && <Badge variant="outline">{result.from_cache ? "saved run" : "live"}</Badge>}
        </div>
      </div>

      {status === "idle" && (
        <p className="text-sm text-muted-foreground">Run a simulation to watch the agents debate.</p>
      )}
      {statusMessage && (
        <p
          className={`flex items-start gap-2 text-sm ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {running && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
          <span className="line-clamp-3">{statusMessage}</span>
        </p>
      )}

      {result && (
        <>
          <VerdictSummary result={result} />
          <ReasoningGraph />
        </>
      )}

      {toolCalls.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{toolCalls.length} tool calls</summary>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono">
            {toolCalls.map((t, i) => (
              <li key={i} className="truncate">
                {t.agent}: {t.tool}({Object.values(t.args).filter((v) => v != null).map(String).join(", ")})
              </li>
            ))}
          </ul>
        </details>
      )}

      {debate.map((turn, i) => {
        const a = AGENTS[turn.agent];
        return (
          <div key={i} className={`rounded-lg border bg-background/50 p-3 ${a.color}`}>
            <div className="mb-1 text-xs font-medium">
              {a.label}{" "}
              <span className="text-muted-foreground">
                · {turn.model ?? a.model} · round {turn.round}
              </span>
            </div>
            <TurnText text={turn.text} citations={citations} />
          </div>
        );
      })}

      {result && result.caveats.length > 0 && (
        <div className="rounded-lg border p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Caveats</div>
          <ul className="list-disc pl-4">
            {result.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
