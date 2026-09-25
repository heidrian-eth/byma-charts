# TradingView chart websocket: protocol spec

TradingView has no public data API. Its website loads chart data over this websocket, and this spec describes that protocol as observed. Every behaviour below was captured live on **2026-09-25** (server `release_210-6`) unless marked **unverified**. The protocol is undocumented and can change without notice.

Client in this repo: `backend/app/sources/tradingview.py`.

## 1. Connection

| | |
|---|---|
| URL | `wss://data.tradingview.com/socket.io/websocket` |
| Required header | `Origin: https://www.tradingview.com` (or `https://data.tradingview.com`). **Without it, or with any other origin, the handshake fails with HTTP 403.** |
| Auth | None for public data: send the literal token `unauthorized_user_token` (§3.1) |
| Encoding | Text frames, JSON inside a length-prefixed envelope (§2) |

Right after connecting, the server sends a hello packet:

```json
{"session_id":"0.79130501.0_nje1-charts-free-4-tvbs-hfxtd-8","timestamp":1790346117,
 "timestampMs":1790346117565,"release":"release_210-6","auth_scheme_vsn":2,"protocol":"json", ...}
```

## 2. Framing

Every packet, in both directions, is wrapped as:

```
~m~<N>~m~<payload>
```

- `<N>` is the payload length in characters.
- **One websocket frame can carry several packets back to back**, so parse by walking the prefixes rather than assuming one packet per frame.
- A payload is either:
  - a JSON message `{"m": <method>, "p": [<params>]}`, sometimes with `t` / `t_ms` server timestamps, or
  - a heartbeat `~h~<k>`.
- **Heartbeats must be echoed back unchanged**, re-wrapped: `~m~<len>~m~~h~<k>`. A client that doesn't echo them gets disconnected. The interval is **unverified**; none arrived during the sub-30-second captures.

Encode outgoing JSON without spaces, e.g. `json.dumps(msg, separators=(",", ":"))`, and compute `<N>` on that exact string.

## 3. Client → server messages

Session ids are client-chosen strings. By convention they are `cs_` plus 12 random lowercase letters for chart sessions, and `qs_` plus 12 for quote sessions.

### 3.1 `set_auth_token`
```json
{"m":"set_auth_token","p":["unauthorized_user_token"]}
```
Send first. A logged-in account's token would come from `POST https://www.tradingview.com/accounts/signin/` (`user.auth_token` in the response); that's how `tvdatafeed` logs in. This app doesn't need it.

### 3.2 `chart_create_session` / `chart_delete_session`
```json
{"m":"chart_create_session","p":["cs_xxxxxxxxxxxx",""]}
{"m":"chart_delete_session","p":["cs_xxxxxxxxxxxx"]}
```
**Anonymous limit: one series per chart session.** A second `create_series` in the same session fails with `critical_error: "exceed limit of series in the session"`. To fetch several symbols on one socket, create a session, fetch, delete it, and repeat. Sequential sessions on one socket were verified to work.

### 3.3 `resolve_symbol`
```json
{"m":"resolve_symbol","p":["cs_…","sym_1","={\"symbol\":\"BCBA:GGAL\",\"adjustment\":\"splits\"}"]}
```
- **Third param:** a symbol id you choose, referenced later by `create_series`.
- **Fourth param:** `"="` followed by a JSON descriptor **encoded as a string**.
  - `symbol` is `EXCHANGE:TICKER`, e.g. `BCBA:GGAL`, `BCBA:IMV`, `BCBA:IAB`, `NYSE:YPF`.
  - `adjustment`:
    - `"splits"`: split-adjusted
    - `"dividends"`: split and dividend-adjusted, i.e. total return. Verified: GGAL's first close is 1.73 with `splits` and 1.21 with `dividends`.
  - `session`: optional, e.g. `"regular"`.

### 3.4 `create_series`
```json
{"m":"create_series","p":["cs_…","sds_1","s1","sym_1","1D",20000,""]}
```

| Index | Meaning |
|---|---|
| 0 | chart session |
| 1 | series id (you choose) |
| 2 | turnaround id, echoed back (`"s1"`) |
| 3 | symbol id from `resolve_symbol` |
| 4 | resolution: `"1"`, `"5"`, `"60"` (minutes), `"1D"`, `"1W"`, `"1M"` |
| 5 | number of bars wanted, counting back from the latest |
| 6 | range. Always `""` here; other values are **unverified** |

### 3.5 Quote sessions (optional)
```json
{"m":"quote_create_session","p":["qs_…"]}
{"m":"quote_set_fields","p":["qs_…","lp","ch","chp","volume","currency_code","description"]}
{"m":"quote_add_symbols","p":["qs_…","BCBA:GGAL"]}
```
These return the last price and daily change without bars (§4).

## 4. Server → client messages

| `m` | `p` | Meaning |
|---|---|---|
| `series_loading` | `[cs, series_id, turnaround]` | Request accepted |
| `symbol_resolved` | `[cs, symbol_id, {…}]` | Symbol metadata: `currency_code`, exchange info, and `session_holidays` (a comma-separated `YYYYMMDD` list, useful as a trading calendar) |
| `timescale_update` | `[cs, {series_id: {"s": [bars], …}}, {…}]` | **The bars** (§5) |
| `series_completed` | `[cs, series_id, stream_mode, turnaround, {"rt_update_period": 5, "data_completed": …}]` | Download finished (§6) |
| `du` | `[cs, {series_id: {"s": [bars]}}]` | Live update of the latest bar(s) while the socket stays open |
| `qsd` | `[qs, {"n": symbol, "s": "ok", "v": {fields}}]` | Quote data, e.g. `{"lp": 6335.0, "ch": -60.0, "chp": -0.94, "volume": 219092.0, …}` |
| `quote_completed` | `[qs, symbol]` | Initial quote delivered |
| `symbol_error` | `[cs, symbol_id, "invalid symbol"]` | Unknown symbol (verified with `BCBA:NOPE123`) |
| `critical_error` | `[cs, reason, detail]` | Protocol misuse, e.g. the series limit in §3.2 |

A one-shot download can stop reading at `series_completed` and close the socket, or send `chart_delete_session` and reuse the socket.

## 5. Bar format

```json
{"i": 2, "v": [1790343000.0, 6405.0, 6455.0, 6320.0, 6325.0, 219080.0]}
```
- `i`: bar index within the series.
- `v`: `[time, open, high, low, close, volume]`.
  - Volume can be missing for indices, so read `v[5]` defensively.
  - `time` is Unix seconds (UTC) at the **session open**, not midnight. BCBA daily bars sit at 13:30 or 14:00 UTC, NYSE at 13:30 UTC.
  - To get the trading date, convert to the exchange's time zone, or truncate UTC to the date. Both work for these markets, because the open falls on the same UTC day.
- Bars arrive oldest first, all in a single `timescale_update`.

## 6. Coverage and limits (anonymous, observed)

`series_completed`'s last param says whether you got everything:

- `data_completed: "end"`: the whole history was delivered.
- `data_completed: "limit"`: the result was capped.

Its stream mode says how fresh the data is:

- `"delayed_streaming_1200"`: **20-minute delayed**. This applies to BCBA.
- `"streaming"`: real time. This applies to NYSE.

| Request (bars asked: 20,000; weekly: 5,000) | Bars returned | Span | `data_completed` |
|---|---|---|---|
| `BCBA:GGAL` 1D | 5,374 | 2004-09-17 → today | end |
| `BCBA:GGAL` 1W | 1,150 | 2004-09-13 → today | end |
| `BCBA:GGAL` 60 | 5,753 | 2023-01-02 → today | **limit** |
| `BCBA:GGAL` 1 | 5,392 | 2026-09-07 → today | **limit** |
| `BCBA:AL30` 1D | 1,140 | 2022-01-26 → today | end |
| `BCBA:IAB` 1D | 5,379 | 2004-09-17 → today | end |
| `NYSE:YPF` 1D | 8,358 | 1993-06-29 → today | end |

So:

- **Daily and weekly history is complete without logging in.** For BCBA, "complete" means from **2004-09-17**; TradingView has nothing earlier for that exchange.
- **Intraday is capped at roughly 5,000–5,800 bars.**
- Today's bar is included while the market is open, and it updates through `du`.

## 7. Minimal session (daily history for one symbol)

```
→ set_auth_token        ["unauthorized_user_token"]
→ chart_create_session  ["cs_abc", ""]
→ resolve_symbol        ["cs_abc", "sym_1", "={\"symbol\":\"BCBA:IAB\",\"adjustment\":\"splits\"}"]
→ create_series         ["cs_abc", "sds_1", "s1", "sym_1", "1D", 20000, ""]
← (hello), series_loading, symbol_resolved
← timescale_update      → read p[1]["sds_1"]["s"]
← series_completed      → done; close, or chart_delete_session and reuse the socket
(echo every ~h~N as it arrives)
```

## 8. Failure modes to guard against

- **HTTP 403 on connect:** the Origin header is missing or not allowed.
- **Hangs:** no `series_completed` ever arrives. Wrap the whole exchange in a timeout; this app uses 45 seconds.
- **`symbol_error`:** a wrong ticker or exchange prefix.
- **`critical_error`:** too many series in one session.
- **Protocol drift:** a changed message name or payload shape breaks parsing silently, so fail loudly when no bars come back.

## 9. Existing client libraries

- **`tvdatafeed-enhanced`** (PyPI, v2.2.1), a fork of [`rongardF/tvdatafeed`](https://github.com/rongardF/tvdatafeed). It's a Python wrapper around this same protocol: `TvDatafeed().get_hist(symbol, exchange, interval, n_bars)` returns a pandas DataFrame.
  - **No login needed:** constructed without a username, it uses `unauthorized_user_token` just like this app.
  - **The `n_bars` default is 10:** its docstring claims a maximum of 5,000 bars, but daily requests return more (see §6).
  - It was tested in `tests/test_tradingview.py` and `tests/test_tvdatafeed_auth.py` (around 2026-08-27), where `n_bars=10000` reached 2004-09-17 for BCBA stocks and indices.
  - **Security note:** `tests/test_tvdatafeed_auth.py` hardcodes a TradingView username in the source. The password is read from a temp file, not stored.
- **`tradingview-datafeed`:** failed to import in the same tests.

This app keeps its own ~80-line client rather than depending on those libraries, for three reasons: it needs asyncio, a hard timeout and incremental fetches (`n_bars` = 15), and a small library would be no less likely to break when the protocol changes.
