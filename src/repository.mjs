/** Minimal repository contract shared by JsonStore and PostgresStore. */
export const repositoryMethods = Object.freeze(['read', 'update', 'createProject', 'createJob', 'claimJob', 'updateJob', 'audit', 'searchKnowledge']);
export function assertRepository(repository) {
  for (const method of repositoryMethods) if (typeof repository?.[method] !== 'function') throw new TypeError(`Repository missing ${method}()`);
  return repository;
}
