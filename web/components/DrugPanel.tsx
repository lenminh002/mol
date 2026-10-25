"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Pencil, Play, Plus, X } from "lucide-react";
import { useHistory } from "@/lib/history";
import { useLoadRun, useNewChat, useRunSimulation } from "@/lib/run";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</h3>;
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
        "relative min-w-0 overflow-hidden rounded-md bg-transparent transition-[width] duration-300 ease-in-out",
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
          "scroll-thin flex h-full min-w-0 flex-col overflow-y-auto px-4 pb-4 pt-2 transition-opacity duration-200 lg:w-[300px]",
          collapsed && "pointer-events-none opacity-0 max-lg:hidden",
        )}
        inert={collapsed}
      >
        <div className="flex items-center justify-between">
          <SectionLabel>Setup</SectionLabel>
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            aria-expanded
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>
        <button
          className="mt-5 flex items-center gap-2 self-start text-sm text-foreground"
          onClick={() => {
            newChat();
            setDrug("");
            setTarget("");
          }}
        >
          <Plus className="size-4 text-brand" /> New chat
        </button>

        <section className="mt-8 flex flex-col">
          <div className="flex items-center justify-between">
            <SectionLabel>History{items.length > 0 && ` · ${items.length}`}</SectionLabel>
            {items.length > 0 && (
              <button onClick={clear} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                Clear all
              </button>
            )}
          </div>
          {items.length === 0 && (
            <p className="mt-2 text-xs italic text-muted-foreground">No history yet. Press Tab in the box below for an example.</p>
          )}
          <div className="mt-2 flex flex-col">
            {items.map((h) => {
              const active = h.id === runId;
              return (
                <div key={h.id} className="group relative flex items-start gap-1">
                  {active && <span className="absolute -left-3 top-[1.1rem] size-1 rounded-full bg-brand" />}
                  <button
                    disabled={running}
                    onClick={() => {
                      if (h.req.prompt) setPrompt(h.req.prompt);
                      loadRun(h.id);
                    }}
                    className={cn(
                      "min-w-0 flex-1 py-2 text-left text-[13px] leading-snug transition-colors hover:text-foreground disabled:opacity-40",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="line-clamp-2">{h.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] italic text-muted-foreground">
                      {[h.req.drug, h.req.target, (h.chat_count ?? 0) > 0 && `${h.chat_count} messages`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </button>
                  <button
                    aria-label="Delete from history"
                    onClick={() => remove(h.id)}
                    className="py-2 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-lg:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-auto flex flex-col gap-3 pt-8">
          <SectionLabel>{fromPrompt ? "Understood as" : "Run directly"}</SectionLabel>
          <Field label="Drug">
            <Input
              className="h-8 rounded-none border-0 border-b bg-transparent px-0 shadow-none focus-visible:ring-0"
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
              className="h-8 rounded-none border-0 border-b bg-transparent px-0 shadow-none focus-visible:ring-0"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="optional"
            />
          </Field>
          {fromPrompt && (
            <p className="flex items-center gap-1.5 text-xs italic text-muted-foreground">
              <Pencil className="size-3 shrink-0 text-brand" />
              Not right? Edit and run again.
            </p>
          )}
          <button
            disabled={running || !drug.trim()}
            onClick={() => run({ drug: drug.trim(), target: target.trim() || undefined })}
            className="flex items-center gap-1.5 self-start text-sm text-brand transition-opacity hover:opacity-80 disabled:text-muted-foreground disabled:opacity-60"
          >
            <Play className="size-3.5 fill-current" /> Run
          </button>
        </section>
      </div>
    </aside>
  );
}
