"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { ChevronRight, Loader2, RotateCw } from "lucide-react";
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

// Plain-English description of a tool call: what the agent did, and what it did it to.
function describeToolCall(tool: string, args: Record<string, unknown>): { verb: string; detail: string } {
  const s = (v: unknown) => (v == null ? "" : String(v));
  switch (tool) {
    case "drug_info":
      return { verb: "looked up drug info for", detail: s(args.name) };
    case "target_info":
      return { verb: "looked up target info for", detail: s(args.name) };
    case "dock":
      return { verb: "ran docking against", detail: s(args.target_name) };
    case "search_literature":
      return { verb: "searched the literature for", detail: s(args.query) };
    case "web_search":
      return { verb: "searched the web for", detail: s(args.query) };
    case "knowledge_graph":
      return { verb: "explored the knowledge graph for", detail: s(args.name) };
    case "mechanism_path":
      return {
        verb: "traced the mechanism path to",
        detail: [`${s(args.region)} from ${s(args.drug)}`, args.via ? `via ${s(args.via)}` : ""]
          .filter(Boolean)
          .join(" "),
      };
    case "off_targets":
      return { verb: "checked off-target effects of", detail: s(args.drug) };
    default:
      return {
        verb: `called ${tool}`,
        detail: Object.values(args).filter((v) => v != null).map(String).join(", "),
      };
  }
}

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
  const scroller = useRef<HTMLDivElement>(null);
  const running = status === "running";
  const [open, setOpen] = useState(false);

  // Follow the debate as it streams; jump back to the verdict when it lands.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (result) el.scrollTo({ top: 0, behavior: "smooth" });
    else if (running) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [debate.length, result, running]);

  return (
    <aside
      className={cn(
        "relative min-w-0 overflow-hidden rounded-md border bg-card transition-[width] duration-300 ease-in-out",
        open ? "lg:w-[380px]" : "lg:w-11",
      )}
    >
      <button
        onClick={() => setOpen(true)}
        aria-label="Expand reasoning"
        aria-expanded={false}
        inert={open}
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center gap-2 p-3 text-muted-foreground transition-opacity duration-200 hover:text-foreground max-lg:static max-lg:w-full lg:flex-col lg:px-0",
          open && "pointer-events-none opacity-0 max-lg:hidden",
        )}
      >
        <ChevronRight className="size-4 rotate-180" />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] lg:[writing-mode:vertical-rl]">
          Reasoning{running ? " · running…" : ""}
        </span>
      </button>
      <div
        ref={scroller}
        inert={!open}
        className={cn(
          "scroll-thin flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-3.5 transition-opacity duration-200 lg:w-[380px]",
          !open && "pointer-events-none opacity-0 max-lg:hidden",
        )}
      >
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setOpen(false)}
          aria-label="Collapse reasoning"
          aria-expanded
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className="size-4" />
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em]">Reasoning</h2>
        </button>
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
          <summary className="cursor-pointer">
            {toolCalls.length} tool {toolCalls.length === 1 ? "call" : "calls"}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {toolCalls.map((t, i) => {
              const a = AGENTS[t.agent as AgentName];
              const { verb, detail } = describeToolCall(t.tool, t.args);
              const raw = `${t.tool}(${Object.values(t.args).filter((v) => v != null).map(String).join(", ")})`;
              return (
                <li key={i} className="line-clamp-2" title={raw}>
                  <span className={`font-medium ${a?.color.split(" ")[0] ?? ""}`}>{a?.label ?? t.agent}</span>{" "}
                  {verb}
                  {detail && <> <span className="text-foreground/80">“{detail}”</span></>}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {debate.map((turn, i) => {
        const a = AGENTS[turn.agent];
        return (
          <div key={i} className={`rounded border bg-background/40 p-3 ${a.color}`}>
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
        <div className="rounded border p-3 text-xs leading-relaxed text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Caveats</div>
          <ul className="list-disc pl-4">
            {result.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </aside>
  );
}
