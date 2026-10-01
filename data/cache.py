"""Tiny on-disk cache with a time-to-live, so data is not re-downloaded on every run."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent


def cache_dir() -> Path:
    path = Path(os.getenv("CACHE_DIR", "data/cache"))
    if not path.is_absolute():
        path = ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def _fresh(path: Path, ttl_hours: float) -> bool:
    return path.exists() and (time.time() - path.stat().st_mtime) < ttl_hours * 3600


def cached_json(key: str, ttl_hours: float, loader: Callable[[], Any], force: bool = False) -> Any:
    """Return cached JSON for ``key`` or call ``loader`` and store its result.

    If the loader fails and a stale copy exists, the stale copy is returned so a
    provider outage does not take the application down.
    """
    path = cache_dir() / f"{key}.json"
    if not force and _fresh(path, ttl_hours):
        return json.loads(path.read_text())
    try:
        value = loader()
    except Exception:
        if path.exists():
            return json.loads(path.read_text())
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, default=str))
    return value


def cached_frame(key: str, ttl_hours: float, loader: Callable[[], pd.DataFrame],
                 force: bool = False) -> pd.DataFrame:
    path = cache_dir() / f"{key}.parquet"
    if not force and _fresh(path, ttl_hours):
        return pd.read_parquet(path)
    try:
        frame = loader()
    except Exception:
        if path.exists():
            return pd.read_parquet(path)
        raise
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path)
    return frame


def cache_age_hours(key: str, suffix: str = "parquet") -> float | None:
    path = cache_dir() / f"{key}.{suffix}"
    if not path.exists():
        return None
    return (time.time() - path.stat().st_mtime) / 3600
