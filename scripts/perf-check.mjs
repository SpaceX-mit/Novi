import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

const dir = await mkdtemp(join(tmpdir(), 'novi-perf-'));
const previous = process.env.NOVI_DATA_FILE;
process.env.NOVI_DATA_FILE = join(dir, 'state.json');
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const shell = await fetch(`${base}/`);
  const body = await shell.arrayBuffer();
  if (body.byteLength >= 500 * 1024) throw new Error(`Shell is ${body.byteLength} bytes; must be below 500 KB`);
  const samples = [];
  for (let index = 0; index < 40; index += 1) {
    const started = performance.now();
    const response = await fetch(`${base}/api/health`);
    if (!response.ok) throw new Error(`Health returned ${response.status}`);
    await response.arrayBuffer(); samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  if (p95 >= 200) throw new Error(`Health P95 is ${p95.toFixed(1)} ms; must be below 200 ms`);
  console.log(`perf-check: shell=${body.byteLength} bytes, health-p95=${p95.toFixed(1)} ms`);
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (previous === undefined) delete process.env.NOVI_DATA_FILE; else process.env.NOVI_DATA_FILE = previous;
}
