import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { searchProjectKnowledge } from './knowledge.mjs';

const initialState = () => ({ version: 3, projects: [], jobs: [], users: [], sessions: [], audit: [], usage: [], subscriptions: [], paymentEvents: [], organizations: [], memberships: [], invitations: [], oidcStates: [], llmProviderConfigs: [], documents: [], chunks: [], knowledgeEntities: [], knowledgeEdges: [], watchConfigs: [], sourceSnapshots: [], externalProjectionJobs: [] });

export class JsonStore {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      state.version = 3;
      state.projects ||= []; state.jobs ||= []; state.users ||= []; state.sessions ||= []; state.audit ||= [];
      state.usage ||= []; state.subscriptions ||= []; state.paymentEvents ||= [];
      state.organizations ||= []; state.memberships ||= []; state.invitations ||= [];
      state.oidcStates ||= [];
      state.llmProviderConfigs ||= [];
      state.documents ||= []; state.chunks ||= []; state.knowledgeEntities ||= []; state.knowledgeEdges ||= [];
      state.watchConfigs ||= []; state.sourceSnapshots ||= []; state.externalProjectionJobs ||= [];
      return state;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return initialState();
    }
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      const state = await this.read();
      const result = await mutator(state);
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      await chmod(this.file, 0o600);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async createProject(input, owner = null) {
    return this.update((state) => {
      const now = new Date().toISOString();
      const project = {
        id: randomUUID(), tenantId: owner?.tenantId || 'local', ownerId: owner?.id || 'local',
        title: input.title.trim(),
        topic: input.topic.trim(),
        type: input.type,
        description: input.description?.trim() || '',
        status: 'draft',
        pinned: false,
        createdAt: now,
        updatedAt: now,
        artifacts: [],
      };
      state.projects.unshift(project);
      return project;
    });
  }

  async searchKnowledge(projectId, tenantId, query, limit = 10) {
    return searchProjectKnowledge(await this.read(), projectId, tenantId, query, limit);
  }

  async createJob(input) {
    return this.update((state) => {
      const job = { id: randomUUID(), ...input, status: 'queued', progress: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.jobs.unshift(job);
      return job;
    });
  }

  async updateJob(id, patch) {
    return this.update((state) => {
      const job = state.jobs.find((item) => item.id === id);
      if (!job) return null;
      Object.assign(job, patch, { updatedAt: new Date().toISOString() });
      return job;
    });
  }

  async claimJob(id, owner = randomUUID()) {
    return this.update((state) => {
      const job = state.jobs.find((item) => item.id === id && item.status === 'queued');
      if (!job) return null;
      job.status = 'running'; job.workerId = owner; job.progress = Math.max(10, job.progress || 0); job.updatedAt = new Date().toISOString();
      return job;
    });
  }

  async audit(entry) {
    return this.update((state) => {
      state.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry });
      state.audit = state.audit.slice(0, 5000);
    });
  }

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
          interrupted.add(job.projectId);
        }
      }
      for (const project of state.projects) {
        if (project.status === 'generating') {
          const latest = state.jobs.find((job) => job.projectId === project.id && job.previousStatus);
          const hasActiveJob = state.jobs.some((job) => job.projectId === project.id && (job.status === 'queued' || job.status === 'running'));
          // A sync generation has no Job record; after a process restart it is safe
          // to release its marker because the in-memory operation is gone.
          if (interrupted.has(project.id) || !hasActiveJob) {
            project.status = latest?.previousStatus || 'draft'; project.updatedAt = new Date().toISOString();
          }
        }
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
