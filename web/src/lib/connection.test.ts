import { describe, expect, it } from 'vitest';
import type { TrackerIssue, TrackerProjectGroup } from './api';
import { connectionOf } from './connection';

const issue = (service: string | null): TrackerIssue => ({ fingerprintHash: Math.random().toString(), service, projectId: '1', title: 't', firstSeen: '', lastSeen: '', count: 1, githubIssueNumber: null, githubIssueUrl: null, githubRepo: null });
const group = (over: Partial<TrackerProjectGroup>): TrackerProjectGroup => ({ projectId: '1', repo: 'a/b', branch: 'main', issueCount: 0, eventCount: 0, lastSeen: null, issues: [], rejections: { count: 0, last: null }, ...over });

describe('connectionOf', () => {
  it('is not connected until an event has arrived', () => {
    expect(connectionOf(undefined)).toEqual({ connected: false, events: 0, lastSeen: null, apps: [], refusal: null });
    expect(connectionOf(group({}))).toMatchObject({ connected: false });
  });

  it('is connected once any event has arrived, even a test message, and reports when', () => {
    const c = connectionOf(group({ eventCount: 1, lastSeen: '2026-10-09T10:00:00Z', issues: [issue(null)] }));
    expect(c).toMatchObject({ connected: true, events: 1, lastSeen: '2026-10-09T10:00:00Z' });
  });

  it('lists each reporting app once, sorted, and ignores errors that name none', () => {
    const c = connectionOf(group({ eventCount: 5, issues: [issue('worker'), issue('gateway'), issue('worker'), issue(null), issue('')] }));
    expect(c.apps).toEqual(['gateway', 'worker']);
  });

  it('reports a refusal until an event arrives after it', () => {
    const last = { status: 401, reason: 'Invalid or missing sentry_key', at: '2026-10-09T10:00:00Z' };
    expect(connectionOf(group({ rejections: { count: 3, last } })).refusal).toEqual({ ...last, count: 3 });
    expect(connectionOf(group({ eventCount: 1, lastSeen: '2026-10-09T09:00:00Z', rejections: { count: 1, last } })).refusal).toMatchObject({ status: 401 });
    expect(connectionOf(group({ eventCount: 1, lastSeen: '2026-10-09T11:00:00Z', rejections: { count: 1, last } })).refusal).toBeNull();
  });
});
