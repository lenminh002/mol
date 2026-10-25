import { useCallback } from "react";
import { useHistory } from "./history";
import { API_URL, streamSimulation } from "./sse";
import { useSim } from "./store";
import type { SimEvent, SimulateRequest, StoredRun } from "./types";

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

// Show a stored run as it finished, without calling the model again.
export function useLoadRun() {
  const { loadRun, applyEvent } = useSim();

  return useCallback(
    async (id: string) => {
      current?.abort();
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
