import { describe, expect, it } from 'vitest';
import { guides, serviceName, SETTINGS } from './snippets';

describe('serviceName', () => {
  it('uses the repository name, lower-cased and safe as a tag', () => {
    expect(serviceName('Ayesh96/MacRemote')).toBe('macremote');
    expect(serviceName('acme/Web App!')).toBe('web-app-');
    expect(serviceName('solo')).toBe('solo');
  });
});

describe('guides', () => {
  const dsn = 'http://codeakos@localhost:3080/1';
  const g = guides(dsn, 'macremote');

  it('puts the project address and service into every language', () => {
    for (const guide of Object.values(g)) {
      expect(guide.init).toContain(dsn);
      expect(guide.init).toContain('macremote');
    }
  });

  it('turns on stack traces for messages in every language, which is what lets a logged failure be filed', () => {
    expect(g.python.init).toContain('attach_stacktrace=True');
    expect(g.node.init).toContain('attachStacktrace: true');
    expect(g.browser.init).toContain('attachStacktrace: true');
  });

  it('uses the right package for each runtime, and sends an info message that is never filed', () => {
    expect(g.python.install).toBe('pip install sentry-sdk');
    expect(g.node.init).toContain('"@sentry/node"');
    expect(g.browser.init).toContain('"@sentry/browser"');
    for (const guide of Object.values(g)) expect(guide.test).toMatch(/info/);
  });

  it('writes the address as a safe string literal, whatever it contains', () => {
    const odd = guides('http://x@h/1"; evil()//', 's');
    expect(odd.python.init).toContain('dsn="http://x@h/1\\"; evil()//"');
    expect(odd.node.init).toContain('dsn: "http://x@h/1\\"; evil()//"');
  });

  it('names every recommended setting in every language', () => {
    for (const guide of Object.values(g)) expect(guide.names).toHaveLength(SETTINGS.length);
  });
});
