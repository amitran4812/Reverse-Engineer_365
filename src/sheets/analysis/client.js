// Talks to the analysis worker. Calls return promises; the worker's file
// reads for handle-based files are served here through window.office.data.

export class DataClient {
  constructor(url = './analysis-worker.js') {
    this.worker = new Worker(url);
    this.seq = 0;
    this.calls = new Map();
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => {
      for (const c of this.calls.values()) c.reject(new Error(e.message || 'The data worker stopped'));
      this.calls.clear();
    };
  }

  async onMessage(m) {
    if (m.read) {
      const { id, handle, offset, length } = m.read;
      try {
        const data = await window.office.data.read(handle, offset, length);
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.worker.postMessage({ readResult: { id, data: u8 } }, [u8.buffer]);
      } catch (err) {
        this.worker.postMessage({ readResult: { id, error: err.message || String(err) } });
      }
      return;
    }
    const c = this.calls.get(m.id);
    if (!c) return;
    if (m.progress) {
      c.onProgress?.(m.progress);
      return;
    }
    this.calls.delete(m.id);
    if (m.ok) c.resolve(m.result);
    else c.reject(new Error(m.error));
  }

  call(op, ...args) {
    return this.callWith({}, op, ...args);
  }

  callWith({ onProgress }, op, ...args) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ id, op, args });
    });
  }
}
