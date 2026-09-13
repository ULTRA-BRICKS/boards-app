/** Serial CAS queue. Disposed queues cannot notify, retry or write into another session. */
export class SyncQueue {
  constructor({ send, onState = () => {}, delay = 550 }) {
    Object.assign(this, {
      send,
      onState,
      delay,
      version: 0,
      enabled: false,
      paused: false,
      running: false,
      disposed: false,
      sequence: 0,
      ack: 0,
      document: null,
      timer: null,
    });
  }
  configure({ enabled, version = 0 }) {
    if (this.disposed) return;
    this.enabled = enabled;
    this.version = version;
    this.paused = false;
    if (enabled && this.sequence > this.ack) this.schedule();
  }
  change(document) {
    if (this.disposed) return;
    this.document = structuredClone(document);
    this.sequence++;
    // Changes already in the editor must survive a failed previous request.
    if (!this.paused) this.onState({ kind: this.enabled ? "pending" : "local" });
    if (this.enabled && !this.paused) this.schedule();
  }
  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.disposed && this.enabled && !this.paused)
      this.timer = setTimeout(() => this.flush(), this.delay);
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (
      this.disposed ||
      !this.enabled ||
      this.paused ||
      this.running ||
      this.sequence === this.ack ||
      !this.document
    )
      return;
    this.running = true;
    const seq = this.sequence,
      document = structuredClone(this.document);
    this.onState({ kind: "saving" });
    try {
      const result = await this.send({ document, version: this.version });
      if (this.disposed) return;
      if (result.conflict) {
        this.paused = true;
        this.onState({ kind: "conflict", remote: result.remote });
        return;
      }
      if (!Number.isInteger(result.version) || result.version <= this.version)
        throw Error("The server returned an invalid version.");
      this.version = result.version;
      this.ack = seq;
      this.onState({
        kind: this.sequence === seq ? "saved" : "pending",
        version: this.version,
        document,
      });
    } catch (error) {
      if (this.disposed) return;
      this.paused = true;
      this.onState({ kind: error.status === 409 ? "conflict" : "error", message: error.message });
    } finally {
      this.running = false;
      if (!this.disposed && !this.paused && this.sequence > this.ack) this.schedule();
    }
  }
  resolve(version, document) {
    if (this.disposed) return;
    this.version = version;
    this.paused = false;
    this.change(document);
  }
  retry() {
    if (this.disposed) return;
    this.paused = false;
    return this.flush();
  }
  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
    this.disposed = true;
    this.enabled = false;
    this.onState = () => {};
  }
}
