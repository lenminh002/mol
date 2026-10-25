import { create } from "zustand";
import type { ChatMessage, DebateTurn, SimEvent, SimulateRequest, SimulationResult, StoredRun } from "./types";

type Status = "idle" | "running" | "done" | "error";
type View = "cell" | "molecule";

interface ToolCallLog {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
}

interface SimState {
  input: SimulateRequest;
  status: Status;
  statusMessage: string;
  debate: DebateTurn[];
  toolCalls: ToolCallLog[];
  result: SimulationResult | null;
  parsed: { drug: string; target: string | null } | null; // what the backend understood the request as
  view: View;
  selectedTarget: string | null;
  highlight: string | null;
  prompt: string;
  messages: ChatMessage[]; // follow-up thread; survives reset() so it continues across a confirmed re-simulation
  chatPending: boolean;
  runId: string | null; // the stored run on screen: where the thread is saved
  drawerOpen: boolean; // right-hand drawer (Reasoning / Chat)
  drawerTab: "reasoning" | "chat";
  setDrawer: (open: boolean, tab?: "reasoning" | "chat") => void;
  addMessage: (message: ChatMessage) => void;
  setProposalStatus: (index: number, status: "confirmed" | "declined") => void;
  setChatPending: (pending: boolean) => void;
  setPrompt: (prompt: string) => void;
  setInput: (input: SimulateRequest) => void;
  reset: () => void;
  newChat: () => void;
  applyEvent: (event: SimEvent) => void;
  loadRun: (run: StoredRun) => void;
  setView: (view: View) => void;
  selectTarget: (name: string | null) => void;
  setHighlight: (id: string | null) => void;
}

export const useSim = create<SimState>((set) => ({
  input: {},
  status: "idle",
  statusMessage: "",
  debate: [],
  toolCalls: [],
  result: null,
  parsed: null,
  view: "cell",
  selectedTarget: null,
  highlight: null,
  prompt: "",
  messages: [],
  chatPending: false,
  runId: null,
  drawerOpen: false,
  drawerTab: "reasoning",
  setDrawer: (drawerOpen, tab) => set((s) => ({ drawerOpen, drawerTab: tab ?? s.drawerTab })),
  // Asking a question opens the drawer on the thread.
  addMessage: (message) =>
    set((s) => ({
      messages: [...s.messages, message],
      ...(message.role === "user" ? { drawerOpen: true, drawerTab: "chat" as const } : {}),
    })),
  setProposalStatus: (index, status) =>
    set((s) => ({
      messages: s.messages.map((m, i) => (i === index && m.proposal ? { ...m, proposal: { ...m.proposal, status } } : m)),
    })),
  setChatPending: (chatPending) => set({ chatPending }),
  setPrompt: (prompt) => set({ prompt }),
  setInput: (input) => set({ input }),
  reset: () =>
    set({
      status: "running",
      statusMessage: "Starting simulation…",
      debate: [],
      toolCalls: [],
      result: null,
      parsed: null,
      view: "cell",
      selectedTarget: null,
      highlight: null,
    }),
  newChat: () =>
    set({
      input: {},
      status: "idle",
      statusMessage: "",
      debate: [],
      toolCalls: [],
      result: null,
      parsed: null,
      view: "cell",
      selectedTarget: null,
      highlight: null,
      prompt: "",
      messages: [],
      chatPending: false,
      runId: null,
    }),
  applyEvent: (event) =>
    set((s) => {
      switch (event.type) {
        case "status":
          return { statusMessage: event.message };
        case "parsed":
          return { parsed: { drug: event.drug, target: event.target } };
        case "tool_call":
          return { toolCalls: [...s.toolCalls, { agent: event.agent, tool: event.tool, args: event.args }] };
        case "turn":
          return { debate: [...s.debate, event.turn] };
        case "result":
          return { result: event.result, status: "done", statusMessage: "" };
        case "saved":
          return { runId: event.id };
        case "error":
          return { status: "error", statusMessage: event.message };
      }
    }),
  loadRun: (run) =>
    set({
      input: run.req,
      status: "done",
      statusMessage: "",
      debate: run.result.debate,
      toolCalls: run.tool_calls,
      result: run.result,
      parsed: run.parsed,
      view: "cell",
      selectedTarget: null,
      highlight: null,
      messages: run.chat ?? [],
      chatPending: false,
      runId: run.id,
    }),
  setView: (view) => set({ view }),
  selectTarget: (name) => set({ selectedTarget: name, view: name ? "molecule" : "cell" }),
  setHighlight: (highlight) => set({ highlight }),
}));

// Dev-only handle for poking the store from the browser console.
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as { __sim: typeof useSim }).__sim = useSim;
}
