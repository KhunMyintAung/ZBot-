import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ROOT, loadConfig, reloadEnv } from './config.js';
import { Binance } from './binance.js';
import { botProcess, readControl, writeControl, queueCommand, pendingCommands } from './control.js';
import { log } from './notify.js';
import { mmkApi } from './mmk.js';
import { teamStatus } from './team.js';
import {
  readState, journalRows, logTail, backtestTrades, startBot as startBotWith, getLastStartError,
  currentSettings, saveSettings as saveSettingsShared, keyStatus, saveKeys, chartData,
} from './service.js';
import {
  verifyPassword, newSession, validSession, endSession, sessionCookie, clearCookie, cookieToken,
  loginAllowed, loginFailed, loginOk,
} from './auth.js';

// Local web dashboard + control panel. Listens on 127.0.0.1 only.
// It never sends orders itself: Close/Stop are queued for the bot, which does the work.
// It never shows or edits API keys, MODE or LIVE_CONFIRM.
const PAGE = path.join(ROOT, 'dashboard', 'index.html');

let cfg = loadConfig();
let ex = new Binance({ ...cfg, mode: 'paper' }); // public prices only
let AUTH_ON = false;

async function status() {
  // Settings may have been changed from Telegram.
  reloadEnv();
  const next = loadConfig();
  if (next.market !== cfg.market) ex = new Binance({ ...next, mode: 'paper' });
  cfg = next;
  const state = readState(cfg);
  const log = logTail(40);
  let prices = {};
  try {
    prices = Object.fromEntries(await Promise.all(cfg.symbols.map(async (s) => [s, await ex.price(s)])));
  } catch { /* offline: show without live prices */ }

  const journal = journalRows(cfg);
  const proc = botProcess();
  const heartbeatAge = state?.heartbeat ? Date.now() - state.heartbeat : null;
  return {
    now: Date.now(),
    authOn: AUTH_ON,
    config: {
      mode: cfg.mode, market: cfg.market, symbols: cfg.symbols, interval: cfg.interval, strategy: cfg.strategy,
      riskPct: cfg.riskPct, maxOpen: cfg.maxOpen, dailyLossPct: cfg.dailyLossPct, leverage: cfg.leverage,
      maxTradesPerDay: cfg.maxTradesPerDay, startBalance: cfg.startBalance, feePct: cfg.feePct,
    },
    bot: {
      running: !!proc,
      pid: proc?.pid ?? null,
      started: proc?.started ?? null,
      // running under a different MODE/MARKET than the .env the dashboard shows
      otherAccount: proc && (proc.mode !== cfg.mode || proc.market !== cfg.market) ? `${proc.mode} ${proc.market}` : null,
      heartbeatAge,
      netRetry: /network retry/.test(log.at(-1) ?? ''),
      lastStartError: getLastStartError(),
    },
    control: readControl(),
    pending: pendingCommands().map((c) => ({ type: c.type, symbol: c.symbol, at: c.at })),
    state,
    prices,
    journal,
    log,
  };
}

// The Telegram agent may have changed .env; always start with the current settings.
function startBot() {
  cfg = loadConfig();
  ex = new Binance({ ...cfg, mode: 'paper' });
  return startBotWith(cfg);
}

async function saveSettings(values) {
  const r = await saveSettingsShared(values);
  cfg = r.cfg;
  ex = new Binance({ ...cfg, mode: 'paper' });
  return { ok: true, message: r.message };
}

// ---------- http ----------
async function readJson(req) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20000) throw new Error('body too large'); }
  return body ? JSON.parse(body) : {};
}

const LOGIN_PAGE = path.join(ROOT, 'dashboard', 'login.html');
const MMK_DOCS = path.join(ROOT, 'dashboard', 'mmk-api.html');

export function startDashboard(_cfg, port = 8787) {
  // DASHBOARD_PUBLIC_HOST = the domain people open on the VPS (Caddy forwards it to 127.0.0.1).
  const publicHost = (process.env.DASHBOARD_PUBLIC_HOST ?? '').trim().toLowerCase();
  const pwHash = (process.env.DASHBOARD_PASSWORD_HASH ?? '').trim();
  const needLogin = !!publicHost || !!pwHash;
  AUTH_ON = needLogin;
  if (publicHost && !pwHash) {
    console.error('DASHBOARD_PUBLIC_HOST is set but there is no password.\nRun: node src/index.js set-password');
    process.exit(1);
  }
  const okHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, ...(publicHost ? [publicHost] : [])]);
  const secure = !!publicHost; // public = behind HTTPS
  const clientIp = (req) => (publicHost ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress;

  const send = (res, code, type, body, extra = {}) => {
    res.writeHead(code, {
      'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', ...extra,
    });
    res.end(body);
  };
  const json = (res, code, obj, extra) => send(res, code, 'application/json', JSON.stringify(obj), extra);
  const mmkHits = new Map(); // ip -> request times in the last minute (public /api/mmk)

  const server = http.createServer(async (req, res) => {
    try {
      // Only known host names (blocks DNS-rebinding and other websites posting to us).
      if (!okHosts.has(String(req.headers.host).toLowerCase())) return send(res, 403, 'text/plain', 'forbidden host');
      const url = new URL(req.url, 'http://localhost');

      // ---- public, read-only MMK rates API (no login; any website or app may read it) ----
      if (req.method === 'GET' && (url.pathname === '/api/mmk/docs' || url.pathname === '/mmk-api')) {
        return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(MMK_DOCS), { 'cache-control': 'public, max-age=300' });
      }
      if (url.pathname === '/api/mmk') {
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'cache-control': 'public, max-age=300' };
        if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '', cors);
        if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }, cors);
        const ip = clientIp(req), now = Date.now();
        const hit = (mmkHits.get(ip) ?? []).filter((t) => now - t < 60e3);
        if (hit.length >= 60) return json(res, 429, { error: 'Too many requests (60 per minute)' }, cors);
        mmkHits.set(ip, [...hit, now]);
        if (mmkHits.size > 5000) mmkHits.clear();
        try { return json(res, 200, await mmkApi(url.searchParams), cors); }
        catch (e) { return json(res, /amount|rate for/.test(e.message) ? 400 : 503, { error: e.message }, cors); }
      }

      // ---- login ----
      if (needLogin) {
        if (req.method === 'GET' && url.pathname === '/login') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(LOGIN_PAGE));
        if (req.method === 'POST' && url.pathname === '/api/login') {
          const ip = clientIp(req);
          if (!loginAllowed(ip)) return json(res, 429, { ok: false, error: 'Password မှား ၅ ကြိမ်ဖြစ်လို့ ၁၅ မိနစ် ပိတ်ထားပါတယ်။' });
          const body = await readJson(req);
          if (!verifyPassword(body.password ?? '', pwHash)) {
            loginFailed(ip);
            log(`dashboard login FAILED from ${ip}`);
            return json(res, 401, { ok: false, error: 'Password မှားနေပါတယ်။' });
          }
          loginOk(ip);
          log(`dashboard login from ${ip}`);
          return json(res, 200, { ok: true }, { 'set-cookie': sessionCookie(newSession(), secure) });
        }
        if (!validSession(cookieToken(req))) {
          if (req.method === 'GET' && url.pathname === '/') return send(res, 302, 'text/plain', '', { location: '/login' });
          return json(res, 401, { ok: false, error: 'login required' });
        }
        if (req.method === 'POST' && url.pathname === '/api/logout') {
          endSession(cookieToken(req));
          return json(res, 200, { ok: true }, { 'set-cookie': clearCookie(secure) });
        }
      }

      if (req.method === 'GET') {
        if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(PAGE));
        if (url.pathname === '/api/status') return json(res, 200, await status());
        if (url.pathname === '/api/team') { reloadEnv(); return json(res, 200, await teamStatus(loadConfig())); }
        if (url.pathname === '/api/backtest') return json(res, 200, backtestTrades(cfg));
        if (url.pathname === '/api/settings') return json(res, 200, currentSettings());
        if (url.pathname === '/api/keys') return json(res, 200, keyStatus());
        if (url.pathname === '/api/chart') return json(res, 200, await chartData(cfg, String(url.searchParams.get('symbol') ?? cfg.symbol).toUpperCase()));
        return send(res, 404, 'text/plain', 'not found');
      }

      if (req.method !== 'POST') return send(res, 405, 'text/plain', 'method not allowed');
      const origin = req.headers.origin;
      if ((origin && !okHosts.has(origin.replace(/^https?:\/\//, ''))) || req.headers['x-zbot'] !== '1'
        || !String(req.headers['content-type']).startsWith('application/json')) {
        return send(res, 403, 'text/plain', 'forbidden');
      }
      const body = await readJson(req);
      const needBot = () => { if (!botProcess()) throw new Error('Bot is not running'); };

      switch (url.pathname) {
        case '/api/start': { const r = startBot(); writeControl({ wantRunning: true }); return json(res, 200, r); }
        case '/api/stop': needBot(); queueCommand({ type: 'stop' }); writeControl({ wantRunning: false }); return json(res, 200, { ok: true, message: 'Stop sent. Bot will stop within a few seconds.' });
        case '/api/pause': writeControl({ paused: !!body.paused }); return json(res, 200, { ok: true, message: body.paused ? 'Paused: no new trades.' : 'Resumed.' });
        case '/api/close': {
          needBot();
          const st = readState(cfg);
          if (!st?.positions?.[body.symbol]) throw new Error(`No open position for ${body.symbol}`);
          queueCommand({ type: 'close', symbol: body.symbol });
          return json(res, 200, { ok: true, message: `Closing ${body.symbol}…` });
        }
        case '/api/close-all': needBot(); queueCommand({ type: 'closeAll' }); return json(res, 200, { ok: true, message: 'Closing all positions…' });
        case '/api/settings': return json(res, 200, await saveSettings(body.values ?? {}));
        case '/api/keys': {
          // Keys need the password typed again (a stolen/left-open session alone is not enough).
          if (pwHash) {
            const ip = clientIp(req);
            if (!loginAllowed(ip)) return json(res, 429, { ok: false, error: 'Password မှား ၅ ကြိမ်ဖြစ်လို့ ၁၅ မိနစ် ပိတ်ထားပါတယ်။' });
            if (!verifyPassword(String(body.password ?? ''), pwHash)) { loginFailed(ip); log(`dashboard key save: wrong password from ${ip}`); throw new Error('Dashboard password မှားနေပါတယ်။'); }
            loginOk(ip);
          }
          const changed = saveKeys(body.values ?? {});
          log(`dashboard: API keys updated (${changed.join(', ')})`);
          const botKeys = changed.some((k) => k.startsWith('BINANCE'));
          return json(res, 200, { ok: true, message: `Saved: ${changed.join(', ')}. Telegram agent restarts by itself in ~30s.${botKeys ? ' Binance keys are used after the bot is stopped and started again.' : ''}`, keys: keyStatus() });
        }
        default: return send(res, 404, 'text/plain', 'not found');
      }
    } catch (e) {
      json(res, 400, { ok: false, error: e.message });
    }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Dashboard: http://localhost:${port}${publicHost ? `  public: https://${publicHost}` : ''}` +
      `${needLogin ? '  (password login on)' : ''}  (Ctrl+C to stop the dashboard; the bot keeps running)`);
    // After a server reboot, start the bot again if it was running before.
    if (readControl().wantRunning && !botProcess()) {
      try { startBot(); log('Dashboard restarted the bot (it was running before the restart).'); }
      catch (e) { log(`Auto-start failed: ${e.message}`); }
    }
  });
}
