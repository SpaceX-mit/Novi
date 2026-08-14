const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Novi desktop packaging requires Node.js 22.12.0 or newer; current version is ${process.version}.`);
  console.error('Run `nvm install && nvm use`, then reinstall dependencies with `npm ci`.');
  process.exit(1);
}

console.log(`desktop-node-check: ${process.version} supports electron-builder ESM dependencies`);
