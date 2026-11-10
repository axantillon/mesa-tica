/** RestaurantStore: restaurant identity, weekly hours/time zone, pickup instructions and contact. */
export function createRestaurantStore(db) {
  return {
    readRestaurant() {
      const row = db.prepare('SELECT details FROM restaurant WHERE id = 1').get();
      if (!row) throw new Error('Restaurant details are missing. Run setup first.');
      return JSON.parse(row.details);
    },

    /** Loads the supplied details only when none exist, so operator values are preserved. */
    loadRestaurantIfAbsent(restaurant) {
      const result = db
        .prepare('INSERT INTO restaurant (id, details) VALUES (1, ?) ON CONFLICT (id) DO NOTHING')
        .run(JSON.stringify(restaurant));
      return { loaded: result.changes === 1 };
    },
  };
}
