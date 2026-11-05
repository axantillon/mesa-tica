import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.js';
import { digest, token, tokenPattern } from './orders.js';

const derive = promisify(scrypt);
const lifetime = 8 * 60 * 60;
const cookieName = 'mesa_staff';
const dummyHash = Buffer.alloc(64);

function credential(req) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + '='));
  const value = cookie?.slice(cookieName.length + 1);
  return value && tokenPattern.test(value) ? digest(value) : null;
}

function cookie(value, age, secure) {
  return `${cookieName}=${value}; Path=/api/staff; Max-Age=${age}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

export async function signIn(db, { username, password }, now, secure) {
  const employee = typeof username === 'string' && username.length <= 64 &&
    db.prepare('SELECT * FROM employees WHERE username = ?').get(username.trim().toLowerCase());
  const supplied = typeof password === 'string' && password.length <= 256 ? password : '';
  const hash = await derive(supplied, employee?.salt ?? 'mesa-unused-salt', 64);
  const matches = timingSafeEqual(hash, employee ? Buffer.from(employee.password_hash, 'hex') : dummyHash);
  if (!matches || !employee?.authorized) throw new HttpError(401, 'invalid_credentials');

  const instant = now().getTime();
  const secret = token();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(instant);
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(secret), employee.username, instant + lifetime * 1000);
  return { employee: { name: employee.name }, cookie: cookie(secret, lifetime, secure) };
}

export function requireStaff(db, req, now) {
  const employee = db.prepare(`
    SELECT employees.username, employees.name FROM sessions
    JOIN employees ON employees.username = sessions.username
    WHERE token_hash = ? AND expires_at > ? AND employees.authorized = 1
  `).get(credential(req), now().getTime());
  if (!employee) throw new HttpError(401, 'sign_in_required');
  return employee;
}

export function signOut(db, req, secure) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(credential(req));
  return cookie('', 0, secure);
}

export function loginThrottle() {
  const attempts = new Map();
  return (peer) => {
    const time = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.until <= time) attempts.delete(key);
    }
    const entry = attempts.get(peer) ?? { count: 0, until: time + 60000 };
    if (entry.count >= 10) throw new HttpError(429, 'login_throttled');
    entry.count++;
    attempts.set(peer, entry);
  };
}
