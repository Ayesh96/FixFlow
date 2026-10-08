import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Store } from '../../../server/workflows/errors/store.ts';
import { jsEvent, normalized } from './fixtures.ts';

describe('Store schema upgrade', () => {
  it('opens a database created before projects existed, keeping its issues', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'store-')), 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE issues (fingerprint_hash TEXT PRIMARY KEY, title TEXT NOT NULL, first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1, github_issue_number INTEGER, github_issue_url TEXT);
      INSERT INTO issues VALUES ('abc', '[Error] Old: one', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 4, 9, 'https://github.com/o/r/issues/9');`);
    old.close();

    const store = new Store(path);
    try {
      assert.deepEqual(store.getIssue('abc'), {
        fingerprintHash: 'abc',
        projectId: '',
        service: null,
        title: '[Error] Old: one',
        firstSeen: '2026-01-01T00:00:00Z',
        lastSeen: '2026-01-02T00:00:00Z',
        count: 4,
        githubIssueNumber: 9,
        githubIssueUrl: 'https://github.com/o/r/issues/9',
        githubRepo: null,
        resolverStatus: null,
        resolverPrNumber: null,
        resolverPrUrl: null,
        resolverReason: null,
        resolverUpdatedAt: null,
      });
      const fresh = store.recordEvent(normalized(jsEvent()), 'new', 't', '7');
      assert.equal(fresh?.projectId, '7');
    } finally {
      store.close();
    }
  });
});

describe('Store.setResolverStatus', () => {
  it('records status, PR details, and reason against an existing issue', () => {
    const store = new Store(':memory:');
    try {
      store.recordEvent(normalized(jsEvent()), 'fp-1', 'title', '1');
      const now = new Date('2026-01-03T00:00:00Z');
      const found = store.setResolverStatus('fp-1', 'PR_OPEN', { prNumber: 12, prUrl: 'https://github.com/o/r/pull/12' }, now);

      assert.equal(found, true);
      const issue = store.getIssue('fp-1');
      assert.equal(issue?.resolverStatus, 'PR_OPEN');
      assert.equal(issue?.resolverPrNumber, 12);
      assert.equal(issue?.resolverPrUrl, 'https://github.com/o/r/pull/12');
      assert.equal(issue?.resolverReason, null);
      assert.equal(issue?.resolverUpdatedAt, now.toISOString());
    } finally {
      store.close();
    }
  });

  it('returns false and writes nothing for an unknown fingerprint', () => {
    const store = new Store(':memory:');
    try {
      const found = store.setResolverStatus('does-not-exist', 'SKIPPED', { reason: 'no such issue' });
      assert.equal(found, false);
      assert.equal(store.getIssue('does-not-exist'), null);
    } finally {
      store.close();
    }
  });

  it('overwrites a previous status with the latest one', () => {
    const store = new Store(':memory:');
    try {
      store.recordEvent(normalized(jsEvent()), 'fp-2', 'title', '1');
      store.setResolverStatus('fp-2', 'FAILED', { reason: 'clone failed' });
      store.setResolverStatus('fp-2', 'PR_OPEN', { prNumber: 5, prUrl: 'https://github.com/o/r/pull/5' });

      const issue = store.getIssue('fp-2');
      assert.equal(issue?.resolverStatus, 'PR_OPEN');
      assert.equal(issue?.resolverReason, null);
      assert.equal(issue?.resolverPrNumber, 5);
    } finally {
      store.close();
    }
  });
});
