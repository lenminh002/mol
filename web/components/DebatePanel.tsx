"use client";

import { useEffect, useRef } from "react";
import { cn } from "cn";
import { ChevronRight, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EffectLegend } from "@/components/EffectLegend";
import { ReasoningGraph } from "@/components/ReasoningGraph";
import { ChatThread } from "@/components/ChatThread";
import { TurnText } from "@/components/TurnText";
import { usePersistChat, useRunSimulation } from "@/lib/run";
import { useSim } from "@/lib/store";
import type { AgentName, SimulationResult } from "@/lib/types";

const AGENTS: Record<AgentName, { label: string; model: string; color: string }> = {
  proposer: { label: "Pharmacologist", model: "Claude", color: "text-claude border-claude/40" },
  skeptic: { label: "Skeptic", model: "Gemini", color: "text-gemini border-gemini/40" },
  judge: { label: "Judge", model: "Claude", color: "text-brand border-brand/40" },
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

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

// How the panel resolved: a one-line verdict, then mean confidence and source count.
function VerdictSummary({ result }: { result: SimulationResult }) {
  const total = result.effects.length;
  const agreed = result.effects.filter((e) => e.status === "agreed").length;
  const disputed = result.effects.filter((e) => e.status === "disputed").length;
  const speculative = result.effects.filter((e) => e.status === "speculative").length;
  const mean = total ? result.effects.reduce((sum, e) => sum + e.confidence, 0) / total : 0;
  const count = NUMBER_WORDS[total] ?? String(total);
  const rest = [disputed && `${disputed} disputed`, speculative && `${speculative} speculative`].filter(Boolean);
  return (
    <div>
      <h2 className="font-heading text-[26px] leading-[1.15] tracking-tight">
        {count} {total === 1 ? "effect" : "effects"},{" "}
        {agreed === total ? (
          <em className="text-brand">all agreed</em>
        ) : (
          <>
            <em className="text-brand">{agreed} agreed</em>
            {rest.length > 0 && <span className="text-muted-foreground">, {rest.join(", ")}</span>}
          </>
        )}
      </h2>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span title="Mean confidence across effects">{Math.round(mean * 100)}% confidence</span> · {result.citations.length}{" "}
        sources
      </p>
    </div>
  );
}

export function DebatePanel() {
  const { debate, toolCalls, status, statusMessage, result, input, chatPending, messages } = useSim();
  const open = useSim((s) => s.drawerOpen);
  const tab = useSim((s) => s.drawerTab);
  const setDrawer = useSim((s) => s.setDrawer);
  const run = useRunSimulation();
  usePersistChat();
  const citations = new Map(result?.citations.map((c) => [c.id, c]) ?? []);
  const scroller = useRef<HTMLDivElement>(null);
  const running = status === "running";
  const chat = tab === "chat";
  const width = "lg:w-[380px]";

  // Follow the debate as it streams; jump back to the verdict when it lands.
  useEffect(() => {
    const el = scroller.current;
    if (!el || chat) return;
    if (result) el.scrollTo({ top: 0, behavior: "smooth" });
    else if (running) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [debate.length, result, running, chat]);

  return (
    <aside
      className={cn(
        "relative min-w-0 overflow-hidden rounded-md bg-transparent transition-[width] duration-300 ease-in-out",
        open ? width : "lg:w-11",
      )}
    >
      <button
        onClick={() => setDrawer(true)}
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
          {messages.length > 0 ? "Chat" : "Reasoning"}
          {running ? " · running…" : chatPending ? " · replying…" : ""}
        </span>
      </button>
      <div
        inert={!open}
        className={cn(
          "flex h-full min-w-0 flex-col transition-opacity duration-200",
          width,
          !open && "pointer-events-none opacity-0 max-lg:hidden",
        )}
      >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3.5 pb-2 pt-3.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDrawer(false)}
            aria-label="Collapse panel"
            aria-expanded
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="size-4" />
          </button>
          {(["chat", "reasoning"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setDrawer(true, t)}
              aria-pressed={tab === t}
              className={cn(
                "text-[10px] font-medium uppercase tracking-[0.14em] transition-colors",
                tab === t ? "text-foreground underline underline-offset-4" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
              {t === "chat" && chatPending && <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-brand" />}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {!chat && result?.from_cache && input.preset && (
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
          {!chat && result && (
            <span className={cn("flex items-center gap-1.5 text-[11px]", result.from_cache ? "text-muted-foreground" : "text-brand")}>
              <span className="size-1.5 rounded-full bg-current" />
              {result.from_cache ? "saved run" : "live"}
            </span>
          )}
        </div>
      </div>

      <div
        ref={scroller}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3.5 pb-3.5 pt-2"
      >
      <div
        key={tab}
        className={cn(
          "flex flex-col gap-6 animate-in fade-in duration-300 ease-out",
          chat ? "slide-in-from-left-6" : "slide-in-from-right-6",
        )}
      >
      {chat && <ChatThread />}

      {!chat && status === "idle" && (
        <p className="text-sm text-muted-foreground">Run a simulation to watch the agents debate.</p>
      )}
      {!chat && (<>
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
          <EffectLegend />
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
          <div key={i} className={`border-l pl-3 ${a.color}`}>
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
        <div className="text-xs leading-relaxed text-muted-foreground">
          <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em]">Caveats</h3>
          <ul className="list-disc pl-4">
            {result.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      </>)}
      </div>
      </div>
      </div>
    </aside>
  );
}
