export class FrameQueue {
  private frames: string[] = [];
  private readerFinished = false;
  private drainResolve: (() => void) | null = null;
  private drainPromise: Promise<void>;
  private totalBytes = 0;

  constructor(private maxFrames: number = 500, private maxBytes: number = 2_000_000) {
    this.drainPromise = new Promise<void>(res => { this.drainResolve = res; });
  }

  push(frame: string) {
    if (!frame) return;
    const size = frame.length;
    this.totalBytes += size;
    if (this.frames.length >= this.maxFrames || this.totalBytes >= this.maxBytes) {
      // Drop oldest frame to keep memory bounded
      this.frames.shift();
    }
    this.frames.push(frame);
  }
  shift(): string | undefined { return this.frames.shift(); }
  length(): number { return this.frames.length; }

  markReaderFinished() {
    this.readerFinished = true;
    if (this.readerFinished && this.frames.length === 0 && this.drainResolve) this.drainResolve();
  }

  notifyFrameConsumed() {
    if (this.readerFinished && this.frames.length === 0 && this.drainResolve) this.drainResolve();
  }

  drain(): Promise<void> { return this.drainPromise; }

  abort() {
    this.frames.length = 0;
    if (this.drainResolve) this.drainResolve();
  }
}
