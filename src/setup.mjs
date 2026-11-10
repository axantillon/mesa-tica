import { resolve, dirname, join } from 'node:path';
import { existsSync, writeFileSync, chmodSync } from 'node:fs';
import { openStore, token } from './store.mjs';

const filename = resolve(process.env.DATA_PATH || 'var/mesa.sqlite');
const store = openStore(filename);
const credentials = [];
for (const [username, name] of [['luis', 'Luis Ramírez'], ['elena', 'Elena Vargas']]) {
  const password = process.env[`STAFF_${username.toUpperCase()}_PASSWORD`] || token();
  if (password.length < 12) throw new Error('Staff passwords must have at least 12 characters.');
  if (await store.provision(username, name, password)) credentials.push(`${username}: ${password}`);
}
const credentialFile = join(dirname(filename), 'staff-credentials.txt');
if (credentials.length) {
  writeFileSync(credentialFile, `${credentials.join('\n')}\n`, { flag: 'a', mode: 0o600 });
  chmodSync(credentialFile, 0o600);
}
if (existsSync(filename)) chmodSync(filename, 0o600);
store.db.close();
console.log(`Setup complete. Existing orders and staff passwords preserved. Local sign-in details: ${credentialFile}`);
