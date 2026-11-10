import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { CREDENTIALS_FILE } from './setup.js';
import { hashPassword } from './stores/identity-store.js';

/**
 * Explicit operator command (never run by setup): `npm run staff:reset-password -- <username>`.
 * Sets a new random password, ends that employee's sessions and appends the new line to the local
 * credentials file. Status history keeps referring to the same employee.
 */
const username = process.argv[2]?.trim().toLowerCase();
if (!username) {
  console.error('Usage: npm run staff:reset-password -- <username>');
  process.exit(2);
}

const config = loadConfig();
const db = openDatabase(config.dataDir);
try {
  const employee = db.prepare('SELECT id, display_name FROM employees WHERE username = ?').get(username);
  if (!employee) {
    console.error(`No staff account named "${username}".`);
    process.exitCode = 1;
  } else {
    const password = crypto.randomBytes(12).toString('base64url');
    db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(await hashPassword(password), employee.id);
    db.prepare('DELETE FROM sessions WHERE employee_id = ?').run(employee.id);
    const file = path.join(config.dataDir, CREDENTIALS_FILE);
    fs.appendFileSync(file, `${username}\t${password}\t(${employee.display_name}, reset ${new Date().toISOString()})\n`, { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    console.log(`New password for ${username} written to ${file} (the last line for that username applies).`);
  }
} finally {
  db.close();
}
