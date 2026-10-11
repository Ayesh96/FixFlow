import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../../../server/workflows/resolver/store.ts';

test('getAttempt returns null for a never-attempted issue', () => {
  const store = new Store(':memory:');
  const result = store.getAttempt('owner/repo', 42);
  assert.equal(result, null);
  store.close();
});

test('beginAttempt then getAttempt shows IN_PROGRESS with null pr fields', () => {
  const store = new Store(':memory:');
  const now = new Date('2024-01-01T12:00:00Z');
  store.beginAttempt('owner/repo', 42, 'hash123', now);
  const result = store.getAttempt('owner/repo', 42);
  assert.ok(result);
  assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(result.prNumber, null);
  assert.equal(result.prUrl, null);
  assert.equal(result.reason, null);
  assert.equal(result.attemptedAt, now.toISOString());
  store.close();
});

test('beginAttempt then recordResult updates status and pr fields', () => {
  const store = new Store(':memory:');
  const t1 = new Date('2024-01-01T12:00:00Z');
  const t2 = new Date('2024-01-01T12:01:00Z');
  store.beginAttempt('owner/repo', 42, 'hash123', t1);
  store.recordResult('owner/repo', 42, 'PR_OPEN', {
    prNumber: 5,
    prUrl: 'https://github.com/x/y/pull/5',
  }, t2);
  const result = store.getAttempt('owner/repo', 42);
  assert.ok(result);
  assert.equal(result.status, 'PR_OPEN');
  assert.equal(result.prNumber, 5);
  assert.equal(result.prUrl, 'https://github.com/x/y/pull/5');
  assert.equal(result.attemptedAt, t2.toISOString());
  store.close();
});

test('beginAttempt twice for same (repo, issueNumber) overwrites row', () => {
  const store = new Store(':memory:');
  const t1 = new Date('2024-01-01T12:00:00Z');
  const t2 = new Date('2024-01-01T12:01:00Z');
  store.beginAttempt('owner/repo', 42, 'hash123', t1);
  store.beginAttempt('owner/repo', 42, 'hash456', t2);
  const rows = store.listAttempts(100, 0);
  assert.equal(rows.length, 1);
  const result = store.getAttempt('owner/repo', 42);
  assert.ok(result);
  assert.equal(result.fingerprintHash, 'hash456');
  assert.equal(result.attemptedAt, t2.toISOString());
  store.close();
});

test('listAttempts returns most-recently-attempted first and respects limit/offset', () => {
  const store = new Store(':memory:');
  const t1 = new Date('2024-01-01T12:00:00Z');
  const t2 = new Date('2024-01-01T12:05:00Z');
  const t3 = new Date('2024-01-01T12:10:00Z');
  store.beginAttempt('owner/repo', 1, 'hash1', t1);
  store.beginAttempt('owner/repo', 2, 'hash2', t2);
  store.beginAttempt('owner/repo', 3, 'hash3', t3);
  const all = store.listAttempts(100, 0);
  assert.equal(all.length, 3);
  assert.equal(all[0]!.issueNumber, 3);
  assert.equal(all[1]!.issueNumber, 2);
  assert.equal(all[2]!.issueNumber, 1);
  const page1 = store.listAttempts(2, 0);
  assert.equal(page1.length, 2);
  assert.equal(page1[0]!.issueNumber, 3);
  assert.equal(page1[1]!.issueNumber, 2);
  const page2 = store.listAttempts(2, 2);
  assert.equal(page2.length, 1);
  assert.equal(page2[0]!.issueNumber, 1);
  store.close();
});

test('stats() on empty store returns all zeros', () => {
  const store = new Store(':memory:');
  const stats = store.stats();
  assert.deepEqual(stats, {
    total: 0,
    prOpen: 0,
    skipped: 0,
    failed: 0,
  });
  store.close();
});

test('stats() with mixed statuses counts correctly', () => {
  const store = new Store(':memory:');
  const now = new Date('2024-01-01T12:00:00Z');
  store.beginAttempt('owner/repo', 1, 'hash1', now);
  store.recordResult('owner/repo', 1, 'PR_OPEN', { prNumber: 1 }, now);
  store.beginAttempt('owner/repo', 2, 'hash2', now);
  store.recordResult('owner/repo', 2, 'SKIPPED', { reason: 'already open' }, now);
  store.beginAttempt('owner/repo', 3, 'hash3', now);
  store.recordResult('owner/repo', 3, 'FAILED', { reason: 'error' }, now);
  store.beginAttempt('owner/repo', 4, 'hash4', now);
  const stats = store.stats();
  assert.equal(stats.total, 4);
  assert.equal(stats.prOpen, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.failed, 1);
  store.close();
});

test('every beginAttempt counts, whatever the outcome', () => {
  const store = new Store(':memory:');
  store.beginAttempt('owner/repo', 42, 'hash123');
  assert.equal(store.getAttempt('owner/repo', 42)?.attempts, 1);
  store.recordResult('owner/repo', 42, 'FAILED', { reason: 'boom' });
  store.beginAttempt('owner/repo', 42, 'hash123');
  store.recordResult('owner/repo', 42, 'SKIPPED', { reason: 'no' });
  store.beginAttempt('owner/repo', 42, 'hash123');
  assert.equal(store.getAttempt('owner/repo', 42)?.attempts, 3);
  assert.equal(store.getAttempt('owner/repo', 43), null);
  store.close();
});

test('a database from before attempts were counted is upgraded in place', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { DatabaseSync } = await import('node:sqlite');
  const path = join(mkdtempSync(join(tmpdir(), 'resolver-old-')), 'resolver.db');

  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE attempts (
    repo TEXT NOT NULL, issue_number INTEGER NOT NULL, fingerprint_hash TEXT NOT NULL, status TEXT NOT NULL,
    pr_number INTEGER, pr_url TEXT, reason TEXT, attempted_at TEXT NOT NULL, PRIMARY KEY (repo, issue_number))`);
  old.exec("INSERT INTO attempts VALUES ('owner/repo', 9, 'h', 'FAILED', NULL, NULL, 'old failure', '2024-01-01T00:00:00.000Z')");
  old.close();

  const store = new Store(path);
  const row = store.getAttempt('owner/repo', 9);
  assert.equal(row?.status, 'FAILED');
  assert.equal(row?.attempts, 0, 'an old failure starts with a fresh allowance');
  store.beginAttempt('owner/repo', 9, 'h');
  assert.equal(store.getAttempt('owner/repo', 9)?.attempts, 1);
  store.close();
});
