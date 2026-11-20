# zBOT Trader — Binance Spot + Futures

Rule-based trading bot ဖြစ်ပါတယ်။ Backtest စမ်းလို့ရတယ်၊ Risk manager နဲ့ Daily kill switch ပါပါတယ်။
Node.js ပဲ လိုပါတယ် (library ထပ်သွင်းစရာ မလိုပါ)။

> ⚠️ ပညာပေး Tool သာ ဖြစ်ပါတယ်။ အမြတ်အာမခံချက် မရှိပါ။ ငွေကြေးအကြံပေးချက် မဟုတ်ပါ။
> ဆုံးရှုံးသွားရင်တောင် ခံနိုင်တဲ့ ငွေကိုပဲ ထည့်ပါ။

## Setup

```bash
cd trading
copy .env.example .env
```

## အဆင့် ၁ — Backtest (API key မလို)

```bash
node src/index.js compare --market futures --interval 4h --days 1460
node src/index.js backtest --strategy trend --market spot --symbol ETHUSDT --interval 4h
```

- `compare` = Strategy ၄ ခုလုံးကို Data တူတူနဲ့ ယှဉ်စမ်းတာပါ
- Trade တစ်ခုချင်းစီကို `data/trades-*.csv` ထဲမှာ ကြည့်လို့ရပါတယ်
- **PASS** ဖြစ်ဖို့ လိုအပ်ချက်: Trade 100+, Profit Factor > 1.3, Max DD < 20%, Out-of-sample PF > 1.1

## အဆင့် ၂ — Paper (ငွေအတု၊ ဈေးနှုန်းအစစ်)

`.env` ထဲမှာ `MODE=paper` ထားပြီး:

```bash
node src/index.js bot
```

အနည်းဆုံး ၁ လကနေ ၃ လအထိ Run ပါ။ ရလဒ်တွေကို `state/journal.csv` မှာ မှတ်ထားပါတယ်။

## အဆင့် ၃ — Testnet

- Spot testnet key: https://testnet.binance.vision
- Futures testnet key: https://testnet.binancefuture.com
- `.env` ထဲမှာ `MODE=testnet` ထားပြီး key ထည့်ပါ၊ ပြီးရင် `node src/index.js check` → `node src/index.js bot`
- **Futures မှာ SL/TP order တကယ်ပေါ်လား Testnet မှာ မဖြစ်မနေ စစ်ပါ** (Binance က Conditional order API ကို မကြာခဏ ပြောင်းလို့ပါ)

## အဆင့် ၄ — Live (ငွေအစစ်)

`MODE=live` နဲ့ `LIVE_CONFIRM=YES` နှစ်ခုလုံး ထည့်မှ Bot က စပါမယ်။ Account ရဲ့ ၁၀% လောက်နဲ့ပဲ စပါ။

**API key လုံခြုံရေး:** Withdrawals **OFF**, IP restriction **ON**၊ `.env` ကို ဘယ်သူ့ကိုမှ မပေးပါနဲ့။

## Strategies

| Name | Logic | SL / TP |
|---|---|---|
| `trend` | EMA20 က EMA50 ကို ဖြတ်တယ် + EMA200 ဘက်အတိုင်း | 1.5 ATR / **3 ATR Trailing stop** (default) |
| `breakout` | 20-bar High/Low ကို ဖောက်တယ် + EMA200 filter | 1.5 ATR / 3 ATR |
| `meanrev` | ADX<20, Bollinger band + RSI 30/70 | Band+ATR / Middle band |
| `regime` | ADX>25 → trend/breakout, ADX<20 → meanrev | — |

Spot = Long only။ Futures = Long + Short။ Strategy ကို `src/strategies.js` မှာ ပြင်ပါ။

### Trend 4h — Trailing stop စမ်းသပ်ချက် (2022-11 → 2026-11, BTC/ETH/SOL/BNB)

| Version | Futures ပျမ်းမျှ Net | Coin ဘယ်နှခု အမြတ် | Spot ပျမ်းမျှ Net |
|---|---|---|---|
| Fixed TP 3 ATR (အဟောင်း) | +2.6% | 2/4 | +3.7% |
| **Trailing 3 ATR (default အသစ်)** | **+15.6%** | **4/4** | +7.8% |
| Trailing 3 ATR + ADX≥20 | +9.9% | 3/4 | +8.5% |

Trailing stop က ဈေးတက်နေသရွေ့ Trade ကို မပိတ်ဘဲ ဆက်ထားလို့ အမြတ်ကြီးတဲ့ Trade တွေ ရလာပါတယ်။
Filter တွေ (ADX, slope) ကို `.env` ထဲမှာ ဖွင့်/ပိတ် လုပ်လို့ရပါတယ်။
**သတိပြုရန်:** BTC တစ်ခုတည်းမှာ နောက်ဆုံး ၃၀% (Out-of-sample) က ရှုံးပါတယ် (PF 0.50)။ PASS မဖြစ်သေးပါ။

## Dashboard (Browser ထဲမှာ ကြည့်ရန်)

Bot ကို Run ထားပြီး **Terminal နောက်တစ်ခု** ဖွင့်ကာ:

```bash
node src/index.js dashboard
```

Browser မှာ **http://localhost:8787** ကို ဖွင့်ပါ။ ၁၀ စက္ကန့်တစ်ခါ အလိုအလျောက် Update ဖြစ်ပါတယ်။

- Bot အခြေအနေ (🟢 Running / 🟡 Internet ပြတ်နေ / 🔴 ရပ်နေ), Equity, P&L, Open positions, Kill switch
- Coin တစ်ခုချင်းရဲ့ ဈေးနှုန်းအစစ်၊ Position၊ Stop၊ Unrealized P&L
- Equity curve (Paper / Backtest ပြောင်းကြည့်လို့ရ), Coin အလိုက် P&L, Trade မှတ်တမ်း, Bot log

### Control panel

Dashboard ကနေ Bot ကို ထိန်းလို့ရပါတယ်။ Bot ကို Terminal ကနေ စထားရင်လည်း ဒီ Control panel နဲ့ ထိန်းလို့ရပါတယ်:

| ခလုတ် | လုပ်ဆောင်ချက် |
|---|---|
| ▶ **Start bot** | Bot ကို နောက်ကွယ်မှာ စမယ် (Terminal မလို) |
| ⏸ **Pause new trades** | Trade အသစ် မဝင်တော့ဘဲ ရှိပြီးသား Position တွေရဲ့ Trailing stop ကိုပဲ ဆက်ထိန်းမယ်။ ▶ Resume နဲ့ ပြန်ဖွင့်ပါ |
| ⏹ **Stop bot** | Bot ကို ရပ်မယ် (Position တွေရဲ့ Stop-loss က Exchange ပေါ်မှာ ကျန်နေမယ်) |
| ✕ **Close all positions** | Position အားလုံးကို Market ဈေးနဲ့ ချက်ချင်း ပိတ်မယ် |
| **Close** (Coin တစ်ခုချင်း) | အဲဒီ Coin ရဲ့ Position ကိုပဲ ပိတ်မယ် |
| **Settings** | Coins, Risk, Strategy, Timeframe, Leverage... ကို ပြင်မယ်။ Bot ရပ်ထားမှပဲ ပြင်လို့ရတယ် |

လုံခြုံရေး:
- ဒီ PC (`localhost`) ကနေပဲ ဖွင့်လို့ရပါတယ်။ တခြား Website တွေက ဒီခလုတ်တွေကို နှိပ်လို့ မရပါဘူး
- **MODE, LIVE_CONFIRM, API key တွေကို Dashboard က မပြ၊ မပြင်ပါဘူး**။ Live ကို ပြောင်းချင်ရင် `.env` ထဲမှာပဲ ကိုယ်တိုင် ပြင်ပါ
- Settings သိမ်းတိုင်း `.env` အဟောင်းကို `.env.prev` အဖြစ် Backup ယူထားပါတယ်
- Bot ၂ ခု တစ်ပြိုင်နက် Run လို့ မရပါဘူး (Account တစ်ခုတည်းကို ၂ ခါ Trade မလုပ်မိအောင်ပါ)
- Close/Stop ကို Bot ကိုယ်တိုင် လုပ်ပါတယ်။ ဒါကြောင့် Bot Run နေမှပဲ အလုပ်လုပ်ပါတယ်

## 🌐 VPS (Cloud server) ပေါ်တင်နည်း — ၂၄ နာရီ Run ပြီး ဖုန်းကနေ ကြည့်ရန်

PC ပိတ်ထားလည်း Bot က ဆက် Run နေပြီး ဖုန်း Browser ကနေ `https://...` Link နဲ့ Password ထည့်ပြီး ဝင်ကြည့်/ထိန်းလို့ ရပါမယ်။

### အဆင့် ၁ — VPS ဝယ်ပါ (ကိုယ်တိုင် လုပ်ရ)

- **OS:** Ubuntu 24.04 (ဒါမှမဟုတ် 22.04)
- **Size:** 1 vCPU, 1 GB RAM လောက်ဆို လုံလောက်ပါတယ် (တစ်လ ~$4–6)
- **Provider:** DigitalOcean, Vultr, Hetzner, Contabo စသည်။ မြန်မာက ငွေပေးချေလို့ရတဲ့ နည်းလမ်း (Card / Crypto) ကို အရင်စစ်ပါ
- **Region:** ⚠️ **US ကို မရွေးပါနဲ့**။ Binance က တချို့နိုင်ငံက Server တွေကို ပိတ်ထားပါတယ်။ Setup script က Binance ကို ဆက်သွယ်လို့ရ/မရ အလိုအလျောက် စစ်ပေးပါမယ်။ မရရင် Region ပြောင်းပါ
- ဝယ်ပြီးရင် **IP address** (ဥပမာ `203.0.113.10`) နဲ့ **root password** (ဒါမှမဟုတ် SSH key) ရပါမယ်

### အဆင့် ၂ — Deploy (PowerShell Command တစ်ကြောင်းတည်း)

```bash
cd C:\Users\Admin\Desktop\zBOT\trading
```
```bash
powershell -ExecutionPolicy Bypass -File deploy\deploy.ps1 -Server root@203.0.113.10
```

(`203.0.113.10` နေရာမှာ ကိုယ့် VPS IP ကို ထည့်ပါ)

- root password ကို ၂ ကြိမ် မေးပါမယ် (Upload + Install)
- **Dashboard password အသစ်** ကို မေးပါမယ်။ စာလုံး ၁၂ လုံးအထက်၊ Binance password နဲ့ မတူတာ ထားပါ
- ၃–၅ မိနစ်လောက်ကြာရင် ဒီလို ပေါ်လာပါမယ်:
```
 Open:      https://203-0-113-10.sslip.io
```

Domain ကိုယ်ပိုင်ရှိရင် `-Domain bot.example.com` ကို ထပ်ထည့်ပါ (Domain ရဲ့ DNS A record ကို VPS IP ကို အရင်ညွှန်ထားပါ)။

### အဆင့် ၃ — ဖုန်းကနေ ဖွင့်ပါ

1. ဖုန်း Browser မှာ ရလာတဲ့ `https://...sslip.io` Link ကို ဖွင့်ပါ (Bookmark လုပ်ထားပါ)
2. Password ထည့်ပါ
3. Control panel → **▶ Start bot**

VPS Restart ဖြစ်သွားရင်လည်း Bot က သူ့ဘာသာ ပြန်စပါတယ် (ရပ်မထားခဲ့ရင်)။

### Update လုပ်နည်း

Code ပြင်ပြီးရင် Deploy command ကို ထပ် Run ရုံပါပဲ။ VPS ပေါ်က Settings, Position, Journal တွေ မပျက်ပါဘူး။

### VPS ပေါ်က Setting ပြင်နည်း (MODE, API key)

Dashboard က MODE နဲ့ API key ကို လုံခြုံရေးအတွက် မပြင်ပေးပါဘူး။ SSH နဲ့ ဝင်ပြီး ပြင်ပါ:

```bash
ssh root@203.0.113.10
```
```bash
nano /opt/zbot/trading/.env
```
```bash
systemctl restart zbot-dashboard
```

Binance API key ရဲ့ **IP restriction** မှာ VPS IP ကို ထည့်ပါ။ ဒါဆို တခြားနေရာကနေ ဒီ Key ကို သုံးလို့ မရတော့ပါဘူး။

### 🔐 လုံခြုံရေး (Setup က အလိုအလျောက် လုပ်ပေးတာ)

- **HTTPS** (Caddy + Let's Encrypt)။ Password ကို Encrypt လုပ်ပြီး ပို့ပါတယ်
- **Password login** — Password ကို Hash အနေနဲ့ပဲ သိမ်းပါတယ်။ ၅ ကြိမ်မှားရင် ၁၅ မိနစ် ပိတ်ပါတယ်။ Login ဝင်တိုင်း IP ကို `bot.log` မှာ မှတ်ပါတယ်
- **Firewall** — SSH, 80, 443 ပဲ ဖွင့်ထားပါတယ်
- Bot က ကိုယ်ပိုင် `zbot` user နဲ့ Run ပါတယ် (root မဟုတ်ပါ)
- VPS အသစ်မှာ **MODE=paper** နဲ့ပဲ အမြဲစပါတယ်
- Password ပြောင်းချင်ရင်:
```bash
sudo -u zbot -H bash -c 'cd /opt/zbot/trading && node src/index.js set-password' && systemctl restart zbot-dashboard
```

### ⚠️ သတိ

- **PC နဲ့ VPS မှာ Live bot ၂ ခု တစ်ပြိုင်နက် မ Run ပါနဲ့**။ Account တစ်ခုတည်းကို ၂ ခါ Trade လုပ်မိပါလိမ့်မယ်
- Log ကြည့်ရန်: `journalctl -u zbot-dashboard -f` ဒါမှမဟုတ် `tail -f /opt/zbot/trading/state/bot.log`

## 🤖 Telegram AI Agent

Telegram ကနေ စာနဲ့ ပြောပြီး Bot ကို ထိန်းနိုင်၊ Report ယူနိုင်၊ စီးပွားရေး အကြံ/Content ရေးခိုင်းနိုင်ပါတယ်။ (Claude AI သုံးပါတယ်)

**လုပ်နိုင်တာ**
- Bot အခြေအနေ၊ Trade မှတ်တမ်း၊ Backtest၊ Coin ဈေး (Binance) ကို ကြည့်ပြီး ရှင်းပြ
- Pause ချက်ချင်း။ Start / Stop / Resume / Position ပိတ် / Settings ပြောင်း = **✅ Yes ခလုတ် နှိပ်မှ** လုပ်
- MODE (live)၊ LIVE_CONFIRM၊ API key တွေကို **ဘယ်တော့မှ မပြောင်းနိုင်** (Server မှာ ကိုယ်တိုင်ပဲ)
- Mahar POS ဈေးသတ်မှတ်/ရောင်းနည်း၊ ဖုန်းဆိုင် TikTok/Facebook Content၊ Fiverr Gig စာ၊ လုပ်စရာစာရင်း (/tasks)
- ဓာတ်ပုံ ပို့ပြီး မေးလို့ရ၊ Web search နဲ့ လက်ရှိ အချက်အလက် ရှာ
- မနက် ၈ နာရီ (မြန်မာစံတော်ချိန်) နေ့စဉ် Report ပို့
- Commands: `/status /report /pause /resume /tasks /usage /reset /help`

**ကုန်ကျစရိတ်**: Claude API က သုံးသလောက် ပေးရ (Opus 5.5: input $4 / output $20 per 1M tokens)။ မေးခွန်းတစ်ခု ~$0.01–0.05။ တစ်နေ့ `AGENT_DAILY_USD` (default $2) ပြည့်ရင် AI က ရပ်ပြီး Command တွေပဲ ဆက်သုံးလို့ရ။ စျေးသက်သာချင်ရင် `AGENT_MODEL=claude-sonnet-5-5`။

**Setup (VPS ပေါ်မှာ)**
1. Telegram မှာ **@BotFather** → `/newbot` → Token ကို ကူးထား (Chat ထဲ ဘယ်သူ့ကိုမှ မပို့ပါနဲ့)
2. **console.anthropic.com** → Account ဖွင့် → Billing မှာ Credit ဖြည့် → API Keys → Create Key
3. VPS ထဲဝင်ပြီး `.env` ပြင်:
   ```
   ssh root@68.183.234.118
   nano /opt/zbot/trading/.env
   ```
   အောက်ဆုံးမှာ ဖြည့် (Ctrl+O Enter Ctrl+X နဲ့ Save):
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC...
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. `systemctl enable --now zbot-agent` → Telegram မှာ ကိုယ့် Bot ကို `/start` ပို့ → Chat id ပြန်ပြောလိမ့်မယ်
5. `.env` ထဲ `TELEGRAM_CHAT_ID=<အဲဒီ id>` ထည့် → `systemctl restart zbot-agent`
6. Telegram မှာ "zBOT Agent online" ရောက်လာရင် ပြီးပါပြီ။ ကိုယ့် Chat id ကလွဲပြီး ဘယ်သူ့ကိုမှ မဖြေပါ။

Log: `journalctl -u zbot-agent -f`။ Agent ကို PC နဲ့ VPS ၂ နေရာ တစ်ပြိုင်နက် မ Run ပါနဲ့ (Telegram က တစ်နေရာပဲ ခွင့်ပြုတယ်)။

## Internet ပြတ်ရင်

Internet ဒါမှမဟုတ် Binance ကို ဆက်သွယ်လို့ မရရင် Bot က **မရပ်ပါဘူး**။ 30 စက္ကန့်ကနေ 5 မိနစ်အထိ စောင့်ပြီး ပြန်ကြိုးစားပါတယ်။ ပြန်ရလာရင် ဆက်အလုပ်လုပ်ပါတယ်။ Stop-loss တွေက Binance ပေါ်မှာ ရှိနေလို့ ကာကွယ်ပြီးသားပါ။
Order မှား၊ Key မှား စတဲ့ Error အစစ် ၅ ကြိမ် ဆက်တိုက်ဖြစ်မှသာ Bot က ရပ်ပါတယ်။

## Multi-coin (Coin အများကြီး တစ်ပြိုင်နက်)

`SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT` လို့ ထည့်ရင် Coin အားလုံးက **Account တစ်ခုတည်း** ကို မျှသုံးပါတယ်:

- Equity, Daily kill switch, Margin/Cash limit အားလုံး မျှသုံးတယ်
- `MAX_OPEN_POSITIONS` ထက် ပိုမဖွင့်ဘူး
- `RISK_PCT × MAX_OPEN_POSITIONS` က 4% ထက် ပိုရင် Bot က စမှာ မဟုတ်ဘူး

```bash
node src/index.js backtest --strategy trend --market futures --symbols BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT --interval 4h --days 1460 --risk 0.5
```

### ရလဒ် — Trend 4h, Trailing 3 ATR, Coin ၄ ခု, 2022-11 → 2026-11, Start 1000 USDT

| | Trades | PF | Net | Max DD | Out-of-sample PF |
|---|---|---|---|---|---|
| BTC တစ်ခုတည်း, Risk 1% | 86 | 1.23 | +13.9% | 18.8% | 0.50 ❌ |
| **Futures ၄ ခု, Risk 0.5%** | 380 | 1.27 | **+34.8%** | **14.7%** | **1.24** ✅ |
| Futures ၄ ခု, Risk 1% | 380 | 1.24 | +69.3% | 27.7% ❌ | 1.20 |
| Spot ၄ ခု, Risk 0.5% | 165 | 1.30 | +15.4% | 7.3% | 1.25 |

Coin ၄ ခု ခွဲထားတာက Coin တစ်ခုတည်းထက် ပိုတည်ငြိမ်ပါတယ်။ Out-of-sample (နောက်ဆုံး ၁၄ လ) မှာလည်း အမြတ်ရပါတယ်။
PF က 1.3 နားမှာပဲ ရှိနေလို့ **PASS နဲ့ ကပ်လျက်** ဖြစ်ပါတယ်။ Paper/Testnet မှာ ၁–၃ လ စမ်းဖို့ သင့်တော်ပါပြီ၊ Live အတွက် မဟုတ်သေးပါ။
Risk 1% ဆိုရင် အမြတ် ၂ ဆ ဖြစ်ပေမယ့် Drawdown 28% ရှိလို့ **0.5% ကို အကြံပြုပါတယ်**။

**Futures အတွက် အနည်းဆုံး ငွေ:** Binance ရဲ့ Minimum order (~5–100 USDT, Coin ပေါ်မူတည်) ကြောင့် ငွေနည်းရင် Trade တွေ "too small" ဆိုပြီး ကျော်သွားပါမယ်။ `node src/index.js check` နဲ့ `minNotional` ကို စစ်ပါ။

## Risk Rules (Code ထဲမှာ အတင်းထည့်ထားတာ)

- Trade တစ်ခုကို Equity ရဲ့ `RISK_PCT`% သာ Risk ယူမယ် (2% ထက်ပိုရင် Bot က လက်မခံ)
- တစ်ရက် `DAILY_LOSS_PCT`% ရှုံးရင် → မြန်မာစံတော်ချိန် နောက်တစ်ရက်အထိ ရပ်မယ်
- Leverage 10x ထက်ပိုရင် လက်မခံ
- SL order တင်လို့မရရင် Position ကို ချက်ချင်း ပိတ်မယ်
- Error ၅ ကြိမ်ဆက်တိုက် ဖြစ်ရင် Bot ရပ်ပြီး Telegram ကို အကြောင်းကြားမယ်
- Stop က 1 ATR ထက်နည်းရင် ဒါမှမဟုတ် Fee က Risk ရဲ့ 15% ထက်များရင် Trade မဝင်ဘူး

## Files

| Path | ဘာလဲ |
|---|---|
| `src/strategies.js` | Strategy logic |
| `src/indicators.js` | EMA, RSI, ATR, ADX, Bollinger, Donchian |
| `src/risk.js` | Position size, Daily kill switch |
| `src/backtest.js` | Backtester |
| `src/bot.js` | Live / paper loop |
| `src/binance.js` | Binance REST (Spot + USDT-M Futures) |
| `state/` | Bot state (`<mode>-<market>-portfolio.json`), `bot.log`, `journal.csv` |
| `data/` | Download လုပ်ထားတဲ့ Candle cache, Backtest trades |
