/** The setup code shown in the "Connect an app" guide, one set per language, filled in with a project's own address. */

export type LanguageId = 'python' | 'node' | 'browser';

export interface Guide {
  label: string;
  /** The language fence, for the copy button's label. */
  language: 'python' | 'typescript';
  install: string;
  init: string;
  test: string;
  /** What each setting is called in this SDK, in the order of `SETTINGS`. */
  names: string[];
}

/** The settings the guide recommends, and why: the part a reader needs even if they never read the code. */
export const SETTINGS = [
  { key: 'dsn', why: "Where errors are sent: this project's error address." },
  { key: 'environment', why: 'Says where it ran ("production", "development"), so a bug on your laptop is not mistaken for one in production.' },
  { key: 'release', why: 'Your app version or git commit, so a bug can be tied to the change that caused it.' },
  { key: 'stacktrace', why: 'Attaches the call stack to logged messages. Without it a logged failure has no stack and is kept here but never filed on GitHub.' },
  { key: 'service', why: 'Names the app on every error. Errors from different apps are never grouped together.' },
] as const;

/** `Ayesh96/MacRemote` → `macremote`: a readable default for the service tag. */
export const serviceName = (repo: string): string => (repo.split('/').pop() ?? repo).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');

const str = (value: string): string => JSON.stringify(value); // a valid string literal in both Python and JavaScript

export function guides(dsn: string, service: string): Record<LanguageId, Guide> {
  const jsInit = (pkg: string, env: string) => `import * as Sentry from "${pkg}";

Sentry.init({
  dsn: ${str(dsn)},
  environment: ${env},
  release: "${service}@1.0.0", // your version or git commit
  attachStacktrace: true, // logged messages carry the stack
  initialScope: { tags: { service: ${str(service)} } },
});`;
  const jsTest = `Sentry.captureMessage("errorflow connection test", "info");
await Sentry.flush(2000); // send now rather than at exit`;
  const jsNames = ['dsn', 'environment', 'release', 'attachStacktrace', 'initialScope.tags.service'];

  return {
    python: {
      label: 'Python',
      language: 'python',
      install: 'pip install sentry-sdk',
      init: `import sentry_sdk

sentry_sdk.init(
    dsn=${str(dsn)},
    environment="production",  # "development" on your own machine
    release="${service}@1.0.0",  # your version or git commit
    attach_stacktrace=True,  # logged messages carry the stack
)
sentry_sdk.set_tag("service", ${str(service)})  # names the app on every error`,
      test: `sentry_sdk.capture_message("errorflow connection test", level="info")
sentry_sdk.flush(2)  # send now rather than at exit`,
      names: ['dsn', 'environment', 'release', 'attach_stacktrace', 'set_tag("service", …)'],
    },
    node: {
      label: 'Node.js',
      language: 'typescript',
      install: 'npm install @sentry/node',
      init: jsInit('@sentry/node', 'process.env.NODE_ENV ?? "production"'),
      test: jsTest,
      names: jsNames,
    },
    browser: {
      label: 'Browser',
      language: 'typescript',
      install: 'npm install @sentry/browser',
      init: jsInit('@sentry/browser', '"production"'),
      test: jsTest,
      names: jsNames,
    },
  };
}
