import { homedir } from 'node:os';
import { join } from 'node:path';
import { githubApiUrl, githubCloneUrl, loadAnthropic, loadOllama } from './workflows/config.ts';
import { loadConfig as loadErrorsConfig, type Config as ErrorsConfig } from './workflows/errors/config.ts';
import { loadConfig as loadResolverConfig, type Config as ResolverConfig } from './workflows/resolver/config.ts';

export interface Config {
  port: number;
  home: string;
  /** Where everything this install keeps lives: the token, the databases, the key and the clones. */
  dataDir: string;
  /** Holds the secret the browser must present; readable only by you. */
  tokenFile: string;
  /** Where projects (repo, branch, token) live. */
  projectsDb: string;
  /** The key that seals the tokens in `projectsDb`. Readable only by you. */
  secretKeyFile: string;
  /** Where each project's repository is cloned (see projects/repos.ts). */
  reposDir: string;
  /** Where repositories are cloned from, with `{repo}` for `owner/name`. */
  githubCloneUrl: string;
  /** Error tracking; null leaves it out of the dashboard entirely. */
  errors: ErrorsConfig | null;
  /** The resolver; null leaves it out of the dashboard entirely. */
  resolver: ResolverConfig | null;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const home = homedir();
  const port = Number(env.PORT ?? 7420);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`PORT must be 1-65535 (got "${env.PORT}")`);

  const dataDir = env.ORCH_DATA_DIR ?? join(home, '.errorflow');

  // GitHub, Ollama and Anthropic are read once and shared by the workflows that need them.
  const ollama = loadOllama(env);
  const anthropic = loadAnthropic(env);

  return {
    port,
    home,
    dataDir,
    tokenFile: env.ORCH_TOKEN_FILE ?? join(dataDir, 'token'),
    projectsDb: env.ORCH_PROJECTS_DB ?? join(dataDir, 'projects.db'),
    secretKeyFile: env.ORCH_SECRET_KEY_FILE ?? join(dataDir, 'secret.key'),
    reposDir: env.ORCH_REPOS_DIR ?? join(dataDir, 'repos'),
    githubCloneUrl: githubCloneUrl(env),
    errors: loadErrorsConfig(env, { dataDir, githubApiUrl: githubApiUrl(env), ollama }),
    resolver: loadResolverConfig(env, { dataDir, githubApiUrl: githubApiUrl(env), ollama, anthropic }),
  };
}
