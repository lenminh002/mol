"""SimulationResult contract. Mirrored in web/lib/types.ts — keep the two in sync."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CellLocation = Literal["membrane", "cytoplasm", "nucleus", "mitochondria", "er"]
Direction = Literal["up", "down", "block"]
EffectStatus = Literal["agreed", "disputed", "speculative"]
AgentName = Literal["proposer", "skeptic", "judge"]


class Drug(BaseModel):
    name: str
    smiles: str | None = None
    cid: int | None = None
    mw: float | None = None
    logp: float | None = None


class Target(BaseModel):
    name: str
    uniprot: str | None = None
    pdb_id: str | None = None
    cell_location: CellLocation
    binding_score: float | None = None
    pose_pdb_url: str | None = None


class Effect(BaseModel):
    pathway: str
    organelle: CellLocation
    direction: Direction
    magnitude: float = Field(ge=0, le=1)
    status: EffectStatus
    confidence: float = Field(ge=0, le=1)
    explanation: str
    source_ids: list[str] = []


class DebateTurn(BaseModel):
    agent: AgentName
    round: int
    text: str
    model: str | None = None  # which model actually spoke, e.g. "Gemini" or "Claude (Gemini unavailable)"
    source_ids: list[str] = []


class PathHop(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    relation: str
    to: str
    source_id: str | None = None


class Citation(BaseModel):
    id: str
    title: str
    url: str
    pmid: str | None = None


class SimulationResult(BaseModel):
    drug: Drug
    targets: list[Target]
    effects: list[Effect]
    debate: list[DebateTurn] = []
    reasoning_path: list[PathHop] = []
    citations: list[Citation] = []
    caveats: list[str] = []
    summary: str = ""
    from_cache: bool = False


class SimulateRequest(BaseModel):
    drug: str | None = None
    target: str | None = None
    prompt: str | None = None
    preset: str | None = None
    fresh: bool = False  # bypass a cached preset result and run the debate live


class Preset(BaseModel):
    id: str
    drug: str
    target: str
    pdb_id: str
    blurb: str
