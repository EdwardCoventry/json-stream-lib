export type DeltaFlushCallback = (chunk: string) => void;

export class DeltaThrottler {
  private acc = '';
  private scheduled = false;
  constructor(private onFlush: DeltaFlushCallback) {}

  enqueue(fragment: string) {
    if (!fragment) return;
    this.acc += fragment;
    if (!this.scheduled) {
      this.scheduled = true;
      const schedule = (cb: () => void) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb); else setTimeout(cb, 0);
      };
      schedule(() => {
        const chunk = this.acc;
        this.acc = '';
        this.scheduled = false;
        try { this.onFlush(chunk); } catch {}
      });
    }
  }

  dispose() {
    this.acc = '';
    this.scheduled = false;
  }
}
