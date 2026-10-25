import { create } from "zustand";
import type { DebateTurn, SimEvent, SimulateRequest, SimulationResult } from "./types";

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
  setInput: (input: SimulateRequest) => void;
  reset: () => void;
  applyEvent: (event: SimEvent) => void;
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
        case "error":
          return { status: "error", statusMessage: event.message };
      }
    }),
  setView: (view) => set({ view }),
  selectTarget: (name) => set({ selectedTarget: name, view: name ? "molecule" : "cell" }),
  setHighlight: (highlight) => set({ highlight }),
}));

// Dev-only handle for poking the store from the browser console.
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as { __sim: typeof useSim }).__sim = useSim;
}
