import { searchKnowledgeSources } from '../src/connectors.mjs';
import { verifyEvidenceSources } from '../src/evidence.mjs';

const topic = process.env.NOVI_INTEGRATION_TOPIC || 'agent operating system security';
const sources = await searchKnowledgeSources(topic, 2);
if (!sources.length) throw new Error('live-source-integration-check: no provider returned a result');
const verified = await verifyEvidenceSources(sources);
const usable = verified.filter((source) => source.verification === 'verified' && source.mapped === true && source.contentHash);
if (!usable.length) throw new Error('live-source-integration-check: no concrete source passed retrieval verification');
const providers = [...new Set(usable.map((source) => new URL(source.url).hostname))];
console.log(`live-source-integration-check: results=${sources.length}, verified=${usable.length}, hosts=${providers.join(',')}`);
