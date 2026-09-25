"""data912.com: free hobby API with daily OHLC for BYMA stocks back to 2001. Not split-adjusted."""

import pandas as pd

from app.sources.http import client

BASE = "https://data912.com"

# USD/cable legs of local stocks that the "drop <ticker>D" rule can't catch.
_NON_ARS = {"BMA.D", "TGN4D", "REITC", "TECOD", "TGSUD"}


async def stock_bars(ticker: str) -> pd.DataFrame:
    r = await client.get(f"{BASE}/historical/stocks/{ticker}")
    r.raise_for_status()
    rows = r.json()
    if not isinstance(rows, list) or not rows:
        return pd.DataFrame(columns=["o", "h", "l", "c", "v"])
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")[["o", "h", "l", "c", "v"]].sort_index()


async def ars_stock_universe() -> list[str]:
    r = await client.get(f"{BASE}/live/arg_stocks")
    r.raise_for_status()
    symbols = {row["symbol"] for row in r.json()}
    return sorted(
        s for s in symbols if s not in _NON_ARS and not (s.endswith("D") and s[:-1] in symbols)
    )
