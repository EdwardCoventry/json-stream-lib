export type DeltaFlushCallback = (chunk: string) => void;

/**
 * Coalesces rapid delta fragments and flushes them on the next animation frame
 * (or microtask), reducing render churn for chat-style UIs.
 */
export class JsonDeltaThrottler {
  private acc = '';
  private scheduled = false;
  constructor(private readonly onFlush: DeltaFlushCallback) {}

  private scheduleFlush() {
    const schedule = (cb: () => void) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(cb);
      } else if (typeof queueMicrotask === 'function') {
        queueMicrotask(cb);
      } else {
        setTimeout(cb, 0);
      }
    };
    schedule(() => this.flush());
  }

  flush() {
    if (!this.acc) return;
    const chunk = this.acc;
    this.acc = '';
    this.scheduled = false;
    try { this.onFlush(chunk); } catch {}
  }

  enqueue(fragment: string) {
    if (!fragment) return;
    this.acc += fragment;
    if (!this.scheduled) {
      this.scheduled = true;
      this.scheduleFlush();
    }
  }

  dispose() {
    this.acc = '';
    this.scheduled = false;
  }
}
