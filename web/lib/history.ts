import { create } from "zustand";
import { API_URL } from "./sse";
import type { HistoryItem } from "./types";

interface HistoryState {
  items: HistoryItem[];
  refresh: () => Promise<void>;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistory = create<HistoryState>((set, get) => ({
  items: [],
  // Called in an effect (not at module load) so server rendering stays deterministic.
  refresh: async () => {
    try {
      const res = await fetch(`${API_URL}/history`);
      if (res.ok) set({ items: await res.json() });
    } catch {}
  },
  remove: (id) => {
    set({ items: get().items.filter((i) => i.id !== id) });
    fetch(`${API_URL}/history/${id}`, { method: "DELETE" }).catch(() => {});
  },
  clear: () => {
    set({ items: [] });
    fetch(`${API_URL}/history`, { method: "DELETE" }).catch(() => {});
  },
}));
