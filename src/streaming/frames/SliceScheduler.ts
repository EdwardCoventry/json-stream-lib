export interface SliceSchedulerOpts {
  maxFramesPerSlice: number;
  maxSliceMs: number;
  processFrame: (frame: string) => void;
  onPerfSlice: (processed: number, sliceMs: number, queueDepth: number) => void;
  abortSignal: AbortSignal;
  onAbort?: () => void;
}

export class SliceScheduler {
  private active = false;
  constructor(private queue: { shift(): string | undefined; length(): number; notifyFrameConsumed(): void }, private opts: SliceSchedulerOpts) {}

  private scheduleNext() {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => this.runSlice());
    } else {
      setTimeout(() => this.runSlice(), 0);
    }
  }

  ensureScheduled() {
    if (!this.active) {
      this.active = true;
      this.scheduleNext();
    }
  }

  private runSlice() {
    if (this.opts.abortSignal.aborted) {
      this.active = false;
      // Clear any remaining frames so downstream drain promises can resolve.
      while (this.queue.length()) {
        this.queue.shift();
        this.queue.notifyFrameConsumed();
      }
      this.opts.onAbort?.();
      return;
    }
    const start = performance.now();
    let processed = 0;
    while (this.queue.length() && processed < this.opts.maxFramesPerSlice) {
      const frame = this.queue.shift()!;
      processed += 1;
      try { this.opts.processFrame(frame); } catch {}
      this.queue.notifyFrameConsumed();
      const elapsed = performance.now() - start;
      if (elapsed > this.opts.maxSliceMs) break; // yield if budget exceeded
    }
    const sliceMs = performance.now() - start;
    this.opts.onPerfSlice(processed, sliceMs, this.queue.length());
    if (this.queue.length()) {
      this.scheduleNext();
    } else {
      this.active = false;
    }
  }
}
