import { randomUUID } from 'node:crypto';
import { searchKnowledgeSources } from './connectors.mjs';
import { consumeGeneration, consumeSourceQuery, refundGeneration, refundSourceQuery } from './billing.mjs';
import { verifyEvidenceSources } from './evidence.mjs';
import { generateArtifactAsync } from './engine.mjs';
import { searchProjectKnowledge } from './knowledge.mjs';
import { resolvedProviderConfig } from './llm-providers.mjs';

const DAY = 24 * 60 * 60 * 1000;
const CLAIM_TTL = 15 * 60 * 1000;

function due(config, now) {
  if (!config.enabled || config.frequency === 'manual') return false;
  const interval = config.frequency === 'weekly' ? 7 * DAY : DAY;
  return !config.lastRefreshedAt || now - Date.parse(config.lastRefreshedAt) >= interval;
}

function claimAvailable(config, now) {
  if (!config?.refreshing) return true;
  const started = Date.parse(config.refreshStartedAt || '');
  return !Number.isFinite(started) || now - started >= CLAIM_TTL;
}

function sourceFingerprint(source) {
  return [source.contentHash || '', source.publishedAt || '', source.updatedAt || '', source.name || '', source.snippet || ''].join('|');
}

export function sourceChanges(previous = [], current = []) {
  const before = new Map(previous.filter((item) => item?.url).map((item) => [item.url, sourceFingerprint(item)]));
  const after = new Map(current.filter((item) => item?.url).map((item) => [item.url, sourceFingerprint(item)]));
  let added = 0; let updated = 0; let removed = 0;
  for (const [url, fingerprint] of after) { if (!before.has(url)) added += 1; else if (before.get(url) !== fingerprint) updated += 1; }
  for (const url of before.keys()) if (!after.has(url)) removed += 1;
  return { changed: added + updated + removed > 0, added, updated, removed };
}

function updateSnapshot(state, snapshotId, patch) {
  const snapshot = (state.sourceSnapshots || []).find((item) => item.id === snapshotId);
  if (snapshot) Object.assign(snapshot, patch);
}

function updaterActive(state, user, tenantId) {
  if (user.id === 'local') return true;
  if (user.id === 'refresh-worker') return (state.memberships || []).some((item) => item.tenantId === tenantId && item.status === 'active');
  return (state.users || []).some((item) => item.id === user.id)
    && (state.memberships || []).some((item) => item.userId === user.id && item.tenantId === tenantId && item.status === 'active');
}

/** Generate a new immutable artifact only when a refresh found source changes. */
export async function updateProjectFromSnapshot(store, snapshot, user) {
  if (!snapshot?.id || snapshot.changeStatus !== 'changed') return { status: 'unchanged' };
  const marked = await store.update((state) => {
    const project = (state.projects || []).find((item) => item.id === snapshot.projectId && item.tenantId === snapshot.tenantId);
    const watch = (state.watchConfigs || []).find((item) => item.projectId === snapshot.projectId && item.tenantId === snapshot.tenantId);
    if (!project) return { status: 'deleted' };
    if (watch?.autoUpdate === false) { updateSnapshot(state, snapshot.id, { autoUpdateStatus: 'disabled' }); return { status: 'disabled' }; }
    if (project.status === 'generating') { updateSnapshot(state, snapshot.id, { autoUpdateStatus: 'busy' }); return { status: 'busy' }; }
    const quota = consumeGeneration(state, user);
    if (!quota.allowed) { updateSnapshot(state, snapshot.id, { autoUpdateStatus: 'quota-exceeded' }); return { status: 'quota-exceeded' }; }
    const now = new Date().toISOString();
    const job = { id: randomUUID(), type: 'continuous-update', projectId: project.id, userId: user.id, tenantId: user.tenantId, status: 'running', progress: 30, previousStatus: project.status, generationCharged: true, generationRefunded: false, sourceCharged: false, generationPeriod: quota.usage.period, snapshotId: snapshot.id, createdAt: now, updatedAt: now };
    state.jobs ||= []; state.jobs.unshift(job); project.status = 'generating'; project.updatedAt = now;
    updateSnapshot(state, snapshot.id, { autoUpdateStatus: 'running', autoUpdateJobId: job.id });
    return { status: 'running', project: structuredClone(project), job: structuredClone(job) };
  });
  if (marked.status !== 'running') return marked;
  try {
    const query = `${marked.project.topic || ''} ${marked.project.description || ''}`.trim();
    const knowledgeContext = query
      ? (typeof store.searchKnowledge === 'function' ? await store.searchKnowledge(marked.project.id, marked.project.tenantId, query, 6) : searchProjectKnowledge(await store.read(), marked.project.id, marked.project.tenantId, query, 6))
      : [];
    const stillActive = await store.update((state) => Boolean(
      (state.projects || []).some((item) => item.id === marked.project.id && item.tenantId === marked.project.tenantId)
      && (state.jobs || []).some((item) => item.id === marked.job.id && item.status === 'running')
      && updaterActive(state, user, marked.project.tenantId)
    ));
    if (!stillActive) throw new Error('Continuous update was cancelled');
    const providerConfig = await resolvedProviderConfig(await store.read(), marked.project.tenantId);
    const onStage = async (stage) => store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === marked.job.id && item.status === 'running');
      if (!job || !updaterActive(state, user, marked.project.tenantId)) return false;
      job.agentStages ||= [];
      const index = job.agentStages.findIndex((item) => item.id === stage.id);
      const publicStage = { id: stage.id, name: stage.name, status: stage.status, ...(stage.startedAt ? { startedAt: stage.startedAt } : {}), ...(stage.completedAt ? { completedAt: stage.completedAt } : {}), ...(stage.usage ? { usage: stage.usage } : {}), ...(stage.error ? { error: stage.error } : {}) };
      if (index >= 0) job.agentStages[index] = publicStage; else job.agentStages.push(publicStage);
      job.progress = Math.max(job.progress || 0, stage.progress || 0); job.currentStage = stage.name; job.updatedAt = new Date().toISOString();
      return true;
    });
    const artifact = await generateArtifactAsync(marked.project, { sources: snapshot.sources || [], knowledgeContext, providerConfig, onStage, threadId: `${marked.project.tenantId}:${marked.job.id}` });
    artifact.trigger = 'continuous-update'; artifact.snapshotId = snapshot.id;
    const committed = await store.update((state) => {
      const project = (state.projects || []).find((item) => item.id === marked.project.id && item.tenantId === marked.project.tenantId);
      const job = (state.jobs || []).find((item) => item.id === marked.job.id && item.status === 'running');
      if (!project || !job || !updaterActive(state, user, marked.project.tenantId)) return false;
      project.artifacts ||= []; project.artifacts.unshift(artifact); project.status = 'ready'; project.updatedAt = new Date().toISOString();
      job.status = 'completed'; job.progress = 100; job.resultId = artifact.id; job.updatedAt = project.updatedAt;
      updateSnapshot(state, snapshot.id, { autoUpdateStatus: 'completed', artifactId: artifact.id, autoUpdatedAt: project.updatedAt });
      return true;
    });
    if (!committed) throw new Error('Continuous update was superseded');
    if (typeof store.audit === 'function') await store.audit({ action: 'project.continuous_update.completed', userId: user.id, tenantId: snapshot.tenantId, resourceId: snapshot.projectId, snapshotId: snapshot.id, artifactId: artifact.id });
    return { status: 'completed', artifactId: artifact.id, jobId: marked.job.id };
  } catch (error) {
    await store.update((state) => {
      const job = (state.jobs || []).find((item) => item.id === marked.job.id);
      if (job?.generationCharged && !job.generationRefunded) { refundGeneration(state, user, job.generationPeriod); job.generationCharged = false; job.generationRefunded = true; }
      if (job) { job.status = 'failed'; job.progress = 100; job.error = 'Continuous update failed'; job.updatedAt = new Date().toISOString(); }
      const project = (state.projects || []).find((item) => item.id === marked.project.id && item.tenantId === marked.project.tenantId);
      if (project?.status === 'generating') { project.status = marked.job.previousStatus || 'draft'; project.updatedAt = new Date().toISOString(); }
      updateSnapshot(state, snapshot.id, { autoUpdateStatus: 'failed', autoUpdateError: error.message });
    });
    return { status: 'failed', error: error.message };
  }
}

/** Refresh all due project watches. The claim is committed before network I/O. */
export async function refreshDueProjects(store, now = Date.now()) {
  const state = await store.read();
  const candidates = (state.watchConfigs || []).filter((config) => due(config, now));
  const results = [];
  for (const candidate of candidates) {
    const claim = await store.update((next) => {
      const config = (next.watchConfigs || []).find((item) => item.projectId === candidate.projectId && item.tenantId === candidate.tenantId);
      if (!config || !due(config, now) || !claimAvailable(config, now)) return null;
      config.refreshing = true; config.refreshStartedAt = new Date(now).toISOString(); config.refreshToken = randomUUID();
      return { ...config };
    });
    if (!claim) continue;
    const project = (await store.read()).projects.find((item) => item.id === claim.projectId && item.tenantId === claim.tenantId);
    if (!project) {
      await store.update((next) => { const config = next.watchConfigs.find((item) => item.projectId === claim.projectId && item.tenantId === claim.tenantId && item.refreshToken === claim.refreshToken); if (config) { config.refreshing = false; config.refreshToken = null; config.refreshStartedAt = null; } });
      continue;
    }
    const latestState = await store.read();
    const membership = (latestState.memberships || []).find((item) => item.tenantId === claim.tenantId && item.status === 'active');
    const owner = membership ? latestState.users.find((item) => item.id === membership.userId) : latestState.users.find((item) => item.tenantId === claim.tenantId);
    const user = { id: 'refresh-worker', tenantId: claim.tenantId, plan: owner?.plan || 'free' };
    const quota = await store.update((next) => consumeSourceQuery(next, user));
    if (!quota.allowed) {
      await store.update((next) => { const config = next.watchConfigs.find((item) => item.projectId === claim.projectId && item.tenantId === claim.tenantId && item.refreshToken === claim.refreshToken); if (config) { config.refreshing = false; config.refreshToken = null; config.refreshStartedAt = null; config.lastError = 'SOURCE_QUOTA_EXCEEDED'; } });
      results.push({ projectId: claim.projectId, status: 'quota-exceeded' });
      continue;
    }
    try {
      let sources = await searchKnowledgeSources(project.topic, 5);
      if (process.env.NOVI_VERIFY_SOURCES !== 'false') sources = await verifyEvidenceSources(sources);
      const snapshot = await store.update((next) => {
        const config = next.watchConfigs.find((entry) => entry.tenantId === claim.tenantId && entry.projectId === claim.projectId && entry.refreshToken === claim.refreshToken);
        if (!config) return null;
        next.sourceSnapshots ||= [];
        const fetchedAt = new Date(now).toISOString();
        const previous = (next.sourceSnapshots || []).find((entry) => entry.tenantId === claim.tenantId && entry.projectId === claim.projectId && entry.autoUpdateStatus === 'completed');
        const changes = sourceChanges(previous?.sources || [], sources);
        const item = { id: randomUUID(), projectId: claim.projectId, tenantId: claim.tenantId, topic: project.topic, fetchedAt, sourceCount: sources.length, sources, trigger: 'scheduled', changeStatus: changes.changed ? 'changed' : 'unchanged', changes };
        next.sourceSnapshots.unshift(item);
        let retained = 0;
        next.sourceSnapshots = next.sourceSnapshots.filter((entry) => {
          if (entry.tenantId !== claim.tenantId || entry.projectId !== claim.projectId) return true;
          retained += 1;
          return retained <= 20;
        });
        config.refreshing = false; config.refreshToken = null; config.lastRefreshedAt = fetchedAt; config.lastError = null;
        return item;
      });
      if (snapshot) {
        const update = await updateProjectFromSnapshot(store, snapshot, user);
        results.push({ projectId: claim.projectId, status: 'refreshed', snapshotId: snapshot.id, updateStatus: update.status, artifactId: update.artifactId || null });
      }
      else {
        await store.update((next) => refundSourceQuery(next, user, quota.usage.period));
        results.push({ projectId: claim.projectId, status: 'superseded' });
      }
    } catch (error) {
      await store.update((next) => { refundSourceQuery(next, user, quota.usage.period); const config = next.watchConfigs.find((item) => item.projectId === claim.projectId && item.tenantId === claim.tenantId && item.refreshToken === claim.refreshToken); if (config) { config.refreshing = false; config.refreshToken = null; config.refreshStartedAt = null; config.lastError = 'PROVIDER_UNAVAILABLE'; } });
      results.push({ projectId: claim.projectId, status: 'failed', error: error.message });
    }
  }
  return results;
}

export function startRefreshWorker(store, options = {}) {
  const intervalMs = Math.max(30_000, Number(options.intervalMs || process.env.NOVI_REFRESH_INTERVAL_MS || 300_000));
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await refreshDueProjects(store); } catch (error) { console.warn(`Scheduled refresh failed: ${error.message}`); }
    finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs); timer.unref?.();
  return { tick, stop: () => clearInterval(timer), intervalMs };
}

export { CLAIM_TTL };
