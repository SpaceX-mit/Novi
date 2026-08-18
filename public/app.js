import { marked } from '/vendor/marked.esm.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { projects: [], activeProject: null, activeTab: 'overview', activeArtifactId: null, compareVersions: false, role: 'viewer', providerSettings: null, toolSettings: null, mcpSettings: null, skillSettings: null, pluginSettings: null, customizeTab: 'tools', activeJob: null, sessions: [], activeSessionId: null, activeSession: null, sessionProjectId: null, workspaceKnowledge: null, contextPanel: 'wiki', activeDocumentId: null, documentViewMode: 'preview', monitoringJobId: null, composerDraft: '', composerMode: 'auto', composerLanguage: 'zh-CN' };
let authRegister = false;
const roleRank = Object.freeze({ viewer: 10, editor: 20, admin: 30, owner: 40 });
const canRole = (required) => (roleRank[state.role] || 0) >= roleRank[required];

function applyRoleCapabilities() {
  const editor = canRole('editor');
  for (const id of ['new-project', 'heading-new', 'empty-new']) { const node = $(`#${id}`); if (node) node.hidden = !editor; }
  $$('.nav-tab').filter((tab) => tab.dataset.view !== 'overview').forEach((tab) => { tab.hidden = !editor; });
  $('#billing-upgrade').hidden = !canRole('admin');
  $('#model-settings').hidden = !canRole('admin');
  $('#customize-nav').hidden = !canRole('admin');
  if (!canRole('admin')) $('#billing-modal')?.classList.add('hidden');
  if (!canRole('admin')) $('#provider-modal')?.classList.add('hidden');
}

const typeMeta = {
  knowledge: { label: 'KNOWLEDGE BUILDER', color: 'knowledge' },
  research: { label: 'DEEP RESEARCH', color: 'research' },
  paper: { label: 'PAPER AUTHOR', color: 'paper' },
};
const wikiLanguages = [['zh-CN', '简体中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['pt-BR', 'Português (Brasil)']];

async function request(path, options = {}) {
  // Browser sessions use the HttpOnly SameSite cookie set by the server. Bearer
  // tokens remain supported for external/API clients but are never persisted by
  // the web UI (avoiding localStorage exposure to XSS).
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Novi-Client': 'web', ...(options.headers || {}) }, ...options });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== '/api/auth/me' && path !== '/api/auth/login') $('#auth-modal').classList.remove('hidden');
    throw new Error(payload.error || 'Something went wrong');
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('json') ? response.json() : response.text();
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show');
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function openModal(type = 'knowledge') {
  if (!canRole('editor')) return showToast('Editor access is required to create a workspace');
  $('#modal').classList.remove('hidden');
  const radio = $(`input[name="type"][value="${type}"]`); if (radio) radio.checked = true;
  $('[name="title"]').focus();
}
function closeModal() { $('#modal').classList.add('hidden'); $('#form-error').textContent = ''; }

function renderProjects() {
  const grid = $('#project-grid');
  $('#metric-projects').textContent = state.projects.length;
  $('#metric-artifacts').textContent = state.projects.reduce((total, p) => total + p.artifacts.length, 0);
  $('#empty-state').classList.toggle('show', !state.projects.length);
  if (!state.projects.length) { grid.innerHTML = ''; return; }
  grid.innerHTML = state.projects.map((project) => {
    const meta = typeMeta[project.type];
    return `<article class="project-card" data-project="${project.id}">
      <div class="card-top"><span class="type-label ${meta.color}">${meta.label}</span>${canRole('editor') ? `<button class="pin ${project.pinned ? 'active' : ''}" data-pin="${project.id}" title="${project.pinned ? 'Unpin workspace' : 'Pin workspace'}">${project.pinned ? '★' : '☆'}</button>` : ''}</div>
      <h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.topic)}</p>
      <div class="card-footer"><span>${formatDate(project.updatedAt)}</span><span class="card-status ${project.status}">${project.status === 'ready' ? '● Ready' : project.status === 'generating' ? '◌ Generating' : '○ Draft'}</span></div>
    </article>`;
  }).join('');
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function safeExternalUrl(value) { try { const url = new URL(String(value)); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '#'; } catch { return '#'; } }

const markdownTags = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'EM', 'A', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DEL', 'BR']);

function renderMarkdown(value) {
  const template = document.createElement('template');
  template.innerHTML = marked.parse(String(value || ''), { gfm: true, breaks: false });
  for (const node of [...template.content.querySelectorAll('*')]) {
    if (!markdownTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ''));
      continue;
    }
    const href = node.tagName === 'A' ? String(node.getAttribute('href') || '') : '';
    const languageClass = node.tagName === 'CODE' && /^language-[a-z0-9_-]+$/iu.test(node.className) ? node.className : '';
    for (const attribute of [...node.attributes]) node.removeAttribute(attribute.name);
    if (languageClass) node.className = languageClass;
    if (node.tagName === 'A') {
      const documentName = decodeURIComponent(href.replace(/^\.\//u, ''));
      if (/^[a-z0-9][a-z0-9._-]*\.md$/iu.test(documentName)) {
        node.href = '#'; node.dataset.markdownDocument = documentName;
      } else {
        const safeHref = safeExternalUrl(href);
        if (safeHref !== '#') { node.href = safeHref; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
      }
    }
  }
  return template.innerHTML;
}
function renderFigureSvg(figure) {
  const nodes = new Map((figure.nodes || []).slice(0, 12).map((node) => [String(node.id), { label: String(node.label || node.id), x: Math.max(0, Math.min(550, Number(node.x) || 0)), y: Math.max(0, Math.min(176, Number(node.y) || 0)) }]));
  if (!nodes.size) return `<pre class="figure-diagram">${escapeHtml(figure.diagram || '')}</pre>`;
  const marker = `arrow-${String(figure.id || 'figure').replace(/[^a-z0-9_-]/gi, '')}`;
  const edges = (figure.edges || []).slice(0, 24).map((edge) => {
    const source = nodes.get(String(edge.source)); const target = nodes.get(String(edge.target)); if (!source || !target) return '';
    return `<line x1="${source.x + 65}" y1="${source.y + 22}" x2="${target.x + 65}" y2="${target.y + 22}" marker-end="url(#${marker})" />`;
  }).join('');
  const boxes = [...nodes.values()].map((node) => `<g><rect x="${node.x}" y="${node.y}" width="130" height="44" rx="7" /><text x="${node.x + 65}" y="${node.y + 27}" text-anchor="middle">${escapeHtml(node.label)}</text></g>`).join('');
  return `<svg class="figure-svg" viewBox="0 0 680 220" role="img" aria-label="${escapeHtml(figure.caption)}"><defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" /></marker></defs>${edges}${boxes}</svg>`;
}
function formatDate(date) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date)); }

function formatDateTime(date) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}

function updateAgentRunStatus(job) {
  if (!job) return;
  const mode = $('#agent-run-mode'); const stage = $('#agent-run-stage'); const progress = $('#agent-run-progress');
  if (mode) mode.textContent = job.currentModeLabel || job.currentMode || 'Routing';
  if (stage) stage.textContent = job.currentStage || (job.status === 'queued' ? 'Queued' : 'Preparing');
  if (progress) progress.textContent = `${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`;
}

function renderVersionToolbar(project, artifactIndex) {
  const artifacts = project.artifacts || [];
  const options = artifacts.map((artifact, index) => {
    const version = artifacts.length - index;
    return `<option value="${escapeHtml(artifact.id)}" ${index === artifactIndex ? 'selected' : ''}>Version ${version}${index === 0 ? ' · Latest' : ''} · ${escapeHtml(formatDateTime(artifact.createdAt))}</option>`;
  }).join('');
  const canCompare = Boolean(artifacts[artifactIndex + 1]);
  return `<div class="version-toolbar"><label for="artifact-version"><span>Artifact history</span><select id="artifact-version">${options}</select></label><button class="secondary-button" id="compare-version" ${canCompare ? '' : 'disabled'}>${state.compareVersions && canCompare ? 'Close comparison' : 'Compare with previous'}</button><small>${artifacts.length} immutable version${artifacts.length === 1 ? '' : 's'}</small></div>`;
}

function comparableArtifactFields(artifact) {
  const c = artifact?.content || {};
  const fields = new Map();
  const add = (label, value) => {
    const normalized = Array.isArray(value) ? value.filter(Boolean).join('\n') : String(value || '').trim();
    if (normalized) fields.set(label, normalized);
  };
  add('Summary', c.summary);
  add('Abstract', c.abstract);
  add('Expert Goal', c.expertGoal ? `${c.expertGoal.question}\n${c.expertGoal.outcome}\n${(c.expertGoal.successCriteria || []).join('\n')}` : '');
  add('Expert roles', (c.expertRoles || []).map((role) => `${role.title}: ${role.responsibility}`));
  add('Knowledge system', (c.knowledgeSystem?.layers || []).map((layer) => `${layer.title}: ${layer.objective}; dependencies: ${(layer.dependencies || []).join(', ')}`));
  add('System document', (c.systemDocument?.sections || []).map((section) => `${section.title}: ${section.body}`));
  add('LLM Wiki summary', c.llmWiki?.summary);
  for (const section of c.sections || []) add(`Section · ${section.title}`, section.body);
  for (const section of c.wikiSections || []) add(`Wiki · ${section.title}`, section.body);
  add('Contributions', c.contributions);
  add('Research gaps', (c.researchGaps || []).map((item) => `${item.gap}; evidence: ${item.evidenceNeeded}; test: ${item.test}`));
  add('Novelty analysis', (c.noveltyAnalysis || []).map((item) => `${item.dimension}: ${item.differentiation}; baseline: ${item.baseline}; risk: ${item.risk}`));
  add('Method', c.method);
  add('Research opportunities', c.opportunities);
  add('Learning path', (c.learningPath || []).map((item) => `${item.stage}: ${item.outcome}`));
  add('Case studies', (c.caseStudies || []).map((item) => `${item.title}: ${item.scenario}; deliverable: ${item.deliverable}`));
  add('Practice questions', (c.practiceQuestions || []).map((item) => `${item.level}: ${item.question}; success: ${item.successCriteria}`));
  add('State of the art', (c.sota || []).map((item) => `${item.dimension}: ${item.finding} (${item.confidence})`));
  add('Experiments', (c.experiments || []).map((item) => `${item.name}: ${item.purpose}; ${item.metric}`));
  add('Review', (c.review || []).map((item) => `${item.area}: ${item.verdict}; ${item.note}`));
  add('Figures', (c.figures || []).map((item) => `${item.caption}: ${item.purpose}`));
  add('Workflow', (artifact?.workflow?.agents || []).map((agent) => `${agent.order}. ${agent.name}: ${agent.status}`));
  add('Workspace knowledge used', (c.knowledgeContext || []).map((item) => `${item.document}: ${item.excerpt} (${item.relevanceScore})`));
  add('Mapped source URLs', (c.sources || []).map((item) => item.url).filter(Boolean).sort());
  return fields;
}

function renderVersionComparison(project, artifactIndex) {
  const artifacts = project.artifacts || [];
  const current = artifacts[artifactIndex];
  const previous = artifacts[artifactIndex + 1];
  if (!current || !previous) return '';
  const currentFields = comparableArtifactFields(current);
  const previousFields = comparableArtifactFields(previous);
  const keys = [...new Set([...currentFields.keys(), ...previousFields.keys()])];
  const changed = keys.filter((key) => currentFields.get(key) !== previousFields.get(key));
  const visibleChanges = changed.slice(0, 20);
  const currentVersion = artifacts.length - artifactIndex;
  const previousVersion = currentVersion - 1;
  const currentSources = current.content?.evidence?.sources?.length || 0;
  const previousSources = previous.content?.evidence?.sources?.length || 0;
  const rows = visibleChanges.map((key) => `<article class="version-change"><h4>${escapeHtml(key)}</h4><div><section><b>Version ${previousVersion}</b><p>${escapeHtml(previousFields.get(key) || 'Not present')}</p></section><section><b>Version ${currentVersion}</b><p>${escapeHtml(currentFields.get(key) || 'Removed')}</p></section></div></article>`).join('');
  const omitted = changed.length > visibleChanges.length ? `<p class="comparison-omitted">${changed.length - visibleChanges.length} additional changed sections are omitted from this preview. Export both versions for full review.</p>` : '';
  return `<section class="version-comparison" aria-live="polite"><div class="comparison-head"><div><p class="eyebrow">VERSION COMPARISON</p><h2>Version ${currentVersion} compared with Version ${previousVersion}</h2></div><div class="comparison-metrics"><span><b>${changed.length}</b> changed sections</span><span><b>${previousSources} → ${currentSources}</b> mapped sources</span></div></div>${rows || '<div class="comparison-empty"><b>No content changes</b><p>The regenerated artifact matches the previous version. Creation time and immutable version ID are still preserved.</p></div>'}${omitted}</section>`;
}

function showOverview() {
  state.activeProject = null;
  $('#view-overview').classList.add('active-view'); $('#view-workspace').classList.remove('active-view'); $('#view-customize').classList.remove('active-view');
  $('#page-label').textContent = 'Overview';
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === 'overview'));
  renderProjects();
}

function showWorkspace(project) {
  const sameProject = state.activeProject?.id === project.id;
  if (!sameProject || !(project.artifacts || []).some((artifact) => artifact.id === state.activeArtifactId)) {
    state.activeArtifactId = project.artifacts?.[0]?.id || null;
    state.compareVersions = false;
  }
  state.activeProject = project;
  $('#view-overview').classList.remove('active-view'); $('#view-customize').classList.remove('active-view'); $('#view-workspace').classList.add('active-view');
  $('#page-label').textContent = project.title;
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === project.type));
  if (state.sessionProjectId !== project.id) {
    state.sessionProjectId = project.id; state.sessions = []; state.activeSessionId = null; state.activeSession = null; state.workspaceKnowledge = null; state.contextPanel = 'wiki'; state.activeDocumentId = null; state.composerDraft = ''; state.composerMode = 'auto'; state.composerLanguage = project.wikiLanguage || 'zh-CN';
    void loadAgentWorkspace(project.id);
  }
  renderWorkspace(project);
}

function sessionModeLabel(mode) {
  return ({ auto: 'Auto', workflow: 'Workflow', react: 'ReAct', 'plan-execute': 'Plan & Execute', supervisor: 'Supervisor' })[mode] || mode || 'Auto';
}

async function loadAgentWorkspace(projectId, preferredSessionId = null) {
  try {
    const [sessionResult, knowledge] = await Promise.all([
      request(`/api/projects/${projectId}/sessions`),
      request(`/api/projects/${projectId}/knowledge`),
    ]);
    if (state.activeProject?.id !== projectId) return;
    state.sessions = sessionResult.sessions || [];
    const selectedId = preferredSessionId || (state.sessions.some((item) => item.id === state.activeSessionId) ? state.activeSessionId : state.sessions[0]?.id);
    state.activeSessionId = selectedId || null; state.workspaceKnowledge = knowledge;
    state.activeSession = selectedId ? (await request(`/api/projects/${projectId}/sessions/${selectedId}`)).session : null;
    if (state.activeProject?.id !== projectId) return;
    renderWorkspace(state.activeProject, state.activeTab);
    const run = state.activeSession?.activeRun;
    if (run?.jobId && !String(run.jobId).startsWith('sync:') && state.monitoringJobId !== run.jobId) {
      const current = await request(`/api/jobs/${run.jobId}`).catch(() => null);
      if (current?.job && ['queued', 'running'].includes(current.job.status)) void (current.job.type === 'refine' ? monitorConversation(projectId, current.job, selectedId, false) : monitorGeneration(projectId, current.job, selectedId, false));
    }
  } catch (error) { if (state.activeProject?.id === projectId) showToast(error.message); }
}

async function selectAgentSession(projectId, sessionId) {
  try {
    state.activeSessionId = sessionId; state.composerDraft = ''; state.composerMode = 'auto';
    state.activeSession = (await request(`/api/projects/${projectId}/sessions/${sessionId}`)).session;
    renderWorkspace(state.activeProject, state.activeTab);
  } catch (error) { showToast(error.message); }
}

async function createAgentSessionUi(projectId) {
  if (!canRole('editor')) return showToast('Editor access is required to create a session');
  const title = window.prompt('Session name', `Session ${state.sessions.length + 1}`);
  if (title === null) return;
  try {
    const result = await request(`/api/projects/${projectId}/sessions`, { method: 'POST', body: JSON.stringify({ title: title.trim() }) });
    state.activeSessionId = result.session.id; state.activeSession = result.session; state.sessions = result.sessions || []; state.composerDraft = ''; state.composerMode = 'auto';
    renderWorkspace(state.activeProject, state.activeTab); $('#agent-prompt')?.focus();
  } catch (error) { showToast(error.message); }
}

async function deleteAgentSessionUi(projectId, sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session || session.status === 'running') return showToast('An active session cannot be deleted');
  if (!window.confirm(`Delete “${session.title}” and its conversation?`)) return;
  try {
    await request(`/api/projects/${projectId}/sessions/${sessionId}`, { method: 'DELETE' });
    state.activeSession = null; state.activeSessionId = null;
    await loadAgentWorkspace(projectId);
    showToast('Session deleted');
  } catch (error) { showToast(error.message); }
}

function renderSessionRail(project) {
  const items = state.sessions.map((session) => `<button class="session-item ${session.id === state.activeSessionId ? 'active' : ''}" data-session-id="${escapeHtml(session.id)}"><span>${escapeHtml(session.title)}</span><small>${session.status === 'running' ? `${sessionModeLabel(session.activeRun?.currentMode)} · ${Number(session.activeRun?.progress || 0)}%` : `${session.messageCount} messages`}</small></button>`).join('');
  return `<aside class="session-rail"><div class="session-rail-head"><span>Sessions</span>${canRole('editor') ? '<button id="new-session" title="New session" aria-label="New session">+</button>' : ''}</div><div class="session-list">${items || '<p>Loading sessions...</p>'}</div>${canRole('editor') && state.activeSession ? `<button class="session-delete" id="delete-session" ${state.activeSession.status === 'running' ? 'disabled' : ''}>Delete session</button>` : ''}</aside>`;
}

function renderAgentMessage(message) {
  const isUser = message.role === 'user';
  const meta = [message.mode ? sessionModeLabel(message.mode) : '', message.status || '', formatDateTime(message.createdAt)].filter(Boolean).join(' · ');
  const tools = (message.toolCalls || []).map((call) => `<span class="message-tool ${call.status}">${escapeHtml(call.label || call.tool)} · ${escapeHtml(call.status)}</span>`).join('');
  const skills = (message.skills || []).map((skill) => `<span class="message-skill">${escapeHtml(skill.title || skill.name)}</span>`).join('');
  const plugins = (message.plugins || []).map((plugin) => `<span class="message-plugin">${escapeHtml(plugin.title || plugin.name)} ${escapeHtml(plugin.version || '')}</span>`).join('');
  return `<article class="agent-message ${isUser ? 'user' : 'assistant'} ${message.kind || 'message'}"><div class="message-author"><b>${isUser ? 'You' : 'Novi'}</b><span>${escapeHtml(meta)}</span></div><p>${escapeHtml(message.content)}</p>${plugins ? `<div class="message-plugins">${plugins}</div>` : ''}${skills ? `<div class="message-skills">${skills}</div>` : ''}${tools ? `<div class="message-tools">${tools}</div>` : ''}${renderRunEvents(message.runEvents, 'Run details')}${message.artifactId ? `<button class="message-artifact" data-artifact-id="${escapeHtml(message.artifactId)}">Open generated artifact</button>` : ''}</article>`;
}

function eventDetail(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return escapeHtml(value);
  try { return escapeHtml(JSON.stringify(value, null, 2)); } catch { return '[unavailable]'; }
}

function renderRunEvent(event) {
  const status = String(event.status || 'completed');
  const eventId = String(event.id || `${event.type || 'activity'}:${event.createdAt || event.title || ''}`);
  const detail = [
    event.summary ? `<p>${escapeHtml(event.summary)}</p>` : '',
    event.request !== undefined ? `<div><b>Request</b><pre>${eventDetail(event.request)}</pre></div>` : '',
    event.response !== undefined ? `<div><b>Response</b><pre>${eventDetail(event.response)}</pre></div>` : '',
    event.input !== undefined ? `<div><b>Input</b><pre>${eventDetail(event.input)}</pre></div>` : '',
    event.output !== undefined ? `<div><b>Output</b><pre>${eventDetail(event.output)}</pre></div>` : '',
    event.warning ? `<div class="run-event-warning"><b>Warning</b><pre>${escapeHtml(event.warning)}</pre></div>` : '',
    event.error ? `<div class="run-event-error"><b>Error</b><pre>${escapeHtml(event.error)}</pre></div>` : '',
    event.usage ? `<small>Tokens: ${eventDetail(event.usage)}</small>` : '',
  ].join('');
  const meta = [event.actor, event.mode, event.stageId, formatDateTime(event.createdAt)].filter(Boolean).join(' · ');
  const open = event.type !== 'tool';
  return `<details class="run-event ${escapeHtml(status)}" data-event-id="${escapeHtml(eventId)}" ${open ? 'open' : ''}><summary><span class="run-event-type">${escapeHtml(event.type || 'activity')}</span><b>${escapeHtml(event.title || 'Agent activity')}</b><small>${escapeHtml(meta)}</small><i>${escapeHtml(status)}</i></summary><div class="run-event-body">${detail || '<p>No additional detail.</p>'}</div></details>`;
}

function renderRunEvents(events, title = 'Agent run details') {
  if (!events?.length) return '';
  return `<section class="run-events"><header><b>${escapeHtml(title)}</b><small>${events.length} events</small></header><div class="run-event-list">${events.map(renderRunEvent).join('')}</div></section>`;
}

function renderLiveGoal(run) {
  if (!run?.expertGoal) return '';
  return `<section class="live-goal"><span>GOAL</span><b>${escapeHtml(run.expertGoal.question)}</b><p>${escapeHtml(run.expertGoal.outcome)}</p>${run.referenceDiscovery ? `<small>References: ${escapeHtml(run.referenceDiscovery.status)} · ${Number(run.referenceDiscovery.sourceCount || 0)} sources${run.referenceDiscovery.sourceKinds?.length ? ` · ${escapeHtml(run.referenceDiscovery.sourceKinds.join(', '))}` : ''}</small>` : '<small>Goal ready · reference discovery follows</small>'}</section>`;
}

function renderConversation(project) {
  const session = state.activeSession;
  const messages = session?.messages || [];
  const run = session?.activeRun;
  const busy = project.status === 'generating' || session?.status === 'running';
  const editor = canRole('editor');
  const modes = [['auto', 'Auto'], ['workflow', 'Workflow'], ['react', 'ReAct'], ['plan-execute', 'Plan & Execute'], ['supervisor', 'Supervisor']];
  const runSkills = [...(run?.plugins || []).map((plugin) => plugin.title || plugin.name), ...(run?.skills || []).map((skill) => skill.title || skill.name)].join(', ');
  const liveGoal = renderLiveGoal(run);
  return `<section class="conversation-panel"><header><div><p class="eyebrow">AGENT SESSION</p><h2>${escapeHtml(session?.title || 'Loading session')}</h2></div>${run ? `<div class="conversation-run" id="conversation-run"><b id="conversation-run-mode">${escapeHtml(sessionModeLabel(run.currentMode))}</b><span id="conversation-run-stage">${escapeHtml(run.currentStage || 'Preparing')}</span>${runSkills ? `<span class="conversation-run-skills">${escapeHtml(runSkills)}</span>` : ''}<small id="conversation-run-progress">${Number(run.progress || 0)}%</small></div>` : ''}</header><div class="conversation-messages" id="conversation-messages" aria-live="polite">${messages.map(renderAgentMessage).join('') || '<div class="conversation-loading">Loading conversation...</div>'}${liveGoal}${runEventsSection(run?.runEvents)}</div>${!project.artifacts?.length && editor ? `<button class="primary-button generate-now" id="generate-empty" ${busy ? 'disabled' : ''}>${busy ? 'Generating...' : 'Generate now'}</button>` : ''}${editor ? `<form class="agent-composer" id="agent-composer"><textarea id="agent-prompt" name="prompt" rows="2" maxlength="20000" placeholder="Ask Novi to research and improve this Wiki..." ${busy || !session ? 'disabled' : ''}>${escapeHtml(state.composerDraft)}</textarea><div><label>Execution mode<select id="agent-mode" name="mode" ${busy ? 'disabled' : ''}>${modes.map(([value, label]) => `<option value="${value}" ${state.composerMode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Wiki language<select id="wiki-language" name="language" ${busy ? 'disabled' : ''}>${wikiLanguages.map(([value, label]) => `<option value="${value}" ${state.composerLanguage === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="composer-send" type="submit" title="Research and update Wiki" aria-label="Research and update Wiki" ${busy || !session ? 'disabled' : ''}>↑</button></div></form>` : '<p class="conversation-readonly">Viewer access is read only.</p>'}</section>`;
}

function runEventsSection(events) {
  if (!events?.length) return '';
  return `<section class="live-events" id="live-events"><header><b>Live Agent activity</b><small>${events.length} events</small></header><div>${events.map(renderRunEvent).join('')}</div></section>`;
}

function renderDocumentViewer(artifact) {
  const generated = (artifact?.documents || []).find((item) => item.id === state.activeDocumentId);
  if (generated) {
    const sourceMode = state.documentViewMode === 'source';
    return `<article class="document-viewer generated-document"><span>${escapeHtml(generated.mediaType)} · ${escapeHtml(generated.language || artifact.language || 'en')}</span><h3>${escapeHtml(generated.name)}</h3><div class="document-view-switch" role="group" aria-label="Document view"><button data-document-view-mode="preview" class="${sourceMode ? '' : 'active'}">Preview</button><button data-document-view-mode="source" class="${sourceMode ? 'active' : ''}">Source</button></div>${sourceMode ? `<pre class="markdown-source">${escapeHtml(generated.content || '')}</pre>` : `<div class="markdown-document">${renderMarkdown(generated.content || '')}</div>`}</article>`;
  }
  const knowledge = state.workspaceKnowledge || { documents: [], chunks: [] };
  const document = knowledge.documents?.find((item) => item.id === state.activeDocumentId) || knowledge.documents?.[0];
  if (!document) return '<div class="context-empty"><b>No document selected</b><p>Import notes or a public URL to inspect it here.</p></div>';
  const chunks = (knowledge.chunks || []).filter((item) => item.documentId === document.id).slice(0, 12);
  return `<article class="document-viewer"><span>${escapeHtml(document.sourceKind || 'text')} · ${document.chunkCount || chunks.length} chunks</span><h3>${escapeHtml(document.title)}</h3>${document.sourceUrl ? `<a href="${escapeHtml(safeExternalUrl(document.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open source</a>` : ''}<div>${chunks.map((chunk) => `<p>${escapeHtml(chunk.text || '')}</p>`).join('') || '<p>No indexed passages.</p>'}</div></article>`;
}

function renderContextBody(project, artifact, artifactIndex, selected) {
  const knowledge = state.workspaceKnowledge || { documents: [] };
  if (state.contextPanel === 'files') {
    const generated = (artifact?.documents || []).map((document) => `<button data-generated-document-id="${escapeHtml(document.id)}"><span>${escapeHtml(document.name)}</span><small>${escapeHtml(document.role === 'deep-dive' ? 'Technical Deep Dive' : document.role === 'goal' ? 'Research Goal' : 'LLM Wiki summary')} · ${escapeHtml(document.language || artifact.language || 'en')}</small></button>`).join('');
    const imported = (knowledge.documents || []).map((document) => `<button data-document-id="${escapeHtml(document.id)}"><span>${escapeHtml(document.title)}</span><small>${escapeHtml(document.sourceKind || 'text')} · ${document.chunkCount || 0} chunks</small></button>`).join('');
    return generated || imported ? `<div class="context-file-list">${generated}${imported}</div>` : '<div class="context-empty"><b>No files yet</b><p>Generate a Wiki or import notes, web pages, PDFs, or a GitHub repository.</p></div>';
  }
  if (state.contextPanel === 'document') return renderDocumentViewer(artifact);
  if (!artifact) return '<div class="context-empty"><b>No artifact yet</b><p>Send a request in this Session to create the first knowledge asset.</p></div>';
  const tabs = tabsFor(project.type); const c = artifact.content;
  const toolCalls = artifact.workflow?.runtime?.toolCalls || [];
  const skills = artifact.workflow?.runtime?.skills || [];
  const plugins = artifact.workflow?.runtime?.plugins || [];
  const toolProvenance = toolCalls.length ? `<section class="tool-provenance"><h3>Tool activity</h3>${toolCalls.map((call) => `<div><b>${escapeHtml(call.label || call.tool)}</b><span class="${call.status}">${escapeHtml(call.status)}</span><small>${escapeHtml(formatDateTime(call.completedAt || call.startedAt))}</small></div>`).join('')}</section>` : '';
  const skillProvenance = skills.length ? `<section class="skill-provenance"><h3>Applied skills</h3>${skills.map((skill) => `<div><b>${escapeHtml(skill.title || skill.name)}</b><span>${escapeHtml(skill.matchReason || skill.activation)}</span><small>${escapeHtml(String(skill.instructionHash || '').slice(0, 12))}</small></div>`).join('')}</section>` : '';
  const pluginProvenance = plugins.length ? `<section class="skill-provenance plugin-provenance"><h3>Applied plugins</h3>${plugins.map((plugin) => `<div><b>${escapeHtml(plugin.title || plugin.name)} ${escapeHtml(plugin.version)}</b><span>${escapeHtml(plugin.matchReason || plugin.activation)}</span><small>${escapeHtml(String(plugin.manifestHash || '').slice(0, 12))}</small></div>`).join('')}</section>` : '';
  return `${renderVersionToolbar(project, artifactIndex)}${state.compareVersions && project.artifacts[artifactIndex + 1] ? renderVersionComparison(project, artifactIndex) : ''}<div class="artifact-panel"><div class="artifact-tabs">${tabs.map((tab) => `<button class="artifact-tab ${selected === tab.key ? 'active' : ''}" data-artifact-tab="${tab.key}">${tab.label}</button>`).join('')}</div><div class="artifact-content">${renderArtifact(project, selected, c)}</div></div>${pluginProvenance}${skillProvenance}${toolProvenance}`;
}

function renderWorkspace(project, selected = state.activeTab) {
  const artifacts = project.artifacts || [];
  let artifactIndex = artifacts.findIndex((item) => item.id === state.activeArtifactId);
  if (artifactIndex < 0) artifactIndex = 0;
  const artifact = artifacts[artifactIndex];
  if (artifact) state.activeArtifactId = artifact.id;
  const c = artifact?.content;
  const activeJob = state.activeJob?.projectId === project.id && ['queued', 'running'].includes(state.activeJob.status) ? state.activeJob : null;
  const workspaceBusy = project.status === 'generating' || state.activeSession?.status === 'running';
  const meta = typeMeta[project.type];
  const availableTabs = tabsFor(project.type);
  const editor = canRole('editor'); const administrator = canRole('admin');
  if (!availableTabs.some((tab) => tab.key === selected)) selected = availableTabs[0].key;
  state.activeTab = selected;
  $('#workspace-root').innerHTML = `<button class="back-link" id="back-overview">← All workspaces</button>
    <div class="workspace-head"><div><span class="type-label ${meta.color}">${meta.label}</span><h1>${escapeHtml(project.title)}</h1><p>${escapeHtml(project.topic)}</p>${activeJob || workspaceBusy ? `<div class="agent-run-strip" id="agent-run-status" aria-live="polite"><span>ACTIVE MODE</span><b id="agent-run-mode">${escapeHtml(activeJob?.currentModeLabel || activeJob?.currentMode || 'Routing')}</b><i></i><strong id="agent-run-stage">${escapeHtml(activeJob?.currentStage || 'Preparing')}</strong><small id="agent-run-progress">${Number(activeJob?.progress || 0)}%</small></div>` : ''}</div><div class="workspace-actions">${editor ? `<button class="secondary-button" id="pin-workspace">${project.pinned ? '★ Pinned' : '☆ Pin'}</button>` : ''}${artifact ? `<button class="secondary-button" id="export-md">↓ Markdown</button>${project.type === 'paper' ? '<button class="secondary-button" id="export-ieee">↓ IEEE LaTeX</button><button class="secondary-button" id="export-acm">↓ ACM LaTeX</button>' : ''}` : ''}${administrator ? '<button class="secondary-button danger-button" id="delete-workspace">Delete</button>' : ''}${editor ? `<button class="primary-button" id="generate" ${workspaceBusy ? 'disabled' : ''}>${workspaceBusy ? 'Agent running…' : artifact ? '↻ Regenerate' : '✦ Generate asset'}</button>` : ''}</div></div>
    <div class="session-workspace">${renderSessionRail(project)}${renderConversation(project)}<aside class="context-panel"><div class="context-tabs"><button data-context-panel="files" class="${state.contextPanel === 'files' ? 'active' : ''}">Files</button><button data-context-panel="wiki" class="${state.contextPanel === 'wiki' ? 'active' : ''}">LLM Wiki</button><button data-context-panel="document" class="${state.contextPanel === 'document' ? 'active' : ''}">Document</button></div><div class="context-body">${renderContextBody(project, artifact, artifactIndex, selected)}</div><div class="context-actions">${artifact ? '<button class="secondary-button full" id="copy-summary">Copy summary</button>' : ''}${editor ? '<button class="secondary-button full" id="ingest-document">Import notes</button><button class="secondary-button full" id="import-url">Import web/PDF URL</button>' : ''}<button class="secondary-button full" id="knowledge-library">Browse &amp; search knowledge</button>${editor ? '<button class="secondary-button full" id="refresh-sources">Refresh sources</button>' : ''}<button class="secondary-button full" id="show-snapshots">View source history</button>${editor ? '<button class="secondary-button full" id="toggle-watch">Configure updates</button>' : ''}</div></aside></div>`;
  if (c?.knowledgeContext?.length && ['wiki', 'report', 'draft'].includes(selected)) $('.artifact-content')?.insertAdjacentHTML('beforeend', renderWorkspaceKnowledgeContext(c.knowledgeContext));
  $('#back-overview').onclick = showOverview;
  $('#generate')?.addEventListener('click', () => generate(project.id)); $('#generate-empty')?.addEventListener('click', () => generate(project.id));
  $('#agent-composer')?.addEventListener('submit', (event) => { event.preventDefault(); const input = $('#agent-prompt'); const prompt = input.value.trim(); if (!prompt) return showToast('Enter a request for Novi'); sendAgentMessage(project.id, { prompt, mode: $('#agent-mode').value }); });
  $('#agent-prompt')?.addEventListener('input', (event) => { state.composerDraft = event.currentTarget.value; });
  $('#agent-mode')?.addEventListener('change', (event) => { state.composerMode = event.currentTarget.value; });
  $('#wiki-language')?.addEventListener('change', (event) => { state.composerLanguage = event.currentTarget.value; });
  $('#new-session')?.addEventListener('click', () => createAgentSessionUi(project.id));
  $('#delete-session')?.addEventListener('click', () => deleteAgentSessionUi(project.id, state.activeSessionId));
  $$('[data-session-id]').forEach((button) => button.addEventListener('click', () => selectAgentSession(project.id, button.dataset.sessionId)));
  $$('[data-context-panel]').forEach((button) => button.addEventListener('click', () => { state.contextPanel = button.dataset.contextPanel; renderWorkspace(project, state.activeTab); }));
  $$('[data-document-id]').forEach((button) => button.addEventListener('click', () => { state.activeDocumentId = button.dataset.documentId; state.contextPanel = 'document'; state.documentViewMode = 'preview'; renderWorkspace(project, state.activeTab); }));
  $$('[data-generated-document-id]').forEach((button) => button.addEventListener('click', () => { state.activeDocumentId = button.dataset.generatedDocumentId; state.contextPanel = 'document'; state.documentViewMode = 'preview'; renderWorkspace(project, state.activeTab); }));
  $$('[data-document-view-mode]').forEach((button) => button.addEventListener('click', () => { state.documentViewMode = button.dataset.documentViewMode; renderWorkspace(project, state.activeTab); }));
  $$('[data-markdown-document]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault();
    const document = (artifact?.documents || []).find((item) => item.name === link.dataset.markdownDocument);
    if (!document) return;
    state.activeDocumentId = document.id; state.contextPanel = 'document'; state.documentViewMode = 'preview'; renderWorkspace(project, state.activeTab);
  }));
  $$('[data-artifact-id]').forEach((button) => button.addEventListener('click', () => { state.activeArtifactId = button.dataset.artifactId; state.contextPanel = 'wiki'; state.compareVersions = false; renderWorkspace(project, state.activeTab); }));
  $('#pin-workspace')?.addEventListener('click', () => pin(project.id)); $('#copy-summary')?.addEventListener('click', async () => { if (!navigator.clipboard) return showToast('Clipboard is unavailable'); await navigator.clipboard.writeText(c.summary); showToast('Summary copied'); });
  $('#delete-workspace')?.addEventListener('click', () => deleteWorkspace(project));
  $('#export-md')?.addEventListener('click', () => exportArtifact(project.id, 'markdown', artifact.id));
  $('#export-ieee')?.addEventListener('click', () => exportArtifact(project.id, 'latex', artifact.id, 'ieee'));
  $('#export-acm')?.addEventListener('click', () => exportArtifact(project.id, 'latex', artifact.id, 'acm'));
  $('#artifact-version')?.addEventListener('change', (event) => { state.activeArtifactId = event.currentTarget.value; state.compareVersions = false; renderWorkspace(project, state.activeTab); });
  $('#compare-version')?.addEventListener('click', () => { state.compareVersions = !state.compareVersions; renderWorkspace(project, state.activeTab); });
  $('#ingest-document')?.addEventListener('click', () => ingestDocument(project.id));
  $('#import-url')?.addEventListener('click', () => importUrl(project.id));
  $('#knowledge-library')?.addEventListener('click', () => showKnowledgeLibrary(project.id));
  $('#refresh-sources')?.addEventListener('click', () => refreshSources(project.id));
  $('#show-snapshots')?.addEventListener('click', () => showSnapshots(project.id));
  $('#toggle-watch')?.addEventListener('click', () => configureWatch(project.id));
  $$('[data-artifact-tab]').forEach((button) => button.addEventListener('click', () => { state.activeTab = button.dataset.artifactTab; renderWorkspace(state.activeProject, state.activeTab); }));
  const messages = $('#conversation-messages'); if (messages) messages.scrollTop = messages.scrollHeight;
}

function renderWorkspaceKnowledgeContext(items) {
  return `<section class="artifact-knowledge-context"><h3>Workspace knowledge used</h3><p class="context-disclaimer">Retrieved from your semantic memory for this version. Treat these passages as user-provided context, not independently verified evidence.</p>${items.map((item) => `<article><div><b>${escapeHtml(item.document)}</b><span>${Math.round(Math.max(0, Math.min(1, Number(item.relevanceScore) || 0)) * 100)}% match</span></div><p>${escapeHtml(item.excerpt)}</p></article>`).join('')}</section>`;
}

function tabsFor(type) {
  if (type === 'knowledge') return [{ key: 'wiki', label: 'LLM WIKI' }, { key: 'path', label: 'LEARNING PATH' }, { key: 'practice', label: 'PRACTICE LAB' }, { key: 'graph', label: 'KNOWLEDGE GRAPH' }, { key: 'sources', label: 'SOURCES' }];
  if (type === 'research') return [{ key: 'report', label: 'REPORT' }, { key: 'wiki', label: 'LLM WIKI' }, { key: 'graph', label: 'KNOWLEDGE GRAPH' }, { key: 'sota', label: 'SOTA ANALYSIS' }, { key: 'opportunities', label: 'OPPORTUNITIES' }, { key: 'sources', label: 'SOURCES' }];
  return [{ key: 'draft', label: 'DRAFT' }, { key: 'wiki', label: 'LLM WIKI' }, { key: 'novelty', label: 'GAP & NOVELTY' }, { key: 'method', label: 'METHOD' }, { key: 'experiments', label: 'EXPERIMENTS' }, { key: 'figures', label: 'FIGURES' }, { key: 'review', label: 'REVIEW' }, { key: 'sources', label: 'SOURCES' }];
}

function renderLlmWiki(c) {
  const wiki = c.llmWiki || { title: c.title || 'LLM Wiki', summary: c.summary, sections: c.wikiSections || [] };
  const goal = c.expertGoal ? `<section class="wiki-goal"><h3>Expert Goal</h3><p><b>${escapeHtml(c.expertGoal.domain)}</b> · ${escapeHtml(c.expertGoal.outcome)}</p><small>${escapeHtml(c.expertGoal.question)}</small><ul>${(c.expertGoal.successCriteria || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';
  const roles = c.expertRoles?.length ? `<h3>Coordinated experts</h3><div class="path-list">${c.expertRoles.map((role) => `<div class="path-item"><strong>${escapeHtml(role.title)}</strong><span class="duration">${escapeHtml(role.stage)}</span><p>${escapeHtml(role.responsibility)}</p><small>${escapeHtml(role.expertise)}</small></div>`).join('')}</div>` : '';
  const knowledgeSystem = c.knowledgeSystem ? `<h3>Knowledge system</h3><p>${escapeHtml(c.knowledgeSystem.purpose)}</p><div class="path-list">${(c.knowledgeSystem.layers || []).map((layer) => `<div class="path-item"><strong>${escapeHtml(layer.title)}</strong><p>${escapeHtml(layer.objective)}</p><small>Depends on: ${escapeHtml((layer.dependencies || []).join(', ') || 'foundation')}</small></div>`).join('')}</div>` : '';
  const systemDocument = c.systemDocument ? `<h3>System document</h3><p>${escapeHtml(c.systemDocument.executiveSummary)}</p>${(c.systemDocument.sections || []).map((section) => `<h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(section.body)}</p>`).join('')}` : '';
  const glossary = wiki.glossary?.length ? `<h3>Glossary</h3><div class="opportunity-list">${wiki.glossary.map((item) => `<div class="opportunity"><b>${escapeHtml(item.term)}</b><p>${escapeHtml(item.definition)}</p></div>`).join('')}</div>` : '';
  const nextQuestions = wiki.nextQuestions?.length ? `<h3>Next questions</h3><ul>${wiki.nextQuestions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  const documentMap = (wiki.documentMap || c.deepDiveDocuments || []).length ? `<h3>Deep Dive documents</h3><div class="path-list">${(wiki.documentMap || c.deepDiveDocuments || []).map((document) => `<div class="path-item"><strong>${escapeHtml(document.title)}</strong><p>${escapeHtml(document.purpose)}</p><small>Open the matching Markdown file from Files to inspect the full technical analysis.</small></div>`).join('')}</div>` : '';
  return `<h2>${escapeHtml(wiki.title)}</h2><div class="summary"><p>${escapeHtml(wiki.summary)}</p></div><div class="evidence-badge ${c.evidence?.status === 'source-mapped' ? 'mapped' : ''}">Evidence: ${escapeHtml(c.evidence?.status || 'unverified')} · ${c.evidence?.sources?.length || 0} mapped sources</div>${goal}${roles}${knowledgeSystem}${systemDocument}${documentMap}<h3>Final Wiki synthesis</h3>${(wiki.sections || []).map((section) => `<h4>${escapeHtml(section.title)}</h4><p>${escapeHtml(section.body)}</p>`).join('')}${glossary}${nextQuestions}${renderEvidenceClaims(c.evidence)}`;
}

function renderArtifact(project, selected, c) {
  if (selected === 'wiki') return renderLlmWiki(c);
  if (selected === 'wiki' || selected === 'report' || selected === 'draft') return `<h2>${escapeHtml(c.title || (selected === 'wiki' ? 'LLM Wiki' : selected === 'report' ? 'Research Report' : 'Paper Draft'))}</h2><div class="summary"><p>${escapeHtml(c.summary)}</p></div><div class="evidence-badge ${c.evidence?.status === 'source-mapped' ? 'mapped' : ''}">Evidence: ${escapeHtml(c.evidence?.status || 'unverified')} · ${c.evidence?.sources?.length || 0} mapped sources</div>${c.abstract ? `<h3>Abstract</h3><p>${escapeHtml(c.abstract)}</p>` : ''}${(c.sections || []).map((s) => `<h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.body)}</p>`).join('')}${c.contributions ? `<h3>Proposed contributions</h3><div class="opportunity-list">${c.contributions.map((x) => `<div class="opportunity">${escapeHtml(x)}</div>`).join('')}</div>` : ''}${renderEvidenceClaims(c.evidence)}`;
  if (selected === 'path') return `<h2>Four-week learning path</h2><div class="summary"><p>Move from vocabulary to an original, evidence-backed position with deliberate practice each week.</p></div><div class="path-list">${c.learningPath.map((item) => `<div class="path-item"><strong>${escapeHtml(item.stage)}</strong><span class="duration">${escapeHtml(item.duration)}</span><p>${escapeHtml(item.outcome)}</p><ul>${item.tasks.map((task) => `<li>${escapeHtml(task)}</li>`).join('')}</ul></div>`).join('')}</div>`;
  if (selected === 'practice') return `<h2>Practice lab</h2><div class="summary"><p>Convert understanding into decisions, debugging skill, and production evidence.</p></div><div class="path-list">${(c.caseStudies || []).map((item) => `<div class="path-item"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.scenario)}</p><small><b>Deliverable:</b> ${escapeHtml(item.deliverable)}</small></div>`).join('')}</div><h3>Practice questions</h3><div class="opportunity-list">${(c.practiceQuestions || []).map((item) => `<div class="opportunity"><b>${escapeHtml(item.level)}</b><p>${escapeHtml(item.question)}</p><small>Success: ${escapeHtml(item.successCriteria)}</small></div>`).join('')}</div>`;
  if (selected === 'graph') return `<h2>Knowledge graph</h2><div class="summary"><p>Start with the central topic, then follow the concept clusters to find the next useful question.</p></div><div class="graph">${c.graph.nodes.map((node) => `<span class="node ${node.group === 'topic' ? 'topic' : ''}">${escapeHtml(node.label)}</span>`).join('')}</div><h3>Relationships</h3><div class="opportunity-list">${c.graph.edges.map((edge) => `<div class="opportunity">${escapeHtml(edge.source)} contains ${escapeHtml(edge.target)}</div>`).join('')}</div>`;
  if (selected === 'novelty') return `<h2>Research gap discovery</h2><div class="summary"><p>Turn an idea into falsifiable differentiation before investing in a full paper.</p></div><div class="path-list">${(c.researchGaps || []).map((item, index) => `<div class="path-item"><strong>Gap ${index + 1}</strong><p>${escapeHtml(item.gap)}</p><small><b>Evidence needed:</b> ${escapeHtml(item.evidenceNeeded)}</small><small><b>Falsification test:</b> ${escapeHtml(item.test)}</small></div>`).join('')}</div><h3>Novelty analysis</h3><div class="sota-table">${(c.noveltyAnalysis || []).map((item) => `<div class="source-row"><b>${escapeHtml(item.dimension)}</b><span><b>Baseline:</b> ${escapeHtml(item.baseline)}<br><b>Differentiation:</b> ${escapeHtml(item.differentiation)}<br><b>Risk:</b> ${escapeHtml(item.risk)}</span></div>`).join('')}</div>`;
  if (selected === 'sota') return `<h2>State of the art</h2><div class="sota-table">${c.sota.map((row) => `<div class="source-row"><b>${escapeHtml(row.dimension)}</b><span>${escapeHtml(row.finding)}</span><span class="confidence">${escapeHtml(row.confidence)} confidence</span></div>`).join('')}</div>`;
  if (selected === 'opportunities' || selected === 'review') return `<h2>${selected === 'review' ? 'Review simulation' : 'Research opportunities'}</h2><div class="summary"><p>${selected === 'review' ? 'Use this pre-submission review to strengthen claims before asking for external feedback.' : 'Promising directions become useful when they are scoped into measurable next steps.'}</p></div><div class="opportunity-list">${(selected === 'review' ? c.review.map((x) => `${x.area}: ${x.verdict} — ${x.note}`) : c.opportunities).map((x) => `<div class="opportunity">${escapeHtml(typeof x === 'string' ? x : x.note)}</div>`).join('')}</div>`;
  if (selected === 'method') return `<h2>Research method</h2><div class="path-list">${c.method.map((x, i) => `<div class="path-item"><strong>Step ${i + 1}</strong><p>${escapeHtml(x)}</p></div>`).join('')}</div>`;
  if (selected === 'experiments') return `<h2>Experiment plan</h2><div class="path-list">${c.experiments.map((x) => `<div class="path-item"><strong>${escapeHtml(x.name)}</strong><p>${escapeHtml(x.purpose)}</p><small>${escapeHtml(x.metric)}</small></div>`).join('')}</div>`;
  if (selected === 'figures') return `<h2>Figures</h2><div class="path-list">${(c.figures || []).map((figure) => `<div class="path-item"><strong>${escapeHtml(figure.caption)}</strong><p>${escapeHtml(figure.purpose)}</p>${renderFigureSvg(figure)}</div>`).join('')}</div>`;
  if (selected === 'sources') return `<h2>Source map</h2><div class="summary"><p>${escapeHtml(c.evidence?.disclaimer || 'Review sources before publication.')}</p></div><div class="source-list">${(c.sources || []).map((source) => `<div class="source-row"><span><a href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a><span class="source-kind"> · ${escapeHtml(source.kind)}</span></span><span class="confidence">${source.mapped ? 'Mapped' : 'Search entry'} · ${source.authority}%</span></div>`).join('')}</div>${renderEvidenceClaims(c.evidence)}`;
  return '';
}

function renderEvidenceClaims(evidence) {
  if (!evidence?.claims?.length) return '';
  const sources = new Map((evidence.sources || []).map((source) => [source.id, source]));
  return `<section class="evidence-claims"><h3>Claim-level evidence</h3><p class="muted">${escapeHtml(evidence.disclaimer || 'Review claims before publication.')}</p>${evidence.claims.map((claim) => `<div class="evidence-claim"><b>${escapeHtml(claim.id)} · ${escapeHtml(claim.verification)}</b><p>${escapeHtml(claim.text)}</p><small>${(claim.evidenceIds || []).map((id) => sources.get(id)).filter(Boolean).map((source) => `<a href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.name)}</a>`).join(' · ') || 'No mapped source'}</small></div>`).join('')}</section>`;
}

async function loadProjects() { state.projects = (await request('/api/projects')).projects; renderProjects(); }
function resetAgentWorkspaceState() { state.sessions = []; state.activeSessionId = null; state.activeSession = null; state.sessionProjectId = null; state.workspaceKnowledge = null; state.activeDocumentId = null; state.monitoringJobId = null; state.composerDraft = ''; state.composerMode = 'auto'; state.composerLanguage = 'zh-CN'; }
async function loadBilling() {
  try {
    const org = await request('/api/org');
    state.role = org.role || 'viewer'; $('#org-name').textContent = org.organization.name; $('#org-role').textContent = `Role: ${state.role}`;
    applyRoleCapabilities(); renderProjects(); if (state.activeProject) renderWorkspace(state.activeProject, state.activeTab);
  } catch {}
  try {
    const billing = await request('/api/billing');
    const metric = document.querySelector('.plan b');
    if (metric) metric.textContent = `${billing.planLabel} · ${billing.usage.generations}/${billing.limits.monthlyGenerations} generations`;
  } catch {}
  try {
    const result = await request('/api/orgs');
    const selector = $('#org-switch');
    selector.innerHTML = (result.organizations || []).map((item) => `<option value="${escapeHtml(item.id)}" ${item.current ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(item.role)}</option>`).join('');
    selector.hidden = (result.organizations || []).length < 2;
  } catch {}
}
async function logout() { try { await request('/api/auth/logout', { method: 'POST' }); } finally { state.projects = []; state.activeProject = null; state.role = 'viewer'; resetAgentWorkspaceState(); applyRoleCapabilities(); showOverview(); $('#auth-modal').classList.remove('hidden'); showToast('Signed out'); } }
function openBilling() { if (!canRole('admin')) return showToast('Admin access is required to manage billing'); $('#billing-error').textContent = ''; $('#billing-modal').classList.remove('hidden'); }
function closeBilling() { $('#billing-modal').classList.add('hidden'); $('#billing-error').textContent = ''; }
async function upgradePlan(plan) { try { const result = await request('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, returnUrl: window.location.href }) }); if (result.checkoutUrl) { const url = safeExternalUrl(result.checkoutUrl); if (url === '#') throw new Error('Payment provider returned an unsafe checkout URL'); window.open(url, '_blank', 'noopener,noreferrer'); } } catch (error) { $('#billing-error').textContent = error.message; showToast(error.message); } }
function closeProviderSettings() { $('#provider-modal').classList.add('hidden'); $('#provider-error').textContent = ''; }
function providerDefinition(id) { return state.providerSettings?.providers?.find((provider) => provider.id === id); }
function renderProviderStatus() {
  const active = state.providerSettings?.configs?.find((config) => config.active);
  const status = $('#provider-status');
  status.textContent = active ? `${providerDefinition(active.provider)?.name || active.provider} · ${active.model}` : 'Offline';
  status.classList.toggle('offline', !active);
  $('#provider-disable').hidden = !active;
}
function populateProviderForm(providerId) {
  const definition = providerDefinition(providerId); if (!definition) return;
  const saved = state.providerSettings.configs.find((config) => config.provider === providerId);
  const form = $('#provider-form');
  form.elements.model.value = saved?.model || definition.defaultModel || '';
  form.elements.baseUrl.value = saved?.baseUrl || definition.baseUrl || '';
  form.elements.apiVersion.value = saved?.apiVersion || definition.apiVersion || '';
  form.elements.apiKey.value = '';
  form.elements.apiKey.required = Boolean(definition.apiKeyRequired && !saved?.hasApiKey);
  form.elements.apiKey.placeholder = saved?.hasApiKey ? `Stored key ending ${saved.apiKeyLast4 || '••••'}` : definition.apiKeyRequired ? 'Required' : 'Optional';
  $('#provider-key-hint').textContent = saved?.hasApiKey ? 'Leave blank to keep the stored key' : definition.apiKeyRequired ? 'Required' : 'Optional';
  $('#provider-base-field').hidden = !definition.configurableBaseUrl;
  $('#provider-version-field').hidden = definition.id !== 'azure-openai';
}
async function openProviderSettings() {
  if (!canRole('admin')) return showToast('Admin access is required to manage model providers');
  $('#provider-error').textContent = ''; $('#provider-modal').classList.remove('hidden');
  try {
    state.providerSettings = await request('/api/llm/providers');
    const select = $('#provider-form [name="provider"]');
    select.innerHTML = state.providerSettings.providers.map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join('');
    select.value = state.providerSettings.activeProvider || state.providerSettings.providers[0]?.id || '';
    populateProviderForm(select.value); renderProviderStatus();
  } catch (error) { $('#provider-error').textContent = error.message; }
}
async function saveProviderSettings(event) {
  event.preventDefault(); const form = event.currentTarget; const payload = Object.fromEntries(new FormData(form).entries());
  if (!payload.apiKey) delete payload.apiKey;
  $('#provider-error').textContent = '';
  try {
    const result = await request('/api/llm/provider', { method: 'PUT', body: JSON.stringify(payload) });
    for (const config of state.providerSettings.configs) config.active = false;
    const index = state.providerSettings.configs.findIndex((config) => config.provider === result.config.provider);
    if (index >= 0) state.providerSettings.configs[index] = result.config; else state.providerSettings.configs.push(result.config);
    state.providerSettings.activeProvider = result.config.provider; populateProviderForm(result.config.provider); renderProviderStatus(); showToast('Model provider saved');
  } catch (error) { $('#provider-error').textContent = error.message; }
}
async function testConfiguredProvider() {
  const button = $('#provider-test'); button.disabled = true; $('#provider-error').textContent = '';
  try {
    const form = $('#provider-form'); const payload = Object.fromEntries(new FormData(form).entries());
    if (!payload.apiKey) delete payload.apiKey;
    const saved = await request('/api/llm/provider', { method: 'PUT', body: JSON.stringify(payload) });
    for (const config of state.providerSettings.configs) config.active = false;
    const index = state.providerSettings.configs.findIndex((config) => config.provider === saved.config.provider);
    if (index >= 0) state.providerSettings.configs[index] = saved.config; else state.providerSettings.configs.push(saved.config);
    state.providerSettings.activeProvider = saved.config.provider; populateProviderForm(saved.config.provider); renderProviderStatus();
    const result = await request('/api/llm/provider/test', { method: 'POST' }); showToast(`${result.provider} connected · ${result.latencyMs} ms`);
  }
  catch (error) { $('#provider-error').textContent = error.message; }
  finally { button.disabled = false; }
}
async function disableProvider() {
  $('#provider-error').textContent = '';
  try { await request('/api/llm/provider', { method: 'DELETE' }); for (const config of state.providerSettings.configs) config.active = false; state.providerSettings.activeProvider = null; renderProviderStatus(); showToast('Offline generation enabled'); }
  catch (error) { $('#provider-error').textContent = error.message; }
}
function updateConversationRun(job) {
  const mode = $('#conversation-run-mode'); const stage = $('#conversation-run-stage'); const progress = $('#conversation-run-progress');
  if (mode) mode.textContent = job.currentModeLabel || sessionModeLabel(job.currentMode);
  if (stage) stage.textContent = job.currentStage || (job.status === 'queued' ? 'Queued' : 'Preparing');
  if (progress) progress.textContent = `${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`;
  if (state.activeSession?.activeRun?.jobId === job.id) Object.assign(state.activeSession.activeRun, { currentMode: job.currentMode, currentStage: job.currentStage, progress: job.progress, runEvents: job.runEvents || state.activeSession.activeRun.runEvents || [], ...(job.expertGoal ? { expertGoal: job.expertGoal, expertRoles: job.expertRoles || [] } : {}), ...(job.referenceDiscovery ? { referenceDiscovery: job.referenceDiscovery } : {}) });
  const messages = $('#conversation-messages');
  if (messages) {
    const current = messages.querySelector('#live-events');
    const html = runEventsSection(job.runEvents || state.activeSession?.activeRun?.runEvents || []);
    if (current && html) {
      const openState = new Map([...current.querySelectorAll('details[data-event-id]')].map((detail) => [detail.dataset.eventId, detail.open]));
      current.outerHTML = html;
      const replacement = messages.querySelector('#live-events');
      replacement?.querySelectorAll('details[data-event-id]').forEach((detail) => {
        if (openState.has(detail.dataset.eventId)) detail.open = openState.get(detail.dataset.eventId);
      });
    }
    else if (!current && html) messages.insertAdjacentHTML('beforeend', html);
  }
  if (job.expertGoal) {
    const current = messages?.querySelector('.live-goal');
    const template = document.createElement('template'); template.innerHTML = renderLiveGoal(job).trim();
    if (current) current.replaceWith(template.content.firstElementChild);
    else if (messages) {
      const goal = template.content.firstElementChild; const events = messages.querySelector('#live-events');
      if (events) events.before(goal); else messages.append(goal);
    }
  }
}

function streamJobEvents(jobId, onJob) {
  if (typeof EventSource === 'undefined') return Promise.reject(new Error('SSE is not supported by this browser'));
  return new Promise((resolve, reject) => {
    const source = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    let settled = false; let lastEventAt = Date.now();
    const watchdog = window.setInterval(() => {
      if (Date.now() - lastEventAt > 35_000) finish(new Error('Agent event stream timed out'));
    }, 5_000);
    const finish = (error, job) => {
      if (settled) return;
      settled = true; window.clearInterval(watchdog); source.close();
      if (error) reject(error); else resolve(job);
    };
    source.addEventListener('job', (event) => {
      lastEventAt = Date.now();
      try {
        const job = JSON.parse(event.data).job; onJob(job);
        if (['completed', 'failed', 'cancelled'].includes(job.status)) finish(null, job);
      } catch (error) { finish(error); }
    });
    source.addEventListener('heartbeat', () => { lastEventAt = Date.now(); });
    source.addEventListener('error', (event) => {
      lastEventAt = Date.now();
      if (event?.data) { try { finish(new Error(JSON.parse(event.data).error || 'Agent event stream failed')); } catch { finish(new Error('Agent event stream failed')); } }
    });
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) finish(new Error('Agent event stream closed')); };
  });
}

async function followJob(initialJob, onJob) {
  onJob(initialJob);
  try { return await streamJobEvents(initialJob.id, onJob); }
  catch {
    let job = initialJob;
    for (let attempt = 0; attempt < 7_200; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      job = (await request(`/api/jobs/${job.id}`)).job; onJob(job);
      if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    }
    throw new Error('Generation timed out');
  }
}

async function monitorGeneration(id, initialJob, sessionId, notifyStages = true) {
  if (state.monitoringJobId === initialJob.id) return;
  state.monitoringJobId = initialJob.id;
  let job = initialJob; let lastStage = '';
  try {
    job = await followJob(job, (next) => { job = next; state.activeJob = job; updateAgentRunStatus(job); updateConversationRun(job); if (notifyStages && job.currentStage && job.currentStage !== lastStage) { lastStage = job.currentStage; showToast(`${job.currentModeLabel || job.currentMode} · ${job.currentStage}`); } });
    if (job.status !== 'completed') throw new Error(job.error || 'Generation failed');
    const result = await request(`/api/projects/${id}`);
    state.projects = state.projects.map((project) => project.id === id ? result.project : project);
    state.activeProject = result.project; state.activeJob = null;
    state.activeArtifactId = result.project.artifacts?.[0]?.id || null; state.compareVersions = false; state.contextPanel = 'wiki'; state.activeTab = 'overview';
    await loadAgentWorkspace(id, sessionId);
    showToast('Knowledge asset generated');
  } catch (error) {
    state.activeJob = null; showToast(error.message);
    await loadProjects().catch(() => {});
    const project = state.projects.find((item) => item.id === id);
    if (project) { state.activeProject = project; await loadAgentWorkspace(id, sessionId).catch(() => {}); }
  } finally { if (state.monitoringJobId === initialJob.id) state.monitoringJobId = null; }
}

async function monitorConversation(id, initialJob, sessionId, notifyStages = true) {
  if (state.monitoringJobId === initialJob.id) return;
  state.monitoringJobId = initialJob.id;
  let job = initialJob; let lastStage = '';
  try {
    job = await followJob(job, (next) => { job = next; state.activeJob = job; updateAgentRunStatus(job); updateConversationRun(job); if (notifyStages && job.currentStage && job.currentStage !== lastStage) { lastStage = job.currentStage; showToast(`${job.currentModeLabel || job.currentMode} · ${job.currentStage}`); } });
    if (job.status !== 'completed') throw new Error(job.error || 'Wiki refinement failed');
    state.activeJob = null; await loadProjects(); state.activeProject = state.projects.find((project) => project.id === id) || state.activeProject; state.activeArtifactId = state.activeProject?.artifacts?.[0]?.id || state.activeArtifactId; await loadAgentWorkspace(id, sessionId); showToast('Wiki and knowledge updated');
  } catch (error) {
    state.activeJob = null; showToast(error.message); await loadAgentWorkspace(id, sessionId).catch(() => {});
  } finally { if (state.monitoringJobId === initialJob.id) state.monitoringJobId = null; }
}

async function sendAgentMessage(id, input = {}) {
  try {
    showToast('Agent request queued…');
    const prompt = String(input.prompt || $('#agent-prompt')?.value || '').trim();
    const mode = input.mode || $('#agent-mode')?.value || 'auto';
    const language = input.language || $('#wiki-language')?.value || state.composerLanguage || state.activeProject?.wikiLanguage || 'zh-CN';
    const queued = await request(`/api/projects/${id}/sessions/${state.activeSessionId}/messages`, { method: 'POST', body: JSON.stringify({ prompt, mode, language }) });
    const job = queued.job;
    state.activeJob = job; state.composerDraft = '';
    renderWorkspace(state.activeProject, state.activeTab); await loadAgentWorkspace(id, state.activeSessionId);
    await monitorConversation(id, job, state.activeSessionId);
  } catch (error) {
    state.activeJob = null; showToast(error.message); await loadAgentWorkspace(id, state.activeSessionId).catch(() => {});
  }
}

async function generate(id, input = {}) {
  try {
    showToast('Generation queued…');
    const sourceProject = state.projects.find((project) => project.id === id) || state.activeProject;
    const prompt = String(input.prompt || $('#agent-prompt')?.value || '').trim() || [sourceProject?.topic, sourceProject?.description].filter(Boolean).join('\n');
    const mode = input.mode || $('#agent-mode')?.value || 'auto';
    const language = input.language || $('#wiki-language')?.value || state.composerLanguage || sourceProject?.wikiLanguage || 'zh-CN';
    const queued = await request(`/api/projects/${id}/generate?async=true`, { method: 'POST', body: JSON.stringify({ prompt, mode, language, sessionId: state.activeSessionId }) });
    const job = queued.job;
    state.activeJob = job; state.activeSessionId = queued.sessionId || state.activeSessionId; state.composerDraft = '';
    state.projects = state.projects.map((project) => project.id === id ? { ...project, status: 'generating' } : project);
    const generatingProject = state.projects.find((project) => project.id === id);
    if (generatingProject) { state.activeProject = generatingProject; renderWorkspace(generatingProject, state.activeTab); await loadAgentWorkspace(id, state.activeSessionId); }
    await monitorGeneration(id, job, state.activeSessionId);
  } catch (error) { state.activeJob = null; showToast(error.message); await loadProjects().catch(() => {}); const project = state.projects.find((item) => item.id === id); if (project) showWorkspace(project); }
}
async function pin(id) { const result = await request(`/api/projects/${id}/pin`, { method: 'PATCH' }); state.projects = state.projects.map((p) => p.id === id ? result.project : p); showWorkspace(result.project); renderProjects(); }
async function deleteWorkspace(project) {
  if (!window.confirm(`Delete “${project.title}” and its indexed knowledge? This cannot be undone.`)) return;
  try {
    await request(`/api/projects/${project.id}`, { method: 'DELETE' });
    state.projects = state.projects.filter((item) => item.id !== project.id); resetAgentWorkspaceState(); showOverview(); showToast('Workspace deleted');
  } catch (error) { showToast(error.message); }
}
async function switchOrganization(tenantId) {
  if (!tenantId) return;
  try {
    await request('/api/auth/switch', { method: 'POST', body: JSON.stringify({ tenantId }) });
    state.activeProject = null; state.activeTab = 'overview'; resetAgentWorkspaceState(); await loadProjects(); await loadBilling(); showOverview(); showToast('Organization switched');
  } catch (error) { showToast(error.message); await loadBilling(); }
}
async function exportArtifact(id, format = 'markdown', artifactId = null, template = 'article') { try { const requestedVersion = artifactId ? `&artifactId=${encodeURIComponent(artifactId)}` : ''; const requestedTemplate = format === 'latex' ? `&template=${encodeURIComponent(template)}` : ''; const content = await request(`/api/projects/${id}/export?format=${format}${requestedVersion}${requestedTemplate}`); const extension = format === 'latex' ? 'tex' : 'md'; const blob = new Blob([content], { type: format === 'latex' ? 'application/x-tex' : 'text/markdown' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); const project = state.projects.find((item) => item.id === id) || state.activeProject; const index = project?.artifacts?.findIndex((item) => item.id === artifactId) ?? -1; const number = index >= 0 ? project.artifacts.length - index : project?.artifacts?.length || 1; const safeName = String(project?.title || 'novi-workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'novi-workspace'; link.href = url; link.download = `${safeName}-v${number}${format === 'latex' && template !== 'article' ? `-${template}` : ''}.${extension}`; link.click(); URL.revokeObjectURL(url); showToast(`${format === 'latex' ? template.toUpperCase() + ' LaTeX' : 'Markdown'} version ${number} downloaded`); } catch (error) { showToast(error.message); } }
async function ingestDocument(id) {
  const title = window.prompt('Notes title'); if (!title) return;
  const content = window.prompt('Paste notes or source text (up to 900 KB)'); if (!content) return;
  const sourceUrl = window.prompt('Optional source URL (https://…)') || '';
  try { await request(`/api/projects/${id}/knowledge`, { method: 'POST', body: JSON.stringify({ title, content, sourceUrl }) }); await loadAgentWorkspace(id, state.activeSessionId); showToast('Notes indexed into workspace'); } catch (error) { showToast(error.message); }
}
async function importUrl(id) {
  const title = window.prompt('Document title'); if (!title) return;
  const sourceUrl = window.prompt('Public web page or PDF URL (https://…)'); if (!sourceUrl) return;
  const render = window.confirm('Does this page require JavaScript rendering? Choose OK only when your organization configured Browser Agent.') ? 'browser' : 'static';
  try { await request(`/api/projects/${id}/knowledge/import`, { method: 'POST', body: JSON.stringify({ title, url: sourceUrl, render }) }); await loadAgentWorkspace(id, state.activeSessionId); showToast(`${render === 'browser' ? 'Rendered page' : 'Remote document'} imported and indexed`); } catch (error) { showToast(error.message); }
}
function closeKnowledgeLibrary() { $('#knowledge-modal').classList.add('hidden'); $('#knowledge-error').textContent = ''; }
function renderKnowledgeDocuments(payload) {
  const documents = payload.documents || [];
  $('#knowledge-summary').innerHTML = `<span><b>${documents.length}</b> documents</span><span><b>${(payload.chunks || []).length}</b> passages</span><span><b>${(payload.entities || []).length}</b> concepts</span>`;
  $('#knowledge-results').innerHTML = documents.length ? `<div class="knowledge-document-list">${documents.map((document) => `<article class="knowledge-document"><div><b>${escapeHtml(document.title)}</b><span>${escapeHtml(document.sourceKind || 'text')}</span></div><p>${document.chunkCount || 0} passages · ${document.entityCount || 0} concepts · imported ${escapeHtml(formatDate(document.createdAt))}</p><div class="knowledge-document-actions">${document.sourceUrl ? `<a href="${escapeHtml(safeExternalUrl(document.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : '<i></i>'}${canRole('editor') ? `<button type="button" class="text-button knowledge-delete" data-delete-document="${escapeHtml(document.id)}" data-document-title="${escapeHtml(document.title)}">Remove</button>` : ''}</div></article>`).join('')}</div>` : '<div class="knowledge-empty"><b>No imported knowledge yet</b><p>Use Import notes or Import web/PDF URL, then Novi will retrieve relevant passages during generation.</p></div>';
}
function renderKnowledgeMatches(results) {
  $('#knowledge-results').innerHTML = results.length ? `<div class="knowledge-match-list">${results.map((item) => `<article class="knowledge-match"><div><b>${escapeHtml(item.document || 'Workspace document')}</b><span>${Math.round(Math.max(0, Math.min(1, Number(item.score) || 0)) * 100)}% match</span></div><p>${escapeHtml(item.text || '')}</p>${item.sourceUrl ? `<a href="${escapeHtml(safeExternalUrl(item.sourceUrl))}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}</article>`).join('')}</div>` : '<div class="knowledge-empty"><b>No matching passages</b><p>Try a broader term or import more workspace knowledge.</p></div>';
}
async function showKnowledgeLibrary(id) {
  $('#knowledge-modal').classList.remove('hidden');
  $('#knowledge-search-form').dataset.projectId = id;
  $('#knowledge-results').innerHTML = '<p class="muted">Loading workspace knowledge…</p>';
  try {
    const payload = await request(`/api/projects/${id}/knowledge`);
    renderKnowledgeDocuments(payload);
    const input = $('#knowledge-search-form [name="query"]');
    if (!input.value && state.activeProject?.topic) input.value = state.activeProject.topic;
    input.focus();
  } catch (error) { $('#knowledge-results').innerHTML = ''; $('#knowledge-error').textContent = error.message; }
}
async function deleteKnowledgeDocument(projectId, documentId, title) {
  if (!window.confirm(`Remove “${title}” from semantic memory? Existing immutable artifact versions may retain excerpts that were already used. Delete the workspace for a complete purge.`)) return;
  try { await request(`/api/projects/${projectId}/knowledge/${documentId}`, { method: 'DELETE' }); await loadAgentWorkspace(projectId, state.activeSessionId); showToast('Knowledge document removed'); await showKnowledgeLibrary(projectId); }
  catch (error) { showToast(error.message); }
}
async function refreshSources(id) { try { const result = await request(`/api/projects/${id}/refresh`, { method: 'POST' }); if (result.update?.status === 'completed') { await loadProjects(); const project = state.projects.find((item) => item.id === id); if (project) { state.activeProject = project; await loadAgentWorkspace(id, state.activeSessionId); } } const update = result.update?.status === 'completed' ? ' · workspace updated' : result.update?.status === 'unchanged' ? ' · no source changes' : result.update?.status === 'quota-exceeded' ? ' · generation quota reached' : ''; showToast(`Sources refreshed: ${result.snapshot.sourceCount}${update}`); } catch (error) { showToast(error.message); } }
async function showSnapshots(id) { try { const result = await request(`/api/projects/${id}/snapshots?limit=10`); const labels = { completed: 'Workspace updated', unchanged: 'No source changes', disabled: 'Artifact update disabled', busy: 'Waiting for active generation', 'quota-exceeded': 'Generation quota reached', failed: 'Artifact update failed', running: 'Artifact update running' }; const list = $('#snapshot-list'); list.innerHTML = result.snapshots.length ? result.snapshots.map((snapshot) => { const changes = snapshot.changes || { added: 0, updated: 0, removed: 0 }; const changed = snapshot.changeStatus === 'changed'; const update = labels[snapshot.autoUpdateStatus] || (changed ? 'Change not yet applied' : 'No artifact update needed'); return `<article class="snapshot-item"><div class="snapshot-head"><b>${formatDateTime(snapshot.fetchedAt)}</b><span>${snapshot.sourceCount} sources</span></div><div class="snapshot-status"><span class="snapshot-change ${changed ? 'changed' : 'unchanged'}">${changed ? `Changed · +${changes.added || 0} ~${changes.updated || 0} −${changes.removed || 0}` : 'Unchanged'}</span><span>${escapeHtml(update)}</span></div><div class="snapshot-sources">${(snapshot.sources || []).slice(0, 8).map((source) => `<a href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)} <small>${Number(source.relevanceScore || 0).toFixed(2)}</small></a>`).join('')}</div></article>`; }).join('') : '<p class="muted">No source snapshots yet.</p>'; $('#snapshot-modal').classList.remove('hidden'); } catch (error) { showToast(error.message); } }
async function configureWatch(id) {
  const enabled = window.confirm('Enable source update reminders for this workspace?');
  const frequency = enabled ? (window.prompt('Frequency: daily or weekly', 'weekly') || 'weekly') : 'manual';
  try { await request(`/api/projects/${id}/watch`, { method: 'PUT', body: JSON.stringify({ enabled, frequency, autoUpdate: enabled }) }); showToast(enabled ? `Automatic artifact updates enabled (${frequency})` : 'Updates disabled'); } catch (error) { showToast(error.message); }
}

function openSearch() {
  $('#search-modal').classList.remove('hidden');
  const input = $('#search-form [name="topic"]');
  if (!input.value && state.activeProject?.topic) input.value = state.activeProject.topic;
  input.focus();
}
function closeSearch() { $('#search-modal').classList.add('hidden'); $('#search-error').textContent = ''; }

function customToolRow(tool, index) {
  const schema = tool.inputSchema || { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 500 } }, required: ['query'] };
  return `<article class="custom-tool-row" data-custom-tool-index="${index}" data-custom-tool-id="${escapeHtml(tool.id || '')}"><div class="tool-row-heading"><label class="tool-enabled"><input type="checkbox" name="enabled" ${tool.enabled !== false ? 'checked' : ''} /> Enabled</label><button type="button" class="text-button tool-remove" data-remove-tool="${index}">Remove</button></div><div class="tool-form-grid"><label>Name<input name="name" value="${escapeHtml(tool.name || '')}" maxlength="48" placeholder="literature_lookup" /></label><label>Endpoint<input name="endpoint" type="url" value="${escapeHtml(tool.endpoint || '')}" maxlength="500" placeholder="https://tools.example.com/invoke" /></label><label class="tool-wide">Description<input name="description" value="${escapeHtml(tool.description || '')}" maxlength="500" placeholder="Describe when the Agent should use this tool" /></label><label class="tool-wide">Bearer token <span class="optional">${tool.hasBearerToken ? `Stored · ends ${escapeHtml(tool.bearerTokenLast4 || '')}` : 'Optional'}</span><input name="bearerToken" type="password" maxlength="2000" autocomplete="new-password" /></label><label class="tool-wide">Input JSON Schema<textarea name="inputSchema" rows="7" spellcheck="false">${escapeHtml(JSON.stringify(schema, null, 2))}</textarea></label></div></article>`;
}

function customizeTabs() {
  return `<div class="customize-tabs" role="tablist"><button class="${state.customizeTab === 'tools' ? 'active' : ''}" data-customize-tab="tools" role="tab">Tools</button><button class="${state.customizeTab === 'mcp' ? 'active' : ''}" data-customize-tab="mcp" role="tab">MCP</button><button class="${state.customizeTab === 'skills' ? 'active' : ''}" data-customize-tab="skills" role="tab">Skills</button><button class="${state.customizeTab === 'plugins' ? 'active' : ''}" data-customize-tab="plugins" role="tab">Plugins</button></div>`;
}

function bindCustomizeTabs() {
  $$('[data-customize-tab]').forEach((button) => button.onclick = () => { state.customizeTab = button.dataset.customizeTab; renderCustomize(); });
}

function renderToolsCustomize() {
  const settings = state.toolSettings || { builtins: [], customTools: [] };
  const builtins = settings.builtins.map((tool) => `<label class="builtin-tool"><input type="checkbox" data-builtin-tool="${escapeHtml(tool.name)}" ${tool.enabled ? 'checked' : ''} /><span><b>${escapeHtml(tool.label)}</b><small>${escapeHtml(tool.description)}</small></span></label>`).join('');
  const customTools = settings.customTools.map(customToolRow).join('');
  $('#customize-root').innerHTML = `<div class="customize-heading"><div><p class="eyebrow">AGENT RUNTIME</p><h1>Customize</h1><p>Control the tools available to Agent runs in this organization.</p></div><button class="primary-button" id="save-tools" ${canRole('admin') ? '' : 'disabled'}>Save tools</button></div>${customizeTabs()}<section class="customize-section"><div class="section-head"><div><h2>Built-in tools</h2><p>Workspace access stays within the current tenant and project.</p></div></div><div class="builtin-tool-grid">${builtins || '<p class="muted">Loading built-in tools...</p>'}</div></section><section class="customize-section"><div class="section-head"><div><h2>Custom HTTP tools</h2><p>Endpoints must use an allowed HTTPS hostname and return no more than 32 KB.</p></div><button class="secondary-button" id="add-custom-tool" type="button">Add tool</button></div><div id="custom-tool-list" class="custom-tool-list">${customTools || '<div class="context-empty"><b>No custom tools</b><p>Add an allowlisted HTTP endpoint when this organization needs a domain-specific action.</p></div>'}</div><p class="form-error" id="tools-error"></p></section>`;
  $('#add-custom-tool').onclick = () => { state.toolSettings.customTools.push({ enabled: true, name: '', description: '', endpoint: '', inputSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', maxLength: 500 } }, required: ['query'] } }); renderCustomize(); };
  $$('[data-remove-tool]').forEach((button) => button.onclick = () => { state.toolSettings.customTools.splice(Number(button.dataset.removeTool), 1); renderCustomize(); });
  $('#save-tools').onclick = saveTools;
  bindCustomizeTabs();
}

function mcpServerRow(server, index) {
  const tools = (server.discoveredTools || []).map((tool) => `<label class="mcp-tool ${tool.supported === false ? 'unsupported' : ''}"><input type="checkbox" data-mcp-tool="${escapeHtml(tool.name)}" ${tool.enabled ? 'checked' : ''} ${tool.supported === false ? 'disabled' : ''} /><span><b>${escapeHtml(tool.title || tool.name)}</b><small>${escapeHtml(tool.description || tool.name)}</small><i>${tool.annotations?.destructiveHint ? 'Destructive' : tool.annotations?.readOnlyHint ? 'Read only' : 'No safety hint'}${tool.supported === false ? ` · ${escapeHtml(tool.unsupportedReason || 'Unsupported')}` : ''}</i></span></label>`).join('');
  const syncStatus = server.lastSyncedAt ? `${server.discoveredTools?.length || 0} tools · ${formatDateTime(server.lastSyncedAt)}` : 'Not discovered';
  return `<article class="custom-tool-row mcp-server-row" data-mcp-server-index="${index}" data-mcp-server-id="${escapeHtml(server.id || '')}"><div class="tool-row-heading"><label class="tool-enabled"><input type="checkbox" name="enabled" ${server.enabled !== false ? 'checked' : ''} /> Enabled</label><span class="mcp-sync-status">${escapeHtml(syncStatus)}</span><button type="button" class="text-button tool-remove" data-remove-mcp="${index}">Remove</button></div><div class="tool-form-grid"><label>Name<input name="name" value="${escapeHtml(server.name || '')}" maxlength="80" placeholder="Research services" /></label><label>Streamable HTTP endpoint<input name="endpoint" type="url" value="${escapeHtml(server.endpoint || '')}" maxlength="500" placeholder="https://mcp.example.com/mcp" /></label><label class="tool-wide">Bearer token <span class="optional">${server.hasBearerToken ? `Stored · ends ${escapeHtml(server.bearerTokenLast4 || '')}` : 'Optional'}</span><input name="bearerToken" type="password" maxlength="2000" autocomplete="new-password" /></label></div><div class="mcp-server-actions"><button class="secondary-button" type="button" data-sync-mcp="${index}">Save &amp; discover</button><span>${escapeHtml(server.serverInfo?.name || '')}${server.serverInfo?.version ? ` · ${escapeHtml(server.serverInfo.version)}` : ''}</span></div><div class="mcp-tools-grid">${tools || '<div class="context-empty"><b>No discovered tools</b><p>Save and discover this server, then explicitly enable the tools the Agent may call.</p></div>'}</div></article>`;
}

function renderMcpCustomize() {
  const settings = state.mcpSettings || { servers: [] };
  $('#customize-root').innerHTML = `<div class="customize-heading"><div><p class="eyebrow">AGENT RUNTIME</p><h1>Customize</h1><p>Connect governed MCP servers and authorize their tools.</p></div><button class="primary-button" id="save-mcp" ${canRole('admin') ? '' : 'disabled'}>Save MCP</button></div>${customizeTabs()}<section class="customize-section"><div class="section-head"><div><h2>MCP servers</h2><p>Streamable HTTP tools are namespaced and enter ReAct, Plan &amp; Execute, and Supervisor only after explicit approval.</p></div><button class="secondary-button" id="add-mcp-server" type="button">Add server</button></div><div id="mcp-server-list" class="custom-tool-list">${settings.servers.map(mcpServerRow).join('') || '<div class="context-empty"><b>No MCP servers</b><p>Add an allowlisted Streamable HTTP endpoint to discover its tools.</p></div>'}</div><p class="form-error" id="mcp-error"></p></section>`;
  $('#add-mcp-server').onclick = () => { state.mcpSettings.servers.push({ enabled: true, name: '', endpoint: '', discoveredTools: [] }); renderCustomize(); };
  $$('[data-remove-mcp]').forEach((button) => button.onclick = () => { state.mcpSettings.servers.splice(Number(button.dataset.removeMcp), 1); renderCustomize(); });
  $$('[data-sync-mcp]').forEach((button) => button.onclick = () => saveMcp(Number(button.dataset.syncMcp)));
  $('#save-mcp').onclick = () => saveMcp();
  bindCustomizeTabs();
}

function skillRow(skill, index) {
  const products = [['knowledge', 'Knowledge Builder'], ['research', 'Deep Research'], ['paper', 'Paper Author']];
  const selectedProducts = skill.productTypes || products.map(([value]) => value);
  return `<article class="custom-tool-row skill-row" data-skill-index="${index}" data-skill-id="${escapeHtml(skill.id || '')}"><div class="tool-row-heading"><label class="tool-enabled"><input type="checkbox" name="enabled" ${skill.enabled !== false ? 'checked' : ''} /> Enabled</label><span class="skill-activation-label">${skill.activation === 'always' ? 'Always for scope' : 'Matched on demand'}</span><button type="button" class="text-button tool-remove" data-remove-skill="${index}">Remove</button></div><div class="tool-form-grid"><label>Name<input name="name" value="${escapeHtml(skill.name || '')}" maxlength="48" placeholder="systematic_review" /></label><label>Display title<input name="title" value="${escapeHtml(skill.title || '')}" maxlength="80" placeholder="Systematic review" /></label><label class="tool-wide">Description<input name="description" value="${escapeHtml(skill.description || '')}" maxlength="500" placeholder="Describe when this playbook is useful" /></label><label>Activation<select name="activation"><option value="auto" ${skill.activation !== 'always' ? 'selected' : ''}>Trigger or /skill name</option><option value="always" ${skill.activation === 'always' ? 'selected' : ''}>Always for product scope</option></select></label><label>Trigger terms<input name="triggerTerms" value="${escapeHtml((skill.triggerTerms || []).join(', '))}" maxlength="980" placeholder="systematic review, PRISMA" /></label><fieldset class="tool-wide skill-products"><legend>Product scope</legend>${products.map(([value, label]) => `<label><input type="checkbox" data-skill-product="${value}" ${selectedProducts.includes(value) ? 'checked' : ''} /> ${label}</label>`).join('')}</fieldset><label class="tool-wide">Instructions<textarea name="instructions" rows="9" maxlength="4000" spellcheck="true" placeholder="Define the bounded method, checks, and output emphasis for this Skill.">${escapeHtml(skill.instructions || '')}</textarea></label></div></article>`;
}

function renderSkillsCustomize() {
  const settings = state.skillSettings || { skills: [] };
  $('#customize-root').innerHTML = `<div class="customize-heading"><div><p class="eyebrow">AGENT RUNTIME</p><h1>Customize</h1><p>Define reusable, governed playbooks for LangGraph runs.</p></div><button class="primary-button" id="save-skills" ${canRole('admin') ? '' : 'disabled'}>Save skills</button></div>${customizeTabs()}<section class="customize-section"><div class="section-head"><div><h2>Organization skills</h2><p>Up to three matching Skills guide a run. They cannot grant tools, add sources, or override Novi policy.</p></div><button class="secondary-button" id="add-skill" type="button">Add skill</button></div><div class="custom-tool-list">${settings.skills.map(skillRow).join('') || '<div class="context-empty"><b>No organization Skills</b><p>Add a bounded playbook, then choose its product scope and activation rule.</p></div>'}</div><p class="form-error" id="skills-error"></p></section>`;
  $('#add-skill').onclick = () => { state.skillSettings.skills.push({ enabled: true, name: '', title: '', description: '', activation: 'auto', triggerTerms: [], productTypes: ['knowledge', 'research', 'paper'], instructions: '' }); renderCustomize(); };
  $$('[data-remove-skill]').forEach((button) => button.onclick = () => { state.skillSettings.skills.splice(Number(button.dataset.removeSkill), 1); renderCustomize(); });
  $('#save-skills').onclick = saveSkills;
  bindCustomizeTabs();
}

function pluginRow(plugin, index) {
  const available = state.pluginSettings?.available || { skillNames: [], toolNames: [] }; const selectedProducts = plugin.productTypes || ['knowledge', 'research', 'paper'];
  const options = (values, selected) => values.map((value) => `<option value="${escapeHtml(value)}" ${(selected || []).includes(value) ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  return `<article class="custom-tool-row plugin-row" data-plugin-id="${escapeHtml(plugin.id || '')}"><div class="tool-row-heading"><label class="tool-enabled"><input type="checkbox" name="enabled" ${plugin.enabled !== false ? 'checked' : ''} /> Enabled</label><span class="skill-activation-label">Declarative manifest</span><button type="button" class="text-button tool-remove" data-remove-plugin="${index}">Remove</button></div><div class="tool-form-grid"><label>Name<input name="name" value="${escapeHtml(plugin.name || '')}" maxlength="48" placeholder="research_quality" /></label><label>Version<input name="version" value="${escapeHtml(plugin.version || '1.0.0')}" maxlength="32" /></label><label>Display title<input name="title" value="${escapeHtml(plugin.title || '')}" maxlength="80" /></label><label>Activation<select name="activation"><option value="auto" ${plugin.activation !== 'always' ? 'selected' : ''}>Trigger or /plugin name</option><option value="always" ${plugin.activation === 'always' ? 'selected' : ''}>Always for product scope</option></select></label><label class="tool-wide">Description<input name="description" value="${escapeHtml(plugin.description || '')}" maxlength="500" /></label><label class="tool-wide">Trigger terms<input name="triggerTerms" value="${escapeHtml((plugin.triggerTerms || []).join(', '))}" maxlength="980" /></label><fieldset class="tool-wide skill-products"><legend>Product scope</legend>${[['knowledge','Knowledge Builder'],['research','Deep Research'],['paper','Paper Author']].map(([value,label]) => `<label><input type="checkbox" data-plugin-product="${value}" ${selectedProducts.includes(value) ? 'checked' : ''} /> ${label}</label>`).join('')}</fieldset><label>Referenced Skills<select name="skillNames" multiple size="5">${options(available.skillNames, plugin.skillNames)}</select></label><label>Recommended authorized tools<select name="toolNames" multiple size="5">${options(available.toolNames, plugin.toolNames)}</select></label><label class="tool-wide">Composition instructions<textarea name="instructions" rows="7" maxlength="2000">${escapeHtml(plugin.instructions || '')}</textarea></label></div></article>`;
}

function renderPluginsCustomize() {
  const settings = state.pluginSettings || { plugins: [], available: { skillNames: [], toolNames: [] } };
  $('#customize-root').innerHTML = `<div class="customize-heading"><div><p class="eyebrow">AGENT RUNTIME</p><h1>Customize</h1><p>Compose approved Skills and tools without loading tenant code.</p></div><button class="primary-button" id="save-plugins">Save plugins</button></div>${customizeTabs()}<section class="customize-section"><div class="section-head"><div><h2>Declarative plugins</h2><p>Manifests recommend already-authorized capabilities; they never install code or grant permissions.</p></div><button class="secondary-button" id="add-plugin" type="button">Add plugin</button></div><div class="custom-tool-list">${settings.plugins.map(pluginRow).join('') || '<div class="context-empty"><b>No Plugins</b><p>Compose existing Skills and tools into a reusable manifest.</p></div>'}</div><p class="form-error" id="plugins-error"></p></section>`;
  $('#add-plugin').onclick = () => { settings.plugins.push({ enabled: true, name: '', version: '1.0.0', title: '', description: '', activation: 'auto', triggerTerms: [], productTypes: ['knowledge','research','paper'], skillNames: [], toolNames: [], instructions: '' }); renderCustomize(); };
  $$('[data-remove-plugin]').forEach((button) => button.onclick = () => { settings.plugins.splice(Number(button.dataset.removePlugin), 1); renderCustomize(); });
  $('#save-plugins').onclick = savePlugins; bindCustomizeTabs();
}

function renderCustomize() {
  if (state.customizeTab === 'mcp') renderMcpCustomize(); else if (state.customizeTab === 'skills') renderSkillsCustomize(); else if (state.customizeTab === 'plugins') renderPluginsCustomize(); else renderToolsCustomize();
}

async function openCustomize() {
  if (!canRole('admin')) return showToast('Admin access is required to configure Agent tools');
  state.activeProject = null;
  $('#view-overview').classList.remove('active-view'); $('#view-workspace').classList.remove('active-view'); $('#view-customize').classList.add('active-view');
  $('#page-label').textContent = 'Customize';
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === 'customize'));
  $('#customize-root').innerHTML = '<p class="muted">Loading Agent tools...</p>';
  try {
    const [tools, mcp, skills, plugins] = await Promise.all([request('/api/agent/tools'), request('/api/agent/mcp'), request('/api/agent/skills'), request('/api/agent/plugins')]);
    state.toolSettings = tools.settings; state.mcpSettings = mcp.settings; state.skillSettings = skills.settings; state.pluginSettings = plugins.settings; renderCustomize();
  }
  catch (error) { $('#customize-root').innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`; }
}

async function saveTools() {
  const error = $('#tools-error'); error.textContent = '';
  try {
    const builtins = Object.fromEntries($$('[data-builtin-tool]').map((input) => [input.dataset.builtinTool, input.checked]));
    const customTools = $$('.custom-tool-row').map((row) => {
      let inputSchema;
      try { inputSchema = JSON.parse($('[name="inputSchema"]', row).value); } catch { throw new Error(`Input schema for ${$('[name="name"]', row).value || 'custom tool'} is not valid JSON`); }
      return { id: row.dataset.customToolId || undefined, name: $('[name="name"]', row).value.trim(), endpoint: $('[name="endpoint"]', row).value.trim(), description: $('[name="description"]', row).value.trim(), bearerToken: $('[name="bearerToken"]', row).value || undefined, enabled: $('[name="enabled"]', row).checked, inputSchema };
    });
    const result = await request('/api/agent/tools', { method: 'PUT', body: JSON.stringify({ builtins, customTools }) });
    state.toolSettings = result.settings; state.pluginSettings = (await request('/api/agent/plugins')).settings; renderCustomize(); showToast('Agent tools saved');
  } catch (saveError) { error.textContent = saveError.message; }
}

function mcpPayload() {
  return { servers: $$('.mcp-server-row').map((row) => ({ id: row.dataset.mcpServerId || undefined, name: $('[name="name"]', row).value.trim(), endpoint: $('[name="endpoint"]', row).value.trim(), bearerToken: $('[name="bearerToken"]', row).value || undefined, enabled: $('[name="enabled"]', row).checked, enabledTools: $$('[data-mcp-tool]:checked', row).map((input) => input.dataset.mcpTool) })) };
}

async function saveMcp(discoverIndex = null) {
  $('#mcp-error').textContent = '';
  try {
    const result = await request('/api/agent/mcp', { method: 'PUT', body: JSON.stringify(mcpPayload()) });
    state.mcpSettings = result.settings;
    if (discoverIndex !== null) {
      const server = state.mcpSettings.servers[discoverIndex];
      if (!server) throw new Error('MCP server was not saved');
      renderCustomize();
      state.mcpSettings = (await request(`/api/agent/mcp/servers/${encodeURIComponent(server.id)}/sync`, { method: 'POST' })).settings;
      showToast('MCP tools discovered');
    } else showToast('MCP settings saved');
    state.pluginSettings = (await request('/api/agent/plugins')).settings;
    renderCustomize();
  } catch (saveError) { const error = $('#mcp-error'); if (error) error.textContent = saveError.message; }
}

async function saveSkills() {
  const error = $('#skills-error'); error.textContent = '';
  try {
    const skills = $$('.skill-row').map((row) => ({ id: row.dataset.skillId || undefined, name: $('[name="name"]', row).value.trim(), title: $('[name="title"]', row).value.trim(), description: $('[name="description"]', row).value.trim(), activation: $('[name="activation"]', row).value, triggerTerms: $('[name="triggerTerms"]', row).value.split(',').map((term) => term.trim()).filter(Boolean), productTypes: $$('[data-skill-product]:checked', row).map((input) => input.dataset.skillProduct), instructions: $('[name="instructions"]', row).value.trim(), enabled: $('[name="enabled"]', row).checked }));
    state.skillSettings = (await request('/api/agent/skills', { method: 'PUT', body: JSON.stringify({ skills }) })).settings;
    state.pluginSettings = (await request('/api/agent/plugins')).settings;
    renderCustomize(); showToast('Agent Skills saved');
  } catch (saveError) { error.textContent = saveError.message; }
}

async function savePlugins() {
  const error = $('#plugins-error'); error.textContent = '';
  try {
    const plugins = $$('.plugin-row').map((row) => ({ id: row.dataset.pluginId || undefined, name: $('[name="name"]', row).value.trim(), version: $('[name="version"]', row).value.trim(), title: $('[name="title"]', row).value.trim(), description: $('[name="description"]', row).value.trim(), activation: $('[name="activation"]', row).value, triggerTerms: $('[name="triggerTerms"]', row).value.split(',').map((term) => term.trim()).filter(Boolean), productTypes: $$('[data-plugin-product]:checked', row).map((input) => input.dataset.pluginProduct), skillNames: [...$('[name="skillNames"]', row).selectedOptions].map((option) => option.value), toolNames: [...$('[name="toolNames"]', row).selectedOptions].map((option) => option.value), instructions: $('[name="instructions"]', row).value.trim(), enabled: $('[name="enabled"]', row).checked }));
    state.pluginSettings = (await request('/api/agent/plugins', { method: 'PUT', body: JSON.stringify({ plugins }) })).settings; renderCustomize(); showToast('Agent Plugins saved');
  } catch (saveError) { error.textContent = saveError.message; }
}

$('#new-project').onclick = () => openModal(); $('#heading-new').onclick = () => openModal(); $('#empty-new').onclick = () => openModal(); $('#modal-close').onclick = closeModal; $('.modal-backdrop').onclick = closeModal; $('#snapshot-close').onclick = () => $('#snapshot-modal').classList.add('hidden'); $$('[data-close-snapshots]').forEach((node) => node.onclick = () => $('#snapshot-modal').classList.add('hidden'));
$('#billing-upgrade').onclick = openBilling; $('#billing-close').onclick = closeBilling; $$('[data-close-billing]').forEach((node) => node.onclick = closeBilling); $$('[data-checkout-plan]').forEach((node) => node.onclick = () => upgradePlan(node.dataset.checkoutPlan));
$('#model-settings').onclick = openProviderSettings; $('#provider-close').onclick = closeProviderSettings; $$('[data-close-provider]').forEach((node) => node.onclick = closeProviderSettings); $('#provider-form').addEventListener('submit', saveProviderSettings); $('#provider-form [name="provider"]').addEventListener('change', (event) => populateProviderForm(event.currentTarget.value)); $('#provider-test').onclick = testConfiguredProvider; $('#provider-disable').onclick = disableProvider;
$('#org-switch').onchange = (event) => switchOrganization(event.currentTarget.value);
$('#logout').onclick = logout;
$('#source-search').onclick = openSearch;
$('#help').onclick = () => showToast('⌘/Ctrl + K: search sources · ⌘/Ctrl + N: new workspace');
$('#search-close').onclick = closeSearch; $$('[data-close-search]').forEach((node) => node.onclick = closeSearch);
$('#knowledge-close').onclick = closeKnowledgeLibrary; $$('[data-close-knowledge]').forEach((node) => node.onclick = closeKnowledgeLibrary);
$('#auth-close').onclick = () => $('#auth-modal').classList.add('hidden');
$('#sso-login').onclick = () => { window.location.assign('/api/auth/oidc/start'); };
$('#auth-switch').onclick = () => { authRegister = !authRegister; $('#auth-switch').textContent = authRegister ? 'Already have an account? Sign in' : 'Need an account? Create one'; $('#auth-submit').textContent = authRegister ? 'Create account' : 'Sign in'; $('#auth-form [name="password"]').autocomplete = authRegister ? 'new-password' : 'current-password'; };
$('#auth-form').addEventListener('submit', async (event) => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); try { if (authRegister) await request('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) }); await request('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }); $('#auth-modal').classList.add('hidden'); $('#auth-error').textContent = ''; await loadProjects(); await loadBilling(); showToast(authRegister ? 'Account created' : 'Signed in'); } catch (error) { $('#auth-error').textContent = error.message; } });
$('#project-grid').addEventListener('click', (event) => { const pinButton = event.target.closest('[data-pin]'); if (pinButton) { event.stopPropagation(); pin(pinButton.dataset.pin); return; } const card = event.target.closest('[data-project]'); if (card) { const project = state.projects.find((p) => p.id === card.dataset.project); if (project) showWorkspace(project); } });
$('#project-form').addEventListener('submit', async (event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); const payload = Object.fromEntries(form.entries()); try { const result = await request('/api/projects', { method: 'POST', body: JSON.stringify(payload) }); state.projects.unshift(result.project); closeModal(); formElement.reset(); showWorkspace(result.project); showToast('Workspace created'); } catch (error) { $('#form-error').textContent = error.message; } });
$('#search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const topic = String(form.get('topic') || '').trim();
  $('#search-error').textContent = ''; $('#search-results').innerHTML = '<p class="muted">Searching configured providers…</p>';
  try {
    const result = await request(`/api/search?topic=${encodeURIComponent(topic)}`);
    $('#search-results').innerHTML = result.sources?.length ? result.sources.map((source) => `<article class="snapshot-item"><div class="snapshot-head"><a href="${escapeHtml(safeExternalUrl(source.url))}" target="_blank" rel="noopener noreferrer"><b>${escapeHtml(source.name)}</b></a><span>${escapeHtml(source.kind)} · ${Number(source.relevanceScore || 0).toFixed(2)}</span></div><p class="muted">${escapeHtml(source.snippet || 'No summary available.')}</p></article>`).join('') : '<p class="muted">No matching sources were returned.</p>';
  } catch (error) { $('#search-results').innerHTML = ''; $('#search-error').textContent = error.message; }
});
$('#knowledge-search-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget); const query = String(form.get('query') || '').trim(); const projectId = event.currentTarget.dataset.projectId;
  $('#knowledge-error').textContent = ''; $('#knowledge-results').innerHTML = '<p class="muted">Searching semantic memory…</p>';
  try { const payload = await request(`/api/projects/${projectId}/knowledge?q=${encodeURIComponent(query)}&limit=10`); renderKnowledgeMatches(payload.results || []); }
  catch (error) { $('#knowledge-results').innerHTML = ''; $('#knowledge-error').textContent = error.message; }
});
$('#knowledge-results').addEventListener('click', (event) => {
  const button = event.target.closest('[data-delete-document]'); if (!button) return;
  deleteKnowledgeDocument($('#knowledge-search-form').dataset.projectId, button.dataset.deleteDocument, button.dataset.documentTitle || 'this document');
});
$$('.nav-tab').forEach((tab) => tab.addEventListener('click', () => { if (tab.dataset.view === 'overview') showOverview(); else if (tab.dataset.view === 'customize') openCustomize(); else openModal(tab.dataset.view); })); $('#view-all').onclick = showOverview;
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal(); closeSearch(); closeKnowledgeLibrary(); closeBilling(); closeProviderSettings(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openModal(); } });
applyRoleCapabilities(); loadProjects().then(loadBilling).catch((error) => showToast(error.message));

export { state, applyRoleCapabilities, renderWorkspace, renderKnowledgeDocuments };
