import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { validateObjectStoreConfiguration } from '../src/object-store.mjs';
import { validateGraphConfiguration } from '../src/graph-store.mjs';
import { validatePaymentConfiguration } from '../src/payments.mjs';
import { validateOidcConfiguration } from '../src/oidc.mjs';
import { validateSourceAdapterConfiguration } from '../src/source-adapters.mjs';
import { LOCAL_MONTHLY_GENERATIONS, localMonthlyGenerationLimit } from '../src/billing.mjs';

const required = ['README.md', 'openapi.yaml', 'docs/PRD.md', 'docs/SRS.md', 'docs/ARCHITECTURE.md', 'docs/DETAILED_DESIGN.md', 'docs/GOAL_TRACEABILITY.md', 'docs/COMMERCIAL_READINESS.md', 'docs/RELEASE.md', 'Dockerfile', '.env.example', '.nvmrc', 'package-lock.json'];
for (const file of required) await access(file);
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
if (!packageJson.scripts.test || !packageJson.scripts.check || !packageJson.scripts['perf-check'] || !packageJson.scripts['browser-smoke'] || !packageJson.scripts['desktop-smoke'] || !packageJson.scripts['desktop-package-smoke'] || !packageJson.scripts['desktop:dir'] || !packageJson.scripts['desktop:dist'] || !packageJson.scripts['stress-check'] || !packageJson.scripts['provider-contract-check'] || !packageJson.scripts['storage-contract-check'] || !packageJson.scripts['openapi-check'] || !packageJson.scripts['sbom-check']) throw new Error('test/check/perf-check/browser-smoke/desktop packaging/stress/provider/storage/openapi/SBOM scripts are required');
if (packageJson.engines?.node !== '>=22.12.0' || packageJson.scripts['predesktop:dir'] !== 'node scripts/desktop-node-check.mjs' || packageJson.scripts['predesktop:dist'] !== 'node scripts/desktop-node-check.mjs') throw new Error('Desktop packaging requires the Node 22.12+ engine and lifecycle preflight');
if (!/^22\.22\.2\s*$/.test(await readFile('.nvmrc', 'utf8'))) throw new Error('.nvmrc must pin the verified Node 22.22.2 build runtime');
if (packageJson.main !== 'desktop/main.cjs' || !packageJson.build?.appId || !packageJson.build?.mac || !packageJson.build?.win || !packageJson.build?.linux) throw new Error('Cross-platform Electron packaging configuration is required');
if (!packageJson.dependencies?.pg) throw new Error('PostgreSQL runtime dependency is required');
if (LOCAL_MONTHLY_GENERATIONS.development !== 1000 || LOCAL_MONTHLY_GENERATIONS.release !== 100 || localMonthlyGenerationLimit({}) !== 1000 || localMonthlyGenerationLimit({ NODE_ENV: 'production' }) !== 100 || localMonthlyGenerationLimit({ NOVI_RELEASE_BUILD: 'true' }) !== 100) throw new Error('Local generation quotas must be 1000 for development and 100 for releases');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (lock.lockfileVersion < 3) throw new Error('npm lockfileVersion 3 or newer is required');
const dockerfile = await readFile('Dockerfile', 'utf8');
if (!dockerfile.includes('npm ci --omit=dev')) throw new Error('Dockerfile must use reproducible production install');
if (process.env.NOVI_AUTH_REQUIRED !== 'true' && process.env.NODE_ENV === 'production') throw new Error('Production release requires NOVI_AUTH_REQUIRED=true');
if (process.env.NODE_ENV === 'production' && process.env.NOVI_COOKIE_SECURE !== 'true') throw new Error('Production release requires NOVI_COOKIE_SECURE=true');
if (process.env.NODE_ENV === 'production' && process.env.NOVI_STORAGE === 'postgres' && !process.env.NOVI_PG_URL) throw new Error('PostgreSQL storage requires NOVI_PG_URL');
if (process.env.NODE_ENV === 'production' && process.env.NOVI_STORAGE !== 'postgres') throw new Error('Production release requires NOVI_STORAGE=postgres');
if (process.env.NODE_ENV === 'production' && process.env.NOVI_REQUIRE_NATIVE_VECTOR !== 'true') throw new Error('Production release requires NOVI_REQUIRE_NATIVE_VECTOR=true');
if (process.env.NODE_ENV === 'production' && process.env.NOVI_LIVE_SOURCES !== 'true') throw new Error('Production release requires NOVI_LIVE_SOURCES=true');
if (process.env.NODE_ENV === 'production' && process.env.NOVI_VERIFY_SOURCES === 'false') throw new Error('Production release cannot disable source verification');
if (process.env.NODE_ENV === 'production' && !process.env.NOVI_PG_URL) throw new Error('Production release requires NOVI_PG_URL');
if (process.env.NODE_ENV === 'production' && !process.env.NOVI_OBJECT_STORE_URL && !process.env.NOVI_OBJECT_STORE_DIR) throw new Error('Production release requires an object store backend');
if (process.env.NODE_ENV === 'production' && !process.env.NOVI_GRAPH_URL) throw new Error('Production release requires NOVI_GRAPH_URL');
if (process.env.NODE_ENV === 'production' && ((process.env.NOVI_OBJECT_STORE_ACCESS_KEY && !process.env.NOVI_OBJECT_STORE_SECRET_KEY) || (!process.env.NOVI_OBJECT_STORE_ACCESS_KEY && process.env.NOVI_OBJECT_STORE_SECRET_KEY))) throw new Error('Production object store SigV4 credentials must be configured together');
if (process.env.NOVI_OBJECT_STORE_URL || process.env.NOVI_OBJECT_STORE_DIR) validateObjectStoreConfiguration();
if (process.env.NOVI_GRAPH_URL) validateGraphConfiguration();
validatePaymentConfiguration();
validateOidcConfiguration();
validateSourceAdapterConfiguration();
if (process.env.NOVI_PAYMENT_CHECKOUT_URL) {
  try { if (!process.env.NOVI_APP_ORIGIN || !['http:', 'https:'].includes(new URL(process.env.NOVI_APP_ORIGIN).protocol)) throw new Error(); }
  catch { throw new Error('Payment provider requires a valid NOVI_APP_ORIGIN'); }
}
console.log(`release-check: ${required.length} artifacts present; production auth policy valid`);
execFileSync(process.execPath, ['scripts/openapi-check.mjs'], { stdio: 'inherit', env: process.env });
execFileSync(process.execPath, ['scripts/provider-contract-check.mjs'], { stdio: 'inherit', env: process.env });
execFileSync(process.execPath, ['scripts/storage-contract-check.mjs'], { stdio: 'inherit', env: process.env });
execFileSync(process.execPath, ['scripts/sbom-check.mjs'], { stdio: 'inherit', env: process.env });
if (process.env.NOVI_RUN_EXTERNAL_INTEGRATION === 'true') execFileSync(process.execPath, ['scripts/infrastructure-integration-check.mjs'], { stdio: 'inherit', env: process.env });
if (process.env.NOVI_RUN_LIVE_SOURCE_INTEGRATION === 'true') execFileSync(process.execPath, ['scripts/live-source-integration-check.mjs'], { stdio: 'inherit', env: process.env });
