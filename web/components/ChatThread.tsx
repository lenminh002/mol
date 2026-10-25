"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TurnText } from "@/components/TurnText";
import { useHistory } from "@/lib/history";
import { useResolveProposal } from "@/lib/run";
import { useSim } from "@/lib/store";

// Follow-up conversation about the result on screen, shown in the right-hand drawer. A re-simulation
// is only ever proposed here; it runs when the user clicks Re-simulate.
export function ChatThread() {
  const { messages, chatPending, status, result, runId } = useSim();
  const active = useHistory((s) => s.items.find((h) => h.id === runId));
  const resolve = useResolveProposal();
  const list = useRef<HTMLDivElement>(null);
  const citations = new Map(result?.citations.map((c) => [c.id, c]) ?? []);

  // Bring the newest message into view from its start, so a long answer is read from the top.
  useEffect(() => {
    list.current?.children[messages.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [messages.length]);

  if (messages.length === 0 && !chatPending) {
    return (
      <p className="text-sm text-muted-foreground">
        {result ? "Ask a follow-up about this result below." : "Run a simulation, then ask follow-up questions here."}
      </p>
    );
  }

  return (
    <>
    {active && (
      <div className="mb-3 flex items-center gap-1.5 border-b pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span className="shrink-0 text-brand">Active chat</span>
        <span className="shrink-0">· {messages.length}</span>
        <span className="truncate normal-case tracking-normal">· {active.label}</span>
      </div>
    )}
    <div ref={list} className="flex flex-col gap-3">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="max-w-[85%] self-end rounded-2xl bg-muted px-3 py-1.5 text-sm">
            {m.content}
          </div>
        ) : m.proposal ? (
          <div key={i} className="rounded-md border border-brand/40 bg-background/40 p-3">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-brand">New simulation</div>
            <p className="text-sm text-foreground">{m.proposal.reason}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{m.proposal.prompt}</p>
            <div className="mt-2.5 flex items-center gap-2">
              {m.proposal.status === "pending" ? (
                <>
                  <Button size="sm" disabled={status === "running"} onClick={() => resolve(i, true)}>
                    Re-simulate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve(i, false)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {m.proposal.status === "confirmed" ? "Re-simulation started" : "Declined"}
                </span>
              )}
            </div>
          </div>
        ) : (
          <TurnText key={i} text={m.content} citations={citations} />
        ),
      )}
      {chatPending && messages.at(-1)?.role === "user" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Replying…
        </p>
      )}
    </div>
    </>
  );
}
