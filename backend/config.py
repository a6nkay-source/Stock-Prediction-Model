"""Settings read from the environment (.env is loaded if present)."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

ARTIFACT_DIR = Path(os.getenv("ARTIFACT_DIR") or ROOT / "models" / "artifacts")
RISK_FREE_RATE = float(os.getenv("RISK_FREE_RATE", "0.02"))
CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]

DISCLAIMER = ("Educational portfolio simulation — not financial advice. Predictions are uncertain "
              "estimates from historical data, and past performance does not guarantee future results.")
