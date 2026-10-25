"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";
import { useHistory } from "@/lib/history";
import { useLoadRun, useRunSimulation } from "@/lib/run";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";

const SUGGESTIONS = [
  "How does atorvastatin lower cholesterol?",
  "How does imatinib block BCR-ABL in leukemia cells?",
  "How does aspirin reduce prostaglandin synthesis?",
  "What does tamoxifen do to the estrogen receptor?",
  "How does lisinopril lower blood pressure?",
  "Why does aspirin irreversibly inhibit COX-1?",
  "How do statins block the rate-limiting step of cholesterol synthesis?",
  "How does imatinib bind the kinase domain of BCR-ABL?",
];

const randomSuggestion = (not?: string) => {
  const pool = SUGGESTIONS.filter((s) => s !== not);
  return pool[Math.floor(Math.random() * pool.length)];
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>;
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
  const { status, parsed, input } = useSim();
  const run = useRunSimulation();
  const { items, refresh, remove, clear } = useHistory();
  const loadRun = useLoadRun();
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState(SUGGESTIONS[0]);
  const [drug, setDrug] = useState("");
  const [target, setTarget] = useState("");
  const suggestions = useDrugSuggestions(drug);
  const listId = useId();

  // Random pick and history load happen after mount so server and client markup match.
  useEffect(() => {
    setSuggestion(randomSuggestion());
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
    <aside className="scroll-thin flex flex-col gap-5 overflow-y-auto rounded-xl border bg-card p-4">
      <section className="flex flex-col gap-2">
        <SectionLabel>Ask</SectionLabel>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && !prompt.trim()) {
              e.preventDefault();
              setPrompt(suggestion);
              setSuggestion(randomSuggestion(suggestion));
              return;
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim() && !running) run({ prompt });
          }}
          placeholder={suggestion}
          rows={3}
          className="resize-none"
        />
        {!prompt.trim() && <p className="text-xs text-muted-foreground">Press Tab to autocomplete</p>}
        <Button disabled={running || !prompt.trim()} onClick={() => run({ prompt })}>
          {running ? "Simulating…" : "Simulate"}
        </Button>
      </section>

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
          <p className="text-xs text-muted-foreground">No history yet. Press Tab in the box above for an example.</p>
        )}
        {items.map((h) => (
          <div
            key={h.id}
            className="group flex items-start gap-1 rounded-lg border bg-background/40 transition-colors hover:border-brand"
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
    </aside>
  );
}
