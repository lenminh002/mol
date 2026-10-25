import { create } from "zustand";
import type { SimulateRequest } from "./types";

const KEY = "mol-history";
const MAX_ITEMS = 20;

export interface HistoryItem {
  id: string;
  req: SimulateRequest;
  label: string;
  ts: number;
}

interface HistoryState {
  items: HistoryItem[];
  hydrate: () => void;
  add: (req: SimulateRequest) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function labelFor(req: SimulateRequest): string {
  if (req.prompt?.trim()) return req.prompt.trim();
  if (req.drug) return req.target ? `${req.drug} → ${req.target}` : req.drug;
  return req.preset ?? "simulation";
}

function save(items: HistoryItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {}
}

export const useHistory = create<HistoryState>((set, get) => ({
  items: [],
  // Read in an effect (not at module load) so server rendering stays deterministic.
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) set({ items: JSON.parse(raw) });
    } catch {}
  },
  add: (req) => {
    const label = labelFor(req);
    const item: HistoryItem = { id: crypto.randomUUID(), req, label, ts: Date.now() };
    const items = [item, ...get().items.filter((i) => i.label !== label)].slice(0, MAX_ITEMS);
    set({ items });
    save(items);
  },
  remove: (id) => {
    const items = get().items.filter((i) => i.id !== id);
    set({ items });
    save(items);
  },
  clear: () => {
    set({ items: [] });
    save([]);
  },
}));
