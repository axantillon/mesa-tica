// Shared database handlers (03-class): RestaurantStore, OrderStore, StaffStore.
// One SQLite file, mesa.sqlite, opened with node:sqlite. Server-side only.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const STATUSES = ['Received', 'Preparing', 'Ready', 'Collected', 'Cancelled'];
const SESSION_HOURS = 12;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS Restaurant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  timeZone TEXT NOT NULL,
  weeklyHours TEXT NOT NULL,
  collectionInstructions TEXT NOT NULL,
  contact TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Dish (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  available INTEGER NOT NULL CHECK (available IN (0, 1))
);
CREATE TABLE IF NOT EXISTS StaffAccount (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  passwordHash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS Session (
  id TEXT PRIMARY KEY,
  employeeId TEXT NOT NULL REFERENCES StaffAccount(id),
  expiresAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "Order" (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  submissionId TEXT NOT NULL UNIQUE,
  trackingToken TEXT NOT NULL UNIQUE,
  submittedAt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Received', 'Preparing', 'Ready', 'Collected', 'Cancelled')),
  version INTEGER NOT NULL,
  total INTEGER NOT NULL,
  cancellationReason TEXT
);
CREATE INDEX IF NOT EXISTS OrderBySubmittedAt ON "Order" (submittedAt, number);
CREATE TABLE IF NOT EXISTS OrderLine (
  id INTEGER PRIMARY KEY,
  orderNumber INTEGER NOT NULL REFERENCES "Order"(number),
  dishName TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS OrderLineByOrder ON OrderLine (orderNumber);
CREATE TABLE IF NOT EXISTS StatusChange (
  id INTEGER PRIMARY KEY,
  orderNumber INTEGER NOT NULL REFERENCES "Order"(number),
  fromStatus TEXT NOT NULL,
  toStatus TEXT NOT NULL,
  employeeId TEXT NOT NULL REFERENCES StaffAccount(id),
  changedAt TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS StatusChangeByOrder ON StatusChange (orderNumber);
`;

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'mesa.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export class RestaurantStore {
  constructor(db) {
    this.db = db;
  }

  readMenu() {
    return this.db
      .prepare('SELECT code, name, description, price, available FROM Dish ORDER BY rowid')
      .all()
      .map((d) => ({ ...d, available: d.available === 1 }));
  }

  readRestaurant() {
    const r = this.db
      .prepare('SELECT name, timeZone, weeklyHours, collectionInstructions, contact FROM Restaurant WHERE id = 1')
      .get();
    return r && { ...r, weeklyHours: JSON.parse(r.weeklyHours) };
  }
}

// Every order row comes with its lines, read from OrderLine (never from today's menu).
const ORDER_SELECT = `SELECT number, submissionId, trackingToken, submittedAt, status, version, total, cancellationReason,
  (SELECT json_group_array(json_object('dishName', dishName, 'price', price, 'quantity', quantity) ORDER BY id)
     FROM OrderLine WHERE orderNumber = "Order".number) AS lines
  FROM "Order"`;
const withLines = (row) => row && { ...row, lines: JSON.parse(row.lines) };

export class OrderStore {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }

  // work must be synchronous: no await between BEGIN and COMMIT.
  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  findBySubmission(submissionId) {
    return withLines(this.db.prepare(`${ORDER_SELECT} WHERE submissionId = ?`).get(submissionId));
  }

  findByToken(token) {
    return withLines(this.db.prepare(`${ORDER_SELECT} WHERE trackingToken = ?`).get(token));
  }

  // Lines take the dish name and price from the current menu, at the moment of acceptance.
  createOrder(submissionId, items) {
    const dish = this.db.prepare('SELECT name, price FROM Dish WHERE code = ?');
    const lines = items.map((item) => {
      const { name, price } = dish.get(item.code);
      return { dishName: name, price, quantity: item.quantity };
    });
    const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO "Order" (submissionId, trackingToken, submittedAt, status, version, total)
         VALUES (?, ?, ?, 'Received', 1, ?)`,
      )
      .run(submissionId, randomBytes(16).toString('base64url'), this.now().toISOString(), total);
    const insertLine = this.db.prepare('INSERT INTO OrderLine (orderNumber, dishName, price, quantity) VALUES (?, ?, ?, ?)');
    for (const l of lines) insertLine.run(lastInsertRowid, l.dishName, l.price, l.quantity);
    return this.getOrder(Number(lastInsertRowid));
  }

  // Oldest first: by submittedAt, then number.
  listOrders(statusFilter) {
    const marks = statusFilter.map(() => '?').join(', ');
    return this.db
      .prepare(`${ORDER_SELECT} WHERE status IN (${marks}) ORDER BY submittedAt, number`)
      .all(...statusFilter)
      .map(withLines);
  }

  getOrder(number) {
    const order = withLines(this.db.prepare(`${ORDER_SELECT} WHERE number = ?`).get(number));
    if (order) {
      order.statusChanges = this.db
        .prepare('SELECT fromStatus, toStatus, employeeId, changedAt, reason FROM StatusChange WHERE orderNumber = ? ORDER BY id')
        .all(number);
    }
    return order;
  }

  // One StatusChange per staff change; version + 1; a cancel also sets cancellationReason.
  saveStatus(number, to, reason, employee) {
    const { status: from } = this.db.prepare('SELECT status FROM "Order" WHERE number = ?').get(number);
    this.db
      .prepare(
        `UPDATE "Order" SET status = ?, version = version + 1,
           cancellationReason = CASE WHEN ? = 'Cancelled' THEN ? ELSE cancellationReason END
         WHERE number = ?`,
      )
      .run(to, to, reason, number);
    this.db
      .prepare('INSERT INTO StatusChange (orderNumber, fromStatus, toStatus, employeeId, changedAt, reason) VALUES (?, ?, ?, ?, ?, ?)')
      .run(number, from, to, employee.id, this.now().toISOString(), reason);
    return this.getOrder(number);
  }
}

export class StaffStore {
  constructor(db, now) {
    this.db = db;
    this.now = now;
  }

  findEmployee(username) {
    return this.db.prepare('SELECT id, username, name, passwordHash FROM StaffAccount WHERE username = ?').get(username);
  }

  createSession(employeeId) {
    const id = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + SESSION_HOURS * 3600_000).toISOString();
    this.db.prepare('INSERT INTO Session (id, employeeId, expiresAt) VALUES (?, ?, ?)').run(id, employeeId, expiresAt);
    return { id, expiresAt };
  }

  // Returns the employee for a live session, or undefined.
  findSession(sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) return undefined;
    return this.db
      .prepare(
        `SELECT a.id, a.username, a.name FROM Session s JOIN StaffAccount a ON a.id = s.employeeId
         WHERE s.id = ? AND s.expiresAt > ?`,
      )
      .get(sessionId, this.now().toISOString());
  }
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('base64')}:${scryptSync(password, salt, 64).toString('base64')}`;
}

let dummyHash;
// Unknown user: still run scrypt once so the answer takes the same time.
export function verifyPassword(password, stored) {
  if (!stored) {
    dummyHash ??= hashPassword('not-a-password');
    verifyPassword(password, dummyHash);
    return false;
  }
  const [, salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'base64');
  return timingSafeEqual(scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length), expected);
}
