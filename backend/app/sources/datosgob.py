"""apis.datos.gob.ar: CPI splice inputs and the long official USD/ARS history (both INDEC/BCRA)."""

import io

import pandas as pd

from app.sources.http import client

BASE = "https://apis.datos.gob.ar/series/api/series/"

# INDEC's 2007-2015 CPI was intervened, so those years borrow provincial CPIs. Each segment
# contributes its month-on-month changes from `start` onwards; the chain is rebased at the end.
CPI_SPLICE = [
    ("1990-01", "178.1_NL_GENERAL_0_0_13"),  # INDEC historical CPI (GBA)
    ("2007-01", "197.1_NIVEL_GENERAL_2014_0_13"),  # San Luis CPI
    ("2012-08", "193.1_NIVEL_GENERAL_JULI_0_13"),  # CABA CPI, also covers INDEC's 2015-16 blackout
    ("2016-05", "101.1_I2NG_2016_M_22"),  # INDEC GBA CPI
    ("2017-01", "148.3_INIVELNAL_DICI_M_26"),  # INDEC national CPI
]
USD_OFFICIAL = "175.1_DR_ESTANSE_0_0_20"


async def _series(ids: list[str], start: str) -> pd.DataFrame:
    frames = []
    offset = 0
    while True:
        r = await client.get(
            BASE,
            params={
                "ids": ",".join(ids),
                "start_date": start,
                "format": "csv",
                "limit": 5000,
                "start": offset,
                "header": "ids",
            },
        )
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text), parse_dates=["indice_tiempo"])
        frames.append(df)
        if len(df) < 5000:
            break
        offset += 5000
    return pd.concat(frames).set_index("indice_tiempo").sort_index()


async def cpi_spliced() -> pd.Series:
    """Monthly CPI chained across CPI_SPLICE, indexed by the first day of each month."""
    raw = await _series([sid for _, sid in CPI_SPLICE], CPI_SPLICE[0][0] + "-01")
    change = pd.Series(index=raw.index, dtype=float)
    bounds = [pd.Timestamp(start) for start, _ in CPI_SPLICE] + [pd.Timestamp.max]
    for (_, sid), lo, hi in zip(CPI_SPLICE, bounds, bounds[1:]):
        mom = raw[sid] / raw[sid].shift(1)
        span = (raw.index >= lo) & (raw.index < hi)
        change[span] = mom[span]
    change.iloc[0] = 1.0
    change = change.dropna()
    # Stop at the first gap, so a late-published segment never silently freezes prices.
    gaps = change.index.to_series().diff() > pd.Timedelta(days=31)
    if gaps.any():
        change = change[: gaps.idxmax()].iloc[:-1]
    index = change.cumprod()
    return index / index.iloc[-1]


async def usd_official() -> pd.Series:
    """Daily official rate from 1992 (1:1 until the 2002 devaluation). Ends ~a month behind."""
    df = await _series([USD_OFFICIAL], "1992-01-01")
    return df[USD_OFFICIAL].dropna()
