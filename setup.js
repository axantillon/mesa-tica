// npm run setup: create the tables, then add the restaurant, menu and staff only if missing. Never overwrites.
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, hashPassword } from './shared/stores.js';

const RESTAURANT = {
  name: 'Mesa Tica',
  timeZone: 'America/Costa_Rica',
  // Index 0 = Sunday. Open from `open` (inclusive) to `close` (exclusive), restaurant time.
  weeklyHours: Array.from({ length: 7 }, () => ({ open: '10:00', close: '21:00' })),
  collectionInstructions: 'Collect at the Mesa Tica pickup counter. Show your order number and pay at collection.',
  contact: 'demo-contact@example.invalid (Demo contact, not monitored)',
};

const DISHES = [
  ['M1', 'Chicken casado', 'Rice, beans, chicken, salad and plantain.', 4500, 1],
  ['M2', 'Vegetarian casado', 'Rice, beans, vegetables, salad and plantain.', 4000, 1],
  ['M3', 'Fish casado', 'Rice, beans, fish and salad.', 5000, 0],
  ['S1', 'Beef empanada', 'Corn pastry filled with seasoned beef.', 1500, 1],
  ['S2', 'Cheese empanada', 'Corn pastry filled with cheese.', 1400, 1],
  ['S3', 'Garden salad', 'Lettuce, tomato and cucumber.', 2500, 1],
  ['S4', 'Plantain side', 'Sweet fried plantain.', 1200, 1],
  ['D1', 'Horchata', 'Rice drink, 350 mL.', 1300, 1],
  ['D2', 'Iced tea', 'Unsweetened tea, 350 mL.', 1000, 1],
];

const STAFF = [
  { username: 'luis', name: 'Luis', variable: 'STAFF_PASSWORD_LUIS' },
  { username: 'elena', name: 'Elena', variable: 'STAFF_PASSWORD_ELENA' },
];

export function setup(dataDir, env = process.env, log = console.log) {
  const db = openDatabase(dataDir);
  try {
    db.exec('BEGIN IMMEDIATE');
    const r = RESTAURANT;
    db.prepare(
      `INSERT OR IGNORE INTO Restaurant (id, name, timeZone, weeklyHours, collectionInstructions, contact)
       VALUES (1, ?, ?, ?, ?, ?)`,
    ).run(r.name, r.timeZone, JSON.stringify(r.weeklyHours), r.collectionInstructions, r.contact);

    const dish = db.prepare('INSERT OR IGNORE INTO Dish (code, name, description, price, available) VALUES (?, ?, ?, ?, ?)');
    for (const d of DISHES) dish.run(...d);

    const exists = db.prepare('SELECT 1 FROM StaffAccount WHERE username = ?');
    const insert = db.prepare('INSERT INTO StaffAccount (id, username, name, passwordHash) VALUES (?, ?, ?, ?)');
    for (const s of STAFF) {
      if (exists.get(s.username)) continue;
      let password = env[s.variable];
      if (!password) {
        password = randomBytes(12).toString('base64url');
        const file = join(dataDir, 'staff-credentials.txt');
        appendFileSync(file, `${s.username}: ${password}\n`, { mode: 0o600 });
        log(`Generated password for ${s.username}: ${password} (also saved in ${file})`);
      }
      insert.run(s.username, s.username, s.name, hashPassword(password));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = process.env.DATA_DIR || './data';
  setup(dataDir);
  console.log(`Setup done: ${join(dataDir, 'mesa.sqlite')}`);
}
