import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { application } from '../src/server.js';
import { setup } from '../src/setup.js';

const directory = await mkdtemp(join(tmpdir(), 'mesa-browser-'));
const configuredCli = process.env.MESA_PLAYWRIGHT_CLI;
const command = configuredCli || 'npx';
const prefix = configuredCli ? [] : ['--yes', '--package', '@playwright/cli@0.1.23', 'playwright-cli'];
let credentials = {};
let server;
let browserOpen = false;

function run(...args) {
  return new Promise((resolve, reject) => {
    const processArgs = [...prefix, '-s=mesa-browser-checks', ...args];
    const child = spawn(command, processArgs, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      for (const password of Object.values(credentials)) output = output.replaceAll(password, '[redacted]');
      output = output.replace(/[a-f0-9]{64}/g, '[redacted]');
      if (code !== 0 || /^### Error/m.test(output)) reject(new Error(output));
      else resolve(output);
    });
  });
}

try {
  credentials = JSON.parse(await readFile(setup(directory), 'utf8'));
  server = application({ directory, now: () => new Date('2026-11-05T18:00:00Z') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const scenario = await readFile(new URL('./browser-scenario.js', import.meta.url), 'utf8');
  const script = join(directory, 'scenario.js');
  await writeFile(script, `async page => (${scenario})(page, ${JSON.stringify(origin)}, ${JSON.stringify(credentials)})`, { mode: 0o600 });
  await run('open', 'about:blank', '--browser=chromium');
  browserOpen = true;
  const result = await run('run-code', '--filename=' + script);
  const report = result.split('\n').find((line) => line.startsWith('["BROWSER PASS '));
  if (!report) throw new Error('No browser success report was returned.\n' + result);
  console.log(JSON.parse(report).join('\n'));
} finally {
  if (browserOpen) await run('close').catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
