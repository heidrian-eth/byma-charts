import numpy as np
import pandas as pd

from app.cleaning import adjust_splits, remove_spikes


def _bars(closes: list[float]) -> pd.DataFrame:
    idx = pd.bdate_range("2024-01-01", periods=len(closes))
    c = pd.Series(closes, index=idx, dtype=float)
    return pd.DataFrame({"o": c, "h": c, "l": c, "c": c, "v": 100.0})


def test_ten_for_one_split_restates_history():
    df = adjust_splits("X", _bars([1000, 1010, 1020, 102, 103, 104]))
    assert np.allclose(df["c"], [100, 101, 102, 102, 103, 104])
    assert df["v"].iloc[0] == 1000


def test_real_crash_is_not_a_split():
    df = adjust_splits("X", _bars([100, 101, 71, 70, 72]))
    assert df["c"].iloc[0] == 100


def test_one_day_bad_tick_is_dropped_but_real_move_kept():
    df = remove_spikes(_bars([100, 101, 55, 102, 103, 104, 150, 151, 152, 153]))
    assert 55 not in df["c"].values
    assert 150 in df["c"].values


def test_stitch_prepends_older_history_scaled_to_the_join():
    from app.store import stitch

    older = _bars([10, 11, 12, 13, 14])
    primary = _bars([26, 28, 30, 32, 34, 36]).iloc[3:]
    primary.index = older.index[3:].append(pd.bdate_range(older.index[-1], periods=2)[1:])
    out = stitch(primary, older)
    assert list(out.index[:3]) == list(older.index[:3])
    assert np.allclose(out["c"].iloc[:3], [10 * 32 / 13, 11 * 32 / 13, 12 * 32 / 13])
    assert out["c"].iloc[3] == 32
