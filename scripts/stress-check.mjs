import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

const dir = await mkdtemp(join(tmpdir(), 'novi-stress-'));
const previous = { file: process.env.NOVI_DATA_FILE, auth: process.env.NOVI_AUTH_REQUIRED, worker: process.env.NOVI_JOB_WORKER, refresh: process.env.NOVI_REFRESH_WORKER };
process.env.NOVI_DATA_FILE = join(dir, 'state.json'); process.env.NOVI_AUTH_REQUIRED = 'false'; process.env.NOVI_JOB_WORKER = 'false'; process.env.NOVI_REFRESH_WORKER = 'false';
const server = createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const restore = async () => { await new Promise((resolve) => server.close(resolve)); for (const [key, value] of Object.entries(previous)) { const name = key === 'file' ? 'NOVI_DATA_FILE' : key === 'auth' ? 'NOVI_AUTH_REQUIRED' : key === 'worker' ? 'NOVI_JOB_WORKER' : 'NOVI_REFRESH_WORKER'; if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
try {
  // Keep the complete phase (health + writes + final read) inside the
  // documented 240-request/IP guard while exercising both read/write races.
  const healthSamples = await Promise.all(Array.from({ length: 199 }, async () => { const started = performance.now(); const response = await fetch(`${base}/api/health`); if (!response.ok) throw new Error(`health returned ${response.status}`); await response.arrayBuffer(); return performance.now() - started; }));
  healthSamples.sort((a, b) => a - b);
  const healthP95 = healthSamples[Math.ceil(healthSamples.length * 0.95) - 1];
  if (healthP95 >= 200) throw new Error(`health concurrency P95 is ${healthP95.toFixed(1)} ms`);
  const projectResponses = await Promise.all(Array.from({ length: 40 }, (_, index) => fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `Stress ${index}`, topic: 'Concurrent persistence', type: 'knowledge' }) })));
  if (projectResponses.some((response) => response.status !== 201)) throw new Error(`project concurrency had ${projectResponses.filter((response) => response.status !== 201).length} failures`);
  const projects = await (await fetch(`${base}/api/projects`)).json();
  if (projects.projects.length !== 40) throw new Error(`expected 40 projects, got ${projects.projects.length}`);
  console.log(`stress-check: health=${healthSamples.length} concurrent, health-p95=${healthP95.toFixed(1)} ms, projects=${projects.projects.length}`);
} finally { await restore(); }
