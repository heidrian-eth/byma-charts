"""Repairs for free daily data: one-day bad ticks and unadjusted splits."""

from __future__ import annotations

import numpy as np
import pandas as pd

SPLIT_FACTORS = (2, 3, 4, 5, 10, 20, 25, 50, 100)
SPLIT_TOLERANCE = 0.03
SPIKE_THRESHOLD = np.log(1.4)

# (ticker, first post-split date) pairs that look like splits but were real price moves.
NOT_SPLITS: set[tuple[str, str]] = set()


def remove_spikes(df: pd.DataFrame) -> pd.DataFrame:
    """Drop days whose close jumps away from a centred 5-day median and comes straight back."""
    df = df[df["c"] > 0].copy()
    med = df["c"].rolling(5, center=True, min_periods=3).median()
    df = df[(np.log(df["c"] / med)).abs() <= SPIKE_THRESHOLD].copy()
    for col in ("o", "h", "l"):
        df[col] = df[col].where(df[col] > 0, df["c"])
    body_hi = df[["o", "c"]].max(axis=1)
    body_lo = df[["o", "c"]].min(axis=1)
    df["h"] = df["h"].clip(lower=body_hi, upper=body_hi * 1.5)
    df["l"] = df["l"].clip(lower=body_lo / 1.5, upper=body_lo)
    return df


def detect_splits(ticker: str, close: pd.Series) -> list[tuple[pd.Timestamp, float]]:
    """Return (date, factor) where price was divided by factor (factor < 1 = reverse split)."""
    ratio = close / close.shift(1)
    found = []
    for date, r in ratio.dropna().items():
        if (ticker, date.strftime("%Y-%m-%d")) in NOT_SPLITS:
            continue
        for k in SPLIT_FACTORS:
            if abs(r * k - 1) < SPLIT_TOLERANCE:
                found.append((date, float(k)))
            elif abs(r / k - 1) < SPLIT_TOLERANCE:
                found.append((date, 1.0 / k))
    return found


def adjust_splits(ticker: str, df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for date, k in detect_splits(ticker, df["c"]):
        before = df.index < date
        df.loc[before, ["o", "h", "l", "c"]] /= k
        df.loc[before, "v"] *= k
    return df


def clean_stock(ticker: str, df: pd.DataFrame) -> pd.DataFrame:
    return adjust_splits(ticker, remove_spikes(df))
