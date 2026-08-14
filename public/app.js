const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { projects: [], activeProject: null, activeTab: 'overview', activeArtifactId: null, compareVersions: false, role: 'viewer' };
let authRegister = false;
const roleRank = Object.freeze({ viewer: 10, editor: 20, admin: 30, owner: 40 });
const canRole = (required) => (roleRank[state.role] || 0) >= roleRank[required];

function applyRoleCapabilities() {
  const editor = canRole('editor');
  for (const id of ['new-project', 'heading-new', 'empty-new']) { const node = $(`#${id}`); if (node) node.hidden = !editor; }
  $$('.nav-tab').filter((tab) => tab.dataset.view !== 'overview').forEach((tab) => { tab.hidden = !editor; });
  $('#billing-upgrade').hidden = !canRole('admin');
  if (!canRole('admin')) $('#billing-modal')?.classList.add('hidden');
}

const typeMeta = {
  knowledge: { label: 'KNOWLEDGE BUILDER', color: 'knowledge' },
  research: { label: 'DEEP RESEARCH', color: 'research' },
  paper: { label: 'PAPER AUTHOR', color: 'paper' },
};

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
  $('#view-overview').classList.add('active-view'); $('#view-workspace').classList.remove('active-view');
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
  $('#view-overview').classList.remove('active-view'); $('#view-workspace').classList.add('active-view');
  $('#page-label').textContent = project.title;
  $$('.nav-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === project.type));
  renderWorkspace(project);
}

function renderWorkspace(project, selected = state.activeTab) {
  const artifacts = project.artifacts || [];
  let artifactIndex = artifacts.findIndex((item) => item.id === state.activeArtifactId);
  if (artifactIndex < 0) artifactIndex = 0;
  const artifact = artifacts[artifactIndex];
  if (artifact) state.activeArtifactId = artifact.id;
  const previousArtifact = artifactIndex >= 0 ? artifacts[artifactIndex + 1] : null;
  const c = artifact?.content;
  const meta = typeMeta[project.type];
  const availableTabs = tabsFor(project.type);
  const editor = canRole('editor'); const administrator = canRole('admin');
  if (!availableTabs.some((tab) => tab.key === selected)) selected = availableTabs[0].key;
  state.activeTab = selected;
  $('#workspace-root').innerHTML = `<button class="back-link" id="back-overview">← All workspaces</button>
    <div class="workspace-head"><div><span class="type-label ${meta.color}">${meta.label}</span><h1>${escapeHtml(project.title)}</h1><p>${escapeHtml(project.topic)}</p>${project.status === 'generating' ? '<div class="evidence-badge">◌ Generation in progress…</div>' : ''}</div><div class="workspace-actions">${editor ? `<button class="secondary-button" id="pin-workspace">${project.pinned ? '★ Pinned' : '☆ Pin'}</button>` : ''}${artifact ? `<button class="secondary-button" id="export-md">↓ Markdown</button>${project.type === 'paper' ? '<button class="secondary-button" id="export-ieee">↓ IEEE LaTeX</button><button class="secondary-button" id="export-acm">↓ ACM LaTeX</button>' : ''}` : ''}${administrator ? '<button class="secondary-button danger-button" id="delete-workspace">Delete</button>' : ''}${editor ? `<button class="primary-button" id="generate" ${project.status === 'generating' ? 'disabled' : ''}>${project.status === 'generating' ? 'Generating…' : artifact ? '↻ Regenerate' : '✦ Generate asset'}</button>` : ''}</div></div>
    ${artifact ? `${renderVersionToolbar(project, artifactIndex)}${state.compareVersions && previousArtifact ? renderVersionComparison(project, artifactIndex) : ''}<div class="workspace-layout"><div class="artifact-panel"><div class="artifact-tabs">${availableTabs.map((tab) => `<button class="artifact-tab ${selected === tab.key ? 'active' : ''}" data-artifact-tab="${tab.key}">${tab.label}</button>`).join('')}</div><div class="artifact-content">${renderArtifact(project, selected, c)}</div></div><aside><div class="side-panel"><h3>Workspace details</h3><div class="side-meta"><div><span>Workspace created</span><b>${formatDate(project.createdAt)}</b></div><div><span>Selected version</span><b>Version ${artifacts.length - artifactIndex}</b></div><div><span>Generated</span><b>${formatDate(artifact.createdAt)}</b></div><div><span>Sources mapped</span><b>${c.sources?.length || 0}</b></div></div></div><div class="side-panel"><h3>Knowledge actions</h3><div class="generate-box"><p>Keep this workspace current as your understanding evolves.</p><button class="secondary-button full" id="copy-summary">Copy summary</button>${editor ? '<button class="secondary-button full" id="ingest-document" style="margin-top:8px">Import notes</button><button class="secondary-button full" id="import-url" style="margin-top:8px">Import web/PDF URL</button>' : ''}<button class="secondary-button full" id="knowledge-library" style="margin-top:8px">Browse & search knowledge</button>${editor ? '<button class="secondary-button full" id="refresh-sources" style="margin-top:8px">Refresh sources</button>' : ''}<button class="secondary-button full" id="show-snapshots" style="margin-top:8px">View source history</button>${editor ? '<button class="secondary-button full" id="toggle-watch" style="margin-top:8px">Configure updates</button>' : ''}</div></div></aside></div>` : `<div class="empty-state show"><div class="empty-icon">✦</div><h3>Your workspace is ready</h3><p>${editor ? `Generate a structured ${meta.label.toLowerCase()} artifact to begin.` : 'This workspace has not generated an artifact yet.'}</p>${editor ? '<button class="primary-button" id="generate-empty">Generate now <span>→</span></button>' : ''}</div>`}`;
  if (c?.knowledgeContext?.length && ['wiki', 'report', 'draft'].includes(selected)) $('.artifact-content')?.insertAdjacentHTML('beforeend', renderWorkspaceKnowledgeContext(c.knowledgeContext));
  $('#back-overview').onclick = showOverview;
  $('#generate')?.addEventListener('click', () => generate(project.id)); $('#generate-empty')?.addEventListener('click', () => generate(project.id));
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
}

function renderWorkspaceKnowledgeContext(items) {
  return `<section class="artifact-knowledge-context"><h3>Workspace knowledge used</h3><p class="context-disclaimer">Retrieved from your semantic memory for this version. Treat these passages as user-provided context, not independently verified evidence.</p>${items.map((item) => `<article><div><b>${escapeHtml(item.document)}</b><span>${Math.round(Math.max(0, Math.min(1, Number(item.relevanceScore) || 0)) * 100)}% match</span></div><p>${escapeHtml(item.excerpt)}</p></article>`).join('')}</section>`;
}

function tabsFor(type) {
  if (type === 'knowledge') return [{ key: 'wiki', label: 'LLM WIKI' }, { key: 'path', label: 'LEARNING PATH' }, { key: 'practice', label: 'PRACTICE LAB' }, { key: 'graph', label: 'KNOWLEDGE GRAPH' }, { key: 'sources', label: 'SOURCES' }];
  if (type === 'research') return [{ key: 'report', label: 'REPORT' }, { key: 'wiki', label: 'LLM WIKI' }, { key: 'graph', label: 'KNOWLEDGE GRAPH' }, { key: 'sota', label: 'SOTA ANALYSIS' }, { key: 'opportunities', label: 'OPPORTUNITIES' }, { key: 'sources', label: 'SOURCES' }];
  return [{ key: 'draft', label: 'DRAFT' }, { key: 'novelty', label: 'GAP & NOVELTY' }, { key: 'method', label: 'METHOD' }, { key: 'experiments', label: 'EXPERIMENTS' }, { key: 'figures', label: 'FIGURES' }, { key: 'review', label: 'REVIEW' }, { key: 'sources', label: 'SOURCES' }];
}

function renderArtifact(project, selected, c) {
  if (selected === 'wiki' && c.wikiSections) c = { ...c, sections: c.wikiSections, abstract: null, contributions: null };
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
async function logout() { try { await request('/api/auth/logout', { method: 'POST' }); } finally { state.projects = []; state.activeProject = null; state.role = 'viewer'; applyRoleCapabilities(); showOverview(); $('#auth-modal').classList.remove('hidden'); showToast('Signed out'); } }
function openBilling() { if (!canRole('admin')) return showToast('Admin access is required to manage billing'); $('#billing-error').textContent = ''; $('#billing-modal').classList.remove('hidden'); }
function closeBilling() { $('#billing-modal').classList.add('hidden'); $('#billing-error').textContent = ''; }
async function upgradePlan(plan) { try { const result = await request('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, returnUrl: window.location.href }) }); if (result.checkoutUrl) { const url = safeExternalUrl(result.checkoutUrl); if (url === '#') throw new Error('Payment provider returned an unsafe checkout URL'); window.open(url, '_blank', 'noopener,noreferrer'); } } catch (error) { $('#billing-error').textContent = error.message; showToast(error.message); } }
async function generate(id) {
  try {
    showToast('Generation queued…');
    const queued = await request(`/api/projects/${id}/generate?async=true`, { method: 'POST' });
    let job = queued.job;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      job = (await request(`/api/jobs/${job.id}`)).job;
      if (job.status === 'completed') break;
      if (job.status === 'failed') throw new Error(job.error || 'Generation failed');
    }
    if (job.status !== 'completed') throw new Error('Generation timed out');
    const result = await request(`/api/projects/${id}`);
    state.projects = state.projects.map((p) => p.id === id ? result.project : p);
    state.activeArtifactId = result.project.artifacts?.[0]?.id || null; state.compareVersions = false;
    state.activeTab = 'overview'; showWorkspace(result.project); showToast('Knowledge asset generated');
  } catch (error) { showToast(error.message); }
}
async function pin(id) { const result = await request(`/api/projects/${id}/pin`, { method: 'PATCH' }); state.projects = state.projects.map((p) => p.id === id ? result.project : p); showWorkspace(result.project); renderProjects(); }
async function deleteWorkspace(project) {
  if (!window.confirm(`Delete “${project.title}” and its indexed knowledge? This cannot be undone.`)) return;
  try {
    await request(`/api/projects/${project.id}`, { method: 'DELETE' });
    state.projects = state.projects.filter((item) => item.id !== project.id); showOverview(); showToast('Workspace deleted');
  } catch (error) { showToast(error.message); }
}
async function switchOrganization(tenantId) {
  if (!tenantId) return;
  try {
    await request('/api/auth/switch', { method: 'POST', body: JSON.stringify({ tenantId }) });
    state.activeProject = null; state.activeTab = 'overview'; await loadProjects(); await loadBilling(); showOverview(); showToast('Organization switched');
  } catch (error) { showToast(error.message); await loadBilling(); }
}
async function exportArtifact(id, format = 'markdown', artifactId = null, template = 'article') { try { const requestedVersion = artifactId ? `&artifactId=${encodeURIComponent(artifactId)}` : ''; const requestedTemplate = format === 'latex' ? `&template=${encodeURIComponent(template)}` : ''; const content = await request(`/api/projects/${id}/export?format=${format}${requestedVersion}${requestedTemplate}`); const extension = format === 'latex' ? 'tex' : 'md'; const blob = new Blob([content], { type: format === 'latex' ? 'application/x-tex' : 'text/markdown' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); const project = state.projects.find((item) => item.id === id) || state.activeProject; const index = project?.artifacts?.findIndex((item) => item.id === artifactId) ?? -1; const number = index >= 0 ? project.artifacts.length - index : project?.artifacts?.length || 1; const safeName = String(project?.title || 'novi-workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'novi-workspace'; link.href = url; link.download = `${safeName}-v${number}${format === 'latex' && template !== 'article' ? `-${template}` : ''}.${extension}`; link.click(); URL.revokeObjectURL(url); showToast(`${format === 'latex' ? template.toUpperCase() + ' LaTeX' : 'Markdown'} version ${number} downloaded`); } catch (error) { showToast(error.message); } }
async function ingestDocument(id) {
  const title = window.prompt('Notes title'); if (!title) return;
  const content = window.prompt('Paste notes or source text (up to 900 KB)'); if (!content) return;
  const sourceUrl = window.prompt('Optional source URL (https://…)') || '';
  try { await request(`/api/projects/${id}/knowledge`, { method: 'POST', body: JSON.stringify({ title, content, sourceUrl }) }); showToast('Notes indexed into workspace'); } catch (error) { showToast(error.message); }
}
async function importUrl(id) {
  const title = window.prompt('Document title'); if (!title) return;
  const sourceUrl = window.prompt('Public web page or PDF URL (https://…)'); if (!sourceUrl) return;
  const render = window.confirm('Does this page require JavaScript rendering? Choose OK only when your organization configured Browser Agent.') ? 'browser' : 'static';
  try { await request(`/api/projects/${id}/knowledge/import`, { method: 'POST', body: JSON.stringify({ title, url: sourceUrl, render }) }); showToast(`${render === 'browser' ? 'Rendered page' : 'Remote document'} imported and indexed`); } catch (error) { showToast(error.message); }
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
  try { await request(`/api/projects/${projectId}/knowledge/${documentId}`, { method: 'DELETE' }); showToast('Knowledge document removed'); await showKnowledgeLibrary(projectId); }
  catch (error) { showToast(error.message); }
}
async function refreshSources(id) { try { const result = await request(`/api/projects/${id}/refresh`, { method: 'POST' }); if (result.update?.status === 'completed') { await loadProjects(); const project = state.projects.find((item) => item.id === id); if (project) showWorkspace(project); } const update = result.update?.status === 'completed' ? ' · workspace updated' : result.update?.status === 'unchanged' ? ' · no source changes' : result.update?.status === 'quota-exceeded' ? ' · generation quota reached' : ''; showToast(`Sources refreshed: ${result.snapshot.sourceCount}${update}`); } catch (error) { showToast(error.message); } }
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

$('#new-project').onclick = () => openModal(); $('#heading-new').onclick = () => openModal(); $('#empty-new').onclick = () => openModal(); $('#modal-close').onclick = closeModal; $('.modal-backdrop').onclick = closeModal; $('#snapshot-close').onclick = () => $('#snapshot-modal').classList.add('hidden'); $$('[data-close-snapshots]').forEach((node) => node.onclick = () => $('#snapshot-modal').classList.add('hidden'));
$('#billing-upgrade').onclick = openBilling; $('#billing-close').onclick = closeBilling; $$('[data-close-billing]').forEach((node) => node.onclick = closeBilling); $$('[data-checkout-plan]').forEach((node) => node.onclick = () => upgradePlan(node.dataset.checkoutPlan));
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
$$('.nav-tab').forEach((tab) => tab.addEventListener('click', () => { if (tab.dataset.view === 'overview') showOverview(); else openModal(tab.dataset.view); })); $('#view-all').onclick = showOverview;
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal(); closeSearch(); closeKnowledgeLibrary(); closeBilling(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); openModal(); } });
applyRoleCapabilities(); loadProjects().then(loadBilling).catch((error) => showToast(error.message));

export { state, applyRoleCapabilities, renderWorkspace, renderKnowledgeDocuments };
