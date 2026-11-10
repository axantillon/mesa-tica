import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { restaurant, menu } from './sample.mjs';
import { opening, guidance, allowedActions, filters } from './policies.mjs';

const derive = promisify(scrypt);
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export class ClientError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS employees (username TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, authorized INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES employees(username), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (number INTEGER PRIMARY KEY AUTOINCREMENT, private_key TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (scope TEXT NOT NULL, id TEXT NOT NULL, selection TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY(scope,id));`);
  const readSetting = key => JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(key).value);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  transaction(() => {
    for (const [key, value] of Object.entries({ restaurant, menu })) {
      db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run(key, JSON.stringify(value));
    }
  });
  const readOrder = number => {
    const row = db.prepare('SELECT data FROM orders WHERE number=?').get(number);
    if (!row) throw new ClientError(404, 'Order unavailable. Return to the queue.');
    return JSON.parse(row.data);
  };
  const publicOrder = order => {
    const { number, submittedAt, status, items, total, reason } = order;
    const config = readSetting('restaurant');
    return { number, submittedAt, status, items, total, reason, restaurant: config, guidance: guidance(order, config) };
  };
  const accepted = number => {
    const order = readOrder(number);
    return { outcome: 'accepted', order: publicOrder(order), privateKey: order.privateKey };
  };
  const resolveOutcome = row => {
    const outcome = JSON.parse(row.outcome);
    return outcome.outcome === 'accepted' ? accepted(outcome.number) : outcome;
  };
  return {
    db, readSetting, readOrder,
    menu(now) {
      const config = readSetting('restaurant');
      return { restaurant: config, items: readSetting('menu'), opening: opening(config, now) };
    },
    async provision(username, name, password) {
      if (db.prepare('SELECT username FROM employees WHERE username=?').get(username)) return false;
      const salt = token();
      const key = await derive(password, salt, 64);
      db.prepare('INSERT OR IGNORE INTO employees(username,name,salt,password) VALUES (?,?,?,?)').run(username, name, salt, key.toString('hex'));
      return true;
    },
    async authenticate(username, password) {
      const employee = db.prepare('SELECT * FROM employees WHERE username=?').get(username);
      const key = await derive(password, employee?.salt || 'mesa-tica-unknown-account', 64);
      if (!employee || !employee.authorized || !timingSafeEqual(key, Buffer.from(employee.password, 'hex'))) {
        throw new ClientError(401, "We couldn't sign you in. Check your credentials and try again.");
      }
      return employee;
    },
    session(employee, now, ttl) {
      const id = token();
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(id), employee.username, now.getTime() + ttl);
      return id;
    },
    requireStaff(id, now) {
      const employee = db.prepare(`SELECT e.username,e.name FROM sessions s JOIN employees e ON s.username=e.username
        WHERE s.id=? AND s.expires>? AND e.authorized=1`).get(hash(id || ''), now.getTime());
      if (!employee) throw new ClientError(401, 'Sign in required. Your staff access is unavailable or expired.');
      return employee;
    },
    signOut(id) { db.prepare('DELETE FROM sessions WHERE id=?').run(hash(id || '')); },
    submit(scope, id, selection, now) {
      // The complete decision is synchronous within one SQLite write transaction.
      // A competing process must finish before this one reads the durable outcome.
      return transaction(() => {
        const prior = db.prepare('SELECT * FROM attempts WHERE scope=? AND id=?').get(hash(scope), hash(id));
        if (prior) return resolveOutcome(prior);
        const config = readSetting('restaurant');
        const currentMenu = readSetting('menu');
        const corrections = [];
        const items = [];
        if (!Array.isArray(selection) || selection.length === 0 || selection.length > 100) {
          corrections.push({ message: 'Choose at least one dish. A cart may contain at most 100 rows.' });
        } else {
          const seen = new Set();
          for (const choice of selection) {
            const dish = currentMenu.find(item => item.id === choice?.id);
            if (!dish || !dish.available) {
              corrections.push({ id: choice?.id, message: `${dish?.name || choice?.name || 'Selected dish'} is no longer available. Remove it or choose another item.`, unavailable: true });
            } else if (!Number.isSafeInteger(choice.quantity) || choice.quantity < 1 || choice.quantity > 999 || seen.has(choice.id)) {
              corrections.push({ id: choice.id, message: 'Enter a whole number greater than zero (maximum 999). Each dish must appear once.' });
            } else if (choice.price !== dish.price) {
              corrections.push({ id: choice.id, price: dish.price, message: `${dish.name} is now ₡${dish.price.toLocaleString('en-US')}. Review your updated total before placing the order.` });
            } else {
              items.push({ id: dish.id, name: dish.name, price: dish.price, quantity: choice.quantity, subtotal: dish.price * choice.quantity });
            }
            seen.add(choice?.id);
          }
        }
        const hours = opening(config, now);
        if (!hours.isOpen) corrections.push({ message: hours.message });
        let outcome;
        if (corrections.length) outcome = { outcome: 'rejected', corrections };
        else {
          const privateKey = token();
          const inserted = db.prepare('INSERT INTO orders(private_key,data) VALUES (?,?)').run(hash(privateKey), '{}');
          const number = Number(inserted.lastInsertRowid);
          const order = {
            number, privateKey, submittedAt: now.toISOString(), status: 'Received', revision: 1,
            items, total: items.reduce((sum, item) => sum + item.subtotal, 0), reason: '', history: [],
          };
          db.prepare('UPDATE orders SET data=? WHERE number=?').run(JSON.stringify(order), number);
          outcome = { outcome: 'accepted', number };
        }
        db.prepare('INSERT INTO attempts VALUES (?,?,?,?)').run(hash(scope), hash(id), JSON.stringify(selection ?? null), JSON.stringify(outcome));
        return outcome.outcome === 'accepted' ? accepted(outcome.number) : outcome;
      });
    },
    recover(scope, id) {
      const row = db.prepare('SELECT * FROM attempts WHERE scope=? AND id=?').get(hash(scope), hash(id));
      return row ? resolveOutcome(row) : { outcome: 'uncertain' };
    },
    tracking(privateKey) {
      const row = db.prepare('SELECT data FROM orders WHERE private_key=?').get(hash(privateKey));
      if (!row) throw new ClientError(404, "We couldn't open this tracking link. Check the full saved link.");
      return publicOrder(JSON.parse(row.data));
    },
    queue(filter) {
      if (!filters.includes(filter)) throw new ClientError(400, 'Unknown queue filter.');
      return db.prepare('SELECT data FROM orders ORDER BY number').all().map(row => JSON.parse(row.data))
        .filter(order => filter === 'All' || (filter === 'Active' ? allowedActions(order.status).length : order.status === filter))
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.number - b.number)
        .map(({ privateKey, ...order }) => order);
    },
    detail(number) {
      const { privateKey, ...order } = readOrder(number);
      return { ...order, actions: allowedActions(order.status) };
    },
    change(number, revision, target, reason, employee, now) {
      return transaction(() => {
        const order = readOrder(number);
        if (order.revision !== revision) throw new ClientError(409, 'This order changed. Review its current state before choosing another action.');
        if (!allowedActions(order.status).includes(target)) throw new ClientError(422, 'This change is not allowed from the current status.');
        if (target === 'Cancelled' && (typeof reason !== 'string' || !reason.trim() || reason.length > 1000)) {
          throw new ClientError(422, 'Enter a customer-visible reason (1–1000 characters).');
        }
        const previous = order.status;
        order.status = target;
        order.revision++;
        order.reason = target === 'Cancelled' ? reason.trim() : '';
        order.history.push({ from: previous, to: target, employee: employee.name, username: employee.username, time: now.toISOString(), reason: order.reason });
        db.prepare('UPDATE orders SET data=? WHERE number=?').run(JSON.stringify(order), number);
        return this.detail(number);
      });
    },
  };
}
