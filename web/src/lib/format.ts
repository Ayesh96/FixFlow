/** "just now", "5m ago", "3h ago", "2d ago"; older than a month falls back to the calendar date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(s / 86_400);
  if (d < 30) return `${d}d ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Thousands separators for counts, so 12480 reads as 12,480. */
export const formatCount = (n: number): string => n.toLocaleString('en-US');

/** An error's title as the dashboard shows it: without the `[Error] ` tag its GitHub issue title starts with. */
export const formatErrorTitle = (title: string): string => title.replace(/^\[Error\]\s+/, '');
