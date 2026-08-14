import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

test('web smoke: health, shell and security headers', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'novi-smoke-'));
  const previous = process.env.NOVI_DATA_FILE;
  process.env.NOVI_DATA_FILE = join(dir, 'state.json');
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); if (previous === undefined) delete process.env.NOVI_DATA_FILE; else process.env.NOVI_DATA_FILE = previous; });
  const base = `http://127.0.0.1:${server.address().port}`;
  const shell = await fetch(`${base}/`);
  assert.equal(shell.status, 200);
  const shellHtml = await shell.text();
  assert.match(shellHtml, /Novi AI Knowledge Scientist/);
  assert.match(shellHtml, /snapshot-modal/);
  assert.match(shellHtml, /provider-modal/);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.match(health.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
});
