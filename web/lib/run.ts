import { useCallback, useEffect, useRef } from "react";
import { useHistory } from "./history";
import { API_URL, streamChat, streamSimulation } from "./sse";
import { useSim } from "./store";
import type { ChatMessage, SimEvent, SimulateRequest, StoredRun } from "./types";

// One simulation at a time: starting a new one aborts the stream of the previous one.
let current: AbortController | null = null;

export function useRunSimulation() {
  const { reset, applyEvent, setInput } = useSim();

  return useCallback(
    async (req: SimulateRequest) => {
      current?.abort();
      const ctrl = new AbortController();
      current = ctrl;
      setInput(req);
      reset();
      const onEvent = (e: SimEvent) => {
        applyEvent(e);
        if (e.type === "saved") void useHistory.getState().refresh();
      };
      try {
        await streamSimulation(req, onEvent, ctrl.signal);
      } catch (e) {
        if ((e as Error).name !== "AbortError") applyEvent({ type: "error", message: String(e) });
      }
    },
    [reset, applyEvent, setInput],
  );
}

let currentChat: AbortController | null = null;

// What the model sees for a message: a proposal carries the user's answer to it.
const forModel = (m: ChatMessage) => ({
  role: m.role,
  content: m.proposal ? `${m.content}\n[user ${m.proposal.status === "pending" ? "has not answered yet" : m.proposal.status}]` : m.content,
});

// Ask a follow-up about the result on screen. The whole thread goes with it; the answer may be a
// proposal to re-simulate, which the user has to confirm (see useResolveProposal).
export function useAskFollowup() {
  const { addMessage, appendToLast, setChatPending } = useSim();

  return useCallback(
    async (question: string) => {
      const { result, messages } = useSim.getState();
      if (!result) return;
      currentChat?.abort();
      const ctrl = new AbortController();
      currentChat = ctrl;
      const user: ChatMessage = { role: "user", content: question };
      addMessage(user);
      setChatPending(true);
      let started = false; // the assistant message exists once the first chunk arrives
      try {
        await streamChat(
          { result, messages: [...messages, user].map(forModel) },
          (e) => {
            if (e.type === "delta") {
              if (started) appendToLast(e.text);
              else addMessage({ role: "assistant", content: e.text });
              started = true;
            } else if (e.type === "resimulate_proposal")
              addMessage({
                role: "assistant",
                content: `This needs a new simulation: ${e.reason}\n\nProposed question: ${e.prompt}`,
                proposal: { prompt: e.prompt, reason: e.reason, status: "pending" },
              });
            else if (e.type === "error") addMessage({ role: "assistant", content: `Sorry, that failed: ${e.message}` });
          },
          ctrl.signal,
        );
      } catch (e) {
        if ((e as Error).name !== "AbortError") addMessage({ role: "assistant", content: `Sorry, that failed: ${String(e)}` });
      } finally {
        if (currentChat === ctrl) setChatPending(false);
      }
    },
    [addMessage, appendToLast, setChatPending],
  );
}

// Confirm runs the proposed simulation (the thread is kept); decline just records the answer.
export function useResolveProposal() {
  const setProposalStatus = useSim((s) => s.setProposalStatus);
  const run = useRunSimulation();

  return useCallback(
    (index: number, accept: boolean) => {
      const proposal = useSim.getState().messages[index]?.proposal;
      if (!proposal || proposal.status !== "pending") return;
      setProposalStatus(index, accept ? "confirmed" : "declined");
      if (accept) void run({ prompt: proposal.prompt });
    },
    [setProposalStatus, run],
  );
}

// Save the thread with the run on screen whenever it settles, so History restores it.
export function usePersistChat() {
  const messages = useSim((s) => s.messages);
  const pending = useSim((s) => s.chatPending);
  const runId = useSim((s) => s.runId);
  const saved = useRef("");

  useEffect(() => {
    if (!runId || pending || messages.length === 0) return;
    const key = `${runId}:${JSON.stringify(messages)}`;
    if (key === saved.current) return;
    saved.current = key;
    void fetch(`${API_URL}/history/${runId}/chat`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    })
      .then(() => useHistory.getState().refresh())
      .catch(() => {
        saved.current = ""; // retry on the next change
      });
  }, [messages, pending, runId]);
}

// Show a stored run as it finished, without calling the model again.
export function useLoadRun() {
  const { loadRun, applyEvent } = useSim();

  return useCallback(
    async (id: string) => {
      current?.abort();
      currentChat?.abort();
      try {
        const res = await fetch(`${API_URL}/history/${id}`);
        if (!res.ok) throw new Error(`API error ${res.status}`);
        loadRun((await res.json()) as StoredRun);
      } catch (e) {
        applyEvent({ type: "error", message: String(e) });
      }
    },
    [loadRun, applyEvent],
  );
}

// Drop the current run (aborting it if still streaming) and go back to an empty simulator.
export function useNewChat() {
  const newChat = useSim((s) => s.newChat);
  return useCallback(() => {
    current?.abort();
    current = null;
    currentChat?.abort();
    currentChat = null;
    newChat();
  }, [newChat]);
}
