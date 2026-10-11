/**
 * Settings both workflows need. Before the merge each service parsed its own `GITHUB_TOKEN`,
 * `OLLAMA_URL` and so on; in one process those names would collide, so they are read once here
 * and handed to whichever workflow wants them.
 */

/**
 * The context window asked of every Ollama request. Ollama's own default is a few thousand tokens, which a
 * stack trace plus the source files it names and a conversation of tool results outgrow, and it cuts the
 * oldest text silently. qwen2.5-coder supports 32768.
 */
export const OLLAMA_NUM_CTX = 32_768;

export interface OllamaSettings {
  url: string;
  model: string;
}

export interface AnthropicSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
}

type Env = Record<string, string | undefined>;

const trimmed = (env: Env, name: string): string => env[name]?.trim() ?? '';

/**
 * The GitHub API address (GitHub Enterprise has its own). Separate from the token because tokens now
 * belong to projects, but the address is still one setting for the whole install.
 */
export function githubApiUrl(env: Env): string {
  return (trimmed(env, 'ORCH_GITHUB_API_URL') || 'https://api.github.com').replace(/\/+$/, '');
}

/**
 * Where repositories are cloned from, with `{repo}` standing for `owner/name`. GitHub by default; a
 * GitHub Enterprise server (or a local mirror) has its own address. Refused without `{repo}`, since
 * that would clone the same thing for every project.
 */
export function githubCloneUrl(env: Env): string {
  const template = trimmed(env, 'ORCH_GITHUB_CLONE_URL') || 'https://github.com/{repo}.git';
  if (!template.includes('{repo}')) throw new Error(`ORCH_GITHUB_CLONE_URL must contain {repo}, for example https://github.com/{repo}.git (got "${template}")`);
  return template;
}

/** Null when no Ollama URL is set; the errors workflow then triages with its rule-based heuristic. */
export function loadOllama(env: Env): OllamaSettings | null {
  const url = trimmed(env, 'ORCH_OLLAMA_URL');
  if (!url) return null;
  return { url: url.replace(/\/+$/, ''), model: trimmed(env, 'ORCH_OLLAMA_MODEL') || 'qwen2.5-coder:7b' };
}

/** The hosted model the resolver tries first; null leaves it on Ollama alone. */
export function loadAnthropic(env: Env): AnthropicSettings | null {
  const apiKey = trimmed(env, 'ORCH_ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  return {
    apiUrl: (trimmed(env, 'ORCH_ANTHROPIC_API_URL') || 'https://api.anthropic.com').replace(/\/+$/, ''),
    apiKey,
    model: trimmed(env, 'ORCH_ANTHROPIC_MODEL') || 'claude-haiku-4-5',
  };
}
