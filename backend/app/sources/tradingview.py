"""TradingView's public chart websocket: the Índice General, stock history when data912 has none,
and cheap incremental updates (BCBA history starts 2004-09).

Undocumented protocol: frames are "~m~<len>~m~<json>", heartbeats "~h~N" must be echoed back.
"""

import asyncio
import json
import random
import re
import string

import pandas as pd
import websockets

URL = "wss://data.tradingview.com/socket.io/websocket"
MAX_BARS = 20000
TIMEOUT_SECONDS = 45


def _frame(method: str, params: list) -> str:
    body = json.dumps({"m": method, "p": params}, separators=(",", ":"))
    return f"~m~{len(body)}~m~{body}"


async def daily_bars(symbol: str, bars: int = MAX_BARS) -> pd.DataFrame:
    """The latest `bars` daily bars, split-adjusted to today's share."""
    session = "cs_" + "".join(random.choices(string.ascii_lowercase, k=12))
    resolve = json.dumps({"symbol": symbol, "adjustment": "splits"})
    async with asyncio.timeout(TIMEOUT_SECONDS):
        buf = await _collect(session, resolve, bars)
    return _parse(symbol, buf)


async def _collect(session: str, resolve: str, bars: int) -> str:
    buf = ""
    async with websockets.connect(
        URL, additional_headers={"Origin": "https://www.tradingview.com"}, open_timeout=30
    ) as ws:
        for method, params in [
            ("set_auth_token", ["unauthorized_user_token"]),
            ("chart_create_session", [session, ""]),
            ("resolve_symbol", [session, "symbol_1", "=" + resolve]),
            ("create_series", [session, "s1", "s1", "symbol_1", "1D", bars]),
        ]:
            await ws.send(_frame(method, params))
        while True:
            msg = str(await ws.recv())
            for beat in re.findall(r"~h~\d+", msg):
                await ws.send(f"~m~{len(beat)}~m~{beat}")
            buf += msg
            if "series_completed" in msg:
                break
            if "symbol_error" in msg or "critical_error" in msg:
                raise RuntimeError(f"TradingView rejected {resolve}")
    return buf


def _parse(symbol: str, buf: str) -> pd.DataFrame:
    match = re.search(r'"s":\[(.*?)\],"ns"', buf)
    if not match:
        raise RuntimeError(f"TradingView returned no bars for {symbol}")
    rows = [b["v"] for b in json.loads("[" + match.group(1) + "]")]
    df = pd.DataFrame([r[:6] + [None] * (6 - len(r[:6])) for r in rows], columns=["t", "o", "h", "l", "c", "v"])
    df.index = pd.to_datetime(df.pop("t"), unit="s").dt.normalize()
    df.index.name = "date"
    return df[~df.index.duplicated(keep="last")].sort_index()
