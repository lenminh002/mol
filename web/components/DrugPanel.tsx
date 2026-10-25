"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, MessageSquare, Pencil, Play, Plus, X } from "lucide-react";
import { useHistory } from "@/lib/history";
import { useLoadRun, useNewChat, useRunSimulation } from "@/lib/run";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</h3>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="font-heading text-lg italic leading-none text-foreground">{children}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

// PubChem-backed drug name suggestions, debounced.
function useDrugSuggestions(query: string): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`${API_URL}/autocomplete?q=${encodeURIComponent(query.trim())}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then(setSuggestions)
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);
  return suggestions;
}

export function DrugPanel() {
  const { status, parsed, input, setPrompt, runId } = useSim();
  const run = useRunSimulation();
  const { items, refresh, remove, clear } = useHistory();
  const loadRun = useLoadRun();
  const newChat = useNewChat();
  const [drug, setDrug] = useState("");
  const [target, setTarget] = useState("");
  const suggestions = useDrugSuggestions(drug);
  const listId = useId();
  const [collapsed, setCollapsed] = useState(true);

  // History loads after mount so server and client markup match.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Show what the backend understood a question as, so the user can correct it and re-run.
  useEffect(() => {
    if (!parsed) return;
    setDrug(parsed.drug);
    setTarget(parsed.target ?? "");
  }, [parsed]);

  const running = status === "running";
  const fromPrompt = parsed && input.prompt;

  return (
    <aside
      className={cn(
        "relative min-w-0 overflow-hidden rounded-md border bg-card transition-[width] duration-300 ease-in-out",
        collapsed ? "lg:w-11" : "lg:w-[300px]",
      )}
    >
      <button
        onClick={() => setCollapsed(false)}
        aria-label="Expand sidebar"
        aria-expanded={false}
        inert={!collapsed}
        className={cn(
          "absolute inset-y-0 left-0 flex w-11 items-center gap-2 p-3 text-muted-foreground transition-opacity duration-200 hover:text-foreground max-lg:static max-lg:w-full lg:flex-col lg:px-0",
          !collapsed && "pointer-events-none opacity-0 max-lg:hidden",
        )}
      >
        <ChevronRight className="size-4" />
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] lg:[writing-mode:vertical-rl]">
          Setup
        </span>
      </button>
      <div
        className={cn(
          "scroll-thin flex h-full min-w-0 flex-col gap-6 overflow-y-auto p-4 transition-opacity duration-200 lg:w-[300px]",
          collapsed && "pointer-events-none opacity-0 max-lg:hidden",
        )}
        inert={collapsed}
      >
      <div className="flex items-center justify-between border-b pb-3">
        <h2 className="font-heading text-2xl italic leading-none">Setup</h2>
        <button
          onClick={() => setCollapsed(true)}
          aria-label="Collapse sidebar"
          aria-expanded
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>
      <Button
        variant="ghost"
        className="-mt-3 justify-start text-muted-foreground"
        onClick={() => {
          newChat();
          setDrug("");
          setTarget("");
        }}
      >
        <Plus className="size-4" /> New chat
      </Button>

      <section className="flex flex-col gap-3">
        <SectionTitle>{fromPrompt ? "Understood as" : "Or set it up"}</SectionTitle>
        <Field label="Drug">
          <Input
            className="h-9 rounded-md bg-background"
            value={drug}
            onChange={(e) => setDrug(e.target.value)}
            placeholder="e.g. imatinib"
            list={listId}
            autoComplete="off"
          />
        </Field>
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Field label="Target">
          <Input
            className="h-9 rounded-md bg-background"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="optional, e.g. BCR-ABL"
          />
        </Field>
        {fromPrompt && (
          <p className="flex items-center gap-1.5 text-xs italic text-muted-foreground">
            <Pencil className="size-3 shrink-0 text-brand" />
            Not right? Edit the fields and run again.
          </p>
        )}
        <Button
          className="h-9 w-full"
          disabled={running || !drug.trim()}
          onClick={() => run({ drug: drug.trim(), target: target.trim() || undefined })}
        >
          <Play className="size-3.5 fill-current" /> Run
        </Button>
      </section>

      <section className="flex flex-col gap-1 border-t pt-5">
        <div className="mb-1 flex items-center justify-between">
          <SectionLabel>History{items.length > 0 && ` · ${items.length}`}</SectionLabel>
          {items.length > 0 && (
            <button onClick={clear} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              Clear all
            </button>
          )}
        </div>
        {items.length === 0 && (
          <p className="text-xs italic text-muted-foreground">No history yet. Press Tab in the box below for an example.</p>
        )}
        <div className="flex flex-col divide-y">
        {items.map((h) => (
          <div
            key={h.id}
            className={cn(
              "group flex items-start gap-1 border-l-2 transition-colors hover:border-brand hover:bg-muted/40",
              h.id === runId ? "border-brand bg-muted/40" : "border-transparent",
            )}
          >
            <button
              disabled={running}
              onClick={() => {
                if (h.req.prompt) setPrompt(h.req.prompt);
                loadRun(h.id);
              }}
              className="min-w-0 flex-1 py-2.5 pl-2.5 text-left text-sm disabled:opacity-40"
            >
              <span className="line-clamp-2">{h.label}</span>
              {(h.chat_count ?? 0) > 0 && (
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageSquare className="size-3 shrink-0" />
                  <span className="shrink-0">{h.chat_count}</span>
                  {h.id === runId && <span className="shrink-0 font-medium text-brand">Active</span>}
                  <span className="truncate italic">{h.chat_preview}</span>
                </span>
              )}
            </button>
            <button
              aria-label="Delete from history"
              onClick={() => remove(h.id)}
              className="p-2.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
        </div>
      </section>
      </div>
    </aside>
  );
}
