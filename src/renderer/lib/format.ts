export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

export function formatAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const min = Math.floor((now - Date.parse(iso)) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()} …` : text;
}

/** The newest part of a growing live transcript, so the overlay stays small. */
export function liveTail(text: string, max = 220): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(t.length - max);
  const space = cut.indexOf(' ');
  return `… ${space > 0 && space < 30 ? cut.slice(space + 1) : cut}`;
}
