import { randomUUID } from 'node:crypto';
import { embedText, searchProjectKnowledge } from './knowledge.mjs';
import { failSessionRun, findAgentSession } from './agent-sessions.mjs';

const initialState = () => ({ version: 3, projects: [], jobs: [], users: [], sessions: [], agentSessions: [], audit: [], usage: [], subscriptions: [], paymentEvents: [], organizations: [], memberships: [], invitations: [], oidcStates: [], llmProviderConfigs: [], documents: [], chunks: [], knowledgeEntities: [], knowledgeEdges: [], watchConfigs: [], sourceSnapshots: [], externalProjectionJobs: [] });

/**
 * PostgreSQL repository. `novi_state` is a compatibility envelope for legacy
 * data, while indexed relational projections below provide production query
 * paths for tenants, projects, jobs and documents. The envelope remains the
 * atomic source during the migration so old backups and adapters stay valid.
 */
export class PostgresStore {
  constructor(pool) { this.pool = pool; this.ready = false; this.vectorEnabled = false; }
  async close() { await this.pool.end?.(); }

  async init() {
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_state (id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_tenants (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_projects (id text PRIMARY KEY, tenant_id text NOT NULL, owner_id text NOT NULL, title text NOT NULL, topic text NOT NULL, type text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_projects_tenant_updated_idx ON novi_projects (tenant_id, updated_at DESC)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_jobs (id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_jobs_claim_idx ON novi_jobs (status, updated_at)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_documents (id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, content_hash text NOT NULL, created_at timestamptz NOT NULL, payload jsonb NOT NULL, UNIQUE (tenant_id, project_id, content_hash))');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_documents_project_idx ON novi_documents (tenant_id, project_id, created_at DESC)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_chunks (id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, document_id text NOT NULL, created_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_chunks_tenant_project_idx ON novi_chunks (tenant_id, project_id, created_at DESC)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_knowledge_entities (id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, document_id text NOT NULL, label text NOT NULL, created_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_entities_tenant_project_idx ON novi_knowledge_entities (tenant_id, project_id, created_at DESC)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_knowledge_edges (id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, document_id text NOT NULL, created_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_edges_tenant_project_idx ON novi_knowledge_edges (tenant_id, project_id, created_at DESC)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_chunk_vectors (chunk_id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, document_id text NOT NULL, embedding jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_chunk_vectors_tenant_project_idx ON novi_chunk_vectors (tenant_id, project_id)');
    await this.pool.query('CREATE TABLE IF NOT EXISTS novi_external_projection_jobs (id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, document_id text NOT NULL, operation text NOT NULL, status text NOT NULL, next_attempt_at timestamptz, updated_at timestamptz NOT NULL, payload jsonb NOT NULL)');
    await this.pool.query('CREATE INDEX IF NOT EXISTS novi_external_projection_jobs_due_idx ON novi_external_projection_jobs (status, next_attempt_at)');
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.pool.query('CREATE TABLE IF NOT EXISTS novi_chunk_vectors_native (chunk_id text PRIMARY KEY, tenant_id text NOT NULL, project_id text NOT NULL, document_id text NOT NULL, embedding vector(24) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
      await this.pool.query('CREATE INDEX IF NOT EXISTS novi_chunk_vectors_native_tenant_project_idx ON novi_chunk_vectors_native (tenant_id, project_id)');
      await this.pool.query('CREATE INDEX IF NOT EXISTS novi_chunk_vectors_native_cosine_idx ON novi_chunk_vectors_native USING hnsw (embedding vector_cosine_ops)');
      this.vectorEnabled = true;
    } catch (error) {
      this.vectorEnabled = false;
      if (process.env.NOVI_REQUIRE_NATIVE_VECTOR === 'true') throw new Error(`Native pgvector storage is required but unavailable: ${error.message}`);
      console.warn(`pgvector unavailable; using JSONB embeddings: ${error.message}`);
    }
    await this.pool.query('INSERT INTO novi_state (id, version, state) VALUES (1, 3, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(initialState())]);
    await this.update(() => undefined);
    this.ready = true; return this;
  }

  async read(client = this.pool) {
    const result = await client.query('SELECT state FROM novi_state WHERE id = 1');
    if (!result.rows[0]) return initialState();
    const state = result.rows[0].state;
    state.version = 3; state.projects ||= []; state.jobs ||= []; state.users ||= []; state.sessions ||= []; state.agentSessions ||= []; state.audit ||= []; state.usage ||= []; state.subscriptions ||= []; state.paymentEvents ||= []; state.organizations ||= []; state.memberships ||= []; state.invitations ||= []; state.oidcStates ||= []; state.llmProviderConfigs ||= []; state.documents ||= []; state.chunks ||= []; state.knowledgeEntities ||= []; state.knowledgeEdges ||= []; state.watchConfigs ||= []; state.sourceSnapshots ||= []; state.externalProjectionJobs ||= [];
    return state;
  }

  async update(mutator) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize writers at the single state row so concurrent mutations
      // cannot overwrite one another while this migration envelope is used.
      const locked = await client.query('SELECT state FROM novi_state WHERE id = 1 FOR UPDATE');
      const state = locked.rows[0]?.state || initialState();
      state.version = 3; state.projects ||= []; state.jobs ||= []; state.users ||= []; state.sessions ||= []; state.agentSessions ||= []; state.audit ||= []; state.usage ||= []; state.subscriptions ||= []; state.paymentEvents ||= []; state.organizations ||= []; state.memberships ||= []; state.invitations ||= []; state.oidcStates ||= []; state.llmProviderConfigs ||= []; state.documents ||= []; state.chunks ||= []; state.knowledgeEntities ||= []; state.knowledgeEdges ||= []; state.watchConfigs ||= []; state.sourceSnapshots ||= []; state.externalProjectionJobs ||= [];
      const result = await mutator(state);
      await client.query('UPDATE novi_state SET version = 3, state = $1::jsonb, updated_at = now() WHERE id = 1', [JSON.stringify(state)]);
      await this.projectProjection(client, state);
      await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async projectProjection(client, state) {
    const tenants = state.organizations || [];
    const projects = state.projects || [];
    const jobs = state.jobs || [];
    const documents = state.documents || [];
    const chunks = state.chunks || [];
    const entities = state.knowledgeEntities || [];
    const edges = state.knowledgeEdges || [];
    const externalJobs = state.externalProjectionJobs || [];
    for (const organization of tenants) await client.query('INSERT INTO novi_tenants (id) VALUES ($1) ON CONFLICT DO NOTHING', [organization.id]);
    for (const project of projects) await client.query('INSERT INTO novi_projects (id, tenant_id, owner_id, title, topic, type, status, updated_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, owner_id=EXCLUDED.owner_id, title=EXCLUDED.title, topic=EXCLUDED.topic, type=EXCLUDED.type, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload', [project.id, project.tenantId || 'local', project.ownerId || 'local', project.title, project.topic, project.type, project.status || 'draft', project.updatedAt || new Date().toISOString(), JSON.stringify(project)]);
    for (const job of jobs) await client.query('INSERT INTO novi_jobs (id, tenant_id, project_id, status, updated_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, status=EXCLUDED.status, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload', [job.id, job.tenantId || 'local', job.projectId, job.status, job.updatedAt || new Date().toISOString(), JSON.stringify(job)]);
    for (const document of documents) await client.query('INSERT INTO novi_documents (id, tenant_id, project_id, content_hash, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, content_hash=EXCLUDED.content_hash, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload', [document.id, document.tenantId, document.projectId, document.contentHash, document.createdAt || new Date().toISOString(), JSON.stringify(document)]);
    for (const chunk of chunks) await client.query('INSERT INTO novi_chunks (id, tenant_id, project_id, document_id, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, document_id=EXCLUDED.document_id, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload', [chunk.id, chunk.tenantId, chunk.projectId, chunk.documentId, chunk.createdAt || new Date().toISOString(), JSON.stringify(chunk)]);
    for (const entity of entities) await client.query('INSERT INTO novi_knowledge_entities (id, tenant_id, project_id, document_id, label, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, document_id=EXCLUDED.document_id, label=EXCLUDED.label, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload', [entity.id, entity.tenantId, entity.projectId, entity.documentId, entity.label, entity.createdAt || new Date().toISOString(), JSON.stringify(entity)]);
    for (const edge of edges) await client.query('INSERT INTO novi_knowledge_edges (id, tenant_id, project_id, document_id, created_at, payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, document_id=EXCLUDED.document_id, created_at=EXCLUDED.created_at, payload=EXCLUDED.payload', [edge.id, edge.tenantId, edge.projectId, edge.documentId, edge.createdAt || new Date().toISOString(), JSON.stringify(edge)]);
    for (const job of externalJobs) await client.query('INSERT INTO novi_external_projection_jobs (id, tenant_id, project_id, document_id, operation, status, next_attempt_at, updated_at, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT (id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, document_id=EXCLUDED.document_id, operation=EXCLUDED.operation, status=EXCLUDED.status, next_attempt_at=EXCLUDED.next_attempt_at, updated_at=EXCLUDED.updated_at, payload=EXCLUDED.payload', [job.id, job.tenantId, job.projectId, job.documentId, job.operation, job.status, job.nextAttemptAt || null, job.updatedAt || new Date().toISOString(), JSON.stringify(job)]);
    for (const chunk of chunks) {
      const embedding = Array.isArray(chunk.embedding) ? `[${chunk.embedding.map((value) => Number(value) || 0).join(',')}]` : null;
      if (embedding) {
        await client.query('INSERT INTO novi_chunk_vectors (chunk_id, tenant_id, project_id, document_id, embedding, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT (chunk_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, document_id=EXCLUDED.document_id, embedding=EXCLUDED.embedding, created_at=EXCLUDED.created_at', [chunk.id, chunk.tenantId, chunk.projectId, chunk.documentId, JSON.stringify(chunk.embedding), chunk.createdAt || new Date().toISOString()]);
        if (this.vectorEnabled) await client.query('INSERT INTO novi_chunk_vectors_native (chunk_id, tenant_id, project_id, document_id, embedding, created_at) VALUES ($1,$2,$3,$4,$5::vector,$6) ON CONFLICT (chunk_id) DO UPDATE SET tenant_id=EXCLUDED.tenant_id, project_id=EXCLUDED.project_id, document_id=EXCLUDED.document_id, embedding=EXCLUDED.embedding, created_at=EXCLUDED.created_at', [chunk.id, chunk.tenantId, chunk.projectId, chunk.documentId, embedding, chunk.createdAt || new Date().toISOString()]);
      }
    }
    const deleteOrphans = async (table, ids, key = 'id') => ids.length ? client.query(`DELETE FROM ${table} WHERE ${key} <> ALL($1::text[])`, [ids]) : client.query(`DELETE FROM ${table}`);
    await deleteOrphans('novi_tenants', tenants.map((item) => item.id));
    await deleteOrphans('novi_projects', projects.map((item) => item.id));
    await deleteOrphans('novi_jobs', jobs.map((item) => item.id));
    await deleteOrphans('novi_documents', documents.map((item) => item.id));
    await deleteOrphans('novi_chunks', chunks.map((item) => item.id));
    await deleteOrphans('novi_knowledge_entities', entities.map((item) => item.id));
    await deleteOrphans('novi_knowledge_edges', edges.map((item) => item.id));
    await deleteOrphans('novi_external_projection_jobs', externalJobs.map((item) => item.id));
    await deleteOrphans('novi_chunk_vectors', chunks.map((item) => item.id), 'chunk_id');
    if (this.vectorEnabled) await deleteOrphans('novi_chunk_vectors_native', chunks.map((item) => item.id), 'chunk_id');
  }

  async createProject(input, owner = null) {
    return this.update((state) => { const now = new Date().toISOString(); const project = { id: randomUUID(), tenantId: owner?.tenantId || 'local', ownerId: owner?.id || 'local', title: input.title.trim(), topic: input.topic.trim(), type: input.type, description: input.description?.trim() || '', status: 'draft', pinned: false, createdAt: now, updatedAt: now, artifacts: [] }; state.projects.unshift(project); return project; });
  }

  async searchKnowledge(projectId, tenantId, query, limit = 10) {
    const boundedLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    if (!this.vectorEnabled) return searchProjectKnowledge(await this.read(), projectId, tenantId, query, boundedLimit);
    const embedding = `[${embedText(query).join(',')}]`;
    const result = await this.pool.query(
      `SELECT c.payload, d.payload->>'title' AS document, d.payload->>'sourceUrl' AS source_url,
              d.payload->>'sourceKind' AS source_kind, 1 - (v.embedding <=> $3::vector) AS score
       FROM novi_chunk_vectors_native v
       JOIN novi_chunks c ON c.id = v.chunk_id
       JOIN novi_documents d ON d.id = v.document_id
       WHERE v.project_id = $1 AND v.tenant_id = $2
       ORDER BY v.embedding <=> $3::vector
       LIMIT $4`,
      [projectId, tenantId, embedding, boundedLimit],
    );
    return result.rows.map((row) => ({
      ...row.payload,
      document: row.document || null,
      ...(row.source_url ? { sourceUrl: row.source_url } : {}),
      sourceKind: row.source_kind || 'text',
      score: Number.isFinite(Number(row.score)) ? Number(row.score) : 0,
    }));
  }

  async createJob(input) { return this.update((state) => { const job = { id: randomUUID(), ...input, status: 'queued', progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; state.jobs.unshift(job); return job; }); }
  async updateJob(id, patch) { return this.update((state) => { const job = state.jobs.find((item) => item.id === id); if (!job) return null; Object.assign(job, patch, { updatedAt: new Date().toISOString() }); return job; }); }
  async claimJob(id, owner = randomUUID()) { return this.update((state) => { const job = state.jobs.find((item) => item.id === id && item.status === 'queued'); if (!job) return null; job.status = 'running'; job.workerId = owner; job.progress = Math.max(10, job.progress || 0); job.updatedAt = new Date().toISOString(); return job; }); }
  async audit(entry) { return this.update((state) => { state.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry }); state.audit = state.audit.slice(0, 5000); }); }

  async recoverInterruptedJobs() {
    return this.update((state) => {
      const interrupted = new Set();
      for (const job of state.jobs) {
        if (job.status === 'queued' || job.status === 'running') {
          const usage = (state.usage || []).find((entry) => entry.tenantId === job.tenantId && entry.period === job.generationPeriod);
          if (usage && job.generationCharged && !job.generationRefunded) usage.generations = Math.max(0, usage.generations - 1);
          const sourceUsage = (state.usage || []).find((entry) => entry.tenantId === job.tenantId && entry.period === job.sourcePeriod);
          if (sourceUsage && job.sourceCharged && !job.sourceRefunded) sourceUsage.sourceQueries = Math.max(0, sourceUsage.sourceQueries - 1);
          job.status = 'failed'; job.progress = 100; job.error = 'Generation interrupted by service restart'; job.updatedAt = new Date().toISOString();
          job.usageRefunded = Boolean(job.generationCharged || job.sourceCharged);
          job.generationRefunded ||= Boolean(job.generationCharged);
          job.sourceRefunded ||= Boolean(job.sourceCharged);
          job.generationCharged = false; job.sourceCharged = false;
          failSessionRun(findAgentSession(state, job.sessionId, job.projectId, job.tenantId), { jobId: job.id, mode: job.currentMode, error: 'Generation interrupted by service restart' });
          interrupted.add(job.projectId);
        }
      }
      for (const project of state.projects) {
        if (project.status !== 'generating') continue;
        const latest = state.jobs.find((job) => job.projectId === project.id && job.previousStatus);
        const active = state.jobs.some((job) => job.projectId === project.id && (job.status === 'queued' || job.status === 'running'));
        if (interrupted.has(project.id) || !active) { project.status = latest?.previousStatus || 'draft'; project.updatedAt = new Date().toISOString(); }
      }
      return interrupted.size;
    });
  }

  async migrateOrganizations() {
    return this.update((state) => {
      state.organizations ||= []; state.memberships ||= [];
      for (const user of state.users) {
        if (!user.tenantId || !user.id) continue;
        if (!state.organizations.some((organization) => organization.id === user.tenantId)) {
          state.organizations.push({ id: user.tenantId, name: `${String(user.email || 'Personal').split('@')[0]}'s workspace`, ownerId: user.id, createdAt: user.createdAt || new Date().toISOString() });
        }
        if (!state.memberships.some((membership) => membership.tenantId === user.tenantId && membership.userId === user.id)) {
          state.memberships.push({ id: randomUUID(), tenantId: user.tenantId, userId: user.id, role: user.role || 'owner', status: 'active', createdAt: user.createdAt || new Date().toISOString() });
        }
      }
      return state.memberships.length;
    });
  }
}

export async function createPostgresStore(connectionString) {
  if (!connectionString) throw new Error('NOVI_PG_URL is required for PostgreSQL storage');
  let pg;
  try { pg = await import('pg'); } catch { throw new Error('PostgreSQL storage requires the optional pg package'); }
  return new PostgresStore(new pg.Pool({ connectionString, max: Number(process.env.NOVI_PG_POOL_MAX || 10), idleTimeoutMillis: 30_000 })).init();
}
