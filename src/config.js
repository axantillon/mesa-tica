import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function integerSetting(env, name, fallback, { min, max }) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function booleanSetting(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`${name} must be true or false.`);
}

/** Runtime settings come from environment variables so operators never edit source. */
export function loadConfig(env = process.env) {
  return {
    host: env.MESA_HOST || '127.0.0.1',
    port: integerSetting(env, 'MESA_PORT', 3000, { min: 0, max: 65535 }),
    dataDir: path.resolve(env.MESA_DATA_DIR || path.join(projectRoot, 'data')),
    restaurantFile: path.resolve(env.MESA_RESTAURANT_FILE || path.join(projectRoot, 'config', 'restaurant.json')),
    secureCookies: booleanSetting(env, 'MESA_SECURE_COOKIES', false),
    sessionTtlMinutes: integerSetting(env, 'MESA_SESSION_TTL_MINUTES', 720, { min: 1, max: 43200 }),
    refreshIntervalMs: integerSetting(env, 'MESA_REFRESH_INTERVAL_MS', 3000, { min: 250, max: 60000 }),
  };
}
