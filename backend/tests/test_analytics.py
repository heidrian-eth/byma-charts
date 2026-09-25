import numpy as np
import pandas as pd

from app.analytics import changes, fit, resample


def test_log_fit_recovers_growth_and_zero_sigma():
    idx = pd.date_range("2010-01-01", "2020-01-01", freq="W-FRI")
    years = (idx - idx[0]).days / 365.25
    close = pd.Series(100 * 1.1 ** years, index=idx)
    f = fit(close, None, None, log=True)
    assert abs(f.annual_growth() - 0.1) < 1e-3
    assert f.sigma < 1e-9


def test_z_sign_above_trend():
    idx = pd.date_range("2010-01-01", periods=200, freq="W-FRI")
    rng = np.random.default_rng(0)
    close = pd.Series(np.exp(rng.normal(0, 0.1, len(idx))) * 100, index=idx)
    f = fit(close, None, None, log=True)
    assert f.z(idx[-1], float(close.iloc[-1]) * 2) > 3


def test_weekly_bars_are_labelled_with_last_trading_day():
    idx = pd.bdate_range("2024-01-01", "2024-01-10")
    df = pd.DataFrame({"o": 1.0, "h": 2.0, "l": 0.5, "c": range(len(idx)), "v": 1.0}, index=idx)
    w = resample(df, "w")
    assert w.index[-1] == pd.Timestamp("2024-01-10")
    assert w["h"].iloc[0] == 2.0


def test_changes_uses_close_on_or_before_lookback():
    idx = pd.date_range("2020-01-01", "2024-01-01", freq="D")
    close = pd.Series(np.arange(len(idx), dtype=float) + 1, index=idx)
    ch = changes(close)
    assert ch["1y"] is not None and ch["1y"] > 0
    assert ch["5y"] is None


def test_flat_mean_is_horizontal_and_scores_distance():
    from app.analytics import mean_trend

    idx = pd.date_range("2015-01-01", periods=100, freq="W-FRI")
    close = pd.Series([100.0, 200.0] * 50, index=idx)
    t = mean_trend(close, None, None, log=True)
    assert t.mid.nunique() == 1
    assert abs(np.exp(t.mid.iloc[0]) - np.sqrt(100 * 200)) < 1e-6
    assert t.z(200.0) > 0 > t.z(100.0)
