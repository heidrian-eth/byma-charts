"""Yahoo chart endpoint: Merval (^MERV, from 1996) and the YPF ADR used for the CCL rate."""

import pandas as pd

from app.sources.http import client

BASE = "https://query1.finance.yahoo.com/v8/finance/chart"


async def bars(symbol: str, since: pd.Timestamp | None = None) -> pd.DataFrame:
    period1 = int(since.timestamp()) if since is not None else 0
    r = await client.get(
        f"{BASE}/{symbol}", params={"period1": period1, "period2": 9_999_999_999, "interval": "1d"}
    )
    r.raise_for_status()
    result = r.json()["chart"]["result"][0]
    q = result["indicators"]["quote"][0]
    df = pd.DataFrame(
        {"o": q["open"], "h": q["high"], "l": q["low"], "c": q["close"], "v": q["volume"]},
        index=pd.to_datetime(result["timestamp"], unit="s").normalize(),
    )
    df.index.name = "date"
    df = df.dropna(subset=["c"])
    return df[~df.index.duplicated(keep="last")].sort_index()
