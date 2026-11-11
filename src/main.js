import { createServer } from 'node:http';
import { createApp } from './app.js';
import { defaultDataDir } from './setup.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const app = createApp({ dataDir: defaultDataDir(), secureCookies: process.env.MESA_SECURE_COOKIES === '1' });

const server = createServer(app.handler).listen(port, host, () => {
  const address = `http://${host}:${server.address().port}`;
  console.log(`Mesa Tica is running at ${address}  (staff: ${address}/staff)`);
});
