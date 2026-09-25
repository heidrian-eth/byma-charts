"""Resampling, regression channels and the leaderboard metrics."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

RULES = {"w": "W-FRI", "m": "ME"}
DAYS_PER_YEAR = 365.25


def resample(df: pd.DataFrame, interval: str) -> pd.DataFrame:
    if interval == "d":
        return df
    out = df.resample(RULES[interval]).agg(
        {"o": "first", "h": "max", "l": "min", "c": "last", "v": "sum"}
    )
    out = out.dropna(subset=["c"])
    # Label each bar with its last real trading day, so the final bar never sits in the future.
    last_day = df["c"].resample(RULES[interval]).apply(lambda s: s.index.max()).dropna()
    out.index = pd.DatetimeIndex(last_day.loc[out.index].values)
    return out


@dataclass
class Fit:
    slope: float
    intercept: float
    sigma: float
    log: bool
    start: pd.Timestamp
    end: pd.Timestamp
    n: int

    def mid(self, dates: pd.DatetimeIndex) -> np.ndarray:
        return self.intercept + self.slope * _years(dates)

    def z(self, date: pd.Timestamp, value: float) -> float:
        y = np.log(value) if self.log else value
        return float((y - self.mid(pd.DatetimeIndex([date]))[0]) / self.sigma)

    def pct_from_trend(self, date: pd.Timestamp, value: float) -> float:
        mid = self.mid(pd.DatetimeIndex([date]))[0]
        return float(value / np.exp(mid) - 1 if self.log else value / mid - 1)

    def annual_growth(self) -> float | None:
        """Trend growth per year: compounded for log fits, undefined for linear ones."""
        return float(np.exp(self.slope) - 1) if self.log else None


def _years(dates: pd.DatetimeIndex) -> np.ndarray:
    return (dates.values.astype("datetime64[D]").astype(np.int64)) / DAYS_PER_YEAR


def fit(close: pd.Series, start: pd.Timestamp | None, end: pd.Timestamp | None, log: bool) -> Fit | None:
    window = close.loc[start:end].dropna()
    window = window[window > 0]
    if len(window) < 10:
        return None
    x = _years(window.index)
    y = np.log(window.values) if log else window.values
    slope, intercept = np.polyfit(x, y, 1)
    resid = y - (intercept + slope * x)
    return Fit(
        slope=float(slope),
        intercept=float(intercept),
        sigma=float(np.std(resid, ddof=2)),
        log=log,
        start=window.index[0],
        end=window.index[-1],
        n=len(window),
    )


def channel_lines(f: Fit, dates: pd.DatetimeIndex, sigmas=(1, 2, 3)) -> dict[str, list[float]]:
    """Mid line and +/- k sigma bands, in price units, extended to every given date."""
    mid = f.mid(dates)
    to_price = np.exp if f.log else (lambda a: a)
    lines = {"mid": to_price(mid)}
    for k in sigmas:
        lines[f"+{k}"] = to_price(mid + k * f.sigma)
        lines[f"-{k}"] = to_price(mid - k * f.sigma)
    return {name: [float(v) for v in arr] for name, arr in lines.items()}


def trading_day_ratio(df: pd.DataFrame) -> float:
    """Share of weekdays since the first trade on which the stock actually traded."""
    traded = df[(df["c"] > 0) & (df["v"].fillna(0) > 0)]
    if traded.empty:
        return 0.0
    weekdays = len(pd.bdate_range(traded.index[0], df.index[-1]))
    return len(traded) / weekdays


PERIODS = {"1m": 30, "3m": 91, "6m": 182, "1y": 365, "3y": 3 * 365, "5y": 5 * 365}


def changes(close: pd.Series) -> dict[str, float | None]:
    """Percent change of the (deflated) close over each lookback period."""
    close = close.dropna()
    last_date, last = close.index[-1], close.iloc[-1]
    out: dict[str, float | None] = {}
    for name, days in PERIODS.items():
        past = close.loc[: last_date - pd.Timedelta(days=days)]
        # A stale anchor (listing gap longer than a month) would mislabel the period.
        ok = not past.empty and (last_date - past.index[-1]).days <= days + 31
        out[name] = float(last / past.iloc[-1] - 1) if ok else None
    return out


BAND_MIN_POINTS = 8


@dataclass
class Trend:
    """A trend line with a (possibly time-varying) sigma, in log or linear space."""

    model: str
    log: bool
    mid: pd.Series  # in fit space (log price when log=True)
    sigma: pd.Series  # in fit space, same index as mid
    start: pd.Timestamp
    end: pd.Timestamp
    annual_growth: float | None
    provisional_from: pd.Timestamp | None = None

    def z(self, value: float) -> float:
        y = np.log(value) if self.log else value
        return float((y - self.mid.iloc[-1]) / self.sigma.iloc[-1])

    def pct_from_trend(self, value: float) -> float:
        mid = self.mid.iloc[-1]
        return float(value / np.exp(mid) - 1 if self.log else value / mid - 1)

    def lines(self, sigmas=(1, 2, 3)) -> dict[str, list[float]]:
        to_price = np.exp if self.log else (lambda a: a)
        out = {"mid": to_price(self.mid.to_numpy())}
        for k in sigmas:
            out[f"+{k}"] = to_price((self.mid + k * self.sigma).to_numpy())
            out[f"-{k}"] = to_price((self.mid - k * self.sigma).to_numpy())
        return {name: [float(v) for v in arr] for name, arr in out.items()}


def regression_trend(
    close: pd.Series, start: pd.Timestamp | None, end: pd.Timestamp | None, log: bool
) -> Trend | None:
    f = fit(close, start, end, log)
    if f is None:
        return None
    dates = close.index[close.index >= f.start]
    mid = pd.Series(f.mid(dates), index=dates)
    return Trend(
        model="regression",
        log=log,
        mid=mid,
        sigma=pd.Series(f.sigma, index=dates),
        start=f.start,
        end=f.end,
        annual_growth=f.annual_growth(),
    )


def mean_trend(
    close: pd.Series, start: pd.Timestamp | None, end: pd.Timestamp | None, log: bool
) -> Trend | None:
    """Flat line at the window's mean (geometric when log) with its standard deviation."""
    window = close.loc[start:end].dropna()
    window = window[window > 0]
    if len(window) < 10:
        return None
    y = np.log(window) if log else window
    dates = close.index[close.index >= window.index[0]]
    return Trend(
        model="mean",
        log=log,
        mid=pd.Series(float(y.mean()), index=dates),
        sigma=pd.Series(float(y.std(ddof=1)), index=dates),
        start=window.index[0],
        end=window.index[-1],
        annual_growth=None,
    )


def band_trend(close: pd.Series, years: float, log: bool) -> Trend | None:
    """Centered Bollinger band: rolling mean and std over a window centred on each bar.

    Near the latest bar the window is truncated to the bars that exist, so the newest
    stretch (half a window) is provisional and moves as new data arrives.
    """
    close = close[close > 0].dropna()
    if len(close) < BAND_MIN_POINTS * 2:
        return None
    y = np.log(close) if log else close
    window = pd.Timedelta(days=round(years * DAYS_PER_YEAR))
    roll = y.rolling(window, center=True, min_periods=BAND_MIN_POINTS)
    mid, sigma = roll.mean(), roll.std()
    ok = mid.notna() & sigma.notna() & (sigma > 0)
    mid, sigma = mid[ok], sigma[ok]
    if mid.empty:
        return None
    return Trend(
        model="bands",
        log=log,
        mid=mid,
        sigma=sigma,
        start=mid.index[0],
        end=mid.index[-1],
        annual_growth=None,
        provisional_from=close.index[-1] - window / 2,
    )
