import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import WebSocket from 'ws';

const chromium = process.env.CHROMIUM_BIN || 'chromium';
const debugPort = Number(process.env.NOVI_BROWSER_DEBUG_PORT || 9228);
const viewportWidth = Number(process.env.NOVI_BROWSER_WIDTH || 1360);
const viewportHeight = Number(process.env.NOVI_BROWSER_HEIGHT || 900);
const dataDir = await mkdtemp(join(tmpdir(), 'novi-browser-'));
const previous = { auth: process.env.NOVI_AUTH_REQUIRED, worker: process.env.NOVI_JOB_WORKER, refresh: process.env.NOVI_REFRESH_WORKER, verify: process.env.NOVI_VERIFY_SOURCES, file: process.env.NOVI_DATA_FILE };
process.env.NOVI_AUTH_REQUIRED = 'false'; process.env.NOVI_JOB_WORKER = 'true'; process.env.NOVI_REFRESH_WORKER = 'false'; process.env.NOVI_VERIFY_SOURCES = 'false'; process.env.NOVI_DATA_FILE = join(dataDir, 'state.json');
const server = createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(chromium, ['--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${dataDir}/chrome`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function json(url) { for (let attempt = 0; attempt < 50; attempt += 1) { try { const response = await fetch(url); if (response.ok) return response.json(); } catch {} await sleep(100); } throw new Error(`Chromium debug endpoint did not become ready: ${url}`); }
const target = (await json(`http://127.0.0.1:${debugPort}/json/list`)).find((item) => item.type === 'page');
if (!target?.webSocketDebuggerUrl) throw new Error('Chromium page target is unavailable');
const socket = new WebSocket(target.webSocketDebuggerUrl);
let sequence = 0; const pending = new Map();
socket.on('message', (raw) => { const message = JSON.parse(String(raw)); if (message.id && pending.has(message.id)) { const entry = pending.get(message.id); pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); } });
await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
function command(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed'); return result.result?.value; }
async function waitFor(expression, timeout = 12_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100); } throw new Error(`Browser condition timed out: ${expression}`); }
try {
  await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: viewportWidth <= 640 });
  await evaluate(`location.href = ${JSON.stringify(base + '/')}`);
  await waitFor(`document.readyState === 'complete' && document.querySelector('#new-project') !== null && !document.querySelector('#new-project').hidden`);
  await sleep(500);
  await evaluate(`document.querySelector('#billing-upgrade').click()`);
  await waitFor(`!document.querySelector('#billing-modal').classList.contains('hidden') && document.querySelectorAll('[data-checkout-plan]').length === 3`);
  const pricing = await evaluate(`([...document.querySelectorAll('[data-checkout-plan]')].map((button) => button.dataset.checkoutPlan + ':' + button.closest('article').textContent))`);
  if (!pricing.some((item) => item.startsWith('personal:') && item.includes('$29')) || !pricing.some((item) => item.startsWith('pro:') && item.includes('$99')) || !pricing.some((item) => item.startsWith('enterprise:') && item.includes('$1000'))) throw new Error(`Pricing UI is incorrect: ${JSON.stringify(pricing)}`);
  await evaluate(`document.querySelector('#billing-close').click()`);
  await evaluate(`document.querySelector('#model-settings').click()`);
  await waitFor(`!document.querySelector('#provider-modal').classList.contains('hidden') && document.querySelectorAll('#provider-form [name="provider"] option').length >= 10`);
  const providerUi = await evaluate(`({ status: document.querySelector('#provider-status').textContent, providers: [...document.querySelectorAll('#provider-form [name="provider"] option')].map((option) => option.value) })`);
  if (providerUi.status !== 'Offline' || !providerUi.providers.includes('openai') || !providerUi.providers.includes('anthropic') || !providerUi.providers.includes('google') || !providerUi.providers.includes('deepseek') || !providerUi.providers.includes('minimax') || !providerUi.providers.includes('ollama')) throw new Error(`Provider settings UI is incorrect: ${JSON.stringify(providerUi)}`);
  if (!await evaluate(`document.querySelector('#provider-test').textContent.trim() === 'Save & test'`)) throw new Error('Provider connection action must make its save behavior explicit');
  await evaluate(`document.querySelector('#provider-close').click()`);
  await evaluate(`document.querySelector('#source-search').click()`);
  await waitFor(`!document.querySelector('#search-modal').classList.contains('hidden')`);
  await evaluate(`document.querySelector('#search-close').click()`);
  await waitFor(`document.querySelector('#search-modal').classList.contains('hidden')`);
  const clickResult = await evaluate(`(() => { const button = document.querySelector('#new-project'); button.click(); return { hidden: document.querySelector('#modal').classList.contains('hidden'), html: document.querySelector('#modal').outerHTML.slice(0, 120) }; })()`);
  if (clickResult.hidden) throw new Error(`New workspace button did not open modal: ${JSON.stringify(clickResult)}`);
  await waitFor(`!document.querySelector('#modal').classList.contains('hidden')`);
  await evaluate(`(() => { const set = (name, value) => { const input = document.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }; set('title', 'Browser smoke workspace'); set('topic', 'Agent OS security'); document.querySelector('#project-form button[type="submit"]').click(); })()`);
  await waitFor(`document.querySelector('#modal').classList.contains('hidden') || document.querySelector('#form-error').textContent.length > 0`);
  if (await evaluate(`document.querySelector('#form-error').textContent.length > 0`)) throw new Error(`Browser workspace form failed: ${await evaluate(`JSON.stringify(document.querySelector('#form-error').textContent)`)}`);
  await waitFor(`document.querySelector('#view-workspace').classList.contains('active-view')`);
  await waitFor(`document.querySelector('#generate') !== null`);
  await evaluate(`document.querySelector('#generate').click()`);
  await waitFor(`document.querySelector('#agent-run-status') !== null && document.querySelector('#agent-run-mode').textContent.trim().length > 0`);
  const activeMode = await evaluate(`document.querySelector('#agent-run-mode').textContent.trim()`);
  if (activeMode !== 'Workflow') throw new Error(`Agent execution mode is not visible or was routed incorrectly: ${activeMode}`);
  if (!await evaluate(`document.querySelector('#generate-empty')?.disabled === true`)) throw new Error('Empty workspace generate action remains enabled during an active Agent run');
  if (process.env.NOVI_BROWSER_AGENT_MODE_SCREENSHOT) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.NOVI_BROWSER_AGENT_MODE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  await waitFor(`document.querySelector('#workspace-root .artifact-panel') !== null`, 15_000);
  if (!await evaluate(`document.querySelector('[data-artifact-tab="practice"]') !== null`)) throw new Error('Knowledge Builder practice lab is unavailable');
  await evaluate(`document.querySelector('[data-artifact-tab="practice"]').click()`);
  await waitFor(`document.querySelector('.artifact-content').textContent.includes('Practice questions') && document.querySelector('.artifact-content').textContent.includes('Deliverable')`);
  if (!await evaluate(`document.querySelector('#delete-workspace') !== null`)) throw new Error('Workspace delete control is unavailable');
  if (await evaluate(`document.querySelector('#export-ieee') !== null || document.querySelector('#export-acm') !== null`)) throw new Error('Non-paper workspace must not expose LaTeX export');
  const viewerUi = await evaluate(`(async () => { const ui = await import('/app.js'); ui.state.role = 'viewer'; ui.applyRoleCapabilities(); ui.renderWorkspace(ui.state.activeProject); const result = { createHidden: document.querySelector('#new-project').hidden, providerHidden: document.querySelector('#model-settings').hidden, generate: !!document.querySelector('#generate'), removeWorkspace: !!document.querySelector('#delete-workspace'), pin: !!document.querySelector('#pin-workspace'), ingest: !!document.querySelector('#ingest-document'), refresh: !!document.querySelector('#refresh-sources'), watch: !!document.querySelector('#toggle-watch'), browse: !!document.querySelector('#knowledge-library'), exportMarkdown: !!document.querySelector('#export-md') }; ui.state.role = 'owner'; ui.applyRoleCapabilities(); ui.renderWorkspace(ui.state.activeProject); return result; })()`);
  if (!viewerUi.createHidden || !viewerUi.providerHidden || viewerUi.generate || viewerUi.removeWorkspace || viewerUi.pin || viewerUi.ingest || viewerUi.refresh || viewerUi.watch || !viewerUi.browse || !viewerUi.exportMarkdown) throw new Error(`Viewer UI capabilities are incorrect: ${JSON.stringify(viewerUi)}`);
  const knowledgeImport = await evaluate(`(async () => { const projects = await (await fetch('/api/projects')).json(); const project = projects.projects.find((item) => item.title === 'Browser smoke workspace'); const response = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/knowledge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Browser security notes', content: 'Agent OS security requires a sandbox threat model and adversarial recovery tests.', sourceUrl: 'https://example.com/browser-notes' }) }); return { status: response.status, projectId: project.id }; })()`);
  if (knowledgeImport.status !== 201) throw new Error(`Knowledge import failed: ${JSON.stringify(knowledgeImport)}`);
  await evaluate(`document.querySelector('#knowledge-library').click()`);
  await waitFor(`!document.querySelector('#knowledge-modal').classList.contains('hidden') && document.querySelector('#knowledge-results').textContent.includes('Browser security notes')`);
  const viewerKnowledge = await evaluate(`(async () => { const ui = await import('/app.js'); const payload = await (await fetch('/api/projects/' + encodeURIComponent(${JSON.stringify(knowledgeImport.projectId)}) + '/knowledge')).json(); ui.state.role = 'viewer'; ui.renderKnowledgeDocuments(payload); const removeVisible = !!document.querySelector('[data-delete-document]'); ui.state.role = 'owner'; ui.renderKnowledgeDocuments(payload); return { removeVisible }; })()`);
  if (viewerKnowledge.removeVisible) throw new Error(`Viewer knowledge controls are incorrect: ${JSON.stringify(viewerKnowledge)}`);
  await evaluate(`(() => { const input = document.querySelector('#knowledge-search-form [name="query"]'); input.value = 'sandbox threat model'; document.querySelector('#knowledge-search-form button[type="submit"]').click(); })()`);
  await waitFor(`document.querySelector('.knowledge-match') !== null && document.querySelector('.knowledge-match').textContent.includes('sandbox threat model')`);
  if (process.env.NOVI_BROWSER_KNOWLEDGE_SCREENSHOT) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.NOVI_BROWSER_KNOWLEDGE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  await evaluate(`document.querySelector('#knowledge-close').click()`);
  await waitFor(`document.querySelector('#knowledge-modal').classList.contains('hidden')`);
  await evaluate(`document.querySelector('#generate').click()`);
  await waitFor(`document.querySelectorAll('#artifact-version option').length === 2`, 15_000);
  await waitFor(`document.querySelector('.artifact-knowledge-context') !== null && document.querySelector('.artifact-knowledge-context').textContent.includes('Browser security notes')`);
  await evaluate(`document.querySelector('#compare-version').click()`);
  await waitFor(`document.querySelector('.version-comparison') !== null`);
  const versionResult = await evaluate(`({ count: document.querySelectorAll('#artifact-version option').length, comparison: document.querySelector('.version-comparison').textContent })`);
  if (versionResult.count !== 2 || !versionResult.comparison.includes('Version 2 compared with Version 1') || !versionResult.comparison.includes('Workspace knowledge used')) throw new Error(`Artifact version comparison failed: ${JSON.stringify(versionResult)}`);
  const networkFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://api.openalex.org/')) return new Response(JSON.stringify({ results: [{ id: 'https://openalex.org/W-browser-update', display_name: 'Browser continuous update paper', publication_year: 2026 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ results: [], items: [], data: [], query: { search: [] }, message: { items: [] }, hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let continuousUpdate;
  try {
    await evaluate(`document.querySelector('#refresh-sources').click()`);
    await waitFor(`document.querySelectorAll('#artifact-version option').length === 3`, 15_000);
    await evaluate(`document.querySelector('#show-snapshots').click()`);
    await waitFor(`!document.querySelector('#snapshot-modal').classList.contains('hidden') && document.querySelector('#snapshot-list').textContent.includes('Workspace updated')`);
    continuousUpdate = await evaluate(`({ versions: document.querySelectorAll('#artifact-version option').length, history: document.querySelector('#snapshot-list').textContent })`);
    if (continuousUpdate.versions !== 3 || !continuousUpdate.history.includes('Changed') || !continuousUpdate.history.includes('Workspace updated')) throw new Error(`Continuous update UI failed: ${JSON.stringify(continuousUpdate)}`);
    await evaluate(`document.querySelector('#snapshot-close').click()`);
  } finally { global.fetch = networkFetch; }
  await evaluate(`document.querySelector('#knowledge-library').click()`);
  await waitFor(`!document.querySelector('#knowledge-modal').classList.contains('hidden') && document.querySelector('[data-delete-document]') !== null`);
  await evaluate(`(() => { window.confirm = () => true; document.querySelector('[data-delete-document]').click(); })()`);
  await waitFor(`document.querySelector('#knowledge-results').textContent.includes('No imported knowledge yet')`);
  const knowledgeDelete = await evaluate(`(async () => { const response = await fetch('/api/projects/' + encodeURIComponent(${JSON.stringify(knowledgeImport.projectId)}) + '/knowledge?q=sandbox'); const payload = await response.json(); return { status: response.status, results: payload.results.length, retained: document.querySelector('.artifact-knowledge-context')?.textContent.includes('Browser security notes') || false }; })()`);
  if (knowledgeDelete.status !== 200 || knowledgeDelete.results !== 0 || !knowledgeDelete.retained) throw new Error(`Knowledge deletion failed: ${JSON.stringify(knowledgeDelete)}`);
  await evaluate(`document.querySelector('#knowledge-close').click()`);
  await waitFor(`document.querySelector('#knowledge-modal').classList.contains('hidden')`);
  if (process.env.NOVI_BROWSER_SCREENSHOT) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.NOVI_BROWSER_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  const result = await evaluate(`(async () => { const projects = await (await fetch('/api/projects')).json(); const project = projects.projects.find((item) => item.title === 'Browser smoke workspace'); const exportResponse = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/export?format=markdown'); return { title: project.title, status: project.status, exportStatus: exportResponse.status, exportText: await exportResponse.text() }; })()`);
  if (result.title !== 'Browser smoke workspace' || result.status !== 'ready' || result.exportStatus !== 200 || !result.exportText.includes('# Knowledge Base')) throw new Error(`Unexpected browser journey result: ${JSON.stringify(result)}`);
  await evaluate(`(async () => { const created = await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Browser paper figures', topic: 'Knowledge systems', type: 'paper' }) })).json(); await fetch('/api/projects/' + encodeURIComponent(created.project.id) + '/generate', { method: 'POST' }); location.reload(); })()`);
  await waitFor(`document.readyState === 'complete' && [...document.querySelectorAll('[data-project]')].some((card) => card.textContent.includes('Browser paper figures'))`);
  await evaluate(`[...document.querySelectorAll('[data-project]')].find((card) => card.textContent.includes('Browser paper figures')).click()`);
  await waitFor(`document.querySelector('[data-artifact-tab="figures"]') !== null`);
  await evaluate(`document.querySelector('[data-artifact-tab="figures"]').click()`);
  await waitFor(`document.querySelector('.figure-svg') !== null`);
  if (!await evaluate(`document.querySelector('[data-artifact-tab="novelty"]') !== null && document.querySelector('[data-artifact-tab="sources"]') !== null && document.querySelector('#export-ieee') !== null && document.querySelector('#export-acm') !== null`)) throw new Error('Paper gap/novelty, sources, or publication template export is unavailable');
  await evaluate(`document.querySelector('[data-artifact-tab="novelty"]').click()`);
  await waitFor(`document.querySelector('.artifact-content').textContent.includes('Research gap discovery') && document.querySelector('.artifact-content').textContent.includes('Falsification test') && document.querySelector('.artifact-content').textContent.includes('Novelty analysis')`);
  const publicationTemplates = await evaluate(`(async () => { const projects = await (await fetch('/api/projects')).json(); const project = projects.projects.find((item) => item.title === 'Browser paper figures'); const ieee = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/export?format=latex&template=ieee'); const acm = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/export?format=latex&template=acm'); return { ieeeStatus: ieee.status, ieee: await ieee.text(), acmStatus: acm.status, acm: await acm.text() }; })()`);
  if (publicationTemplates.ieeeStatus !== 200 || publicationTemplates.acmStatus !== 200 || !publicationTemplates.ieee.startsWith('\\documentclass[conference]{IEEEtran}') || !publicationTemplates.acm.startsWith('\\documentclass[sigconf]{acmart}')) throw new Error(`Publication template export failed: ${JSON.stringify(publicationTemplates).slice(0, 500)}`);
  await evaluate(`(async () => { const created = await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Browser deep research suite', topic: 'Knowledge systems', type: 'research' }) })).json(); const generated = await fetch('/api/projects/' + encodeURIComponent(created.project.id) + '/generate', { method: 'POST' }); if (!generated.ok) throw new Error('Research generation failed: ' + generated.status); location.reload(); })()`);
  await waitFor(`document.readyState === 'complete' && [...document.querySelectorAll('[data-project]')].some((card) => card.textContent.includes('Browser deep research suite'))`);
  await evaluate(`[...document.querySelectorAll('[data-project]')].find((card) => card.textContent.includes('Browser deep research suite')).click()`);
  await waitFor(`document.querySelector('[data-artifact-tab="wiki"]') !== null && document.querySelector('[data-artifact-tab="graph"]') !== null && document.querySelector('[data-artifact-tab="sota"]') !== null`);
  await evaluate(`document.querySelector('[data-artifact-tab="wiki"]').click()`);
  await waitFor(`document.querySelector('.artifact-content').textContent.includes('Interview preparation') && document.querySelector('.artifact-content').textContent.includes('Capstone project')`);
  await evaluate(`document.querySelector('[data-artifact-tab="graph"]').click()`);
  await waitFor(`document.querySelectorAll('.artifact-content .node').length >= 10`);
  console.log(`browser-smoke: created=${result.title}, status=${result.status}, pricing=ready, agent-mode=${activeMode}, viewer-ui=ready, knowledge-search=ready, rag-context=ready, versions=${versionResult.count}, comparison=ready, continuous-update=ready, knowledge-delete=ready, markdown-export=${result.exportStatus}, paper-svg=ready, paper-gap=ready, publication-templates=ready, research-suite=ready`);
} finally {
  socket.close(); chrome.kill('SIGTERM'); await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(previous)) { const name = { auth: 'NOVI_AUTH_REQUIRED', worker: 'NOVI_JOB_WORKER', refresh: 'NOVI_REFRESH_WORKER', verify: 'NOVI_VERIFY_SOURCES', file: 'NOVI_DATA_FILE' }[key]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
