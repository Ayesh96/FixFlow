/**
 * Accepts `sqlite:///abs/path.db`, `sqlite://./rel.db`, `file:./rel.db`, `:memory:` or a bare path.
 * Returns null for anything else (notably postgres:// URLs, which are unsupported).
 */
export function parseDatabaseUrl(url: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !/^(sqlite|file):/i.test(url)) return null;
  return url.replace(/^(?:sqlite|file):(?:\/\/)?/i, '') || null;
}
