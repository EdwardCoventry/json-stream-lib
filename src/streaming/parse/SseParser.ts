export interface ParsedEvent {
  eventType: string;
  data: string[];
  notes?: string[];
}

export function parseSseFrame(raw: string): ParsedEvent[] {
  const lines = raw.split(/\r?\n/).map(l => l.trim());
  const events: ParsedEvent[] = [];
  let current: ParsedEvent | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(':')) {
      const note = line.slice(1).trim();
      if (!note) continue;
      if (!current) current = { eventType: '', data: [], notes: [] };
      (current.notes = current.notes || []).push(note);
      continue;
    }
    if (line.startsWith('event:')) {
      if (current) events.push(current);
      current = { eventType: line.slice(6).trim(), data: [], notes: [] };
      continue;
    }
    if (line.startsWith('data:')) {
      const d = line.slice(5).trim();
      if (!current) current = { eventType: '', data: [], notes: [] };
      current.data.push(d);
      continue;
    }
  }
  if (current) events.push(current);
  return events;
}
