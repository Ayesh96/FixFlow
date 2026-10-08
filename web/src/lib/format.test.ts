import { describe, expect, it } from 'vitest';
import { formatCount, formatRelative } from './format';

const NOW = Date.parse('2026-06-15T12:00:00Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('formatRelative', () => {
  it('reads recent times in the largest whole unit', () => {
    expect(formatRelative(ago(5), NOW)).toBe('just now');
    expect(formatRelative(ago(90), NOW)).toBe('2m ago');
    expect(formatRelative(ago(3 * 3600), NOW)).toBe('3h ago');
    expect(formatRelative(ago(2 * 86_400), NOW)).toBe('2d ago');
  });

  it('treats a timestamp slightly in the future (clock skew) as just now', () => {
    expect(formatRelative(ago(-30), NOW)).toBe('just now');
  });

  it('falls back to a date after a month, and to a dash for garbage', () => {
    expect(formatRelative(ago(90 * 86_400), NOW)).toMatch(/2026/);
    expect(formatRelative('not a date', NOW)).toBe('—');
  });
});

describe('formatCount', () => {
  it('adds thousands separators', () => {
    expect(formatCount(12480)).toBe('12,480');
    expect(formatCount(7)).toBe('7');
  });
});
