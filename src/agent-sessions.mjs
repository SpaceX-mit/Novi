import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();

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
  };
  session.messages.push(message);
  session.messages = session.messages.slice(-500);
  session.updatedAt = message.createdAt;
  return message;
}

export function beginSessionRun(session, { jobId, prompt, requestedMode, currentMode }) {
  const message = appendSessionMessage(session, { role: 'user', content: prompt, runId: jobId, jobId, mode: currentMode, status: 'queued' });
  session.status = 'running';
  session.activeRun = { jobId, requestedMode, currentMode, currentStage: 'Queued', progress: 0, startedAt: message.createdAt };
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

export function completeSessionRun(session, { jobId, artifact, mode }) {
  if (!session) return null;
  const userMessage = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'user');
  if (userMessage) { userMessage.status = 'completed'; userMessage.mode = mode || userMessage.mode; }
  const summary = String(artifact?.content?.summary || artifact?.title || 'Artifact generated.').trim().slice(0, 12_000);
  const toolCalls = session.activeRun?.jobId === jobId ? session.activeRun.toolCalls || [] : [];
  const message = appendSessionMessage(session, { role: 'assistant', kind: 'artifact', content: summary, runId: jobId, jobId, artifactId: artifact?.id, mode, status: 'completed', toolCalls });
  session.status = 'idle'; session.activeRun = null; session.updatedAt = message.createdAt;
  return message;
}

export function failSessionRun(session, { jobId, mode, error = 'Generation failed' }) {
  if (!session) return null;
  const userMessage = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'user');
  if (userMessage) { userMessage.status = 'failed'; userMessage.mode = mode || userMessage.mode; }
  const existing = (session.messages || []).find((item) => item.jobId === jobId && item.role === 'assistant' && item.status === 'failed');
  const message = existing || appendSessionMessage(session, { role: 'assistant', kind: 'error', content: String(error).slice(0, 500), runId: jobId, jobId, mode, status: 'failed' });
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
