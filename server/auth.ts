import type { RequestHandler } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const COOKIE_NAME = 'orch_token';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

/**
 * Loopback is shared by every local user and every sandboxed app, and this server holds GitHub tokens
 * and can push code. So API access needs a secret that only your account can read: a random
 * token kept in a 0600 file, handed to the browser once as an HttpOnly cookie.
 */
export async function loadOrCreateToken(path: string): Promise<string> {
  const existing = await readFile(path, 'utf8').then((t) => t.trim(), () => '');
  if (TOKEN_PATTERN.test(existing)) return existing;

  const token = randomBytes(32).toString('base64url');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
  await chmod(path, 0o600); // writeFile's mode is ignored when the file already existed
  return token;
}

const equal = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/** Guards /api: the request must carry the token cookie. */
export function requireToken(token: string): RequestHandler {
  return (req, res, next) => {
    const presented = cookieValue(req.headers.cookie, COOKIE_NAME);
    if (presented && equal(presented, token)) return next();
    res.status(401).json({ error: 'Unauthorized. Open the link printed when the server started (it ends in ?token=…).' });
  };
}

/** `GET /?token=…` trades the token for a cookie, then redirects to a clean URL so it doesn't linger in history. */
export function tokenLogin(token: string): RequestHandler {
  return (req, res, next) => {
    if (req.path !== '/' || typeof req.query.token !== 'string') return next();
    if (!equal(req.query.token, token)) {
      res.status(401).type('text/plain').send('Invalid token.');
      return;
    }
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 365 * 24 * 3600 * 1000 });
    res.redirect(303, '/');
  };
}
