# DBS Myanmar (TikTok @dbsmyanmar) – what the channel teaches, and what zBOT took from it

Read on 2026-11-15: 528 videos listed, 109 trading-related ones read through their Burmese subtitles.
Newest video seen: id 7707995173237624065 (TikTok ids grow with time; anything larger is new).

## Techniques taught
1. **3 entry candles** – Hammer / Shooting Star (pin bar), Bullish / Bearish Engulfing, Doji (helper only, never an entry alone).
2. **Candle only at a zone** – support/resistance, trendline, pattern edge, supply/demand, SMC (FVG, order block). Not everywhere.
3. **Trend first** – uptrend: buy setups only, on a pullback; downtrend: sell setups only; sideways: no trade.
4. **3 strategies (Essential Trading Strategy Day 8–10)**:
   - Breakout: enter on the candle that closes out of the zone/pattern.
   - Breakout + Retest: wait for price to come back to the broken zone, enter on a confirmation candle; SL beyond candle + zone; TP last swing.
   - Reversal: zone touched 2x (or wedge 3x), confirmation candle required, SL outside the zone.
5. **EMA 50 / 150 / 200 "traffic light"** on 4h / daily (yellow, green, red). He prefers 150 over 100.
6. **Risk**: 1–2% per trade, TP at least 2x SL, always SL + TP. RSI alone is unreliable.
7. **After 3 stop-losses in a row**: check plan/size/market change, rest 24h–3 days.
8. **Timeframes**: beginners swing/position on one timeframe; 15m only with a 4h zone above it.
9. **DCA** for long-term crypto (no SL; split buying).

## Backtest (4 years, 4h, futures, risk 0.5%, F&G filter on)
| Strategy | BTC/ETH/SOL | BNB/XRP/DOGE/ADA (unseen) |
|---|---|---|
| combo (old) | +97%, DD 11.8%, PF 1.52 | +75%, DD 23.9% |
| candle at zone (EMA200) | +237%, DD 18.3% | +17%, DD 24.8% |
| breakout retest | +54%, DD 20.4% | −5% |
| **brain = combo + candle at zone + EMA 50/150/200** | **+214%, DD 12.8%, PF 1.54** | **+108%, DD 27.2%, PF 1.35** |
| all DBS together | +211% | +87% |
| + 3-loss pause 24h | mixed (noise) | — |
| + 3-loss pause 72h | worse | worse |
| pattern 15m (the setting before) | −71%, DD 77% | — |

Fixed 2R take-profit lost money on candles; a 4-ATR trailing stop made it work.
On the bot's 4 coins (BTC/ETH/SOL/BNB): brain +300%, DD 14.5%, PF 1.52, out-of-sample PF 1.61.

## In zBOT
- `src/strategies.js`: `candle`, `retest`, `brain` (used), `dbs`; `trendOk('stack')` = EMA traffic light.
- `src/backtest.js`: optional `lossStreak` / `lossPauseH` (research only, not enabled).
- VPS paper bot: STRATEGY=brain, INTERVAL=4h since 2026-11-15.
