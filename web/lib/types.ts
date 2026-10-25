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
  | { type: "error"; message: string };
