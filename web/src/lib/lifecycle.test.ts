import { describe, expect, it } from 'vitest';
import { funnel, lifecycleOf, safeUrl } from './lifecycle';

const issue = (githubIssueNumber: number | null, resolverStatus?: Parameters<typeof lifecycleOf>[0]['resolverStatus']) => ({ githubIssueNumber, resolverStatus });

describe('lifecycleOf', () => {
  it('reads the furthest stage reached', () => {
    expect(lifecycleOf(issue(null))).toEqual({ reached: 0, ended: null });
    expect(lifecycleOf(issue(7))).toEqual({ reached: 1, ended: null });
    expect(lifecycleOf(issue(7, 'IN_PROGRESS'))).toEqual({ reached: 2, ended: null });
    expect(lifecycleOf(issue(7, 'PR_OPEN'))).toEqual({ reached: 3, ended: null });
  });

  it('marks attempts that stopped for good', () => {
    expect(lifecycleOf(issue(7, 'FAILED'))).toEqual({ reached: 2, ended: 'FAILED' });
    expect(lifecycleOf(issue(7, 'SKIPPED'))).toEqual({ reached: 2, ended: 'SKIPPED' });
  });
});

describe('funnel', () => {
  it('counts every error at each stage it reached or passed', () => {
    expect(funnel([issue(null), issue(1), issue(2, 'FAILED'), issue(3, 'PR_OPEN')])).toEqual([4, 3, 2, 1]);
    expect(funnel([])).toEqual([0, 0, 0, 0]);
  });
});

describe('safeUrl', () => {
  it('only lets http(s) through', () => {
    expect(safeUrl('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
