import { describe, expect, it } from 'vitest';
import { funnel, lifecycleOf, safeUrl } from './lifecycle';

const issue = (githubIssueNumber: number | null, resolverStatus?: Parameters<typeof lifecycleOf>[0]['resolverStatus'], triageStatus?: Parameters<typeof lifecycleOf>[0]['triageStatus']) => ({ githubIssueNumber, resolverStatus, triageStatus });

describe('lifecycleOf', () => {
  it('reads the furthest stage reached', () => {
    expect(lifecycleOf(issue(null))).toEqual({ reached: 0, ended: null });
    expect(lifecycleOf(issue(null, undefined, 'PENDING'))).toEqual({ reached: 0, ended: null });
    expect(lifecycleOf(issue(null, undefined, 'COMPLETED'))).toEqual({ reached: 1, ended: null });
    expect(lifecycleOf(issue(7, undefined, 'COMPLETED'))).toEqual({ reached: 2, ended: null });
    expect(lifecycleOf(issue(7, 'IN_PROGRESS', 'COMPLETED'))).toEqual({ reached: 3, ended: null });
    expect(lifecycleOf(issue(7, 'PR_OPEN', 'COMPLETED'))).toEqual({ reached: 4, ended: null });
  });

  it('counts a failed triage as finished, and a filed error from before triage was recorded as filed', () => {
    expect(lifecycleOf(issue(null, undefined, 'ERRORED')).reached).toBe(1);
    expect(lifecycleOf(issue(7)).reached).toBe(2);
  });

  it('marks attempts that stopped for good', () => {
    expect(lifecycleOf(issue(7, 'FAILED'))).toEqual({ reached: 3, ended: 'FAILED' });
    expect(lifecycleOf(issue(7, 'SKIPPED'))).toEqual({ reached: 3, ended: 'SKIPPED' });
  });
});

describe('funnel', () => {
  it('counts every error at each stage it reached or passed', () => {
    expect(funnel([issue(null), issue(null, undefined, 'COMPLETED'), issue(1, undefined, 'COMPLETED'), issue(2, 'FAILED'), issue(3, 'PR_OPEN')])).toEqual([5, 4, 3, 2, 1]);
    expect(funnel([])).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('safeUrl', () => {
  it('only lets http(s) through', () => {
    expect(safeUrl('https://github.com/a/b')).toBe('https://github.com/a/b');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});
