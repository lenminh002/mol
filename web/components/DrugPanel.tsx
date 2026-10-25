"use client";

import { useEffect, useId, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useHistory } from "@/lib/history";
import { useLoadRun, useNewChat, useRunSimulation } from "@/lib/run";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</h3>;
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
  const { status, parsed, input, setPrompt } = useSim();
  const run = useRunSimulation();
  const { items, refresh, remove, clear } = useHistory();
  const loadRun = useLoadRun();
  const newChat = useNewChat();
  const [drug, setDrug] = useState("");
  const [target, setTarget] = useState("");
  const suggestions = useDrugSuggestions(drug);
  const listId = useId();
  const [collapsed, setCollapsed] = useState(false);

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
        collapsed ? "lg:w-12" : "lg:w-[300px]",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex w-12 flex-col items-center gap-2 p-2 transition-opacity duration-200 max-lg:static max-lg:w-auto max-lg:flex-row",
          !collapsed && "pointer-events-none opacity-0 max-lg:hidden",
        )}
        inert={!collapsed}
      >
        <button
          aria-label="Expand sidebar"
          onClick={() => setCollapsed(false)}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-5" />
        </button>
        <button
          aria-label="New chat"
          onClick={() => {
            newChat();
            setDrug("");
            setTarget("");
          }}
          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-5" />
        </button>
      </div>
      <div
        className={cn(
          "scroll-thin flex h-full min-w-0 flex-col gap-5 overflow-y-auto p-3.5 transition-opacity duration-200 lg:w-[300px]",
          collapsed && "pointer-events-none opacity-0 max-lg:hidden",
        )}
        inert={collapsed}
      >
      <div className="-mb-2 flex justify-end">
        <button
          aria-label="Collapse sidebar"
          onClick={() => setCollapsed(true)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </button>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          newChat();
          setDrug("");
          setTarget("");
        }}
      >
        <Plus className="size-4" /> New chat
      </Button>

      <section className="flex flex-col gap-2">
        <SectionLabel>{fromPrompt ? "Understood as" : "Or set it up"}</SectionLabel>
        <Input
          value={drug}
          onChange={(e) => setDrug(e.target.value)}
          placeholder="Drug (e.g. imatinib)"
          list={listId}
          autoComplete="off"
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="Target (optional, e.g. BCR-ABL)"
        />
        {fromPrompt && (
          <p className="text-xs text-muted-foreground">Not right? Edit the fields and run again.</p>
        )}
        <Button
          variant="outline"
          disabled={running || !drug.trim()}
          onClick={() => run({ drug: drug.trim(), target: target.trim() || undefined })}
        >
          Run
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionLabel>History</SectionLabel>
          {items.length > 0 && (
            <button onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
              Clear all
            </button>
          )}
        </div>
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground">No history yet. Press Tab in the box below for an example.</p>
        )}
        {items.map((h) => (
          <div
            key={h.id}
            className="group flex items-start gap-1 rounded border bg-background/50 transition-colors hover:border-brand/60"
          >
            <button
              disabled={running}
              onClick={() => {
                if (h.req.prompt) setPrompt(h.req.prompt);
                loadRun(h.id);
              }}
              className="min-w-0 flex-1 p-2.5 text-left text-sm disabled:opacity-40"
            >
              <span className="line-clamp-2">{h.label}</span>
            </button>
            <button
              aria-label="Delete from history"
              onClick={() => remove(h.id)}
              className="p-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </section>
      </div>
    </aside>
  );
}
