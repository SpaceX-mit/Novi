import { access, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const requested = process.argv[2] || process.env.NOVI_DESKTOP_EXECUTABLE;
if (!requested) throw new Error('Usage: node scripts/desktop-package-smoke.mjs <packaged-electron-executable>');
const executable = isAbsolute(requested) ? requested : resolve(requested);
await access(executable);

const directory = await mkdtemp(join(tmpdir(), 'novi-packaged-smoke-'));
let output = '';
const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
const child = spawn(executable, args, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NOVI_DESKTOP_SMOKE: 'true',
    NOVI_DESKTOP_USER_DATA_DIR: join(directory, 'user-data'),
    NOVI_DATA_FILE: '',
    NOVI_AUTH_REQUIRED: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

const result = await new Promise((resolveResult, reject) => {
  const timer = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`desktop-package-smoke timed out\n${output.slice(-2_000)}`));
  }, 30_000);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code, signal) => { clearTimeout(timer); resolveResult({ code, signal }); });
});

try {
  if (result.code !== 0 || !output.includes('desktop-smoke: Electron service, secure window and shared UI loaded')) {
    throw new Error(`desktop-package-smoke failed (code=${result.code}, signal=${result.signal})\n${output.slice(-2_000)}`);
  }
  await access(join(directory, 'user-data', 'novi.json'));
  console.log('desktop-package-smoke: packaged service, secure window, userData state and shared UI loaded');
} finally {
  await rm(directory, { recursive: true, force: true });
}
