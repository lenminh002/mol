# Mol: watch AI agents debate what a drug does inside a cell

## Inspiration
Understanding what a medicine actually does inside a cell means reading dozens of papers, cross-checking
databases, and picturing 3D structures in your head. LLMs can summarise this, but they also invent things
with total confidence. We wanted an assistant that **shows its evidence, argues with itself, and admits
uncertainty**, and that makes the result visible in 3D.

## What it does
Ask about a drug ("How does Lipitor lower cholesterol?") or pick a preset. Mol then:
1. **Gathers evidence with real tools:** PubChem and RDKit for the drug, UniProt and RCSB for the target,
   a hybrid literature index of PubMed papers and ClinicalTrials.gov records in Elastic, and a biomedical
   knowledge graph (Hetionet, built from 29 curated databases).
2. **Runs a debate:** a pharmacologist agent (Claude) builds a cited case. A reviewer agent (Gemini, a
   different model family) challenges it. The pharmacologist rebuts. A judge agent (Claude) rules.
3. **Tags every effect** as *agreed*, *disputed* or *speculative*, with a confidence level, and keeps only
   citations that came from real tool results. Made-up IDs are dropped automatically.
4. **Draws the verdict** on a 3D cell (React Three Fiber). Blocked targets glow red and drug particles pile
   up at them, downregulated organelles dim, disputed effects flicker and speculative ones turn to wireframe.
   A glowing path traces the causal chain from drug to target to organelle.
5. **Zooms into the molecule:** click a target to see the real crystal structure in Mol*, with the drug in
   yellow and the binding-site residues and interactions highlighted.
6. **Reads the verdict aloud** (Cartesia), stepping the 3D highlight through each organelle as it speaks.

## How we built it
- **Agents:** Claude Opus 5.5 with the Anthropic SDK Tool Runner (proposer, rebuttal, and a judge using
  structured outputs), and Gemini with automatic function calling for the reviewer. Server-side refusal
  fallback is on, and if any one agent fails the debate degrades gracefully instead of breaking.
- **Evidence:** an Elastic index with Gemini embeddings, ranked by BM25 and kNN combined with reciprocal
  rank fusion. Hetionet is filtered to drug mechanisms and mapped onto five cell regions. PubChem, RDKit,
  UniProt, RCSB and ClinicalTrials.gov supply the rest. Optional DiffDock docking runs via NVIDIA NIM.
- **Frontend:** Next.js, React Three Fiber, Mol*, shadcn/ui and Zustand, with server-sent events so you
  watch every tool call and debate turn as it happens.
- **Backend:** FastAPI in Docker, with saved debates for instant, offline-safe demos.

## Challenges
- **Trust:** we made hallucinated citations impossible to display. Every source ID must exist on a shared
  evidence board that only real tool results can write to.
- **Model availability:** free-tier quotas, overloaded models and safety-classifier refusals all happen
  mid-demo. Each role has a fallback, and the judge says plainly when a case was not independently reviewed.
- **Grounding the 3D view:** mapping Gene Ontology cellular components onto organelles so that "where in
  the cell" comes from a curated graph, not the LLM's imagination.

## Accomplishments
- The judge correctly flagged that a STAT5 effect for imatinib was based on a *different* inhibitor's data
  and marked it disputed. The reviewer also caught the proposer understating imatinib's KIT/PDGFR activity.
- Binding sites computed from coordinates match the textbooks: imatinib's Thr315 gatekeeper and Asp381
  DFG motif, tamoxifen's Glu353/Arg394 anchor, lisinopril's zinc and His353.

## What's next
- Live docking for every query, and a "compare two drugs" mode.
- Wet-lab-validated benchmarks of the agreed/disputed calibration.
- A teaching mode for pharmacology students.

## Built with
Claude (Anthropic) · Gemini · Elastic · Cartesia · Next.js · React Three Fiber · three.js · Mol* · FastAPI ·
RDKit · Hetionet · PubChem · UniProt · RCSB PDB · ClinicalTrials.gov · NVIDIA DiffDock NIM

## Tracks
Anthropic Claude for Public Benefit · People-First Social Impact · Most Technically Advanced ·
MLH Best Use of Gemini · Elastic Agent Builder · Cartesia · GoDaddy domain (once registered)

> Research and education prototype. Not medical advice.
