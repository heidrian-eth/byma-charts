"""SQLite cache of raw daily bars, keyed by series name (e.g. "stock:GGAL", "idx:MERV")."""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).resolve().parent.parent / "data.sqlite3"
COLUMNS = ["o", "h", "l", "c", "v"]

_lock = threading.Lock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.executescript(
    """
    CREATE TABLE IF NOT EXISTS bars (
        key TEXT NOT NULL, date TEXT NOT NULL,
        o REAL, h REAL, l REAL, c REAL NOT NULL, v REAL,
        PRIMARY KEY (key, date)
    );
    CREATE TABLE IF NOT EXISTS fetches (key TEXT PRIMARY KEY, fetched_at REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    """
)


def save(key: str, df: pd.DataFrame) -> None:
    """Replace the stored series with its merged, cleaned version (a local write only)."""
    df = df.reindex(columns=COLUMNS)
    rows = [
        (key, d.strftime("%Y-%m-%d"), *(None if pd.isna(x) else float(x) for x in row))
        for d, row in zip(df.index, df.itertuples(index=False))
    ]
    with _lock, _conn:
        _conn.execute("DELETE FROM bars WHERE key = ?", (key,))
        _conn.executemany("INSERT INTO bars VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
        _conn.execute("INSERT OR REPLACE INTO fetches VALUES (?, ?)", (key, time.time()))


def load(key: str) -> pd.DataFrame:
    with _lock:
        df = pd.read_sql_query(
            "SELECT date, o, h, l, c, v FROM bars WHERE key = ? ORDER BY date",
            _conn,
            params=[key],
            parse_dates=["date"],
        )
    return df.set_index("date")


def keys(prefix: str) -> list[str]:
    with _lock:
        rows = _conn.execute("SELECT key FROM fetches WHERE key LIKE ?", (prefix + "%",)).fetchall()
    return sorted(r[0] for r in rows)


def get_kv(k: str) -> str | None:
    with _lock:
        row = _conn.execute("SELECT v FROM kv WHERE k = ?", (k,)).fetchone()
    return row[0] if row else None


def set_kv(k: str, v: str) -> None:
    with _lock, _conn:
        _conn.execute("INSERT OR REPLACE INTO kv VALUES (?, ?)", (k, v))


def fetched_at(key: str) -> float | None:
    with _lock:
        row = _conn.execute("SELECT fetched_at FROM fetches WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None
