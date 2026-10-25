"use client";

import { useEffect, useState } from "react";
import { ArrowUp, Loader2, Plus } from "lucide-react";
import { useRunSimulation } from "@/lib/run";
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

export function AskBar() {
  const { status, prompt, setPrompt } = useSim();
  const run = useRunSimulation();
  const [suggestion, setSuggestion] = useState(SUGGESTIONS[0]);

  // Random pick happens after mount so server and client markup match.
  useEffect(() => setSuggestion(randomSuggestion()), []);

  const running = status === "running";
  const canSend = !running && !!prompt.trim();
  const send = () => canSend && run({ prompt });

  return (
    <div className="sticky bottom-0 shrink-0 pb-1">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-1 rounded-[28px] border bg-card py-2 pl-2 pr-2 shadow-[0_4px_24px_-8px_rgba(29,27,24,0.25)]">
        <button
          type="button"
          aria-label="Add"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
        >
          <Plus className="size-5" />
        </button>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Tab" && !e.shiftKey && !prompt.trim()) {
              e.preventDefault();
              setPrompt(suggestion);
              setSuggestion(randomSuggestion(suggestion));
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={suggestion}
          rows={1}
          aria-label="Ask a question"
          className="field-sizing-content max-h-40 min-h-10 flex-1 resize-none self-center bg-transparent px-2 py-2 text-base leading-6 outline-none placeholder:text-muted-foreground"
        />
        {!prompt.trim() && (
          <span className="hidden self-center pr-1 text-xs text-muted-foreground sm:block">Tab to autocomplete</span>
        )}
        <button
          type="button"
          aria-label={running ? "Simulating" : "Simulate"}
          disabled={!canSend}
          onClick={send}
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
        >
          {running ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
        </button>
      </div>
    </div>
  );
}
