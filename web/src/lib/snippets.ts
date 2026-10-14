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

/** A compose service that reports to Code Akos on the host: the Docker address, the Linux host alias and a clean stop. */
export function dockerCompose(dockerDsn: string, service: string): string {
  return `services:
  ${service}:
    environment:
      # The SDK reads this on its own
      SENTRY_DSN: ${str(dockerDsn)}
    extra_hosts:
      # Linux needs this line; Docker Desktop does not
      - "host.docker.internal:host-gateway"
    # Passes the stop signal on, so last errors get sent
    init: true`;
}

/** Asks Code Akos if it is up, from inside a container, using the same host name the app will. */
export function dockerCheck(dockerDsn: string): string {
  const { host } = new URL(dockerDsn);
  return `docker run --rm --add-host=host.docker.internal:host-gateway curlimages/curl -s http://${host}/healthz`;
}

/** Sends the errors still waiting when the container is told to stop. */
export const FLUSH_ON_STOP = {
  python: `import signal, sys
import sentry_sdk

def stop(signum, frame):
    sentry_sdk.flush(2)  # send what is waiting
    sys.exit(0)

signal.signal(signal.SIGTERM, stop)`,
  node: `process.on("SIGTERM", async () => {
  await Sentry.close(2000); // send what is waiting
  process.exit(0);
});`,
} as const;

export function guides(dsn: string, service: string): Record<LanguageId, Guide> {
  const jsInit = (pkg: string, env: string) => `import * as Sentry from "${pkg}";

Sentry.init({
  dsn: ${str(dsn)},
  environment: ${env},
  release: "${service}@1.0.0", // your version or git commit
  attachStacktrace: true, // logged messages carry the stack
  initialScope: { tags: { service: ${str(service)} } },
});`;
  const jsTest = `Sentry.captureMessage("code-akos connection test", "info");
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
      test: `sentry_sdk.capture_message("code-akos connection test", level="info")
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
