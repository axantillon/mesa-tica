import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { databasePath, openDatabase } from './db.js';
import { createIdentityStore } from './stores/identity-store.js';
import { createMenuStore } from './stores/menu-store.js';
import { createRestaurantStore } from './stores/restaurant-store.js';

export const CREDENTIALS_FILE = 'staff-credentials.txt';

/**
 * SetupRunner: noninteractive and safe to repeat. Loads the supplied restaurant and menu only when absent,
 * provisions each sample employee only when the username is new (existing passwords are never reset) and
 * never touches orders. Generated passwords are written to a local 0600 file in the data directory,
 * which is outside version control; they are never printed.
 */
export async function runSetup({ db, config }) {
  const content = JSON.parse(fs.readFileSync(config.restaurantFile, 'utf8'));
  const restaurant = createRestaurantStore(db).loadRestaurantIfAbsent(content.restaurant);
  const menu = createMenuStore(db).loadMenuIfAbsent(content.menu);
  const identityStore = createIdentityStore(db);

  const credentialsFile = path.join(config.dataDir, CREDENTIALS_FILE);
  const createdStaff = [];
  for (const profile of content.staff) {
    const password = crypto.randomBytes(12).toString('base64url');
    const { created } = await identityStore.provisionEmployee(profile, password);
    if (created) {
      fs.appendFileSync(credentialsFile, `${profile.username}\t${password}\t(${profile.displayName})\n`, { mode: 0o600 });
      createdStaff.push(profile.username);
    }
  }
  if (fs.existsSync(credentialsFile)) fs.chmodSync(credentialsFile, 0o600);

  return {
    restaurantLoaded: restaurant.loaded,
    menuLoaded: menu.loaded,
    createdStaff,
    credentialsFile: fs.existsSync(credentialsFile) ? credentialsFile : null,
  };
}

export function describeSetup(result, config) {
  const lines = [
    `Data: ${databasePath(config.dataDir)}`,
    `Restaurant details: ${result.restaurantLoaded ? 'loaded' : 'already present, preserved'}`,
    `Menu: ${result.menuLoaded ? 'loaded' : 'already present, preserved'}`,
    `Staff accounts created: ${result.createdStaff.length ? result.createdStaff.join(', ') : 'none (existing accounts and passwords unchanged)'}`,
  ];
  if (result.credentialsFile) lines.push(`Staff sign-in credentials (local only, keep private): ${result.credentialsFile}`);
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const db = openDatabase(config.dataDir);
  try {
    console.log(describeSetup(await runSetup({ db, config }), config));
  } finally {
    db.close();
  }
}
