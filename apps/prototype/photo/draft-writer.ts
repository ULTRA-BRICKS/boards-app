export function coalescedWriter(write: () => Promise<void>, onError: (error: unknown) => void) {
  let dirty = false,
    active: Promise<void> | null = null;
  function start() {
    if (active) return active;
    active = Promise.resolve()
      .then(async () => {
        while (dirty) {
          dirty = false;
          try {
            await write();
          } catch (error) {
            dirty = true;
            throw error;
          }
        }
      })
      .finally(() => {
        active = null;
      });
    // Event-driven callers have no promise to await; explicit flush still receives the rejection.
    void active.catch(onError);
    return active;
  }
  return {
    get dirty() {
      return dirty;
    },
    mark() {
      dirty = true;
      void start();
    },
    async flush() {
      if (active) await active;
      else if (dirty) await start();
    },
  };
}
