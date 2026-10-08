import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SecretStore } from '../../server/projects/secrets.ts';

const tempKeyFile = (): string => join(mkdtempSync(join(tmpdir(), 'secrets-')), 'secret.key');

describe('SecretStore', () => {
  it('seals a secret so the plaintext is not in what gets stored, and opens it again', () => {
    const store = new SecretStore(tempKeyFile());
    const sealed = store.seal('ghp_super_secret_token_123');
    assert.ok(!sealed.includes('ghp_super_secret_token_123'));
    assert.ok(!Buffer.from(sealed, 'base64').toString('latin1').includes('ghp_super_secret_token_123'));
    assert.equal(store.open(sealed), 'ghp_super_secret_token_123');
  });

  it('seals the same secret differently every time', () => {
    const store = new SecretStore(tempKeyFile());
    assert.notEqual(store.seal('same'), store.seal('same'));
  });

  it('keeps its key across restarts, in a file only the owner can read', () => {
    const keyFile = tempKeyFile();
    const sealed = new SecretStore(keyFile).seal('survives a restart');
    assert.equal(new SecretStore(keyFile).open(sealed), 'survives a restart');
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
  });

  it('refuses a sealed value that was tampered with', () => {
    const store = new SecretStore(tempKeyFile());
    const sealed = store.seal('do not touch');
    const flipped = `${sealed.slice(0, -4)}${sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`;
    assert.throws(() => store.open(flipped), /could not be decrypted/i);
  });

  it('cannot be opened with a different key', () => {
    const sealed = new SecretStore(tempKeyFile()).seal('mine');
    assert.throws(() => new SecretStore(tempKeyFile()).open(sealed), /could not be decrypted/i);
  });

  it('refuses a key file that is the wrong size instead of quietly weakening the encryption', () => {
    const keyFile = tempKeyFile();
    writeFileSync(keyFile, 'too short', { mode: 0o600 });
    assert.throws(() => new SecretStore(keyFile), /key file/i);
  });
});
