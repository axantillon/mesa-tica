// Persistence handlers (RestaurantStore, MenuStore, OrderStore, IdentityStore) over one SQLite file.
// BEGIN IMMEDIATE transactions are the indivisible boundary for acceptOnce and changeIfCurrent.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS setup_state (key TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS restaurant (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY,
  item_group TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  display_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  authorized INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  submitted_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Received', 'Preparing', 'Ready', 'Collected', 'Cancelled')),
  revision INTEGER NOT NULL DEFAULT 1,
  total INTEGER NOT NULL,
  cancellation_reason TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  order_number INTEGER NOT NULL REFERENCES orders(number),
  line INTEGER NOT NULL,
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal INTEGER NOT NULL,
  PRIMARY KEY (order_number, line)
);
CREATE TABLE IF NOT EXISTS status_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number INTEGER NOT NULL REFERENCES orders(number),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  at INTEGER NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS attempts (
  context TEXT NOT NULL,
  attempt TEXT NOT NULL,
  selection TEXT NOT NULL,
  order_number INTEGER REFERENCES orders(number),
  rejection TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (context, attempt),
  CHECK ((order_number IS NULL) != (rejection IS NULL))
);
`;

export const STATUSES = ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'];
export const FILTERS = {
  Active: ['Received', 'Preparing', 'Ready'],
  ...Object.fromEntries(STATUSES.map((s) => [s, [s]])),
  All: STATUSES,
};

const scryptAsync = promisify(scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 32, SCRYPT).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':').map((part) => Buffer.from(part, 'hex'));
  return timingSafeEqual(await scryptAsync(password, salt, 32, SCRYPT), expected);
}

export function openStores(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 }); // holds private links and password hashes
  const db = new DatabaseSync(join(dataDir, 'mesa.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  // Order numbers start at 1001 so they read as pickup numbers.
  db.exec(`INSERT INTO sqlite_sequence (name, seq)
           SELECT 'orders', 1000 WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'orders')`);

  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  /** Marks a one-time setup step done; true only the first time. */
  const claimSetupStep = (key) => db.prepare('INSERT OR IGNORE INTO setup_state (key) VALUES (?)').run(key).changes === 1;

  const readRestaurantRow = db.prepare('SELECT data FROM restaurant WHERE id = 1');
  const restaurantStore = {
    read: () => JSON.parse(readRestaurantRow.get().data),
    loadIfAbsent: (restaurant) => {
      db.prepare('INSERT OR IGNORE INTO restaurant (id, data) VALUES (1, ?)').run(JSON.stringify(restaurant));
    },
  };

  const readMenuRows = db.prepare('SELECT * FROM menu_items ORDER BY display_order');
  const menuStore = {
    readCurrent: () => readMenuRows.all().map((row) => ({
      id: row.id,
      group: row.item_group,
      name: row.name,
      description: row.description,
      price: row.price,
      available: row.available === 1,
    })),
    /** Loads the supplied menu once ever, so later operator removals are never undone. */
    loadIfAbsent: (menu) => transaction(() => {
      if (!claimSetupStep('menu_loaded')) return;
      const insert = db.prepare(`INSERT OR IGNORE INTO menu_items
        (id, item_group, name, description, price, available, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      menu.forEach((item, index) => {
        insert.run(item.id, item.group, item.name, item.description, item.price, item.available ? 1 : 0, index);
      });
    }),
  };

  const findEmployee = db.prepare('SELECT * FROM employees WHERE username = ?');
  const identityStore = {
    findByUsername: (username) => findEmployee.get(username),
    /** Creates the account only if missing; returns true when created. */
    provisionEmployee: ({ id, username, displayName }, passwordHash) => db.prepare(
      'INSERT OR IGNORE INTO employees (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
    ).run(id, username, displayName, passwordHash).changes === 1,
    createSession: (tokenHash, employeeId, expiresAt, now) => {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      db.prepare('INSERT INTO sessions (token_hash, employee_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, employeeId, expiresAt);
    },
    resolveAccess: (tokenHash, now) => db.prepare(`
      SELECT e.id, e.display_name AS displayName FROM sessions s JOIN employees e ON e.id = s.employee_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND e.authorized = 1`).get(tokenHash, now),
    revokeAccess: (tokenHash) => { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); },
  };

  const selectAttempt = db.prepare('SELECT * FROM attempts WHERE context = ? AND attempt = ?');
  const insertAttempt = db.prepare(`INSERT INTO attempts (context, attempt, selection, order_number, rejection, created_at)
                                    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertOrder = db.prepare(`INSERT INTO orders (token, submitted_at, status, total) VALUES (?, ?, 'Received', ?)`);
  const insertItem = db.prepare(`INSERT INTO order_items (order_number, line, item_id, name, price, quantity, subtotal)
                                 VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const selectOrder = db.prepare('SELECT * FROM orders WHERE number = ?');
  const selectItems = db.prepare('SELECT name, price, quantity, subtotal FROM order_items WHERE order_number = ? ORDER BY line');

  const selectOrderByToken = db.prepare('SELECT * FROM orders WHERE token = ?');
  // ponytail: no pagination on All; add when retained orders outgrow one screen's load.
  const selectQueue = db.prepare(`
    SELECT o.number, o.submitted_at AS submittedAt, o.status, o.total,
      (SELECT group_concat(line_text, ', ') FROM
        (SELECT quantity || ' × ' || name AS line_text FROM order_items WHERE order_number = o.number ORDER BY line)) AS summary
    FROM orders o
    WHERE o.status IN (SELECT value FROM json_each(?))
    ORDER BY o.submitted_at, o.number`);
  const selectHistory = db.prepare(`
    SELECT c.from_status AS fromStatus, c.to_status AS toStatus, e.display_name AS employee, c.at, c.reason
    FROM status_changes c JOIN employees e ON e.id = c.employee_id
    WHERE c.order_number = ? ORDER BY c.id`);
  const updateStatus = db.prepare(`
    UPDATE orders SET status = ?, cancellation_reason = ?, revision = revision + 1
    WHERE number = ? AND revision = ?`);
  const insertChange = db.prepare(`
    INSERT INTO status_changes (order_number, from_status, to_status, employee_id, at, reason) VALUES (?, ?, ?, ?, ?, ?)`);

  const hydrate = (row) => row && {
    number: row.number,
    token: row.token,
    submittedAt: row.submitted_at,
    status: row.status,
    revision: row.revision,
    total: row.total,
    cancellationReason: row.cancellation_reason,
    items: selectItems.all(row.number).map((item) => ({ ...item })),
  };

  /** At least 128 bits of entropy (here 256); issued once, with the order. */
  const issuePrivateLink = () => randomBytes(32).toString('base64url');

  const orderStore = {
    /** The recorded outcome of a scoped attempt, or undefined when none is established. */
    findAttempt: (context, attempt) => selectAttempt.get(context, attempt),
    closeAttempt: (context, attempt, selection, rejection, at) => {
      insertAttempt.run(context, attempt, selection, null, JSON.stringify(rejection), at);
    },
    /** Records the order, its immutable lines and its accepted attempt. Call inside a transaction. */
    recordAccepted: (context, attempt, selection, lines, total, at) => {
      const number = Number(insertOrder.run(issuePrivateLink(), at, total).lastInsertRowid);
      lines.forEach((line, index) => {
        insertItem.run(number, index, line.itemId, line.name, line.price, line.quantity, line.subtotal);
      });
      insertAttempt.run(context, attempt, selection, number, null, at);
      return number;
    },
    readOrder: (number) => hydrate(selectOrder.get(number)),
    findByPrivateLink: (token) => hydrate(selectOrderByToken.get(token)),
    listOrders: (filter) => selectQueue.all(JSON.stringify(FILTERS[filter])).map((row) => ({ ...row })),
    readHistory: (number) => selectHistory.all(number).map((row) => ({ ...row })),
    /** Saves status and employee/time history together, only from the observed revision. Call inside a transaction. */
    changeIfCurrent(number, revision, target, reason, employeeId, at) {
      const fromStatus = selectOrder.get(number).status;
      const reasonToStore = target === 'Cancelled' ? reason.trim() : null;
      if (updateStatus.run(target, reasonToStore, number, revision).changes !== 1) return false;
      insertChange.run(number, fromStatus, target, employeeId, at, reasonToStore);
      return true;
    },
  };

  return { db, transaction, restaurantStore, menuStore, orderStore, identityStore, close: () => db.close() };
}
