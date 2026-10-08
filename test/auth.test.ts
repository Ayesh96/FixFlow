import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { loadOrCreateToken } from '../server/auth.ts';
import { tempConfig } from './helpers.ts';

describe('loadOrCreateToken', () => {
  it('creates a strong token in a file only the owner can read, and reuses it', async () => {
    const { tokenFile } = await tempConfig();
    const token = await loadOrCreateToken(tokenFile);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/, '256 random bits, url-safe');
    assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
    assert.equal(await loadOrCreateToken(tokenFile), token, 'stable across restarts so the browser cookie stays valid');
  });

  it('replaces a malformed token and tightens loose permissions', async () => {
    const { tokenFile } = await tempConfig();
    await writeFile(tokenFile, 'short\n', { mode: 0o644 });
    const token = await loadOrCreateToken(tokenFile);
    assert.notEqual(token, 'short');
    assert.equal((await stat(tokenFile)).mode & 0o777, 0o600);
  });

  it('generates distinct tokens for distinct installs', async () => {
    const [a, b] = await Promise.all([tempConfig(), tempConfig()]);
    assert.notEqual(await loadOrCreateToken(a.tokenFile), await loadOrCreateToken(b.tokenFile));
  });
});
