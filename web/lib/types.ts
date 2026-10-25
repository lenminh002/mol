// Mirrors api/schemas.py — keep the two in sync.

export type CellLocation = "membrane" | "cytoplasm" | "nucleus" | "mitochondria" | "er";
export type Direction = "up" | "down" | "block";
export type EffectStatus = "agreed" | "disputed" | "speculative";
export type AgentName = "proposer" | "skeptic" | "judge";

export interface Drug {
  name: string;
  smiles: string | null;
  cid: number | null;
  mw: number | null;
  logp: number | null;
}

export interface Target {
  name: string;
  uniprot: string | null;
  pdb_id: string | null;
  cell_location: CellLocation;
  binding_score: number | null;
  pose_pdb_url: string | null;
}

export interface Effect {
  pathway: string;
  organelle: CellLocation;
  direction: Direction;
  magnitude: number;
  status: EffectStatus;
  confidence: number;
  explanation: string;
  source_ids: string[];
}

export interface DebateTurn {
  agent: AgentName;
  round: number;
  text: string;
  model?: string | null; // which model actually spoke, e.g. "Claude (Gemini unavailable)"
  source_ids: string[];
}

export interface PathHop {
  from: string;
  relation: string;
  to: string;
  source_id: string | null;
}

export interface Citation {
  id: string;
  title: string;
  url: string;
  pmid: string | null;
}

export interface SimulationResult {
  drug: Drug;
  targets: Target[];
  effects: Effect[];
  debate: DebateTurn[];
  reasoning_path: PathHop[];
  citations: Citation[];
  caveats: string[];
  summary: string;
  from_cache: boolean;
}

export interface SimulateRequest {
  drug?: string;
  target?: string;
  prompt?: string;
  preset?: string;
  fresh?: boolean; // re-run a preset live instead of replaying its saved debate
}

export interface Preset {
  id: string;
  drug: string;
  target: string;
  pdb_id: string;
  blurb: string;
}

// SSE events streamed by POST /simulate
export type SimEvent =
  | { type: "status"; message: string }
  | { type: "parsed"; drug: string; target: string | null; context: string | null }
  | { type: "tool_call"; agent: AgentName; tool: string; args: Record<string, unknown> }
  | { type: "turn"; turn: DebateTurn }
  | { type: "result"; result: SimulationResult }
  | { type: "saved"; id: string; chat?: ChatMessage[] }
  | { type: "error"; message: string };

// Follow-up chat (POST /chat). A proposal is only a request: nothing re-simulates until the user confirms.
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  proposal?: { prompt: string; reason: string; status: "pending" | "confirmed" | "declined" };
}

export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "resimulate_proposal"; prompt: string; reason: string }
  | { type: "error"; message: string };

// A finished run stored by the API (GET /history, GET /history/{id})
export interface HistoryItem {
  id: string;
  req: SimulateRequest;
  label: string;
  ts: number;
}

export interface StoredRun extends HistoryItem {
  result: SimulationResult;
  tool_calls: { agent: AgentName; tool: string; args: Record<string, unknown> }[];
  parsed: { drug: string; target: string | null } | null;
  chat?: ChatMessage[];
}
