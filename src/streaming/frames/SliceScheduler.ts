export interface SliceSchedulerOpts {
  maxFramesPerSlice: number;
  maxSliceMs: number;
  processFrame: (frame: string) => void;
  onPerfSlice: (processed: number, sliceMs: number, queueDepth: number) => void;
  abortSignal: AbortSignal;
  onAbort?: () => void;
}

/**
 * Pulls SSE frames in small slices (JSON-delta pipeline) to avoid blocking the UI thread.
 */
export class SliceScheduler {
  private active = false;
  constructor(private queue: { shift(): string | undefined; length(): number; notifyFrameConsumed(): void }, private opts: SliceSchedulerOpts) {}

  private now(): number {
    const perf = (globalThis as any).performance;
    return typeof perf?.now === 'function' ? perf.now() : Date.now();
  }

  private runSoon(cb: () => void) {
    const raf = (globalThis as any).requestAnimationFrame;
    if (typeof raf === 'function') {
      raf(cb);
    } else {
      setTimeout(cb, 0);
    }
  }

  private scheduleNext() {
    this.runSoon(() => this.runSlice());
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
    const start = this.now();
    let processed = 0;
    while (this.queue.length() && processed < this.opts.maxFramesPerSlice) {
      const frame = this.queue.shift()!;
      processed += 1;
      try { this.opts.processFrame(frame); } catch {}
      this.queue.notifyFrameConsumed();
      const elapsed = this.now() - start;
      if (elapsed > this.opts.maxSliceMs) break; // yield if budget exceeded
    }
    const sliceMs = this.now() - start;
    this.opts.onPerfSlice(processed, sliceMs, this.queue.length());
    if (this.queue.length()) {
      this.scheduleNext();
    } else {
      this.active = false;
    }
  }
}
