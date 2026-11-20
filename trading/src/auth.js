import crypto from 'node:crypto';

// Password login for the dashboard when it is reachable from the internet.
// The password is stored only as a salted scrypt hash in .env (DASHBOARD_PASSWORD_HASH).

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [kind, saltHex, hashHex] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), want.length);
  return crypto.timingSafeEqual(want, got);
}

const SESSION_DAYS = 7;
const sessions = new Map(); // token -> expiry ms (in memory: restarting the dashboard logs everyone out)

export function newSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, Date.now() + SESSION_DAYS * 86400e3);
  return token;
}

export function validSession(token) {
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

export function endSession(token) { sessions.delete(token); }

export function sessionCookie(token, secure) {
  return `zbot_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}
export const clearCookie = (secure) => `zbot_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;

export function cookieToken(req) {
  const m = /(?:^|;\s*)zbot_session=([^;]+)/.exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}

// Brute-force guard: 5 wrong passwords from one IP -> locked for 15 minutes.
const fails = new Map(); // ip -> { n, until }
export function loginAllowed(ip) {
  const f = fails.get(ip);
  return !(f && f.until > Date.now());
}
export function loginFailed(ip) {
  const f = fails.get(ip) ?? { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; }
  fails.set(ip, f);
}
export function loginOk(ip) { fails.delete(ip); }
