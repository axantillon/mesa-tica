import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, saltText, keyText] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyText, 'base64');
  const actual = await scrypt(password, Buffer.from(saltText, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the username is unknown, so response timing does not reveal account existence.
const unknownUserHash = hashPassword(crypto.randomBytes(16).toString('hex'));

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** IdentityStore: provisioned employees, password verification and revocable staff sessions. */
export function createIdentityStore(db) {
  return {
    /** Returns { employee, token } for valid authorized credentials, otherwise null (no reason given). */
    async authenticate({ username, password }, { now, ttlMinutes }) {
      const row = db
        .prepare('SELECT id, display_name, password_hash, authorized FROM employees WHERE username = ?')
        .get(username.trim().toLowerCase());
      const valid = await verifyPassword(password, row ? row.password_hash : await unknownUserHash);
      if (!row || !valid || row.authorized !== 1) return null;
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.getTime());
      db.prepare('INSERT INTO sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)').run(
        hashToken(token),
        row.id,
        now.getTime() + ttlMinutes * 60_000,
      );
      return { employee: { id: row.id, displayName: row.display_name }, token };
    },

    /** Resolves a session token to its current authorized employee, or null when expired/revoked/unknown. */
    resolveAccess(token, now) {
      if (!token) return null;
      const row = db
        .prepare(
          `SELECT e.id, e.display_name FROM sessions s JOIN employees e ON e.id = s.employee_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND e.authorized = 1`,
        )
        .get(hashToken(token), now.getTime());
      return row ? { id: row.id, displayName: row.display_name } : null;
    },

    revokeAccess(token) {
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    },

    /** Creates the employee only if the username is new; an existing password is never reset. */
    async provisionEmployee({ username, displayName }, password) {
      const exists = db.prepare('SELECT 1 FROM employees WHERE username = ?').get(username);
      if (exists) return { created: false };
      const passwordHash = await hashPassword(password);
      const result = db
        .prepare(
          'INSERT INTO employees (username, display_name, password_hash, authorized) VALUES (?, ?, ?, 1) ON CONFLICT (username) DO NOTHING',
        )
        .run(username, displayName, passwordHash);
      return { created: result.changes === 1 };
    },
  };
}
