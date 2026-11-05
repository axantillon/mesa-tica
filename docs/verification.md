# Verification

The foundation milestone covers startup, idempotent provisioning and a live menu smoke check. Full acceptance checks follow the customer and staff integrations.

Foundation smoke on Node 24.18.0: `npm run setup` twice returned the same credentials path, the credentials file mode was 0600, and SQLite contained two employees and zero orders. `npm start` bound to port 3000. HTTP GET `/` returned the menu shell and GET `/api/menu` returned nine dishes, unavailable Fish casado and the Costa Rica zone.
