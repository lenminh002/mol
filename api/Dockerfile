# Mol API: FastAPI + RDKit + agents. Build from the api/ directory:
#   docker build -t mol-api .
#   docker run -p 8000:8000 --env-file ../.env mol-api
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# RDKit's wheels need these shared libraries at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libxrender1 libxext6 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# App code plus the prebuilt knowledge graph and saved preset debates (structures download on demand).
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uv run --no-dev uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
