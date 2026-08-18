import { access, chmod, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function backupStore(source, destination) {
  await access(source);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  await copyFile(source, temporary);
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return destination;
}

export async function restoreStore(source, destination) {
  const parsed = JSON.parse(await readFile(source, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 3 || !Array.isArray(parsed.projects) || !Array.isArray(parsed.users) || !Array.isArray(parsed.jobs)) throw new Error('Unsupported Novi backup format');
  parsed.externalProjectionJobs ||= [];
  parsed.agentSessions ||= [];
  parsed.agentToolConfigs ||= [];
  parsed.mcpServerConfigs ||= [];
  parsed.agentSkillConfigs ||= [];
  parsed.agentPluginConfigs ||= [];
  parsed.workspaceFiles ||= [];
  parsed.agentMemories ||= [];
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination);
  await chmod(destination, 0o600);
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [command, source, destination] = process.argv.slice(2);
  if (!command || !source || !destination || !['backup', 'restore'].includes(command)) {
    console.error('Usage: node src/backup.mjs backup|restore SOURCE DESTINATION'); process.exit(2);
  }
  (command === 'backup' ? backupStore : restoreStore)(source, destination).then((path) => console.log(path)).catch((error) => { console.error(error.message); process.exit(1); });
}
