/** External save/render effects run after the outer atomic document/navigation commit. */
export function commitDocumentAction(state, mutate, afterMutation, publish) {
  if (state.runtime?.inTransaction) throw Error('Document actions must start outside another transaction');
  const revision = state.runtime?.version;
  let result, observerFailure;
  try {
    result = state.batch(() => {
      const changed = mutate();
      if (changed !== false) afterMutation?.();
      return changed !== false;
    });
  } catch (error) {
    if (!state.runtime || state.runtime.version === revision) throw error;
    observerFailure = error;
    result = true;
  }
  if (result) {
    try { publish(state.documentStore.read()); }
    catch (error) {
      if (!observerFailure) throw error;
      const combined = new AggregateError([observerFailure, error], 'Document committed; observer and publication failed');
      combined.committed = true;
      throw combined;
    }
  }
  if (observerFailure) throw observerFailure;
  return result;
}
