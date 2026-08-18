import { spawn } from 'node:child_process';
import http from 'node:http';
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
async function sendOpenAiChat(res, request, content) {
  const id = 'browser-chat'; const model = 'browser-chat'; const usage = { prompt_tokens: 10, completion_tokens: 8 };
  if (request.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const chunk of String(content).match(/[\s\S]{1,24}/g) || ['']) {
      res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage })}\n\n`);
    res.end('data: [DONE]\n\n');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id, object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage }));
}
const modelServer = http.createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await sendOpenAiChat(res, request, 'Browser Harness response from the configured LLM.');
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
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
  await evaluate(`document.querySelector('#customize-nav').click()`);
  await waitFor(`document.querySelector('#view-customize').classList.contains('active-view') && document.querySelectorAll('[data-builtin-tool]').length === 15`);
  const toolUi = await evaluate(`({ tabs: [...document.querySelectorAll('.customize-tabs button')].map((button) => button.textContent.trim()), builtins: [...document.querySelectorAll('[data-builtin-tool]')].map((input) => input.dataset.builtinTool), configurable: !document.querySelector('#save-tools').disabled, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  if (JSON.stringify(toolUi.tabs) !== JSON.stringify(['Tools', 'MCP', 'Skills', 'Plugins']) || JSON.stringify(toolUi.builtins) !== JSON.stringify(['workspace_read', 'workspace_write', 'read_file', 'search_files', 'write_file', 'patch', 'memory', 'skills_list', 'skill_view', 'skill_manage', 'terminal', 'exec', 'web_search', 'paper_search', 'paper_fetch']) || !toolUi.configurable || toolUi.overflow) throw new Error(`Customize tools UI is incorrect: ${JSON.stringify(toolUi)}`);
  await evaluate(`(() => { const write = document.querySelector('[data-builtin-tool="workspace_write"]'); write.checked = true; document.querySelector('#save-tools').click(); })()`);
  await waitFor(`document.querySelector('#toast').textContent === 'Agent tools saved'`);
  await evaluate(`document.querySelector('[data-customize-tab="mcp"]').click()`);
  await waitFor(`document.querySelector('#add-mcp-server') !== null && document.querySelector('#save-mcp') !== null`);
  await evaluate(`document.querySelector('#add-mcp-server').click()`);
  await waitFor(`document.querySelector('.mcp-server-row') !== null && document.querySelector('[data-sync-mcp]') !== null`);
  const mcpUi = await evaluate(`({ endpoint: !!document.querySelector('.mcp-server-row [name="endpoint"]'), discover: document.querySelector('[data-sync-mcp]').textContent.trim(), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth })`);
  if (!mcpUi.endpoint || mcpUi.discover !== 'Save & discover' || mcpUi.overflow) throw new Error(`Customize MCP UI is incorrect: ${JSON.stringify(mcpUi)}`);
  await evaluate(`document.querySelector('[data-remove-mcp]').click()`);
  await evaluate(`document.querySelector('[data-customize-tab="skills"]').click()`);
  await waitFor(`document.querySelector('#add-skill') !== null && document.querySelector('#save-skills') !== null`);
  await evaluate(`document.querySelector('#add-skill').click()`);
  await waitFor(`document.querySelector('.skill-row') !== null`);
  const skillUi = await evaluate(`(() => { const row = document.querySelector('.skill-row'); const set = (name, value) => { row.querySelector('[name="' + name + '"]').value = value; }; set('name', 'browser_review'); set('title', 'Browser review'); set('description', 'Apply a browser smoke review checklist.'); set('triggerTerms', 'browser review, smoke checklist'); set('instructions', 'Check responsive layout, role boundaries, and persisted provenance.'); return { products: row.querySelectorAll('[data-skill-product]').length, activation: row.querySelector('[name="activation"]').value, instructions: !!row.querySelector('[name="instructions"]'), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`);
  if (skillUi.products !== 3 || skillUi.activation !== 'auto' || !skillUi.instructions || skillUi.overflow) throw new Error(`Customize Skills UI is incorrect: ${JSON.stringify(skillUi)}`);
  await evaluate(`document.querySelector('#save-skills').click()`);
  await waitFor(`document.querySelector('#toast').textContent === 'Agent Skills saved' && document.querySelector('.skill-row [name="name"]').value === 'browser_review'`);
  await evaluate(`document.querySelector('[data-customize-tab="plugins"]').click()`); await waitFor(`document.querySelector('#add-plugin') !== null`); await evaluate(`document.querySelector('#add-plugin').click()`); await waitFor(`document.querySelector('.plugin-row') !== null`);
  const pluginUi = await evaluate(`(() => { const row = document.querySelector('.plugin-row'); const set = (name,value) => row.querySelector('[name="' + name + '"]').value = value; set('name','browser_suite'); set('title','Browser suite'); set('description','Compose browser review checks.'); set('triggerTerms','browser suite'); set('instructions','Use only approved review guidance and tools.'); row.querySelector('[name="skillNames"] option[value="browser_review"]').selected = true; row.querySelector('[name="toolNames"] option[value="workspace_read"]').selected = true; return { skills: row.querySelector('[name="skillNames"]').selectedOptions.length, tools: row.querySelector('[name="toolNames"]').selectedOptions.length, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })()`);
  if (pluginUi.skills !== 1 || pluginUi.tools !== 1 || pluginUi.overflow) throw new Error(`Customize Plugins UI is incorrect: ${JSON.stringify(pluginUi)}`);
  await evaluate(`document.querySelector('#save-plugins').click()`); await waitFor(`document.querySelector('#toast').textContent === 'Agent Plugins saved' && document.querySelector('.plugin-row [name="name"]').value === 'browser_suite'`);
  await evaluate(`document.querySelector('[data-view="overview"]').click()`);
  await waitFor(`document.querySelector('#view-overview').classList.contains('active-view')`);
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
  await evaluate(`(() => { const form = document.querySelector('#project-form'); const set = (name, value) => { const input = form.querySelector('[name="' + name + '"]'); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }; set('title', 'Browser smoke workspace'); set('topic', 'Agent OS security'); set('wikiLanguage', 'en'); form.querySelector('button[type="submit"]').click(); })()`);
  await waitFor(`document.querySelector('#modal').classList.contains('hidden') || document.querySelector('#form-error').textContent.length > 0`);
  if (await evaluate(`document.querySelector('#form-error').textContent.length > 0`)) throw new Error(`Browser workspace form failed: ${await evaluate(`JSON.stringify(document.querySelector('#form-error').textContent)`)}`);
  await waitFor(`document.querySelector('#view-workspace').classList.contains('active-view')`);
  await waitFor(`document.querySelector('#generate') !== null`);
  await waitFor(`document.querySelector('.conversation-panel') !== null && document.querySelector('.session-item.active') !== null && document.querySelector('.agent-message.welcome') !== null`);
  const initialSessionUi = await evaluate(`({ sessions: document.querySelectorAll('.session-item').length, modes: [...document.querySelectorAll('#agent-mode option')].map((option) => option.value), languages: [...document.querySelectorAll('#wiki-language option')].map((option) => option.value), language: document.querySelector('#wiki-language').value, tabs: [...document.querySelectorAll('[data-context-panel]')].map((button) => button.textContent.trim()), welcome: document.querySelector('.agent-message.welcome').textContent })`);
  if (initialSessionUi.sessions !== 1 || JSON.stringify(initialSessionUi.modes) !== JSON.stringify(['auto', 'workflow', 'react', 'plan-execute', 'supervisor']) || initialSessionUi.languages.length !== 8 || initialSessionUi.language !== 'en' || !initialSessionUi.tabs.includes('Files') || !initialSessionUi.tabs.includes('LLM Wiki') || !initialSessionUi.tabs.includes('Document') || !initialSessionUi.welcome.includes('Workspace ready')) throw new Error(`Initial Agent Session UI is incorrect: ${JSON.stringify(initialSessionUi)}`);
  const preservedComposer = await evaluate(`(() => { const prompt = document.querySelector('#agent-prompt'); const mode = document.querySelector('#agent-mode'); prompt.value = 'Preserve this draft'; prompt.dispatchEvent(new Event('input', { bubbles: true })); mode.value = 'plan-execute'; mode.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-context-panel="files"]').click(); return { prompt: document.querySelector('#agent-prompt').value, mode: document.querySelector('#agent-mode').value }; })()`);
  if (preservedComposer.prompt !== 'Preserve this draft' || preservedComposer.mode !== 'plan-execute') throw new Error(`Composer state was lost while switching inspector tabs: ${JSON.stringify(preservedComposer)}`);
  const chatProvider = await evaluate(`fetch('/api/llm/provider', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'custom', model: 'browser-chat', baseUrl: ${JSON.stringify(`http://127.0.0.1:${modelServer.address().port}/v1`)}, apiKey: 'fixture' }) }).then(async (response) => ({ status: response.status, body: await response.json() }))`);
  if (chatProvider.status !== 200) throw new Error(`Browser chat provider setup failed: ${JSON.stringify(chatProvider)}`);
  await evaluate(`(() => { const prompt = document.querySelector('#agent-prompt'); const mode = document.querySelector('#agent-mode'); prompt.value = 'Research authoritative sources and improve this Wiki'; prompt.dispatchEvent(new Event('input', { bubbles: true })); mode.value = 'workflow'; mode.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#agent-composer').requestSubmit(); })()`);
  await waitFor(`document.querySelector('.live-events .run-event') !== null && document.querySelector('.live-events').textContent.includes('streaming')`, 15_000);
  const liveTrace = await evaluate(`({ events: document.querySelectorAll('.live-events .run-event').length, request: document.querySelector('.live-events').textContent.includes('Request sent to LLM'), streaming: document.querySelector('.live-events').textContent.includes('streaming') })`);
  if (liveTrace.events < 2 || !liveTrace.request || !liveTrace.streaming) throw new Error(`Live Agent run timeline is incomplete: ${JSON.stringify(liveTrace)}`);
  await waitFor(`document.querySelectorAll('.agent-message').length === 3 && document.querySelector('.message-artifact') !== null`, 15_000);
  const conversationUi = await evaluate(`(async () => { const projects = await (await fetch('/api/projects')).json(); const project = projects.projects.find((item) => item.title === 'Browser smoke workspace'); const knowledge = await (await fetch('/api/projects/' + encodeURIComponent(project.id) + '/knowledge')).json(); const last = document.querySelector('.agent-message:last-child'); return { artifacts: project.artifacts.length, artifactLinks: document.querySelectorAll('.message-artifact').length, lastKind: last.className, wikiDocuments: knowledge.documents.filter((document) => document.sourceKind === 'agent-wiki').length, runEvents: last.querySelectorAll('.run-event').length, trace: last.textContent, details: [...last.querySelectorAll('.run-event pre')].map((node) => node.textContent).join('\\n') }; })()`);
  if (conversationUi.artifacts !== 1 || conversationUi.artifactLinks !== 1 || !conversationUi.lastKind.includes('artifact') || conversationUi.wikiDocuments !== 1 || conversationUi.runEvents < 10 || !conversationUi.trace.includes('LLM response') || !conversationUi.trace.includes('Artifact saved') || !conversationUi.details.includes('Browser Harness response')) throw new Error(`Composer did not create an auditable cumulative Wiki artifact: ${JSON.stringify(conversationUi)}`);
  await evaluate(`fetch('/api/llm/provider', { method: 'DELETE' })`);
  await evaluate(`(() => { const prompt = document.querySelector('#agent-prompt'); const mode = document.querySelector('#agent-mode'); prompt.value = ''; prompt.dispatchEvent(new Event('input', { bubbles: true })); mode.value = 'auto'; mode.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('[data-context-panel="wiki"]').click(); })()`);
  await evaluate(`document.querySelector('#generate').click()`);
  await waitFor(`document.querySelector('#agent-run-status') !== null && document.querySelector('#agent-run-mode').textContent.trim().length > 0`);
  const activeMode = await evaluate(`document.querySelector('#agent-run-mode').textContent.trim()`);
  if (activeMode !== 'Workflow') throw new Error(`Agent execution mode is not visible or was routed incorrectly: ${activeMode}`);
  if (!await evaluate(`document.querySelector('#generate')?.disabled === true`)) throw new Error('Workspace generate action remains enabled during an active Agent run');
  if (process.env.NOVI_BROWSER_AGENT_MODE_SCREENSHOT) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.NOVI_BROWSER_AGENT_MODE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  await waitFor(`document.querySelector('#workspace-root .artifact-panel') !== null`, 15_000);
  await waitFor(`document.querySelectorAll('.agent-message').length === 5 && document.querySelector('.message-artifact') !== null`);
  const completedSessionUi = await evaluate(`({ roles: [...document.querySelectorAll('.agent-message .message-author b')].map((node) => node.textContent), artifactLink: document.querySelector('.message-artifact').textContent, running: !!document.querySelector('.conversation-run') })`);
  if (JSON.stringify(completedSessionUi.roles) !== JSON.stringify(['Novi', 'You', 'Novi', 'You', 'Novi']) || !completedSessionUi.artifactLink.includes('Open generated artifact') || completedSessionUi.running) throw new Error(`Completed Agent Session UI is incorrect: ${JSON.stringify(completedSessionUi)}`);
  await evaluate(`document.querySelector('[data-context-panel="files"]').click()`);
  await waitFor(`document.querySelector('[data-generated-document-id]')?.textContent.includes('llm-wiki.md')`);
  await evaluate(`document.querySelector('[data-generated-document-id]').click()`);
  await waitFor(`document.querySelector('.generated-document pre')?.textContent.includes('# Knowledge Base')`);
  const markdownPreview = await evaluate(`({ text: document.querySelector('.generated-document pre').textContent, renderedHeading: !!document.querySelector('.generated-document pre h1') })`);
  if (!markdownPreview.text.includes('## LLM Wiki') || markdownPreview.renderedHeading) throw new Error(`Generated Markdown preview is unsafe or incomplete: ${JSON.stringify(markdownPreview)}`);
  await evaluate(`document.querySelector('[data-context-panel="wiki"]').click()`);
  await waitFor(`document.querySelector('[data-artifact-tab="practice"]') !== null`);
  await evaluate(`(() => { window.prompt = () => 'Focused follow-up'; document.querySelector('#new-session').click(); })()`);
  await waitFor(`document.querySelectorAll('.session-item').length === 2 && document.querySelector('.conversation-panel h2').textContent === 'Focused follow-up'`);
  await evaluate(`(() => { window.confirm = () => true; document.querySelector('#delete-session').click(); })()`);
  await waitFor(`document.querySelectorAll('.session-item').length === 1 && document.querySelector('.message-artifact') !== null`);
  if (!await evaluate(`document.querySelector('[data-artifact-tab="practice"]') !== null`)) throw new Error('Knowledge Builder practice lab is unavailable');
  await evaluate(`document.querySelector('[data-artifact-tab="practice"]').click()`);
  await waitFor(`document.querySelector('.artifact-content').textContent.includes('Practice questions') && document.querySelector('.artifact-content').textContent.includes('Deliverable')`);
  if (!await evaluate(`document.querySelector('#delete-workspace') !== null`)) throw new Error('Workspace delete control is unavailable');
  if (await evaluate(`document.querySelector('#export-ieee') !== null || document.querySelector('#export-acm') !== null`)) throw new Error('Non-paper workspace must not expose LaTeX export');
  const viewerUi = await evaluate(`(async () => { const ui = await import('/app.js'); ui.state.role = 'viewer'; ui.applyRoleCapabilities(); ui.renderWorkspace(ui.state.activeProject); const result = { createHidden: document.querySelector('#new-project').hidden, providerHidden: document.querySelector('#model-settings').hidden, customizeHidden: document.querySelector('#customize-nav').hidden, generate: !!document.querySelector('#generate'), removeWorkspace: !!document.querySelector('#delete-workspace'), pin: !!document.querySelector('#pin-workspace'), ingest: !!document.querySelector('#ingest-document'), refresh: !!document.querySelector('#refresh-sources'), watch: !!document.querySelector('#toggle-watch'), browse: !!document.querySelector('#knowledge-library'), exportMarkdown: !!document.querySelector('#export-md'), conversation: !!document.querySelector('.conversation-panel'), composer: !!document.querySelector('#agent-composer'), newSession: !!document.querySelector('#new-session'), deleteSession: !!document.querySelector('#delete-session') }; ui.state.role = 'owner'; ui.applyRoleCapabilities(); ui.renderWorkspace(ui.state.activeProject); return result; })()`);
  if (!viewerUi.createHidden || !viewerUi.providerHidden || !viewerUi.customizeHidden || viewerUi.generate || viewerUi.removeWorkspace || viewerUi.pin || viewerUi.ingest || viewerUi.refresh || viewerUi.watch || !viewerUi.browse || !viewerUi.exportMarkdown || !viewerUi.conversation || viewerUi.composer || viewerUi.newSession || viewerUi.deleteSession) throw new Error(`Viewer UI capabilities are incorrect: ${JSON.stringify(viewerUi)}`);
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
  await waitFor(`document.querySelectorAll('#artifact-version option').length === 3`, 15_000);
  await waitFor(`document.querySelector('.artifact-knowledge-context') !== null && document.querySelector('.artifact-knowledge-context').textContent.includes('Browser security notes')`);
  await evaluate(`document.querySelector('#compare-version').click()`);
  await waitFor(`document.querySelector('.version-comparison') !== null`);
  const versionResult = await evaluate(`({ count: document.querySelectorAll('#artifact-version option').length, comparison: document.querySelector('.version-comparison').textContent })`);
  if (versionResult.count !== 3 || !versionResult.comparison.includes('Version 3 compared with Version 2') || !versionResult.comparison.includes('Workspace knowledge used')) throw new Error(`Artifact version comparison failed: ${JSON.stringify(versionResult)}`);
  const networkFetch = global.fetch;
  global.fetch = async (input) => {
    const url = String(input);
    if (url.startsWith('https://api.openalex.org/')) return new Response(JSON.stringify({ results: [{ id: 'https://openalex.org/W-browser-update', display_name: 'Browser continuous update paper', publication_year: 2026 }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ results: [], items: [], data: [], query: { search: [] }, message: { items: [] }, hits: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  let continuousUpdate;
  try {
    await evaluate(`document.querySelector('#refresh-sources').click()`);
    await waitFor(`document.querySelectorAll('#artifact-version option').length === 4`, 15_000);
    await evaluate(`document.querySelector('#show-snapshots').click()`);
    await waitFor(`!document.querySelector('#snapshot-modal').classList.contains('hidden') && document.querySelector('#snapshot-list').textContent.includes('Workspace updated')`);
    continuousUpdate = await evaluate(`({ versions: document.querySelectorAll('#artifact-version option').length, history: document.querySelector('#snapshot-list').textContent })`);
    if (continuousUpdate.versions !== 4 || !continuousUpdate.history.includes('Changed') || !continuousUpdate.history.includes('Workspace updated')) throw new Error(`Continuous update UI failed: ${JSON.stringify(continuousUpdate)}`);
    await evaluate(`document.querySelector('#snapshot-close').click()`);
  } finally { global.fetch = networkFetch; }
  await evaluate(`document.querySelector('#knowledge-library').click()`);
  await waitFor(`!document.querySelector('#knowledge-modal').classList.contains('hidden') && document.querySelector('[data-delete-document]') !== null`);
  await evaluate(`(() => { window.confirm = () => true; document.querySelector('[data-delete-document]').click(); })()`);
  await waitFor(`document.querySelector('#knowledge-results').textContent.includes('Wiki iteration') && !document.querySelector('#knowledge-results').textContent.includes('Browser security notes')`);
  const knowledgeDelete = await evaluate(`(async () => { const response = await fetch('/api/projects/' + encodeURIComponent(${JSON.stringify(knowledgeImport.projectId)}) + '/knowledge?q=adversarial%20recovery%20tests'); const payload = await response.json(); return { status: response.status, documents: payload.results.map((item) => item.document), retained: document.querySelector('.artifact-knowledge-context')?.textContent.includes('Browser security notes') || false }; })()`);
  if (knowledgeDelete.status !== 200 || knowledgeDelete.documents.includes('Browser security notes') || !knowledgeDelete.documents.some((title) => title.startsWith('Wiki iteration')) || !knowledgeDelete.retained) throw new Error(`Knowledge deletion failed: ${JSON.stringify(knowledgeDelete)}`);
  await evaluate(`document.querySelector('#knowledge-close').click()`);
  await waitFor(`document.querySelector('#knowledge-modal').classList.contains('hidden')`);
  if (process.env.NOVI_BROWSER_SCREENSHOT) {
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.NOVI_BROWSER_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  const result = await evaluate(`(async () => { const projects = await (await fetch('/api/projects')).json(); const project = projects.projects.find((item) => item.title === 'Browser smoke workspace'); const exportResponse = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/export?format=markdown'); return { title: project.title, status: project.status, exportStatus: exportResponse.status, exportText: await exportResponse.text() }; })()`);
  if (result.title !== 'Browser smoke workspace' || result.status !== 'ready' || result.exportStatus !== 200 || !result.exportText.includes('# Knowledge Base')) throw new Error(`Unexpected browser journey result: ${JSON.stringify(result)}`);
  await evaluate(`(async () => { const created = await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Browser paper figures', topic: 'Knowledge systems', type: 'paper', wikiLanguage: 'en' }) })).json(); await fetch('/api/projects/' + encodeURIComponent(created.project.id) + '/generate', { method: 'POST' }); location.reload(); })()`);
  await waitFor(`document.readyState === 'complete' && [...document.querySelectorAll('[data-project]')].some((card) => card.textContent.includes('Browser paper figures'))`);
  await evaluate(`[...document.querySelectorAll('[data-project]')].find((card) => card.textContent.includes('Browser paper figures')).click()`);
  await waitFor(`document.querySelector('[data-artifact-tab="figures"]') !== null`);
  await evaluate(`document.querySelector('[data-artifact-tab="figures"]').click()`);
  await waitFor(`document.querySelector('.figure-svg') !== null`);
  if (!await evaluate(`document.querySelector('[data-artifact-tab="wiki"]') !== null && document.querySelector('[data-artifact-tab="novelty"]') !== null && document.querySelector('[data-artifact-tab="sources"]') !== null && document.querySelector('#export-ieee') !== null && document.querySelector('#export-acm') !== null`)) throw new Error('Paper LLM Wiki, gap/novelty, sources, or publication template export is unavailable');
  await evaluate(`document.querySelector('[data-artifact-tab="wiki"]').click()`);
  await waitFor(`['Expert Goal', 'Coordinated experts', 'Knowledge system', 'System document', 'Final Wiki'].every((label) => document.querySelector('.artifact-content').textContent.includes(label))`);
  await evaluate(`document.querySelector('[data-artifact-tab="novelty"]').click()`);
  await waitFor(`document.querySelector('.artifact-content').textContent.includes('Research gap discovery') && document.querySelector('.artifact-content').textContent.includes('Falsification test') && document.querySelector('.artifact-content').textContent.includes('Novelty analysis')`);
  const publicationTemplates = await evaluate(`(async () => { const projects = await (await fetch('/api/projects')).json(); const project = projects.projects.find((item) => item.title === 'Browser paper figures'); const ieee = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/export?format=latex&template=ieee'); const acm = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/export?format=latex&template=acm'); return { ieeeStatus: ieee.status, ieee: await ieee.text(), acmStatus: acm.status, acm: await acm.text() }; })()`);
  if (publicationTemplates.ieeeStatus !== 200 || publicationTemplates.acmStatus !== 200 || !publicationTemplates.ieee.startsWith('\\documentclass[conference]{IEEEtran}') || !publicationTemplates.acm.startsWith('\\documentclass[sigconf]{acmart}')) throw new Error(`Publication template export failed: ${JSON.stringify(publicationTemplates).slice(0, 500)}`);
  await evaluate(`(async () => { const created = await (await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Browser deep research suite', topic: 'Knowledge systems', type: 'research', wikiLanguage: 'en' }) })).json(); const generated = await fetch('/api/projects/' + encodeURIComponent(created.project.id) + '/generate', { method: 'POST' }); if (!generated.ok) throw new Error('Research generation failed: ' + generated.status); location.reload(); })()`);
  await waitFor(`document.readyState === 'complete' && [...document.querySelectorAll('[data-project]')].some((card) => card.textContent.includes('Browser deep research suite'))`);
  await evaluate(`[...document.querySelectorAll('[data-project]')].find((card) => card.textContent.includes('Browser deep research suite')).click()`);
  await waitFor(`document.querySelector('[data-artifact-tab="wiki"]') !== null && document.querySelector('[data-artifact-tab="graph"]') !== null && document.querySelector('[data-artifact-tab="sota"]') !== null`);
  await evaluate(`document.querySelector('[data-artifact-tab="wiki"]').click()`);
  await waitFor(`document.querySelector('.artifact-content').textContent.includes('Interview preparation') && document.querySelector('.artifact-content').textContent.includes('Capstone project')`);
  await evaluate(`document.querySelector('[data-artifact-tab="graph"]').click()`);
  await waitFor(`document.querySelectorAll('.artifact-content .node').length >= 10`);
  console.log(`browser-smoke: created=${result.title}, status=${result.status}, pricing=ready, agent-session=ready, conversation-wiki=versioned, agent-mode=${activeMode}, agent-skills=ready, agent-plugins=ready, viewer-ui=ready, knowledge-search=ready, rag-context=ready, versions=${versionResult.count}, comparison=ready, continuous-update=ready, knowledge-delete=ready, markdown-export=${result.exportStatus}, paper-svg=ready, expert-wiki=ready, paper-gap=ready, publication-templates=ready, research-suite=ready`);
} finally {
  socket.close(); chrome.kill('SIGTERM'); await new Promise((resolve) => server.close(resolve)); await new Promise((resolve) => modelServer.close(resolve));
  for (const [key, value] of Object.entries(previous)) { const name = { auth: 'NOVI_AUTH_REQUIRED', worker: 'NOVI_JOB_WORKER', refresh: 'NOVI_REFRESH_WORKER', verify: 'NOVI_VERIFY_SOURCES', file: 'NOVI_DATA_FILE' }[key]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
