import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ORDER_STATUSES = ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'];

const statusList = ORDER_STATUSES.map((status) => `'${status}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS setup_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS restaurant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS menu_items (
  code TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  display_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  authorized INTEGER NOT NULL DEFAULT 1 CHECK (authorized IN (0, 1))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  number INTEGER PRIMARY KEY,
  private_token TEXT NOT NULL UNIQUE,
  submitted_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${statusList})),
  revision INTEGER NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0)
);
CREATE TABLE IF NOT EXISTS order_items (
  order_number INTEGER NOT NULL REFERENCES orders(number),
  line INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal INTEGER NOT NULL,
  PRIMARY KEY (order_number, line)
);
CREATE TABLE IF NOT EXISTS status_changes (
  id INTEGER PRIMARY KEY,
  order_number INTEGER NOT NULL REFERENCES orders(number),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  changed_at INTEGER NOT NULL,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS submission_attempts (
  customer_context TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  selection TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'closed')),
  order_number INTEGER UNIQUE REFERENCES orders(number),
  correction TEXT,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (customer_context, attempt_id),
  CHECK ((outcome = 'accepted') = (order_number IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS orders_queue ON orders (status, submitted_at, number);
CREATE INDEX IF NOT EXISTS status_changes_order ON status_changes (order_number, id);
`;

export function databasePath(dataDir) {
  return path.join(dataDir, 'mesa.sqlite');
}

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(databasePath(dataDir));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

/**
 * Runs work inside one IMMEDIATE transaction: the write lock is taken before the first read,
 * so the checks and writes inside `work` are indivisible even if several processes share the file.
 */
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
