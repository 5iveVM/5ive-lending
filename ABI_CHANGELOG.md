# ABI Changelog

## v1 (2026-02-18)
- Canonicalized lending implementation into `src/main.v`.
- Preserved `5ive-lending` instruction naming model.
- Added market pause admin control (`set_market_pause`).
- Added kinked utilization rate logic in reserve refresh.
- Added oracle freshness-gated obligation refresh/liquidation checks.
