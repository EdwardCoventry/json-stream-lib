export function createWatchdogs(ttfbMs: number, stallMs: number, onAbort: () => void) {
  let ttfbTimer: any; let stallTimer: any; let seenBytes = false;
  const armTtfb = () => { clearTimeout(ttfbTimer); ttfbTimer = setTimeout(() => { if (!seenBytes) onAbort(); }, ttfbMs); };
  const armStall = () => { if (!stallMs) return; clearTimeout(stallTimer); stallTimer = setTimeout(() => onAbort(), stallMs); };
  return {
    start() { armTtfb(); },
    onChunk() { seenBytes = true; armTtfb(); armStall(); },
    dispose() { clearTimeout(ttfbTimer); clearTimeout(stallTimer); }
  };
}
