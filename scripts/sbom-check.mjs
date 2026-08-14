import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const npmCli = process.env.npm_execpath;

function npmSbom(format, omitDev = false) {
  const args = ['sbom', '--package-lock-only', `--sbom-format=${format}`];
  args.push(omitDev ? '--omit=dev' : '--include=dev');
  const output = npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(output);
}

const cyclone = npmSbom('cyclonedx');
const runtimeCyclone = npmSbom('cyclonedx', true);
const spdx = npmSbom('spdx');

if (cyclone.bomFormat !== 'CycloneDX' || !cyclone.specVersion) throw new Error('Invalid CycloneDX SBOM');
if (runtimeCyclone.bomFormat !== 'CycloneDX') throw new Error('Invalid runtime CycloneDX SBOM');
if (spdx.spdxVersion !== 'SPDX-2.3') throw new Error('Invalid SPDX SBOM');

const expectedPurl = `pkg:npm/${packageJson.name}@${packageJson.version}`;
if (cyclone.metadata?.component?.purl !== expectedPurl) throw new Error('CycloneDX root package does not match package.json');

const runtimeNames = new Set((runtimeCyclone.components || []).map(component => component.name));
for (const dependency of Object.keys(packageJson.dependencies || {})) {
  if (!runtimeNames.has(dependency)) throw new Error(`Runtime SBOM is missing ${dependency}`);
}
for (const dependency of Object.keys(packageJson.devDependencies || {})) {
  if (runtimeNames.has(dependency)) throw new Error(`Runtime SBOM unexpectedly contains dev dependency ${dependency}`);
}

const missingLicenses = [];
for (const component of cyclone.components || []) {
  if (component.licenses?.length) continue;
  try {
    const installed = JSON.parse(await readFile(`node_modules/${component.name}/package.json`, 'utf8'));
    if (!installed.license && !installed.licenses?.length) missingLicenses.push(component.name);
  } catch {
    missingLicenses.push(component.name);
  }
}
if (missingLicenses.length) throw new Error(`SBOM components without license metadata: ${missingLicenses.join(', ')}`);

console.log(
  `sbom-check: CycloneDX ${cyclone.specVersion} components=${cyclone.components?.length || 0}, ` +
  `runtime=${runtimeCyclone.components?.length || 0}; SPDX packages=${spdx.packages?.length || 0}; license metadata complete`
);
