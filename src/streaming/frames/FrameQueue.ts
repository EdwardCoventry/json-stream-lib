/**
 * Simple bounded queue for SSE frames in the JSON-delta pipeline. Keeps memory
 * under control by capping both frame count and accumulated byte size.
 */
export class FrameQueue {
  private frames: string[] = [];
  private readerFinished = false;
  private drainResolve: (() => void) | null = null;
  private drainPromise: Promise<void>;
  private totalBytes = 0;

  constructor(private maxFrames: number = 500, private maxBytes: number = 2_000_000) {
    this.drainPromise = new Promise<void>(res => { this.drainResolve = res; });
  }

  private resolveDrainIfIdle() {
    if (this.readerFinished && this.frames.length === 0 && this.drainResolve) this.drainResolve();
  }

  push(frame: string) {
    if (!frame) return;
    const size = frame.length;
    this.totalBytes += size;
    if (this.frames.length >= this.maxFrames || this.totalBytes >= this.maxBytes) {
      // Drop oldest frame to keep memory bounded
      const removed = this.frames.shift();
      if (removed) this.totalBytes -= removed.length;
    }
    this.frames.push(frame);
  }
  shift(): string | undefined {
    const frame = this.frames.shift();
    if (frame) this.totalBytes -= frame.length;
    return frame;
  }
  length(): number { return this.frames.length; }

  markReaderFinished() {
    this.readerFinished = true;
    this.resolveDrainIfIdle();
  }

  notifyFrameConsumed() {
    this.resolveDrainIfIdle();
  }

  drain(): Promise<void> { return this.drainPromise; }

  abort() {
    this.frames.length = 0;
    this.totalBytes = 0;
    if (this.drainResolve) this.drainResolve();
  }
}
