"""What a stock's peso price can be divided by. Each builder returns a daily Series."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import pandas as pd

from app import store

# One YPF ADR has represented 10 local YPFD shares since the 10:1 local split of 2026-08-03;
# split adjustment restates older YPFD prices in post-split shares, so 10 holds for all history.
YPF_ADR_RATIO = 10


@dataclass(frozen=True)
class Denominator:
    key: str
    label: str
    unit: str
    sources: tuple[str, ...]
    build: Callable[[dict[str, pd.DataFrame]], pd.Series] | None


def _ccl(raw: dict[str, pd.DataFrame]) -> pd.Series:
    local = raw["stock:YPFD"]["c"]
    adr = raw["yahoo:YPF"]["c"]
    both = pd.concat([local, adr], axis=1, keys=["local", "adr"]).ffill(limit=5).dropna()
    rate = both["local"] * YPF_ADR_RATIO / both["adr"]
    return rate.rolling(5, min_periods=1).median()


def _monthly_to_daily(monthly: pd.Series) -> pd.Series:
    """Daily index from monthly readings, scaled to 1 today.

    Each reading is placed mid-month and interpolated geometrically; months not yet published
    are extrapolated at the last published monthly rate.
    """
    monthly = monthly.copy()
    monthly.index = monthly.index + pd.Timedelta(days=14)
    today = pd.Timestamp.now().normalize()
    days = pd.date_range(monthly.index[0], max(today, monthly.index[-1]), freq="D")
    log_idx = np.log(monthly).reindex(days.union(monthly.index)).interpolate("time")
    last_rate = np.log(monthly.iloc[-1] / monthly.iloc[-2]) / (
        monthly.index[-1] - monthly.index[-2]
    ).days
    after = log_idx.index > monthly.index[-1]
    elapsed = (log_idx.index[after] - monthly.index[-1]).days.to_numpy()
    log_idx[after] = np.log(monthly.iloc[-1]) + last_rate * elapsed
    daily = np.exp(log_idx.reindex(days))
    return daily / daily.iloc[-1]


def _cpi(raw: dict[str, pd.DataFrame]) -> pd.Series:
    return _monthly_to_daily(raw["macro:cpi"]["c"])


def _in_constant_usd(fx: Callable[[dict[str, pd.DataFrame]], pd.Series]):
    """Pesos per dollar of today's US purchasing power: the rate times US CPI."""

    def build(raw: dict[str, pd.DataFrame]) -> pd.Series:
        rate = fx(raw)
        us_cpi = _monthly_to_daily(raw["macro:us_cpi"]["c"])
        return (rate * us_cpi.reindex(rate.index)).dropna()

    return build


def _close(key: str) -> Callable[[dict[str, pd.DataFrame]], pd.Series]:
    return lambda raw: raw[key]["c"]


DENOMINATORS: dict[str, Denominator] = {
    d.key: d
    for d in [
        Denominator("ars", "Nominal pesos", "ARS", (), None),
        Denominator("ars_real", "Constant pesos (today)", "ARS", ("macro:cpi",), _cpi),
        Denominator(
            "usd_official", "USD official", "ARS", ("macro:usd_official",), _close("macro:usd_official")
        ),
        Denominator(
            "usd_official_real",
            "USD official, US-inflation adjusted",
            "ARS",
            ("macro:usd_official", "macro:us_cpi"),
            _in_constant_usd(_close("macro:usd_official")),
        ),
        Denominator("usd_ccl", "USD blue chip (CCL)", "ARS", ("stock:YPFD", "yahoo:YPF"), _ccl),
        Denominator(
            "usd_ccl_real",
            "USD blue chip, US-inflation adjusted",
            "ARS",
            ("stock:YPFD", "yahoo:YPF", "macro:us_cpi"),
            _in_constant_usd(_ccl),
        ),
        Denominator("merval", "vs Merval (IMV)", "ARS", ("yahoo:^MERV",), _close("yahoo:^MERV")),
        Denominator("iab", "vs General Index (IAB)", "ARS", ("tv:BCBA:IAB",), _close("tv:BCBA:IAB")),
    ]
}


_built: dict[str, tuple[tuple[float, ...], pd.Series]] = {}


async def series(key: str, max_age: float | None = None) -> pd.Series | None:
    """Daily denominator values, or None for plain nominal pesos. Rebuilt only on new data."""
    d = DENOMINATORS[key]
    if d.build is None:
        return None
    raw = await store.get_many(list(d.sources), max_age)
    missing = [s for s in d.sources if s not in raw]
    if missing:
        raise LookupError(f"{d.label}: source data unavailable ({', '.join(missing)})")
    ver = store.version(d.sources)
    hit = _built.get(key)
    if hit is None or hit[0] != ver:
        hit = (ver, d.build(raw))
        _built[key] = hit
    return hit[1]


def apply(bars: pd.DataFrame, denom: pd.Series | None) -> pd.DataFrame:
    """Divide OHLC by the denominator, rescaled so its latest value is 1.

    The latest deflated price then equals today's peso price, and history reads as
    "pesos at today's level" of whatever the denominator measures.
    """
    if denom is None:
        return bars
    denom = denom.dropna()
    denom = denom / denom.iloc[-1]
    aligned = denom.reindex(bars.index.union(denom.index)).ffill().reindex(bars.index)
    out = bars[["o", "h", "l", "c"]].div(aligned, axis=0)
    out["v"] = bars["v"]
    return out.dropna(subset=["c"])
