import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // the size GCM is designed around
const VERSION = 'v1';

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

/**
 * Seals small secrets (GitHub tokens) with AES-256-GCM before they are written to the database.
 *
 * What this protects against: a copied database, a backup, a file shared by mistake. None of those
 * contain a usable token. What it does not protect against: someone who can read your user's
 * files, because the key sits in a 0600 file beside the data. It is the same trust model as an
 * SSH private key, and it is better than plaintext in `.env`, but it is not a keychain. Swapping
 * this class for one backed by the OS keychain is the upgrade path; callers only use seal/open.
 */
export class SecretStore {
  private readonly key: Buffer;

  constructor(keyFile: string) {
    this.key = loadOrCreateKey(keyFile);
  }

  /** `v1.<iv>.<tag>.<ciphertext>`, each part base64url, so it is safe in a text column. */
  seal(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), body].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || body === undefined) throw new SecretError('Stored secret is not in a format this version understands');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      // GCM authenticates: this is a wrong key or altered data, and we cannot tell which.
      throw new SecretError('Stored secret could not be decrypted (wrong key file, or the value was altered)');
    }
  }
}

function loadOrCreateKey(keyFile: string): Buffer {
  if (existsSync(keyFile)) {
    const key = readFileSync(keyFile);
    // A truncated key would still "work" with some APIs and silently weaken everything; refuse it.
    if (key.length !== KEY_BYTES) throw new SecretError(`Key file ${keyFile} is ${key.length} bytes, expected ${KEY_BYTES}. Not using it.`);
    return key;
  }
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' }); // wx: never overwrite a key someone else just created
  chmodSync(keyFile, 0o600); // the mode option is masked by umask on some systems
  return key;
}
