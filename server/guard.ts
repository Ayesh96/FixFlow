import type { RequestHandler } from 'express';

/**
 * This server holds GitHub tokens and can push code to your repositories, so a web page you happen to
 * have open must not be able to talk to it. Two attacks matter:
 *  - DNS rebinding: a hostile domain resolves to 127.0.0.1, making the browser treat our API as
 *    same-origin. Defeated by only accepting our own loopback Host names.
 *  - Cross-site requests (forms, fetch no-cors): defeated by rejecting state-changing requests
 *    whose Origin / Sec-Fetch-Site show they came from somewhere else.
 *
 * `publicPort` is for a container: `-p 127.0.0.1:8080:7420` makes the browser send `localhost:8080`. Only the
 * port is added; the names stay loopback-only, so a rebound domain is still refused.
 */
export function localOnly(port: number, publicPort?: number): RequestHandler {
  const ports = publicPort === undefined ? [port] : [port, publicPort];
  const allowedHosts = new Set(ports.flatMap((p) => [`localhost:${p}`, `127.0.0.1:${p}`, `[::1]:${p}`]));

  return (req, res, next) => {
    const host = req.headers.host?.toLowerCase();
    if (!host || !allowedHosts.has(host)) {
      res.status(403).json({ error: 'Forbidden: unexpected Host header' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      const crossOrigin = origin !== undefined && new URL(origin).host.toLowerCase() !== host;
      const crossSite = site !== undefined && site !== 'same-origin' && site !== 'none';
      if (crossOrigin || crossSite) {
        res.status(403).json({ error: 'Forbidden: cross-origin request' });
        return;
      }
    }
    next();
  };
}

/**
 * Defense in depth for the UI: no framing (clickjacking), no third-party loads, no MIME sniffing.
 * `style-src 'unsafe-inline'` is needed because Radix and Sonner position popovers with inline styles.
 */
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  );
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
};
