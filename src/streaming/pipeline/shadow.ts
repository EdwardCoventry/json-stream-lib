import {JsonDeltaDebugLogger} from '../debug/StreamDebug.js';

/**
 * Optionally runs a second shadow request and logs divergences for debugging.
 */
export async function runWithShadow<T>(main: () => Promise<T>, shadowEnabled: boolean, dbg: JsonDeltaDebugLogger, sessionId: string) {
  if (!shadowEnabled) return main();
  const primary = await main();
  let secondary: T | null = null;
  try { secondary = await main(); } catch {}
  if (secondary !== null) {
    const a = String((primary as any)?.content || '');
    const b = String((secondary as any)?.content || '');
    if (a !== b) {
      const maxLen = Math.max(a.length, b.length);
      let diffChars = 0;
      for (let i = 0; i < maxLen; i++) if (a[i] !== b[i]) diffChars++;
      dbg.pipelineDiff(a.length, b.length, sessionId);
      try { dbg.perfSample({shadowDiffChars: diffChars, sessionId}); } catch {}
    }
  }
  return primary;
}
