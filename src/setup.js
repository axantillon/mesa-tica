// SetupRunner: noninteractive and safe to repeat. Loads supplied content only if absent,
// never resets an existing password and never touches orders.

import { appendFileSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword, openStores } from './store.js';
import { MENU, RESTAURANT, STAFF } from './seed.js';

export const defaultDataDir = () => resolve(process.env.MESA_DATA_DIR ?? 'data');

export function runSetup(dataDir) {
  const stores = openStores(dataDir);
  const credentialsFile = join(dataDir, 'staff-credentials.local.txt');
  const created = [];
  try {
    stores.restaurantStore.loadIfAbsent(RESTAURANT);
    stores.menuStore.loadIfAbsent(MENU);
    for (const employee of STAFF) {
      if (stores.identityStore.findByUsername(employee.username)) continue;
      const password = randomBytes(12).toString('base64url');
      if (stores.identityStore.provisionEmployee(employee, hashPassword(password))) {
        appendFileSync(credentialsFile, `${employee.username}\t${password}\n`, { mode: 0o600 });
        chmodSync(credentialsFile, 0o600);
        created.push(employee.username);
      }
    }
  } finally {
    stores.close();
  }
  return { created, credentialsFile };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { created, credentialsFile } = runSetup(defaultDataDir());
  console.log(created.length
    ? `Setup complete. New staff accounts (${created.join(', ')}) are listed in ${credentialsFile}`
    : `Setup complete. Existing data and passwords were left unchanged. Staff credentials: ${credentialsFile}`);
}
