import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { describeSetup, runSetup } from './setup.js';

const config = loadConfig();
const db = openDatabase(config.dataDir);
console.log(describeSetup(await runSetup({ db, config }), config));

const server = http.createServer(createApp({ db, config }));
server.listen(config.port, config.host, () => {
  const { address, port } = server.address();
  const host = address.includes(':') ? `[${address}]` : address;
  console.log(`Mesa Tica is running at http://${host}:${port}/ (staff: /staff)`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
