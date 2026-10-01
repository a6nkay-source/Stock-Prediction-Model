"""A deliberately simple headline-sentiment score.

It counts finance-flavoured positive and negative words in recent headlines. It is
shown for context only and is NOT an input to the prediction model: there is no
free historical news archive to test it on, so its value is unproven.
"""
from __future__ import annotations

import re

POSITIVE = {
    "beat", "beats", "surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "gain",
    "gains", "record", "upgrade", "upgrades", "upgraded", "outperform", "strong", "growth", "profit",
    "profits", "raise", "raises", "raised", "boost", "boosts", "bullish", "buy", "wins", "win",
    "expands", "breakthrough", "tops", "rise", "rises", "rising", "higher", "optimistic", "approval",
    "approved", "rebound", "rebounds", "accelerates", "momentum", "dividend",
}
NEGATIVE = {
    "miss", "misses", "missed", "plunge", "plunges", "fall", "falls", "drop", "drops", "slump",
    "slumps", "sink", "sinks", "downgrade", "downgrades", "downgraded", "underperform", "weak",
    "loss", "losses", "cut", "cuts", "lawsuit", "sues", "sued", "probe", "investigation", "recall",
    "bearish", "sell", "selloff", "layoffs", "layoff", "warning", "warns", "decline", "declines",
    "lower", "fraud", "fine", "fined", "risk", "risks", "concern", "concerns", "tumble", "tumbles",
    "slowdown", "delay", "delays", "bankruptcy", "crash", "fears",
}


def score_headline(text: str) -> dict:
    words = re.findall(r"[a-z']+", (text or "").lower())
    pos = sum(w in POSITIVE for w in words)
    neg = sum(w in NEGATIVE for w in words)
    value = 0.0 if pos + neg == 0 else (pos - neg) / (pos + neg)
    label = "positive" if value > 0.2 else "negative" if value < -0.2 else "neutral"
    return {"score": value, "label": label}


def summarise(items: list[dict]) -> dict | None:
    """Average sentiment across headlines, or None when there is nothing to score."""
    if not items:
        return None
    scores = [item["sentiment"]["score"] for item in items]
    mean = sum(scores) / len(scores)
    return {
        "score": mean,
        "label": "positive" if mean > 0.1 else "negative" if mean < -0.1 else "neutral",
        "n_headlines": len(items),
        "n_positive": sum(i["sentiment"]["label"] == "positive" for i in items),
        "n_negative": sum(i["sentiment"]["label"] == "negative" for i in items),
        "method": "Keyword count over recent headlines. Context only; not used by the model.",
    }
