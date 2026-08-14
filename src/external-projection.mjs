import { randomUUID } from 'node:crypto';
import { deleteDocumentObject, objectKey, putDocumentObject } from './object-store.mjs';
import { deleteKnowledgeGraph, syncKnowledgeGraph } from './graph-store.mjs';

const MAX_RETAINED_JOBS = 2_000;
const retryDelay = (attempts) => Math.min(60 * 60 * 1000, 1_000 * (2 ** Math.min(10, Math.max(0, attempts))));

function jobsFor(state) {
  state.externalProjectionJobs ||= [];
  return state.externalProjectionJobs;
}

function nowIso() { return new Date().toISOString(); }

/** Add a durable upsert intent in the same transaction as the primary document. */
export function enqueueDocumentProjection(state, { document, content, entities = [], edges = [] }) {
  if (!document?.id) throw new TypeError('document.id is required for external projection');
  const jobs = jobsFor(state);
  const existing = jobs.find((job) => job.documentId === document.id && job.operation === 'upsert' && !['completed', 'cancelled'].includes(job.status));
  if (existing) return existing;
  const createdAt = nowIso();
  const job = {
    id: randomUUID(), operation: 'upsert', status: 'pending', attempts: 0,
    tenantId: document.tenantId, projectId: document.projectId, documentId: document.id,
    document: structuredClone(document), content: String(content || ''),
    entities: structuredClone(entities), edges: structuredClone(edges),
    createdAt, updatedAt: createdAt, nextAttemptAt: createdAt,
  };
  jobs.unshift(job);
  return job;
}

/** Add a durable delete intent and cancel any not-yet-started upsert for the document. */
export function enqueueDocumentDeletion(state, { tenantId, projectId, documentId, objectKey: key = null, contentHash: hash = null, suppressAudit = false, purgeAfterCompletion = false }) {
  if (!tenantId || !projectId || !documentId) throw new TypeError('tenantId, projectId and documentId are required for external deletion');
  const jobs = jobsFor(state);
  for (const job of jobs) {
    if (job.documentId === documentId && job.operation === 'upsert' && ['pending', 'failed'].includes(job.status)) {
      job.status = 'cancelled'; job.updatedAt = nowIso(); job.cancelledAt = job.updatedAt;
    }
  }
  const existing = jobs.find((job) => job.documentId === documentId && job.operation === 'delete' && !['completed', 'cancelled'].includes(job.status));
  if (existing) return existing;
  const createdAt = nowIso();
  const job = {
    id: randomUUID(), operation: 'delete', status: 'pending', attempts: 0,
    tenantId, projectId, documentId,
    objectKey: key || (hash ? objectKey({ tenantId, documentId, contentHash: hash }) : null),
    suppressAudit: Boolean(suppressAudit), purgeAfterCompletion: Boolean(purgeAfterCompletion),
    createdAt, updatedAt: createdAt, nextAttemptAt: createdAt,
  };
  jobs.unshift(job);
  return job;
}

function isDue(job, now, force) {
  if (!['pending', 'failed'].includes(job.status)) return false;
  if (force) return true;
  return !job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= now;
}

function runnable(state, job) {
  if (job.operation !== 'delete') return true;
  // Never delete while an older upsert is still making provider calls. The
  // delete intent remains durable and will be picked up on the next pass.
  return !jobsFor(state).some((candidate) => candidate.documentId === job.documentId && candidate.operation === 'upsert' && candidate.status === 'running');
}

function projectionResult(result, kind) {
  if (result.status !== 'fulfilled') return { status: 'failed', error: result.reason?.message || `${kind} projection failed` };
  if (kind === 'object') return { status: result.value?.objectKey ? 'synced' : 'disabled', objectKey: result.value?.objectKey || null };
  return { status: result.value?.status || 'disabled' };
}

async function runJob(store, jobId, { force = false } = {}) {
  let claimed;
  await store.update((state) => {
    const job = jobsFor(state).find((item) => item.id === jobId);
    if (!job || !isDue(job, Date.now(), force)) return null;
    job.status = 'running'; job.startedAt = nowIso(); job.updatedAt = job.startedAt;
    claimed = structuredClone(job);
    return job;
  });
  if (!claimed) return { status: 'skipped', jobId };

  const results = claimed.operation === 'upsert'
    ? await Promise.allSettled([
      putDocumentObject({ tenantId: claimed.tenantId, documentId: claimed.documentId, contentHash: claimed.document.contentHash, content: claimed.content, contentType: claimed.document.mimeType }),
      syncKnowledgeGraph({ tenantId: claimed.tenantId, projectId: claimed.projectId, documentId: claimed.documentId, entities: claimed.entities, edges: claimed.edges }),
    ])
    : await Promise.allSettled([
      claimed.objectKey ? deleteDocumentObject({ objectKey: claimed.objectKey }) : Promise.resolve({ status: 'disabled' }),
      deleteKnowledgeGraph({ tenantId: claimed.tenantId, projectId: claimed.projectId, documentId: claimed.documentId }),
    ]);
  const object = projectionResult(results[0], 'object');
  const graph = projectionResult(results[1], 'graph');
  const failures = [object, graph].filter((item) => item.status === 'failed');

  await store.update((state) => {
    const job = jobsFor(state).find((item) => item.id === claimed.id);
    if (!job) return null;
    job.attempts = Number(job.attempts || 0) + 1;
    job.updatedAt = nowIso();
    if (claimed.operation === 'upsert') {
      const document = (state.documents || []).find((item) => item.id === claimed.documentId && item.tenantId === claimed.tenantId);
      if (document) {
        if (object.status !== 'failed') document.objectKey = object.objectKey;
        document.objectProjection = object.status;
        document.graphProjection = graph.status;
        document.projectionUpdatedAt = job.updatedAt;
      }
    }
    if (!failures.length) {
      job.status = 'completed'; job.completedAt = job.updatedAt; job.nextAttemptAt = null;
      job.result = { object: object.status, graph: graph.status };
      delete job.content; delete job.entities; delete job.edges;
      if (job.purgeAfterCompletion) {
        state.externalProjectionJobs = jobsFor(state).filter((item) => item.id !== job.id);
        return job;
      }
    } else {
      job.status = 'failed'; job.lastError = failures.map((item) => item.error).join('; ');
      job.nextAttemptAt = new Date(Date.now() + retryDelay(job.attempts)).toISOString();
    }
    const completed = jobsFor(state).filter((item) => item.status === 'completed' || item.status === 'cancelled');
    if (completed.length > MAX_RETAINED_JOBS) {
      const keep = new Set(completed.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, MAX_RETAINED_JOBS).map((item) => item.id));
      state.externalProjectionJobs = jobsFor(state).filter((item) => !['completed', 'cancelled'].includes(item.status) || keep.has(item.id));
    }
    return job;
  });
  return { status: failures.length ? 'failed' : 'completed', jobId: claimed.id, object: object.status, graph: graph.status };
}

/** Process due jobs serially; claiming happens transactionally so multiple instances are safe. */
export async function flushExternalProjectionJobs(store, { limit = 10, force = false } = {}) {
  // A process may die after claiming a job. Requeue stale leases so startup
  // recovery cannot strand a projection forever. The 15-minute lease is longer
  // than the bounded provider request timeout and protects active workers.
  let state = await store.read();
  const cutoff = Date.now() - 15 * 60 * 1000;
  const stale = jobsFor(state).filter((job) => job.status === 'running' && Date.parse(job.updatedAt || job.startedAt || 0) <= cutoff);
  if (stale.length) {
    await store.update((next) => {
      const staleIds = new Set(stale.map((job) => job.id));
      for (const job of jobsFor(next)) {
        if (staleIds.has(job.id) && job.status === 'running') {
          job.status = 'failed'; job.lastError = 'Projection worker lease expired'; job.updatedAt = nowIso(); job.nextAttemptAt = job.updatedAt;
        }
      }
    });
    state = await store.read();
  }
  const due = jobsFor(state).filter((job) => isDue(job, Date.now(), force) && runnable(state, job)).slice(0, Math.max(1, Math.min(100, Number(limit) || 10)));
  const results = [];
  for (const job of due) {
    try {
      const result = await runJob(store, job.id, { force });
      results.push(result);
      if (result.status !== 'skipped' && !job.suppressAudit && typeof store.audit === 'function') {
        try { await store.audit({ action: `external.projection.${result.status}`, tenantId: job.tenantId, resourceId: job.documentId, projectionJobId: job.id, operation: job.operation, objectStatus: result.object, graphStatus: result.graph }); }
        catch (auditError) { console.warn(`External projection audit failed: ${auditError.message}`); }
      }
    }
    catch (error) {
      try {
        await store.update((next) => {
          const item = jobsFor(next).find((candidate) => candidate.id === job.id);
          if (!item) return;
          item.status = 'failed'; item.attempts = Number(item.attempts || 0) + 1; item.lastError = error.message; item.updatedAt = nowIso(); item.nextAttemptAt = new Date(Date.now() + retryDelay(item.attempts)).toISOString();
        });
      } catch (persistError) { console.warn(`External projection failure persistence failed: ${persistError.message}`); }
      results.push({ status: 'failed', jobId: job.id, error: error.message });
      if (!job.suppressAudit && typeof store.audit === 'function') {
        try { await store.audit({ action: 'external.projection.failed', tenantId: job.tenantId, resourceId: job.documentId, projectionJobId: job.id, operation: job.operation, error: error.message }); }
        catch (auditError) { console.warn(`External projection audit failed: ${auditError.message}`); }
      }
    }
  }
  return results;
}

export function externalProjectionPending(state) {
  return jobsFor(state).filter((job) => ['pending', 'failed', 'running'].includes(job.status)).length;
}
