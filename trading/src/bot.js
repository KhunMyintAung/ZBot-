import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR } from './config.js';
import { Binance, floorTo, roundTo } from './binance.js';
import { prepare, signalAt } from './strategies.js';
import { positionSize, maxNotional, checkDay } from './risk.js';
import { log, alert, alertButtons, journal, groupSignal, groupPhoto, alertPhoto } from './notify.js';
import { openMm, closeMm, reasonMm, whyMm, sideMm, sideIcon, priceStr, startMm } from './plain.js';
import { trailStop } from './backtest.js';
import { fngNow, sentimentBlock } from './fa.js';
import { acquireLock, readControl, pendingCommands } from './control.js';
import { aiReview, resolveSkipped } from './aireview.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sleep, but wake up early when the dashboard sends a command.
async function waitOrCommand(ms, isStopping) {
  const end = Date.now() + ms;
  while (Date.now() < end && !isStopping()) {
    if (pendingCommands().length) return;
    await sleep(1000);
  }
}

// One account, several coins. Shared equity, shared daily kill switch,
// MAX_OPEN_POSITIONS and a shared notional cap across all coins.
export async function runBot(cfg) {
  if (cfg.mode === 'live' && !cfg.liveConfirm) {
    throw new Error('MODE=live needs LIVE_CONFIRM=YES in trading/.env. Run paper and testnet first.');
  }
  acquireLock(cfg);
  for (const c of pendingCommands()) fs.rmSync(c.file, { force: true }); // ignore commands sent while no bot ran
  const ex = new Binance(cfg);
  const rules = {};
  for (const s of cfg.symbols) rules[s] = await ex.symbolRules(s);

  const stateFile = path.join(STATE_DIR, `${cfg.mode}-${cfg.market}-portfolio.json`);
  const state = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    : { positions: {}, lastBarT: {}, day: {}, paperEquity: cfg.startBalance };
  const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

  const orphan = Object.keys(state.positions).filter((s) => !cfg.symbols.includes(s));
  if (orphan.length) await alert(cfg, `⚠️ ${orphan.join(', ')} မှာ Trade ဖွင့်ထားတာ ရှိပေမယ့် Bot ရဲ့ Coin စာရင်း (SYMBOLS) ထဲ မပါလို့ Bot က မထိန်းပေးနိုင်ပါ။ Binance မှာ ကိုယ်တိုင် စစ်ပါ။`);

  if (cfg.market === 'futures' && cfg.mode !== 'paper') {
    for (const s of cfg.symbols) await ex.setLeverage(s, cfg.leverage);
  }
  await alert(cfg, startMm(cfg));

  let errors = 0;      // real errors (bad order, bad key...): stop after 5 in a row
  let netDown = 0;     // internet / Binance unreachable: keep retrying, never stop
  let netDownSince = 0;
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; log('Stopping after this tick (open positions keep their SL on the exchange).'); });

  const runCommands = async () => {
    for (const c of pendingCommands()) {
      fs.rmSync(c.file, { force: true });
      if (c.type === 'stop') {
        stopping = true;
        await alert(cfg, '⏸️ Bot ကို ခဏ ရပ်လိုက်ပါပြီ (Setting ပြောင်းဖို့ ဒါမှမဟုတ် ပိတ်ဖို့)။\nဖွင့်ထားတဲ့ Trade ရှိရင် Stop-loss ဆက်ရှိနေပါတယ်။ ပြန်ဖွင့်ရင် "Bot စတင်" စာ ထပ်ရပါမယ်။');
      } else if (c.type === 'open') {
        await manualOpen(cfg, ex, rules, state, save, c).catch((e) => alert(cfg, `Manual ${c.side} ${c.symbol} failed: ${e.message}`));
      } else if (c.type === 'modify') {
        await modifyPosition(cfg, ex, rules, state, save, c).catch((e) => alert(cfg, `Change SL/TP ${c.symbol} failed: ${e.message}`));
      } else if (c.type === 'close' || c.type === 'closeAll') {
        const list = c.type === 'closeAll' ? Object.keys(state.positions) : [c.symbol];
        for (const s of list) {
          if (!state.positions[s]) continue;
          await alert(cfg, `✋ ${s.replace('USDT', '')} Trade ကို ပိတ်ခိုင်းလို့ ပိတ်နေပါတယ်။`);
          await manualClose({ ...cfg, symbol: s }, ex, rules[s] ?? await ex.symbolRules(s), state, save);
        }
      }
    }
  };

  while (!stopping) {
    let wait = cfg.pollSeconds * 1000;
    try {
      await runCommands();
      if (stopping) break;
      await tick(cfg, ex, rules, state, save);
      if (netDown) {
        await alert(cfg, `✅ Internet ပြန်ရပါပြီ (${Math.round((Date.now() - netDownSince) / 60000)} မိနစ် ပြတ်ခဲ့)။ Bot ပုံမှန် ပြန်အလုပ်လုပ်နေပါပြီ။`);
        netDown = 0;
      }
      errors = 0;
    } catch (e) {
      if (e.network) {
        if (!netDown) { netDownSince = Date.now(); await alert(cfg, `📡 Internet / Binance နဲ့ ချိတ်မရ ဖြစ်နေတယ် (${e.message})။ ဆက်ကြိုးစားနေပါတယ်။ Stop-loss တွေ Binance မှာ ရှိနေပါတယ်။`); }
        netDown++;
        wait = Math.min(300, 15 * 2 ** Math.min(netDown, 5)) * 1000; // 30s, 60s ... up to 5 min
        log(`network retry #${netDown} in ${wait / 1000}s`);
      } else {
        errors++;
        await alert(cfg, `❗ အမှား (${errors}/5): ${e.message}
(၅ ခါ ဆက်တိုက် ဖြစ်ရင် Bot ရပ်ပါမယ်)`);
        if (errors >= 5) {
          await alert(cfg, '🛑 အမှား ၅ ခါ ဆက်တိုက် ဖြစ်လို့ Bot ရပ်လိုက်ပါပြီ။ Binance မှာ ဖွင့်ထားတဲ့ Trade ရှိမရှိ စစ်ပါ။');
          process.exit(1);
        }
      }
    }
    state.heartbeat = Date.now();
    save();
    await waitOrCommand(wait, () => stopping);
  }
  save();
  log('Bot stopped.');
}

export async function tick(cfg, ex, rules, state, save) {
  const syms = cfg.symbols;
  const prices = Object.fromEntries(await Promise.all(syms.map(async (s) => [s, await ex.price(s)])));

  // ---- 1. manage open positions ----
  for (const s of syms) {
    if (state.positions[s]) await managePosition({ ...cfg, symbol: s }, ex, rules[s], state, save, prices[s]);
  }

  // ---- 2. shared daily kill switch ----
  const equity = cfg.mode === 'paper'
    ? state.paperEquity
    : await ex.equity(syms.map((s) => ({ rules: rules[s], price: prices[s] })));
  const gate = checkDay(state.day, cfg, equity, Date.now());
  if (gate.justHalted) await alert(cfg, `⛔ ဒီနေ့ ရှုံးတာ များလို့ ရပ်ပါပြီ (${gate.reason})။ မနက်ဖြန် (မြန်မာစံတော်ချိန်) အထိ Trade အသစ် မဝင်ပါ။`);

  // ---- 3. per coin: once per closed candle, trail the stop or look for a signal ----
  for (const s of syms) {
    const c = { ...cfg, symbol: s };
    const candles = await ex.closedKlines(s, cfg.interval, 400);
    const last = candles.at(-1);
    if (!last || last.t === state.lastBarT[s]) continue;
    state.lastBarT[s] = last.t;
    const x = prepare(candles);
    const open = Object.keys(state.positions).length;
    log(`${s} bar ${new Date(last.t).toISOString()} close=${last.c} equity=${equity.toFixed(2)} open=${open}/${cfg.maxOpen}` +
      (state.positions[s] ? ' (in position)' : ''));

    if (state.positions[s]?.trailAtr) await moveTrail(c, ex, rules[s], state, save, last, x.atr.at(-1));
    if (state.positions[s]) continue;
    if (!gate.ok) { log(`${s} no new trades: ${gate.reason}`); continue; }
    if (readControl().paused) { log(`${s} paused from dashboard: no new trades`); continue; }
    const sig = signalAt(cfg.strategy, x, candles.length - 1, c);
    if (sig && open >= cfg.maxOpen) {
      log(`${s} signal ${sig.side} skipped: ${open}/${cfg.maxOpen} positions open`);
      await skipAlert(c, sig, last, `Trade ${cfg.maxOpen} ခု ပြည့်နေလို့ (တစ်ခု ပိတ်ပြီးမှ ဝင်လို့ရမယ်)`, false);
      continue;
    }
    if (open >= cfg.maxOpen) continue;
    if (sig && cfg.faFilter) {
      const fng = await fngNow();
      const why = sentimentBlock(sig.side, fng);
      if (why) {
        log(`${s} signal ${sig.side} skipped: ${why}`);
        await skipAlert(c, sig, last, sig.side === 'short'
          ? `Fear & Greed ${fng} – လူတွေ အရမ်းကြောက်နေချိန်။ ဒီအချိန် ဈေး ရုတ်တရက် ပြန်တက်တတ်လို့ Short မဝင်ဘူး`
          : `Fear & Greed ${fng} – လူတွေ အရမ်းလောဘတက်နေချိန်။ ဒီအချိန် ဈေး ရုတ်တရက် ပြန်ကျတတ်လို့ Long မဝင်ဘူး`);
        continue;
      }
    }
    if (sig) {
      // AI second opinion: may only skip (owner's choice). Errors / no key = the rules decide.
      const ai = await aiReview(c, s, sig, x, candles);
      if (!ai.take) {
        log(`${s} signal ${sig.side} skipped by AI (${ai.confidence}%): ${ai.why}`);
        await skipAlert(c, sig, last, `🤖 AI က ကျော်ခိုင်းတယ် (${ai.confidence}% သေချာ) – ${ai.why}\n(ဝင်ခဲ့ရင် ဘာဖြစ်မလဲ နောက်မှ စစ်ပြီး /ai မှာ ပြပါမယ်)`);
        continue;
      }
      await openPosition(c, ex, rules[s], state, save, prices[s], equity, sig);
    }
  }
  await resolveSkipped(ex, cfg.interval).catch(() => {});
}

// A signal the bot decided not to take: tell the owner, with an "enter anyway" button (taken via the
// agent's Yes/No confirm → the normal manual open, same risk size). Saved so the agent can find it.
export const SKIPPED_FILE = path.join(STATE_DIR, 'skipped-signals.json');
async function skipAlert(cfg, sig, last, whyText, button = true) {
  const s = cfg.symbol, coin = s.replace(/USDT$/, ''), L = sig.side === 'long';
  const entry = last.c, sl = +(entry - (L ? 1 : -1) * sig.stopDist).toPrecision(6);
  const id = `${coin}-${Math.round(last.t / 6e4)}`;
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SKIPPED_FILE, 'utf8')); } catch { /* new file */ }
  list = [...list.filter((r) => r.id !== id), { id, symbol: s, side: sig.side, entry, sl, reason: sig.reason, t: Date.now() }].slice(-50);
  try { fs.writeFileSync(SKIPPED_FILE, JSON.stringify(list, null, 1)); } catch (e) { log(`skipped-signals save failed ${e.message}`); }
  const text = [
    `⏭️ ${sideIcon(sig.side)} ${coin} ${L ? 'Long' : 'Short'} Signal တွေ့ပေမယ့် မဝင်လိုက်ပါ`,
    '',
    `❓ Signal: ${reasonMm(sig.reason)}`,
    `🚫 မဝင်တဲ့ အကြောင်း: ${whyText}`,
    `💵 ဈေး: ${priceStr(entry)} · 🛑 Stop-loss: ${priceStr(sl)}`,
    ...(button ? ['', `ဝင်ချင်ရင် အောက်က ခလုတ်ကို နှိပ်ပါ (၄ နာရီအတွင်း)။ နှိပ်ပြီးရင် Yes/No ထပ်မေးပါမယ်။`] : []),
  ].join('\n');
  if (!button) return alert(cfg, text);
  await alertButtons(cfg, text, [[{ text: `${sideIcon(sig.side)} ${coin} ${L ? 'Long' : 'Short'} ဝင်မယ်`, callback_data: `sk:${id}` }]]);
}

async function managePosition(cfg, ex, rules, state, save, price) {
  const s = cfg.symbol;
  const p = state.positions[s];
  const L = p.side === 'long';
  let closed = null;

  if (cfg.mode === 'paper') {
    if (L ? price <= p.sl : price >= p.sl) closed = { exit: price, why: p.trailAtr && (L ? p.sl > p.entry : p.sl < p.entry) ? 'TRAIL' : 'SL' };
    else if (L ? price >= p.tp : price <= p.tp) closed = { exit: price, why: 'TP' };
  } else if (cfg.market === 'futures') {
    const amt = await ex.positionAmt(s);
    if (Math.abs(amt) < rules.minQty) {
      await ex.cancelAll(s); // remove the leftover SL or TP
      closed = { exit: price, why: 'closed on exchange' };
    }
  } else { // real spot
    const stop = await ex.spotOrder(s, p.stopOrderId);
    if (stop.status === 'FILLED') {
      closed = { exit: Number(stop.cummulativeQuoteQty) / Number(stop.executedQty), why: 'SL' };
    } else if (price >= p.tp) {
      await ex.cancelAll(s);
      const r = await ex.marketOrder(s, 'SELL', p.qty);
      closed = { exit: Number(r.cummulativeQuoteQty) / Number(r.executedQty), why: 'TP' };
    } else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(stop.status)) {
      await alert(cfg, `WARNING: ${s} spot stop order is ${stop.status}. Selling now to stay protected.`);
      const r = await ex.marketOrder(s, 'SELL', p.qty);
      closed = { exit: Number(r.cummulativeQuoteQty) / Number(r.executedQty), why: 'stop missing' };
    }
  }
  if (!closed) return;
  await recordClose(cfg, state, save, closed);
}

async function recordClose(cfg, state, save, closed) {
  const s = cfg.symbol;
  const p = state.positions[s];
  const dir = p.side === 'long' ? 1 : -1;
  closed.pnl = (closed.exit - p.entry) * p.qty * dir - (p.entry + closed.exit) * p.qty * (cfg.feePct / 100);
  if (cfg.mode === 'paper') state.paperEquity += closed.pnl;
  const t = { ...p, ...closed, R: closed.pnl / p.riskAmt };
  journal(cfg, t);
  await alert(cfg, closeMm({ mode: cfg.mode, symbol: s, side: p.side, entry: p.entry, exit: closed.exit, pnl: closed.pnl, why: closed.why }));
  const pct = ((closed.exit - p.entry) / p.entry) * dir * 100;
  await groupSignal(cfg, `${pct >= 0 ? '✅ အမြတ်နဲ့' : '❌ အရှုံးနဲ့'} ပိတ်ပြီ – ${s.replace(/USDT$/, '')} ${sideMm(p.side)}\n${whyMm(closed.why)}\n` +
    `ဝင်ဈေး ${priceStr(p.entry)} → ထွက်ဈေး ${priceStr(closed.exit)}\nဈေး ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% ${pct >= 0 ? 'အမြတ်ဘက်' : 'အရှုံးဘက်'} ရွေ့ခဲ့တယ်`);
  delete state.positions[s];
  save();
}

// Close one position now, at market (from the dashboard's Close button).
async function manualClose(cfg, ex, rules, state, save) {
  const s = cfg.symbol;
  const p = state.positions[s];
  if (!p) return;
  const price = await ex.price(s);
  let exit = price;
  if (cfg.mode !== 'paper') {
    await ex.cancelAll(s);
    if (cfg.market === 'futures') {
      const amt = await ex.positionAmt(s);
      if (Math.abs(amt) >= rules.minQty) {
        const r = await ex.marketOrder(s, amt > 0 ? 'SELL' : 'BUY', Math.abs(amt), { reduceOnly: true });
        exit = Number(r.avgPrice) || price;
      }
    } else {
      const r = await ex.marketOrder(s, 'SELL', p.qty);
      exit = Number(r.cummulativeQuoteQty) / Number(r.executedQty);
    }
  }
  await recordClose(cfg, state, save, { exit, why: 'manual' });
}

async function openPosition(cfg, ex, rules, state, save, price, equity, sig) {
  const s = cfg.symbol;
  const L = sig.side === 'long';
  const used = Object.values(state.positions).reduce((a, p) => a + p.qty * p.entry, 0);
  const room = maxNotional(cfg, equity) - used;
  if (room <= 0) { log(`${s} signal ${sig.side} skipped: no margin/cash room left`); return; }

  let qty = positionSize({ equity, riskPct: cfg.riskPct, stopDist: sig.stopDist, entry: price, maxNotional: room });
  qty = floorTo(qty, rules.stepSize);
  if (qty < rules.minQty || qty * price < rules.minNotional) {
    log(`${s} signal ${sig.side} skipped: size ${qty} too small (minQty ${rules.minQty}, minNotional ${rules.minNotional}). Add funds or use fewer coins.`);
    return;
  }

  let entry = price;
  let pos;
  if (cfg.mode === 'paper') {
    pos = { side: sig.side, qty, entry };
  } else if (cfg.market === 'futures') {
    const r = await ex.marketOrder(s, L ? 'BUY' : 'SELL', qty);
    entry = Number(r.avgPrice) || price;
    pos = { side: sig.side, qty: Number(r.executedQty) || qty, entry };
  } else {
    const r = await ex.marketOrder(s, 'BUY', qty);
    const filled = Number(r.executedQty);
    entry = Number(r.cummulativeQuoteQty) / filled;
    const feeInBase = (r.fills ?? []).filter((f) => f.commissionAsset === rules.base).reduce((a, f) => a + Number(f.commission), 0);
    pos = { side: 'long', qty: floorTo(filled - feeInBase, rules.stepSize), entry };
  }

  const dir = L ? 1 : -1;
  pos.sl = roundTo(entry - dir * sig.stopDist, rules.tickSize);
  pos.tp = roundTo(entry + dir * sig.tpDist, rules.tickSize);
  pos.riskAmt = pos.qty * sig.stopDist;
  pos.entryT = Date.now();
  pos.reason = sig.reason;
  if (sig.trailAtr) { pos.trailAtr = sig.trailAtr; pos.best = entry; }

  if (cfg.mode !== 'paper') {
    try {
      await placeExits(cfg, ex, rules, pos);
    } catch (e) {
      await emergencyClose(cfg, ex, pos, `Could not place stop-loss (${e.message})`);
      return;
    }
  }

  state.positions[s] = pos;
  state.day.trades++;
  save();
  // one chart picture (Entry / SL / TP lines) for both the owner alert and the channel signal
  const png = await signalChart(cfg, rules, pos);
  const tps = signalTargets(pos, rules?.tickSize);
  await alertPhoto(cfg, png, openMm({ mode: cfg.mode, symbol: s, side: pos.side, entry, sl: pos.sl, tps, trailing: !!pos.trailAtr,
    qty: pos.qty, riskAmt: pos.riskAmt, riskPct: cfg.riskPct, reason: sig.reason }));
  await channelSignal(cfg, rules, pos, sig.reason, png);
}

async function signalChart(cfg, rules, pos) {
  try {
    const { chartPng } = await import('./chartimg.js');
    return (await chartPng(cfg, cfg.symbol, { side: pos.side, entry: pos.entry, sl: pos.sl, tps: signalTargets(pos, rules?.tickSize) })).png;
  } catch (e) { log(`${cfg.symbol} signal chart failed: ${e.message}`); return null; }
}

// Channel post for a new position: chart picture with Entry / SL / TP lines and the same numbers as text.
// Trailing positions have no fixed TP, so followers get targets at 1.5R, 3R and 5R (R = entry to SL).
export function signalTargets(pos, tick = 0) {
  const dir = pos.side === 'long' ? 1 : -1, R = Math.abs(pos.entry - pos.sl);
  const rnd = (v) => (tick ? roundTo(v, tick) : +v.toPrecision(6));
  if (!pos.trailAtr) return [['TP', pos.tp]];
  return [['TP1', rnd(pos.entry + dir * 1.5 * R)], ['TP2', rnd(pos.entry + dir * 3 * R)], ['TP3', rnd(pos.entry + dir * 5 * R)]];
}
export async function channelSignal(cfg, rules, pos, reason, png = null) {
  if (!cfg.telegramGroupId || !cfg.groupShare.includes('trades')) return;
  const s = cfg.symbol, coin = s.replace(/USDT$/, '');
  const tps = signalTargets(pos, rules?.tickSize);
  const pct = (v) => `${(((v - pos.entry) / pos.entry) * 100).toFixed(2)}%`;
  const text = `${sideIcon(pos.side)} ${coin}/USDT ${sideMm(pos.side)}\n\n` +
    `📍 ဝင်ဈေး (Entry): ${priceStr(pos.entry)}\n🛑 ရှုံးရင်ထွက်ဈေး (Stop-loss): ${priceStr(pos.sl)} (${pct(pos.sl)})\n` +
    tps.map(([l, v]) => `🎯 အမြတ်ယူဈေး ${l.replace('TP', '') || ''} (${l}): ${priceStr(v)} (${pct(v)})`).join('\n') +
    (pos.trailAtr ? '\n\n💡 ဘယ်လိုလုပ်ရမလဲ: အမြတ်ယူဈေး 1 ရောက်ရင် တစ်ဝက် ရောင်းပြီး Stop-loss ကို ဝင်ဈေးဆီ ရွှေ့ထားပါ (ဒါဆို ကျန်တာ မရှုံးတော့ဘူး)။' : '') +
    `\n\n❓ ဘာကြောင့်: ${reasonMm(reason)}`;
  png = png ?? await signalChart(cfg, rules, pos);
  const tag = cfg.mode === 'live' ? '' : '🧪 Paper (စမ်းသပ်) · ';
  if (png && await groupPhoto(cfg, png, `${tag}${text}\n\n⚠️ ငွေရေးကြေးရေး အကြံပြုချက် မဟုတ်ပါ။ ဆုံးရှုံးခံနိုင်တဲ့ ငွေနဲ့ပဲ ကိုယ်တိုင် ဆုံးဖြတ်ပါ။`)) return;
  await groupSignal(cfg, text);
}

// Owner asked (Telegram agent / dashboard) to open a position now at market.
// SL: given price, or 1.5 ATR. TP: given price, or the strategy's ATR trailing stop.
async function manualOpen(cfg, ex, rules, state, save, c) {
  const s = c.symbol;
  if (!cfg.symbols.includes(s)) throw new Error(`${s} is not in SYMBOLS`);
  if (state.positions[s]) throw new Error(`${s} already has a position`);
  if (c.side === 'short' && !cfg.allowShort) throw new Error('Spot cannot short');
  if (Object.keys(state.positions).length >= cfg.maxOpen) throw new Error(`MAX_OPEN_POSITIONS (${cfg.maxOpen}) reached`);
  const price = await ex.price(s);
  const x = prepare(await ex.closedKlines(s, cfg.interval, 400));
  const atr = x.atr.at(-1);
  const L = c.side === 'long';
  const sl = Number(c.sl) > 0 ? Number(c.sl) : price - (L ? 1 : -1) * 1.5 * atr;
  if (L ? sl >= price : sl <= price) throw new Error(`SL ${sl} must be ${L ? 'below' : 'above'} the price ${price}`);
  const tp = Number(c.tp) > 0 ? Number(c.tp) : null;
  if (tp && (L ? tp <= price : tp >= price)) throw new Error(`TP ${tp} must be ${L ? 'above' : 'below'} the price ${price}`);
  const sig = {
    side: c.side, stopDist: Math.abs(price - sl), tpDist: tp ? Math.abs(tp - price) : 100 * atr,
    ...(tp ? {} : { trailAtr: cfg.trend?.trailAtr ?? 3 }), reason: `Manual ${c.side} (owner)`,
  };
  const equity = cfg.mode === 'paper' ? state.paperEquity : await ex.equity(await Promise.all(cfg.symbols.map(async (q) => ({ rules: rules[q], price: await ex.price(q) }))));
  await alert(cfg, `Manual ${c.side.toUpperCase()} ${s} requested (SL ${+sl.toPrecision(6)}${tp ? `, TP ${tp}` : ', trailing'}).`);
  await openPosition({ ...cfg, symbol: s }, ex, rules[s], state, save, price, equity, sig);
}

// Owner moves the stop-loss and/or sets a take-profit. A TP turns the trailing stop off.
async function modifyPosition(cfg, ex, rules, state, save, c) {
  const s = c.symbol, p = state.positions[s];
  if (!p) throw new Error(`No open position for ${s}`);
  const L = p.side === 'long', price = await ex.price(s), r = rules[s];
  const old = { sl: p.sl, tp: p.tp, trail: !!p.trailAtr };
  if (Number(c.sl) > 0) {
    const sl = roundTo(Number(c.sl), r.tickSize);
    if (L ? sl >= price : sl <= price) throw new Error(`SL ${sl} must be ${L ? 'below' : 'above'} the price ${price}`);
    p.sl = sl;
  }
  if (Number(c.tp) > 0) {
    const tp = roundTo(Number(c.tp), r.tickSize);
    if (L ? tp <= price : tp >= price) throw new Error(`TP ${tp} must be ${L ? 'above' : 'below'} the price ${price}`);
    p.tp = tp; delete p.trailAtr; delete p.best;
  }
  if (c.trail === true && !p.trailAtr) { p.trailAtr = cfg.trend?.trailAtr ?? 3; p.best = price; p.tp = L ? p.entry * 100 : p.entry / 100; }
  if (cfg.mode !== 'paper') {
    try {
      await ex.cancelAll(s);
      await placeExits({ ...cfg, symbol: s }, ex, r, p);
    } catch (e) {
      await emergencyClose({ ...cfg, symbol: s }, ex, p, `Could not place the new SL/TP (${e.message})`);
      delete state.positions[s];
      save();
      return;
    }
  }
  save();
  await alert(cfg, `${s} changed by owner: SL ${old.sl} -> ${p.sl}, ${p.trailAtr ? 'trailing stop on' : `TP ${old.trail ? 'trailing' : old.tp} -> ${p.tp}`}`);
}

// Stop (and TP, unless trailing) orders that live on the exchange.
async function placeExits(cfg, ex, rules, pos) {
  const L = pos.side === 'long';
  if (cfg.market === 'futures') {
    await ex.futuresExit(cfg.symbol, L ? 'SELL' : 'BUY', 'STOP_MARKET', pos.sl);
    if (!pos.trailAtr) await ex.futuresExit(cfg.symbol, L ? 'SELL' : 'BUY', 'TAKE_PROFIT_MARKET', pos.tp);
  } else {
    const limit = roundTo(pos.sl * 0.995, rules.tickSize); // 0.5% below the stop so it fills in a fast drop
    const o = await ex.spotStopLoss(cfg.symbol, pos.qty, pos.sl, limit);
    pos.stopOrderId = o.orderId;
  }
}

// Never sit in a position without a stop: close it immediately.
async function emergencyClose(cfg, ex, pos, why) {
  await alert(cfg, `${cfg.symbol}: ${why}. Closing the position now.`);
  await ex.cancelAll(cfg.symbol).catch(() => {});
  await ex.marketOrder(cfg.symbol, pos.side === 'long' ? 'SELL' : 'BUY', pos.qty, { reduceOnly: cfg.market === 'futures' });
}

// On each closed candle, pull the stop up (long) / down (short) behind the price.
async function moveTrail(cfg, ex, rules, state, save, bar, atr) {
  const p = state.positions[cfg.symbol];
  if (!Number.isFinite(atr)) return;
  const newSl = roundTo(trailStop(p, bar.h, bar.l, atr), rules.tickSize);
  if (Math.abs(newSl - p.sl) < rules.tickSize) { save(); return; }
  const old = p.sl;
  p.sl = newSl;
  if (cfg.mode !== 'paper') {
    try {
      await ex.cancelAll(cfg.symbol);
      await placeExits(cfg, ex, rules, p);
    } catch (e) {
      await emergencyClose(cfg, ex, p, `Could not move trailing stop (${e.message})`);
      delete state.positions[cfg.symbol];
      save();
      return;
    }
  }
  save();
  log(`${cfg.symbol} trailing stop ${old} -> ${newSl}`);
}
