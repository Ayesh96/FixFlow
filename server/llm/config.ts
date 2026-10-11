import { PROVIDER_IDS, PURPOSES, type ProviderId, type Purpose } from './types.ts';

export interface OllamaSettings {
  url: string;
  model: string;
}

export interface DeepSeekSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface AnthropicSettings {
  apiUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmSettings {
  /** Always present: the resolver has always defaulted to a local Ollama. */
  ollama: OllamaSettings;
  /** True only when `ORCH_OLLAMA_URL` was set. Triage uses Ollama only then, as it always has. */
  ollamaConfigured: boolean;
  deepseek: DeepSeekSettings | null;
  anthropic: AnthropicSettings | null;
  /** Which providers each purpose tries, in order, already checked against what is configured. */
  order: Record<Purpose, ProviderId[]>;
}

type Env = Record<string, string | undefined>;

const trimmed = (env: Env, name: string): string => env[name]?.trim() ?? '';

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b';
/** Local first, then the cheaper hosted model, then the dearer one. */
const DEFAULT_ORDER: readonly ProviderId[] = ['ollama', 'deepseek', 'anthropic'];

/** Null when no Ollama URL is set. */
export function loadOllama(env: Env): OllamaSettings | null {
  const url = trimmed(env, 'ORCH_OLLAMA_URL');
  if (!url) return null;
  return { url: url.replace(/\/+$/, ''), model: trimmed(env, 'ORCH_OLLAMA_MODEL') || DEFAULT_OLLAMA_MODEL };
}

/** Null when no key is set, which leaves DeepSeek out. */
export function loadDeepSeek(env: Env): DeepSeekSettings | null {
  const apiKey = trimmed(env, 'ORCH_DEEPSEEK_API_KEY');
  if (!apiKey) return null;
  return {
    apiUrl: (trimmed(env, 'ORCH_DEEPSEEK_API_URL') || 'https://api.deepseek.com').replace(/\/+$/, ''),
    apiKey,
    model: trimmed(env, 'ORCH_DEEPSEEK_MODEL') || 'deepseek-flash',
  };
}

/** Null when no key is set, which leaves Anthropic out. */
export function loadAnthropic(env: Env): AnthropicSettings | null {
  const apiKey = trimmed(env, 'ORCH_ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  return {
    apiUrl: (trimmed(env, 'ORCH_ANTHROPIC_API_URL') || 'https://api.anthropic.com').replace(/\/+$/, ''),
    apiKey,
    model: trimmed(env, 'ORCH_ANTHROPIC_MODEL') || 'claude-haiku-4-5',
  };
}

function parseOrder(name: string, raw: string): ProviderId[] {
  const ids = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = ids.filter((id) => !(PROVIDER_IDS as readonly string[]).includes(id));
  if (unknown.length > 0) throw new Error(`${name} names unknown providers: ${unknown.join(', ')} (known: ${PROVIDER_IDS.join(', ')})`);
  return [...new Set(ids as ProviderId[])];
}

/**
 * Reads every provider's settings once, plus the order each purpose tries them in.
 *
 * The order comes from `ORCH_TRIAGE_PROVIDERS` / `ORCH_RESOLVER_PROVIDERS`, else `ORCH_LLM_PROVIDERS`,
 * else ollama, deepseek, anthropic. The default quietly skips a provider that is not set up. A provider
 * named explicitly that is not set up is an error, since the list was asked for by name.
 */
export function loadLlmSettings(env: Env): LlmSettings {
  const ollamaSettings = loadOllama(env);
  const deepseek = loadDeepSeek(env);
  const anthropic = loadAnthropic(env);
  const ollama = ollamaSettings ?? { url: DEFAULT_OLLAMA_URL, model: DEFAULT_OLLAMA_MODEL };
  const ollamaConfigured = ollamaSettings !== null;

  const usable = (purpose: Purpose): Record<ProviderId, boolean> => ({
    // The resolver has always had a local Ollama to fall back on; triage only when one was set up.
    ollama: purpose === 'resolver' || ollamaConfigured,
    deepseek: deepseek !== null,
    anthropic: anthropic !== null,
  });
  const keyName: Record<ProviderId, string> = { ollama: 'ORCH_OLLAMA_URL', deepseek: 'ORCH_DEEPSEEK_API_KEY', anthropic: 'ORCH_ANTHROPIC_API_KEY' };

  const order = {} as Record<Purpose, ProviderId[]>;
  for (const purpose of PURPOSES) {
    const variable = `ORCH_${purpose.toUpperCase()}_PROVIDERS`;
    const named = trimmed(env, variable) || trimmed(env, 'ORCH_LLM_PROVIDERS');
    const available = usable(purpose);
    if (named) {
      const ids = parseOrder(trimmed(env, variable) ? variable : 'ORCH_LLM_PROVIDERS', named);
      const missing = ids.filter((id) => !available[id]);
      if (missing.length > 0) {
        throw new Error(`${variable} lists ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not set up (set ${missing.map((id) => keyName[id]).join(', ')})`);
      }
      order[purpose] = ids;
    } else {
      order[purpose] = DEFAULT_ORDER.filter((id) => available[id]);
    }
  }

  return { ollama, ollamaConfigured, deepseek, anthropic, order };
}
