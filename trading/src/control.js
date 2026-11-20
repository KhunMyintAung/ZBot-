import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE_DIR } from './config.js';

// The dashboard and the bot are separate processes. They talk through small files:
//   state/bot.pid       written by the running bot (one bot at a time)
//   state/control.json  { paused } written by the dashboard, read by the bot every tick
//   state/commands/*.json  one file per command (close / closeAll / stop); the bot runs and deletes it
const PID_FILE = path.join(STATE_DIR, 'bot.pid');
const CONTROL_FILE = path.join(STATE_DIR, 'control.json');
const CMD_DIR = path.join(STATE_DIR, 'commands');
fs.mkdirSync(CMD_DIR, { recursive: true });

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

export function botProcess() {
  if (!fs.existsSync(PID_FILE)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    return alive(info.pid) ? info : null;
  } catch { return null; }
}

// Called by the bot at start. Refuses to run a second bot on the same account.
export function acquireLock(cfg) {
  const other = botProcess();
  if (other && other.pid !== process.pid) {
    throw new Error(`Another bot is already running (pid ${other.pid}, started ${new Date(other.started).toLocaleString()}). Stop it first.`);
  }
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: process.pid, started: Date.now(), mode: cfg.mode, market: cfg.market }));
  const release = () => {
    try {
      const info = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
      if (info.pid === process.pid) fs.unlinkSync(PID_FILE);
    } catch { /* already gone */ }
  };
  process.on('exit', release);
  return release;
}

export function readControl() {
  try { return { paused: false, ...JSON.parse(fs.readFileSync(CONTROL_FILE, 'utf8')) }; } catch { return { paused: false }; }
}
export function writeControl(patch) {
  const c = { ...readControl(), ...patch, updated: Date.now() };
  fs.writeFileSync(CONTROL_FILE, JSON.stringify(c, null, 2));
  return c;
}

export function queueCommand(cmd) {
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(path.join(CMD_DIR, `${id}.json`), JSON.stringify({ id, at: Date.now(), ...cmd }));
  return id;
}

export function pendingCommands() {
  return fs.readdirSync(CMD_DIR).filter((f) => f.endsWith('.json')).sort().map((f) => {
    const file = path.join(CMD_DIR, f);
    try { return { file, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { file, type: 'invalid' }; }
  });
}

export function clearCommands() {
  for (const c of pendingCommands()) fs.rmSync(c.file, { force: true });
}
