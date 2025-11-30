import type {IWatchdogManager} from '../types.js';

/**
 * Simple watchdog that aborts an in-flight request when TTFB/stall thresholds are exceeded.
 */
export class WatchdogManager implements IWatchdogManager {
  private ttfbTimer: any = null;
  private stallTimer: any = null;
  constructor(private ctl: AbortController, private ttfbMs: number, private stallMs: number, private seenAnyBytesRef: () => boolean) {}
  kickTTFB(): void {
    try { if (this.ttfbTimer) clearTimeout(this.ttfbTimer); } catch {}
    this.ttfbTimer = setTimeout(() => { try { if (!this.seenAnyBytesRef()) this.ctl.abort(); } catch {} }, this.ttfbMs);
  }
  kickStall(): void {
    if (!this.stallMs) return;
    try { if (this.stallTimer) clearTimeout(this.stallTimer); } catch {}
    this.stallTimer = setTimeout(() => { try { this.ctl.abort(); } catch {} }, this.stallMs);
  }
  clear(): void {
    try { if (this.ttfbTimer) clearTimeout(this.ttfbTimer); } catch {}
    try { if (this.stallTimer) clearTimeout(this.stallTimer); } catch {}
  }
}
