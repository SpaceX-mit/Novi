import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();
const MAX_RUN_EVENTS = 100;
const MAX_RUN_EVENT_TEXT = 12_000;

function boundedEventDetail(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value.slice(0, MAX_RUN_EVENT_TEXT);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    const stringEntries = entries.filter(([, item]) => typeof item === 'string');
    if (stringEntries.length) {
      const perField = Math.max(400, Math.floor((MAX_RUN_EVENT_TEXT - 256) / stringEntries.length));
      const bounded = Object.fromEntries(entries.map(([key, item]) => [key, typeof item === 'string' ? item.slice(0, perField) : item]));
      try {
        if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= MAX_RUN_EVENT_TEXT) return bounded;
      } catch { /* fall through to the generic bounded representation */ }
    }
  }
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { return { error: 'Event detail was not serializable' }; }
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_RUN_EVENT_TEXT) return JSON.parse(serialized);
  return { truncated: true, text: Buffer.from(serialized, 'utf8').subarray(0, MAX_RUN_EVENT_TEXT).toString('utf8') };
}

export function normalizeRunEvent(input = {}) {
  const createdAt = String(input.createdAt || now());
  return {
    id: String(input.id || randomUUID()).slice(0, 240),
    type: String(input.type || 'status').slice(0, 40),
    actor: String(input.actor || 'Novi').slice(0, 160),
    title: String(input.title || 'Agent activity').slice(0, 240),
    status: String(input.status || 'completed').slice(0, 40),
    createdAt,
    ...(input.completedAt ? { completedAt: String(input.completedAt) } : {}),
    ...(input.stageId ? { stageId: String(input.stageId).slice(0, 80) } : {}),
    ...(input.mode ? { mode: String(input.mode).slice(0, 40) } : {}),
    ...(input.provider ? { provider: String(input.provider).slice(0, 80) } : {}),
    ...(input.model ? { model: String(input.model).slice(0, 160) } : {}),
    ...(input.summary ? { summary: String(input.summary).slice(0, 2_000) } : {}),
    ...(input.request !== undefined ? { request: boundedEventDetail(input.request) } : {}),
    ...(input.response !== undefined ? { response: boundedEventDetail(input.response) } : {}),
    ...(input.input !== undefined ? { input: boundedEventDetail(input.input) } : {}),
    ...(input.output !== undefined ? { output: boundedEventDetail(input.output) } : {}),
    ...(input.warning ? { warning: String(input.warning).slice(0, 500) } : {}),
    ...(input.error ? { error: String(input.error).slice(0, 500) } : {}),
    ...(input.usage ? { usage: boundedEventDetail(input.usage) } : {}),
  };
}

export function upsertRunEvent(events, input) {
  const list = Array.isArray(events) ? [...events] : [];
  const event = normalizeRunEvent(input);
  const index = list.findIndex((item) => item.id === event.id);
  if (index >= 0) list[index] = { ...list[index], ...event, createdAt: list[index].createdAt || event.createdAt };
  else list.push(event);
  return list.slice(-MAX_RUN_EVENTS);
}

function welcomeMessage(project, createdAt) {
  return {
    id: randomUUID(),
    role: 'assistant',
    kind: 'welcome',
    content: `Workspace ready for ${project.topic}. Send a request or use Generate now to start the Agent.`,
    createdAt,
  };
}

export function createAgentSession(state, project, principal, input = {}) {
  state.agentSessions ||= [];
  const createdAt = now();
  const title = String(input.title || project.title || 'New session').trim().slice(0, 120) || 'New session';
  const session = {
    id: randomUUID(),
    tenantId: project.tenantId || principal.tenantId || 'local',
    projectId: project.id,
    createdBy: principal.id || project.ownerId || 'local',
    title,
    status: 'idle',
    activeRun: null,
    messages: [welcomeMessage(project, createdAt)],
    createdAt,
    updatedAt: createdAt,
  };
  state.agentSessions.unshift(session);
  return session;
}

export function ensureAgentSession(state, project, principal) {
  state.agentSessions ||= [];
  const tenantId = project.tenantId || principal.tenantId || 'local';
  return state.agentSessions
    .filter((session) => session.projectId === project.id && session.tenantId === tenantId)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0]
    || createAgentSession(state, project, principal);
}

export function findAgentSession(state, sessionId, projectId, tenantId) {
  return (state.agentSessions || []).find((session) => session.id === sessionId && session.projectId === projectId && session.tenantId === tenantId) || null;
}

export function appendSessionMessage(session, input) {
  session.messages ||= [];
  const content = String(input.content || '').trim();
  if (!content || content.length > 20_000) throw Object.assign(new Error('message content is required and must be 20000 characters or less'), { status: 422 });
  const message = {
    id: randomUUID(),
    role: input.role,
    kind: input.kind || 'message',
    content,
    createdAt: now(),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.toolCalls?.length ? { toolCalls: input.toolCalls.slice(-20).map((call) => ({ ...call })) } : {}),
    ...(input.skills?.length ? { skills: input.skills.slice(0, 3).map((skill) => ({ ...skill, productTypes: [...(skill.productTypes || [])] })) } : {}),
    ...(input.plugins?.length ? { plugins: input.plugins.slice(0, 2).map((plugin) => ({ ...plugin, productTypes: [...(plugin.productTypes || [])], skillNames: [...(plugin.skillNames || [])], recommendedTools: [...(plugin.recommendedTools || [])] })) } : {}),
    ...(input.runEvents?.length ? { runEvents: input.runEvents.slice(-MAX_RUN_EVENTS).map((event) => normalizeRunEvent(event)) } : {}),
    ...(input.runtime ? { runtime: structuredClone(input.runtime) } : {}),
  };
  session.messages.push(message);
  session.messages = session.messages.slice(-500);
  session.updatedAt = message.createdAt;
  return message;
}

export function beginSessionRun(session, { jobId, prompt, requestedMode, currentMode }) {
  const message = appendSessionMessage(session, { role: 'user', content: prompt, runId: jobId, jobId, mode: currentMode, status: 'queued' });
  session.status = 'running';
  session.activeRun = { jobId, requestedMode, currentMode, currentStage: 'Queued', progress: 0, runEvents: [], startedAt: message.createdAt };
  session.updatedAt = message.createdAt;
  return message;
}

export function updateSessionRun(session, patch) {
  if (!session?.activeRun) return null;
  Object.assign(session.activeRun, patch, { updatedAt: now() });
  session.status = 'running'; session.updatedAt = session.activeRun.updatedAt;
  const message = (session.messages || []).find((item) => item.jobId === session.activeRun.jobId && item.role === 'user');
  if (message) { message.status = 'running'; message.mode = session.activeRun.currentMode || message.mode; }
  return session.activeRun;
}

export function updateSessionToolCall(session, call) {
  if (!session?.activeRun) return null;
  session.activeRun.toolCalls ||= [];
  const existing = session.activeRun.toolCalls.find((item) => item.id === call.id);
  if (existing) Object.assign(existing, call); else session.activeRun.toolCalls.push(call);
  session.activeRun.toolCalls = session.activeRun.toolCalls.slice(-20);
  session.activeRun.currentStage = call.status === 'running' ? `Using ${call.tool}` : `${call.tool} ${call.status}`;
  session.activeRun.updatedAt = now(); session.updatedAt = session.activeRun.updatedAt;
  return existing || session.activeRun.toolCalls.at(-1);
}

export function updateSessionRunEvent(session, event) {
  if (!session?.activeRun) return null;
  session.activeRun.runEvents = upsertRunEvent(session.activeRun.runEvents, event);
  session.activeRun.updatedAt = now(); session.updatedAt = session.activeRun.updatedAt;
  return session.activeRun.runEvents.find((item) => item.id === String(event.id)) || session.activeRun.runEvents.at(-1);
}

export function completeSessionRun(session, { jobId, artifact, mode }) {
  if (!session) return null;
  const userMessage = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'user');
  if (userMessage) { userMessage.status = 'completed'; userMessage.mode = mode || userMessage.mode; }
  const summary = String(artifact?.content?.summary || artifact?.title || 'Artifact generated.').trim().slice(0, 12_000);
  const toolCalls = session.activeRun?.jobId === jobId ? session.activeRun.toolCalls || [] : [];
  const skills = artifact?.workflow?.runtime?.skills || (session.activeRun?.jobId === jobId ? session.activeRun.skills || [] : []);
  const plugins = artifact?.workflow?.runtime?.plugins || (session.activeRun?.jobId === jobId ? session.activeRun.plugins || [] : []);
  const runEvents = session.activeRun?.jobId === jobId ? session.activeRun.runEvents || [] : [];
  const message = appendSessionMessage(session, { role: 'assistant', kind: 'artifact', content: summary, runId: jobId, jobId, artifactId: artifact?.id, mode, status: 'completed', toolCalls, skills, plugins, runEvents });
  session.status = 'idle'; session.activeRun = null; session.updatedAt = message.createdAt;
  return message;
}

export function completeSessionConversation(session, { jobId, response, runtime, mode }) {
  if (!session) return null;
  const userMessage = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'user');
  if (userMessage) { userMessage.status = 'completed'; userMessage.mode = mode || userMessage.mode; }
  const toolCalls = runtime?.toolCalls || (session.activeRun?.jobId === jobId ? session.activeRun.toolCalls || [] : []);
  const skills = runtime?.skills || (session.activeRun?.jobId === jobId ? session.activeRun.skills || [] : []);
  const plugins = runtime?.plugins || (session.activeRun?.jobId === jobId ? session.activeRun.plugins || [] : []);
  const message = appendSessionMessage(session, { role: 'assistant', kind: 'message', content: response, runId: jobId, jobId, mode, status: 'completed', toolCalls, skills, plugins, runtime });
  session.status = 'idle'; session.activeRun = null; session.updatedAt = message.createdAt;
  return message;
}

export function failSessionRun(session, { jobId, mode, error = 'Generation failed' }) {
  if (!session) return null;
  const userMessage = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'user');
  if (userMessage) { userMessage.status = 'failed'; userMessage.mode = mode || userMessage.mode; }
  const existing = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'assistant' && item.status === 'failed');
  const runEvents = session.activeRun?.jobId === jobId ? session.activeRun.runEvents || [] : [];
  const message = existing || appendSessionMessage(session, { role: 'assistant', kind: 'error', content: String(error).slice(0, 500), runId: jobId, jobId, mode, status: 'failed', runEvents });
  session.status = 'idle'; session.activeRun = null; session.updatedAt = message.createdAt;
  return message;
}

export function sessionSummary(session) {
  const last = session.messages?.at(-1);
  return {
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    status: session.status,
    activeRun: session.activeRun || null,
    messageCount: session.messages?.length || 0,
    lastMessage: last ? { role: last.role, kind: last.kind, content: last.content.slice(0, 240), createdAt: last.createdAt } : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function publicAgentSession(session) {
  return { ...session, messages: (session.messages || []).map((message) => ({ ...message })) };
}

export { MAX_RUN_EVENTS, MAX_RUN_EVENT_TEXT };
