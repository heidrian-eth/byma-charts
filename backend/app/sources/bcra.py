"""BCRA statistics API: Comunicación A3500 wholesale reference rate, business days from 2002-03."""

import pandas as pd

from app.sources.http import client

BASE = "https://api.bcra.gob.ar/estadisticas/v4.0/monetarias"
A3500 = 5


async def a3500(since: pd.Timestamp | None = None) -> pd.Series:
    desde = since.strftime("%Y-%m-%d") if since is not None else "2002-01-01"
    rows: list[dict] = []
    offset = 0
    while True:
        r = await client.get(
            f"{BASE}/{A3500}",
            params={"desde": desde, "hasta": "2100-01-01", "limit": 3000, "offset": offset},
            headers={"Accept": "application/json"},
        )
        r.raise_for_status()
        page = _detail(r.json())
        rows.extend(page)
        if len(page) < 3000:
            break
        offset += 3000
    s = pd.Series({pd.Timestamp(x["fecha"]): float(x["valor"]) for x in rows})
    return s.sort_index()


def _detail(payload: dict) -> list[dict]:
    results = payload.get("results", [])
    if results and "detalle" in results[0]:
        return results[0]["detalle"]
    return results
