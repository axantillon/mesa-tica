CREATE TABLE IF NOT EXISTS restaurant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  config TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS menu (
  code TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  position INTEGER NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS employees (
  username TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  authorized INTEGER NOT NULL DEFAULT 1 CHECK (authorized IN (0, 1))
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES employees(username),
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS orders (
  number INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_token TEXT NOT NULL UNIQUE,
  submitted_at TEXT NOT NULL,
  items TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  status TEXT NOT NULL CHECK (status IN ('Received', 'Preparing', 'Ready', 'Collected', 'Cancelled')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  reason TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS attempts (
  customer_hash TEXT NOT NULL,
  attempt TEXT NOT NULL,
  selection_hash TEXT NOT NULL,
  order_number INTEGER UNIQUE REFERENCES orders(number),
  rejection TEXT,
  PRIMARY KEY (customer_hash, attempt),
  CHECK ((order_number IS NULL) <> (rejection IS NULL))
) STRICT;

CREATE TABLE IF NOT EXISTS status_changes (
  order_number INTEGER NOT NULL REFERENCES orders(number),
  revision INTEGER NOT NULL,
  previous TEXT NOT NULL,
  status TEXT NOT NULL,
  employee TEXT NOT NULL REFERENCES employees(username),
  employee_name TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (order_number, revision)
) STRICT;

CREATE INDEX IF NOT EXISTS orders_queue ON orders(submitted_at, number);
