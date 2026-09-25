from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Literal

import pandas as pd
from fastapi import FastAPI, HTTPException, Query

from app import analytics, db, denominators, store
from app.sources import data912

logging.basicConfig(level=logging.INFO)

REFRESH_EVERY_SECONDS = 15 * 60


def _all_keys(tickers: list[str]) -> list[str]:
    keys = [f"stock:{t}" for t in tickers]
    for d in denominators.DENOMINATORS.values():
        keys.extend(s for s in d.sources if s not in keys)
    return keys


async def _keep_fresh():
    """Incremental updates on a timer, so pages read from memory instead of the network."""
    while True:
        try:
            errors = await store.update_many(_all_keys(await universe()))
            for key, err in errors.items():
                log.warning("update of %s failed: %s", key, err)
        except Exception as exc:  # noqa: BLE001
            log.warning("refresh cycle failed: %s", exc)
        await asyncio.sleep(REFRESH_EVERY_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(_keep_fresh())
    yield
    task.cancel()


app = FastAPI(title="byma-charts", lifespan=lifespan)
log = logging.getLogger(__name__)

Interval = Literal["d", "w", "m"]
FitMode = Literal["log", "lin"]
TrendModel = Literal["auto", "regression", "mean", "bands"]

# Indices chartable like stocks, and the denominator each one would divide into a flat line.
INDICES = {"IMV": "yahoo:^MERV", "IAB": "tv:BCBA:IAB"}
INDEX_DENOMINATOR = {"IMV": "merval", "IAB": "iab"}
# Liquid stocks trade on 70-94% of weekdays (holidays cap it). Below ~20% (INAG, REGE, EDSH)
# prices are too stale to measure against a trend; DOME (32%) and INTR (50%) stay in.
MIN_TRADING_DAY_RATIO = 0.25

# Sigma distance from a trend fitted on less history than this is noise, not signal.
MIN_TREND_YEARS = 2

_universe: list[str] = json.loads(db.get_kv("universe") or "[]")
_leaderboards: dict[tuple, tuple[tuple[float, ...], dict]] = {}


async def universe(force: bool = False) -> list[str]:
    """Stock list from data912's live panel, persisted so an outage there doesn't empty the app."""
    global _universe
    if force or not _universe:
        try:
            _universe = await data912.ars_stock_universe()
            db.set_kv("universe", json.dumps(_universe))
        except Exception as exc:
            if not _universe:
                _universe = [k.split(":", 1)[1] for k in db.keys("stock:")]
            if not _universe:
                raise HTTPException(502, f"could not load stock list: {exc}") from exc
    return _universe


def _key(ticker: str) -> str:
    ticker = ticker.upper()
    return INDICES.get(ticker, f"stock:{ticker}")


_liquidity: dict[str, tuple[tuple[float, ...], float]] = {}


async def listed() -> list[str]:
    """Indices first, then stocks that trade often enough; unknown ones stay until cached."""
    stocks = await universe()
    keys = [f"stock:{t}" for t in stocks]
    raw = await store.get_many(keys)
    keep = []
    for ticker, key in zip(stocks, keys):
        df = raw.get(key)
        if df is None:
            keep.append(ticker)
            continue
        ver = store.version([key])
        hit = _liquidity.get(key)
        if hit is None or hit[0] != ver:
            hit = (ver, analytics.trading_day_ratio(df))
            _liquidity[key] = hit
        if hit[1] >= MIN_TRADING_DAY_RATIO:
            keep.append(ticker)
    return list(INDICES) + keep


async def _denominator(key: str) -> pd.Series | None:
    if key not in denominators.DENOMINATORS:
        raise HTTPException(404, f"unknown denominator {key}")
    try:
        return await denominators.series(key)
    except LookupError as exc:
        raise HTTPException(503, str(exc)) from exc


def _trend(
    close: pd.Series,
    denom: str,
    model: TrendModel,
    fit: FitMode,
    start: pd.Timestamp | None,
    end: pd.Timestamp | None,
    band_years: float,
) -> analytics.Trend | None:
    """Auto uses centered bands for nominal pesos, whose drift follows inflation rather than a
    straight line, and a regression everywhere else."""
    if model == "auto":
        model = "bands" if denom == "ars" else "regression"
    log_fit = fit == "log"
    if model == "bands":
        t = analytics.band_trend(close, band_years, log_fit)
    elif model == "mean":
        t = analytics.mean_trend(close, start, end, log_fit)
    else:
        t = analytics.regression_trend(close, start, end, log_fit)
    # A series divided by itself is flat: no spread, so no meaningful sigma distance.
    return t if t is not None and t.sigma.iloc[-1] > 0 else None


def _trend_summary(t: analytics.Trend, last: float) -> dict:
    return {
        "model": t.model,
        "z": t.z(last),
        "pct_from_trend": t.pct_from_trend(last),
        "annual_growth": t.annual_growth,
        "start": _iso(t.start),
        "end": _iso(t.end),
        "provisional_from": _iso(t.provisional_from) if t.provisional_from is not None else None,
    }


def _date(value: str | None) -> pd.Timestamp | None:
    return pd.Timestamp(value) if value else None


def _iso(ts: pd.Timestamp) -> str:
    return ts.strftime("%Y-%m-%d")


@app.get("/api/meta")
async def meta():
    return {
        "denominators": [
            {"key": d.key, "label": d.label, "unit": d.unit}
            for d in denominators.DENOMINATORS.values()
        ],
        "tickers": await listed(),
        "indices": list(INDICES),
        "periods": list(analytics.PERIODS),
    }


@app.get("/api/chart/{ticker}")
async def chart(
    ticker: str,
    denom: str = "ars",
    interval: Interval = "w",
    fit: FitMode = "log",
    start: str | None = None,
    end: str | None = None,
    model: TrendModel = "auto",
    band_years: float = Query(2, gt=0, le=10),
):
    try:
        raw = await store.get(_key(ticker))
    except Exception as exc:
        raise HTTPException(502, f"no data for {ticker}: {exc}") from exc
    bars = analytics.resample(denominators.apply(raw, await _denominator(denom)), interval)
    if bars.empty:
        raise HTTPException(404, f"no overlapping data for {ticker} in {denom}")

    channel = None
    t = _trend(bars["c"], denom, model, fit, _date(start), _date(end), band_years)
    if t is not None:
        last = float(bars["c"].iloc[-1])
        channel = _trend_summary(t, last) | {
            "times": [_iso(d) for d in t.mid.index],
            "lines": t.lines(),
            "sigma": float(t.sigma.iloc[-1]),
        }

    return {
        "ticker": ticker.upper(),
        "denominator": denom,
        "bars": [
            {"time": _iso(d), "open": r.o, "high": r.h, "low": r.l, "close": r.c, "volume": r.v}
            for d, r in zip(bars.index, bars.itertuples(index=False))
        ],
        "channel": channel,
        "changes": analytics.changes(bars["c"]),
    }


@app.get("/api/sigmas/{ticker}")
async def sigmas(
    ticker: str,
    interval: Interval = "w",
    fit: FitMode = "log",
    start: str | None = None,
    end: str | None = None,
    model: TrendModel = "auto",
    band_years: float = Query(2, gt=0, le=10),
):
    """Distance from trend of one stock under every denominator, over the same fit window."""
    try:
        raw = await store.get(_key(ticker))
    except Exception as exc:
        raise HTTPException(502, f"no data for {ticker}: {exc}") from exc
    keys = list(denominators.DENOMINATORS)
    series = await asyncio.gather(*(denominators.series(k) for k in keys), return_exceptions=True)
    tiles = []
    for key, denom in zip(keys, series):
        tile: dict = {"denominator": key, "label": denominators.DENOMINATORS[key].label}
        if isinstance(denom, BaseException):
            tile["error"] = str(denom)
            tiles.append(tile)
            continue
        if INDEX_DENOMINATOR.get(ticker.upper()) == key:
            tile["error"] = "the index against itself"
            tiles.append(tile)
            continue
        bars = analytics.resample(denominators.apply(raw, denom), interval)
        t = (
            _trend(bars["c"], key, model, fit, _date(start), _date(end), band_years)
            if not bars.empty
            else None
        )
        if t is None:
            tile["error"] = "not enough data in the window"
        else:
            tile |= _trend_summary(t, float(bars["c"].iloc[-1]))
        tiles.append(tile)
    return {"ticker": ticker.upper(), "tiles": tiles}


@app.get("/api/leaderboard")
async def leaderboard(
    denom: str = "merval",
    trend_years: float = Query(0, ge=0, le=40, description="0 means all history"),
    fit: FitMode = "log",
    model: TrendModel = "auto",
    band_years: float = Query(2, gt=0, le=10),
):
    tickers = [t for t in await listed() if INDEX_DENOMINATOR.get(t) != denom]
    denom_series = await _denominator(denom)
    keys = [_key(t) for t in tickers]
    raw = await store.get_many(keys)
    params = (denom, trend_years, fit, model, band_years)
    ver = store.version(keys + list(denominators.DENOMINATORS[denom].sources))
    hit = _leaderboards.get(params)
    if hit and hit[0] == ver:
        return hit[1]
    rows = []
    for ticker, key in zip(tickers, keys):
        df = raw.get(key)
        if df is None:
            continue
        deflated = denominators.apply(df, denom_series)
        if deflated.empty:
            continue
        last_date = deflated.index[-1]
        if (pd.Timestamp.now() - last_date).days > 30:
            continue
        weekly = analytics.resample(deflated, "w")["c"]
        start = last_date - pd.DateOffset(years=trend_years) if trend_years else None
        t = _trend(weekly, denom, model, fit, start, None, band_years)
        trend_span = (t.end - t.start).days / 365.25 if t else 0
        if trend_span < MIN_TREND_YEARS:
            t = None
        last = float(deflated["c"].iloc[-1])
        rows.append(
            {
                "ticker": ticker,
                "last_date": _iso(last_date),
                "price_ars": float(df["c"].iloc[-1]),
                "value": last,
                "changes": analytics.changes(deflated["c"]),
                "z": t.z(last) if t else None,
                "pct_from_trend": t.pct_from_trend(last) if t else None,
                "annual_growth": t.annual_growth if t else None,
                "model": t.model if t else None,
                "history_start": _iso(deflated.index[0]),
                "trend_years": round(trend_span, 1),
            }
        )
    result = {
        "denominator": denom,
        "trend_years": trend_years,
        "fit": fit,
        "model": model,
        "band_years": band_years,
        "rows": rows,
    }
    _leaderboards[params] = (ver, result)
    return result


@app.post("/api/refresh")
async def refresh(full: bool = False):
    """Fetch the latest bars now (full=true re-downloads every series from scratch)."""
    keys = _all_keys(await universe(force=True))
    errors = await store.update_many(keys, full=full)
    return {"updated": len(keys) - len(errors), "failed": errors}
