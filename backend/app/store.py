"""Named raw series, cached in SQLite and served from memory.

Reads never wait on the network once a series is cached: a stale series is returned as is
and updated in the background, fetching only the last few days (today included). Only a
series that has never been downloaded blocks on a full fetch.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Iterable

import pandas as pd

from app import db
from app.cleaning import clean_stock, remove_spikes
from app.sources import bcra, data912, datosgob, fred, tradingview, yahoo

log = logging.getLogger(__name__)

DAILY_STALE_SECONDS = 30 * 60
MONTHLY_STALE_SECONDS = 24 * 3600
# Re-fetched overlap, so late revisions and today's still-moving bar are picked up.
OVERLAP_BARS = 15
OVERLAP_DAYS = 21

_locks: dict[str, asyncio.Lock] = {}
_fetch_slots = asyncio.Semaphore(6)
_mem: dict[str, tuple[float, pd.DataFrame]] = {}
_background: set[asyncio.Task] = set()

Fetch = Callable[[pd.Timestamp | None], Awaitable[pd.DataFrame]]


def _as_bars(values: pd.Series) -> pd.DataFrame:
    df = pd.DataFrame({"c": values})
    df.index.name = "date"
    return df


def stitch(primary: pd.DataFrame, older: pd.DataFrame) -> pd.DataFrame:
    """Prepend `older` bars from before `primary` starts, rescaled to meet it at the join.

    The two sources can differ by a small adjustment factor (TradingView restates prices
    for corporate actions), so the older segment is scaled rather than taken raw.
    """
    if primary.empty:
        return older
    first = primary.index[0]
    before = older[older.index < first]
    overlap = older["c"].loc[first:]
    if before.empty or overlap.empty:
        return primary
    scale = primary["c"].iloc[0] / overlap.iloc[0]
    before = before.copy()
    before[["o", "h", "l", "c"]] *= scale
    before["v"] /= scale
    return pd.concat([before, primary])


async def _stock(ticker: str, since: pd.Timestamp | None) -> pd.DataFrame:
    symbol = f"BCBA:{ticker}"
    if since is not None:
        try:
            return await tradingview.daily_bars(symbol, OVERLAP_BARS)
        except Exception as exc:  # noqa: BLE001
            log.info("incremental %s via TradingView failed (%s), refetching in full", ticker, exc)
    # data912 reaches back to 2001 but some tickers start late (VALO: 2025-11) or are missing;
    # TradingView (from 2004-09) fills whatever comes before.
    primary, older = await asyncio.gather(
        data912.stock_bars(ticker), tradingview.daily_bars(symbol), return_exceptions=True
    )
    if isinstance(primary, BaseException) or primary.empty:
        if isinstance(older, BaseException):
            raise older
        return older
    if isinstance(older, BaseException):
        log.info("TradingView has no %s (%s), using data912 only", ticker, older)
        return primary
    return stitch(primary, older)


async def _usd_official(since: pd.Timestamp | None) -> pd.DataFrame:
    if since is not None:
        return _as_bars(await bcra.a3500(since))
    # datos.gob.ar goes back to 1992 but lags a month; BCRA's A3500 is current from 2002-03.
    long = await datosgob.usd_official()
    try:
        recent = await bcra.a3500()
    except Exception as exc:  # noqa: BLE001
        log.warning("BCRA A3500 unavailable, official rate will lag: %s", exc)
        return _as_bars(long)
    return _as_bars(pd.concat([long[long.index < recent.index[0]], recent]))


async def _monthly(fetch: Callable[[], Awaitable[pd.Series]]) -> pd.DataFrame:
    return _as_bars(await fetch())


def _source(key: str) -> tuple[Fetch, bool]:
    """Fetcher taking an optional `since`, and whether it updates incrementally."""
    kind, name = key.split(":", 1)
    if kind == "stock":
        return (lambda since: _stock(name, since)), True
    if kind == "yahoo":
        return (lambda since: yahoo.bars(name, since)), True
    if kind == "tv":
        bars = tradingview.MAX_BARS
        return (lambda since: tradingview.daily_bars(name, OVERLAP_BARS if since else bars)), True
    if key == "macro:usd_official":
        return _usd_official, True
    if key == "macro:cpi":
        # Monthly and chained: one small request, and every month depends on the ones before.
        return (lambda _: _monthly(datosgob.cpi_spliced)), False
    if key == "macro:us_cpi":
        return (lambda _: _monthly(fred.us_cpi)), False
    raise KeyError(key)


def _clean(key: str, df: pd.DataFrame) -> pd.DataFrame:
    kind, name = key.split(":", 1)
    if kind == "stock":
        return clean_stock(name, df)
    if kind in ("yahoo", "tv"):
        return remove_spikes(df)
    return df


def _stale_after(key: str) -> float:
    return MONTHLY_STALE_SECONDS if key in ("macro:cpi", "macro:us_cpi") else DAILY_STALE_SECONDS


def _cached(key: str) -> pd.DataFrame | None:
    if key in _mem:
        return _mem[key][1]
    if db.fetched_at(key) is None:
        return None
    df = db.load(key)
    _mem[key] = (db.fetched_at(key) or 0.0, df)
    return df


def version(keys: Iterable[str]) -> tuple[float, ...]:
    """Changes whenever any of the keys gets new data; used to memoise derived series."""
    return tuple(_mem.get(k, (0.0,))[0] for k in keys)


async def update(key: str, full: bool = False, max_age: float | None = None) -> None:
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        fetched = db.fetched_at(key)
        # max_age only tightens daily series; monthly CPIs can't have moved within minutes.
        daily = _stale_after(key) == DAILY_STALE_SECONDS
        limit = min(max_age, DAILY_STALE_SECONDS) if max_age is not None and daily else _stale_after(key)
        if not full and fetched is not None and time.time() - fetched < limit:
            return
        fetch, incremental = _source(key)
        old = _cached(key)
        since = None
        if not full and incremental and old is not None and not old.empty:
            since = old.index[-1] - pd.Timedelta(days=OVERLAP_DAYS)
        async with _fetch_slots:
            new = await fetch(since)
        if new.empty:
            raise LookupError(f"{key}: source returned no data")
        if since is not None:
            new = pd.concat([old[old.index < new.index[0]], new])
        merged = _clean(key, new)
        db.save(key, merged)
        _mem[key] = (time.time(), merged)


def _refresh_in_background(key: str) -> None:
    async def run():
        try:
            await update(key)
        except Exception as exc:  # noqa: BLE001
            log.warning("background update of %s failed: %s", key, exc)

    task = asyncio.get_running_loop().create_task(run())
    _background.add(task)
    task.add_done_callback(_background.discard)


async def get(key: str, max_age: float | None = None) -> pd.DataFrame:
    """Cached bars right away; stale ones refresh in the background.

    With `max_age`, a cache older than that is brought up to date before returning
    (a small incremental fetch), falling back to the cached copy if the source fails.
    """
    df = _cached(key)
    if df is None or df.empty:
        await update(key, full=True)
        return _mem[key][1]
    if max_age is not None:
        try:
            await update(key, max_age=max_age)
        except Exception as exc:  # noqa: BLE001
            log.warning("fresh fetch of %s failed, serving cache: %s", key, exc)
        return _mem[key][1]
    fetched = db.fetched_at(key) or 0.0
    lock = _locks.get(key)
    if time.time() - fetched > _stale_after(key) and not (lock and lock.locked()):
        _refresh_in_background(key)
    return df


async def get_many(keys: list[str], max_age: float | None = None) -> dict[str, pd.DataFrame]:
    results = await asyncio.gather(*(get(k, max_age) for k in keys), return_exceptions=True)
    out = {}
    for key, res in zip(keys, results):
        if isinstance(res, BaseException):
            log.warning("series unavailable %s: %s", key, res)
        elif not res.empty:
            out[key] = res
    return out


async def update_many(keys: list[str], full: bool = False) -> dict[str, str]:
    """Update keys now; returns the errors by key."""
    results = await asyncio.gather(*(update(k, full) for k in keys), return_exceptions=True)
    return {k: str(r) for k, r in zip(keys, results) if isinstance(r, BaseException)}
