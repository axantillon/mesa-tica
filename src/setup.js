import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataDirectory, openDatabase, transaction } from './store.js';
import { dishes, restaurant } from './seed.js';

export function setup(directory) {
  const db = openDatabase(directory);
  const credentialsPath = resolve(directory, 'staff-credentials.json');
  try {
    transaction(db, () => {
      db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      const inserted = db.prepare('INSERT OR IGNORE INTO restaurant VALUES (1, ?)').run(JSON.stringify(restaurant));
      if (inserted.changes) {
        const insertDish = db.prepare('INSERT INTO menu VALUES (?, ?, ?, ?, ?, ?, ?)');
        dishes.forEach((dish, position) => insertDish.run(...dish, position));
      }

      const missing = [['luis', 'Luis'], ['elena', 'Elena']].filter(([username]) =>
        !db.prepare('SELECT 1 FROM employees WHERE username = ?').get(username));
      if (!missing.length) return;
      let credentials = {};
      try {
        credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const insertEmployee = db.prepare('INSERT INTO employees (username, name, salt, password_hash) VALUES (?, ?, ?, ?)');
      for (const [username, name] of missing) {
        const password = credentials[username] ?? randomBytes(18).toString('base64url');
        credentials[username] = password;
        const salt = randomBytes(16).toString('hex');
        insertEmployee.run(username, name, salt, scryptSync(password, salt, 64).toString('hex'));
      }
      const temporary = credentialsPath + '.' + randomBytes(8).toString('hex') + '.tmp';
      writeFileSync(temporary, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      renameSync(temporary, credentialsPath);
    });
    return credentialsPath;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Setup complete. Local staff credentials file:', setup(dataDirectory()));
}
