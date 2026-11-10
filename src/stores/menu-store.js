import { transaction } from '../db.js';

const MENU_LOADED = 'menu_loaded';

/** MenuStore: current dishes with group, display order, exact CRC price and availability flag. */
export function createMenuStore(db) {
  return {
    readCurrentMenu() {
      return db
        .prepare(
          'SELECT code, group_name, name, description, price, available, display_order FROM menu_items ORDER BY display_order, code',
        )
        .all()
        .map((row) => ({
          code: row.code,
          group: row.group_name,
          name: row.name,
          description: row.description,
          price: row.price,
          available: row.available === 1,
          displayOrder: row.display_order,
        }));
    },

    /**
     * Loads the supplied menu once. A setup marker (not "table is empty") decides absence,
     * so repeated setup never duplicates dishes and never refills a menu an operator emptied.
     */
    loadMenuIfAbsent(menu) {
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM setup_state WHERE key = ?').get(MENU_LOADED)) return { loaded: false };
        const insert = db.prepare(
          `INSERT INTO menu_items (code, group_name, name, description, price, available, display_order)
           VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (code) DO NOTHING`,
        );
        menu.forEach((item, index) => {
          insert.run(item.code, item.group, item.name, item.description, item.price, item.available ? 1 : 0, index + 1);
        });
        db.prepare('INSERT INTO setup_state (key, value) VALUES (?, ?)').run(MENU_LOADED, new Date().toISOString());
        return { loaded: true };
      });
    },
  };
}
