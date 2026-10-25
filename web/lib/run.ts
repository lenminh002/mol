import { useCallback } from "react";
import { streamSimulation } from "./sse";
import { useSim } from "./store";
import type { SimulateRequest } from "./types";

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
      try {
        await streamSimulation(req, applyEvent, ctrl.signal);
      } catch (e) {
        if ((e as Error).name !== "AbortError") applyEvent({ type: "error", message: String(e) });
      }
    },
    [reset, applyEvent, setInput],
  );
}
