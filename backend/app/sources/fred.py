"""FRED (St. Louis Fed): US CPI for inflation-adjusted dollars."""

import io

import pandas as pd

from app.sources.http import client

URL = "https://fred.stlouisfed.org/graph/fredgraph.csv"
US_CPI = "CPIAUCSL"  # CPI-U, all items, seasonally adjusted, monthly


async def us_cpi() -> pd.Series:
    # FRED serves an empty body to browser-like user agents.
    r = await client.get(URL, params={"id": US_CPI}, headers={"User-Agent": "byma-charts/0.1"})
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), parse_dates=["observation_date"])
    s = pd.to_numeric(df.set_index("observation_date")[US_CPI], errors="coerce").dropna()
    if s.empty:
        raise RuntimeError("FRED returned no CPI rows")
    return s
