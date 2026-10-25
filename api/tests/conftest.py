from pathlib import Path

import pytest
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Point the tool cache at a temp dir so tests exercise real calls, not old cache files."""
    import tools.cache

    monkeypatch.setattr(tools.cache, "CACHE_ROOT", tmp_path / "cache")
