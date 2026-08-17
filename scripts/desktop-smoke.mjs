import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';

const directory = await mkdtemp(join(tmpdir(), 'novi-electron-smoke-'));
const port = 20_000 + (process.pid % 10_000);
let output = '';
const child = spawn(electron, ['--no-sandbox', 'desktop/main.cjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NOVI_DESKTOP_SMOKE: 'true', NOVI_DESKTOP_USER_DATA_DIR: join(directory, 'user-data'), NOVI_PORT: String(port), NOVI_DATA_FILE: join(directory, 'state.json'), NOVI_AUTH_REQUIRED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`desktop-smoke timed out\n${output.slice(-2_000)}`)); }, 30_000);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
}).finally(() => rm(directory, { recursive: true, force: true }));

if (result.code !== 0 || !output.includes('desktop-smoke: Electron service, secure window and shared UI loaded')) throw new Error(`desktop-smoke failed (code=${result.code}, signal=${result.signal})\n${output.slice(-2_000)}`);
console.log('desktop-smoke: Electron service, secure window and shared UI loaded');
