import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 200_000;
const MAX_FILES = 500;
const MAX_TOTAL_FILE_BYTES = 2_000_000;
const DEFAULT_PROGRAMS = 'pwd,ls,find,grep,rg,cat,head,tail,wc,sort,uniq,cut,sed,awk,printf,echo,node,npm,npx,git';

function enabled() { return process.env.NOVI_AGENT_EXEC_ENABLED === 'true'; }
function programs() { return new Set(String(process.env.NOVI_AGENT_EXEC_ALLOWED || DEFAULT_PROGRAMS).split(',').map((item) => item.trim()).filter(Boolean)); }
function assertProgram(program) {
  const name = basename(String(program || '').trim());
  if (!name || !programs().has(name)) throw new Error(`Program ${name || '(empty)'} is not allowed by NOVI_AGENT_EXEC_ALLOWED`);
  return name;
}

function assertTerminalCommand(command) {
  const value = String(command || '').trim();
  if (!value || value.length > 8_000) throw new Error('Terminal command must be 1 to 8000 characters');
  if (/[\r\n`]/u.test(value) || value.includes('$(') || value.includes('<(') || value.includes('>(')) throw new Error('Terminal command contains unsupported shell expansion');
  for (const segment of value.split(/(?:&&|\|\||[|;])/u)) {
    const first = segment.trim().match(/^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*([^\s]+)/u)?.[1];
    if (first) assertProgram(first.replace(/^['"]|['"]$/g, ''));
  }
  return value;
}

function safeDestination(root, filePath) {
  const destination = resolve(root, filePath);
  if (destination !== root && !destination.startsWith(`${root}${sep}`)) throw new Error('Workspace file path escaped the execution sandbox');
  return destination;
}

async function materialize(files) {
  const root = await mkdtemp(join(tmpdir(), 'novi-agent-exec-'));
  for (const file of files || []) {
    const destination = safeDestination(root, file.path);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, String(file.content || ''), { mode: 0o600 });
  }
  await mkdir(join(root, '.tmp'), { recursive: true, mode: 0o700 });
  return root;
}

async function collectFiles(root) {
  const files = []; let total = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.tmp') continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Execution sandbox cannot persist symbolic links');
      if (entry.isDirectory()) { await walk(absolute); continue; }
      if (!entry.isFile()) continue;
      const metadata = await stat(absolute); if (metadata.size > MAX_FILE_BYTES) throw new Error('Execution produced a file larger than 200 KB');
      total += metadata.size; if (total > MAX_TOTAL_FILE_BYTES) throw new Error('Execution produced more than 2 MB of workspace files');
      const content = await readFile(absolute, 'utf8'); if (content.includes('\u0000')) throw new Error('Execution produced a binary file that cannot be persisted');
      files.push({ path: relative(root, absolute).split(sep).join('/'), content });
      if (files.length > MAX_FILES) throw new Error('Execution produced more than 500 workspace files');
    }
  }
  await walk(root); return files;
}

async function run(program, args, root, timeoutMs) {
  const timeout = Math.max(1_000, Math.min(30_000, Number(timeoutMs) || 10_000));
  const environment = { PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', HOME: root, TMPDIR: join(root, '.tmp'), NOVI_AGENT_WORKSPACE: root };
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { cwd: root, env: environment, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let total = 0; let timedOut = false; let truncated = false;
    const append = (kind, chunk) => {
      const text = chunk.toString('utf8'); const remaining = MAX_OUTPUT_BYTES - total;
      if (remaining <= 0) { truncated = true; return; }
      const value = Buffer.from(text).subarray(0, remaining).toString('utf8'); total += Buffer.byteLength(value); if (value.length < text.length) truncated = true;
      if (kind === 'stdout') stdout += value; else stderr += value;
    };
    child.stdout.on('data', (chunk) => append('stdout', chunk)); child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', reject);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, timeout); timer.unref?.();
    child.on('close', (code, signal) => { clearTimeout(timer); resolvePromise({ exitCode: Number.isInteger(code) ? code : null, signal: signal || null, stdout, stderr, timedOut, truncated }); });
  });
}

export async function executeWorkspaceCommand({ files, kind, command, program, args, timeoutMs }) {
  if (!enabled()) throw new Error('Terminal and exec tools require NOVI_AGENT_EXEC_ENABLED=true');
  const root = await materialize(files);
  try {
    const result = kind === 'terminal'
      ? await run('/bin/sh', ['-lc', assertTerminalCommand(command)], root, timeoutMs)
      : await run(assertProgram(program), Array.isArray(args) ? args.map(String).slice(0, 64) : [], root, timeoutMs);
    return { result, files: await collectFiles(root) };
  } finally { await rm(root, { recursive: true, force: true }); }
}

export { MAX_FILE_BYTES, MAX_FILES, MAX_OUTPUT_BYTES };
