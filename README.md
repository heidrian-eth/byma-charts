# BYMA Charts

A personal, local charting tool for Buenos Aires stocks. It's built for long-term relative-value investing: which stocks have run too far ahead of the market, and which are lagging behind their long-term trend.

```bash
./run.sh        # API on :8765, web app on :5173
```

You'll need `uv` and `pnpm`.

Pages always read from the local cache (`backend/data.sqlite3`, kept in memory), so they never wait on the network:

- **Updates are incremental.** Every 15 minutes, and whenever a series you open is more than 30 minutes old, the backend fetches only the last ~3 weeks, today's bar included, and merges them into the cache.
- **Monthly CPIs** refresh daily.
- **Refresh data** runs an update right away. `POST /api/refresh?full=true` re-downloads everything from scratch.
- **Only a series that has never been downloaded** blocks on a full fetch.

## What it does

- **Price in:** any stock divided by one of:
  - nominal pesos
  - constant pesos (today's pesos)
  - the official dollar, plain or adjusted for US inflation
  - the blue chip dollar (CCL), plain or adjusted for US inflation
  - the Merval (IMV)
  - the General Index (IAB)
- **Every price unit is rescaled** so the latest value equals today's peso price. History then reads as "pesos at today's level" of that unit. For example, vs Merval, HARG's 2001 price of 10,162 means it was worth 7.6× its current 1,330 relative to the index.
- **Stock list:** the Merval (**IMV**) and General Index (**IAB**) come first and chart like stocks. An index divided by itself is skipped.
- **Thin stocks are hidden:** a stock must have traded (volume above zero, a real price) on at least **25% of weekdays** since its first trade. Liquid names sit at 70–94%, since holidays cap even the busiest. Thinner names that still qualify include DOME (32%) and INTR (50%); INAG (19%), REGE (18%) and EDSH (9%) are hidden.
- **Leaderboard:**
  - top gainers and losers over 1m, 3m, 6m, 1y, 3y or 5y
  - the stocks furthest above and below their regression trend, measured in sigmas
  - a sortable table of every stock
- **Chart:**
  - candles or line, with daily, weekly or monthly bars; light, dark or system theme
  - **%** and **x** toggles that relabel the price axis relative to the latest price: as a percentage (latest = 100%) or as a multiple (2x above it, 1/2x below it)
  - a trend with 1/2/3σ bands, from one of two models:
    - **Regression:** one straight trend over a window you set with presets, date fields, or by clicking the chart.
    - **Flat mean:** a horizontal line at the window's average (geometric on Log), with its standard deviation. No trend is assumed.
    - **Centered bands:** Bollinger bands whose mean and σ come from a 1–5 year window centered on each bar. The last half-window only has past data, so it's drawn faded and will move as new bars arrive.
    - **Auto** (the default) uses centered bands for nominal pesos, because inflation bends their long-run path so no single straight line fits, and regression for every other unit. The leaderboard and the sigma mosaic follow the same setting.
  - SMA, EMA and moving-median averages, each with its own color, opacity and line width
  - centered versions of all three, which have no lag. Near the latest bar a centered average has less future data to use, so that stretch is drawn dotted and will change as new bars arrive:
    - centered SMA and median shrink their window to the bars that exist
    - centered EMA runs forward and then backward, with the series mirrored past its ends
  - two-point lines
  - a distance-from-trend mosaic showing the stock's sigma distance under all eight price units at once, over the same window; click a tile to switch to that unit
- **Log / Linear** is one switch. It sets both the price axis and the regression fit, so a linear fit is never drawn on a log axis.
- **Two-point lines** are saved per stock and price unit as (date, price) anchors. They stay put when you switch scale or bar interval.

Per-view settings live in the browser's localStorage: channel windows, lines and averages.

## Data sources

| Series | Source | Coverage |
|---|---|---|
| Stocks, daily OHLC | data912.com `/historical/stocks/{ticker}`, with TradingView `BCBA:{ticker}` history stitched in front when data912 starts late (for example, VALO: data912 from 2025-11, TradingView from 2017-08), or used alone when data912 is down. TradingView also supplies the incremental updates. | 2001 onward (TradingView from 2004-09) |
| Merval | Yahoo chart API `^MERV` | 1996 onward |
| General Index | TradingView public websocket `BCBA:IAB` | 2004-09 onward |
| Official USD | datos.gob.ar `175.1_DR_ESTANSE_0_0_20`, then BCRA A3500 (variable 5) from 2002-03 | 1992 onward |
| Blue chip USD | YPFD (data912) × 10 ÷ YPF ADR (Yahoo), 5-day median | 2001 onward |
| CPI | datos.gob.ar, chained from monthly changes (see below) | 1990 onward |
| US CPI (for inflation-adjusted dollars) | FRED `CPIAUCSL` | 1947 onward |

The TradingView feed is an undocumented websocket; its protocol, as observed live, is written up in [`docs/tradingview-websocket.md`](docs/tradingview-websocket.md).

The CPI splice avoids INDEC's intervened 2007–2015 figures:

| Months | Series |
|---|---|
| 1990-01 → 2006-12 | INDEC historical CPI |
| 2007-01 → 2012-07 | San Luis CPI |
| 2012-08 → 2016-04 | CABA CPI (also covers INDEC's 2015–16 blackout) |
| 2016-05 → 2016-12 | INDEC GBA CPI |
| 2017-01 onward | INDEC national CPI |

Each monthly CPI reading, Argentine or US, is placed mid-month and interpolated geometrically to daily values. Months that haven't been published yet are extrapolated at the last monthly rate.

## Data quirks handled

- **Splits:** data912 does not adjust for splits (for example, YPFD's 10:1 split on 2026-08-03). One-day moves close to 1/k or k (k = 2, 3, 4, 5, 10, 20, 25, 50, 100) are treated as splits, and earlier history is restated. If a real price move is mistaken for a split, add its `(ticker, date)` to `NOT_SPLITS` in `backend/app/cleaning.py`.
- **Stitched histories:** TradingView's older bars are rescaled to meet data912's first close, because the two can differ by a small corporate-action adjustment.
- **Bad ticks:** a day that jumps more than 40% from its 5-day median and comes straight back is dropped.
- **Short histories:** trend distance is only shown when the fit spans at least 2 years. Charts show whatever history a stock has, even when the price unit's data goes back further.
- **Trend windows** default to all history. The chart's window is shared by every stock and unit, so switching charts keeps the same period.
- **Fragile sources:** data912 is a hobby API, and the TradingView socket is undocumented (each call has a 45-second timeout). When an update fails, the cached copy keeps being served. The stock list is cached too, so a data912 outage doesn't empty the app.

## Layout

```
backend/app/
  sources/         one module per upstream API
  cleaning.py      split and bad-tick repair
  store.py         SQLite-cached named series ("stock:GGAL", "yahoo:^MERV", "macro:cpi", ...)
  denominators.py  what prices can be divided by
  analytics.py     resampling, regression channel, period changes
  main.py          FastAPI routes: /api/meta, /api/chart/{ticker}, /api/sigmas/{ticker}, /api/leaderboard, /api/refresh
frontend/src/
  LeaderboardView.tsx, ChartView.tsx, PriceChart.tsx (lightweight-charts), drawings.ts, indicators.ts
```

Tests: `cd backend && uv run pytest`.
