export async function resolveRunLogId({
  preparedRunId = null,
  sourcePath = 'endpoint/dev',
  createRun,
} = {}) {
  if (preparedRunId) return preparedRunId;
  if (typeof createRun !== 'function') return null;

  if (sourcePath === 'firestore-runner') {
    void Promise.resolve()
      .then(() => createRun())
      .catch(() => null);
    return null;
  }

  return createRun();
}
