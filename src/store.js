import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const dataDirectory = () => resolve(process.env.MESA_DATA_DIR || 'data');

export function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(directory, 'mesa.sqlite'), { timeout: 3000 });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db;
}

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

export function readRestaurant(db) {
  return JSON.parse(db.prepare('SELECT config FROM restaurant WHERE id = 1').get().config);
}

export function readMenu(db) {
  return db.prepare('SELECT code, category, name, description, price, available FROM menu ORDER BY position').all();
}
