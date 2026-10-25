"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRunSimulation } from "@/lib/run";
import { API_URL } from "@/lib/sse";
import { useSim } from "@/lib/store";
import type { Preset } from "@/lib/types";

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
  const [presets, setPresets] = useState<Preset[]>([]);
  const [prompt, setPrompt] = useState("");
  const [drug, setDrug] = useState("");
  const [target, setTarget] = useState("");
  const suggestions = useDrugSuggestions(drug);
  const listId = useId();

  useEffect(() => {
    fetch(`${API_URL}/presets`)
      .then((r) => r.json())
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

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
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim() && !running) run({ prompt });
          }}
          placeholder="How does atorvastatin lower cholesterol?"
          rows={3}
          className="resize-none"
        />
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
        <SectionLabel>Demo presets</SectionLabel>
        {presets.length === 0 && <p className="text-xs text-muted-foreground">API offline — start the backend.</p>}
        {presets.map((p) => (
          <button
            key={p.id}
            disabled={running}
            onClick={() => run({ preset: p.id })}
            className="rounded-lg border bg-background/40 p-2.5 text-left text-sm transition-colors hover:border-brand disabled:opacity-40"
          >
            <div className="font-medium">
              {p.drug} <span className="text-muted-foreground">→ {p.target}</span>
            </div>
            <div className="text-xs text-muted-foreground">{p.blurb}</div>
          </button>
        ))}
      </section>
    </aside>
  );
}
