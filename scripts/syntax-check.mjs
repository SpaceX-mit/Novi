import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extname, join } from 'node:path';

const roots = ['src', 'public', 'desktop', 'scripts', 'test'];
const files = ['server.mjs'];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (['.js', '.mjs', '.cjs'].includes(extname(entry.name))) files.push(path);
  }
}

for (const root of roots) await collect(root);
for (const file of files.sort()) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

console.log(`syntax-check: ${files.length} JavaScript modules parsed successfully`);
