# Mol

Drop a drug onto a 3D cell and watch AI agents debate what happens, grounded in real data.
Claude proposes a mechanism, Gemini challenges it, and Claude judges. The verdict is drawn as a
3D cell that zooms into a molecular binding view, with every claim cited.

> Research prototype for Cal Hacks 13.0 — not medical advice.

## Run locally

```bash
cp .env.example .env   # fill in API keys
./dev.sh               # api on :8000, web on :3000
```

Restart the API after editing `.env`; keys are read when it starts.

- `web/` — Next.js, React Three Fiber (cell view), Mol* (molecule view)
- `api/` — FastAPI, debate orchestrator, bio tools, RAG
- `docs/EXECUTION_PLAN.md` — phases, tech map, pitch notes

## Knowledge base

**Knowledge graph** (no keys needed): Hetionet v1.0, filtered to drug mechanisms and shipped prebuilt as
`api/data/graph.json.gz`. To rebuild it from source:

```bash
cd api && uv run python ingest/build_graph.py
```

**Literature index** (Elastic): set `ELASTIC_URL` and `ELASTIC_API_KEY` in `.env` (an Elastic Serverless
project works), then index PubMed and ClinicalTrials.gov for the presets. Add the `BRIGHTDATA_*` settings to
also index authoritative web pages.

```bash
cd api && uv run python ingest/ingest_literature.py --reset
```

If `ELASTIC_URL` is unset or Elastic is unreachable, the agents search PubMed live instead.

**Elastic Agent Builder:** in Kibana, create an agent (e.g. "Mol Literature Agent") with an index-search
tool over `mol-literature`. That gives judges a chat interface over the same evidence the debate cites.
See https://www.elastic.co/docs/solutions/search/agent-builder.
