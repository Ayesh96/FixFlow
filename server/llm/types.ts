/** The models Errorflow can talk to. Adding one means a provider class, a registry line and a name here. */
export const PROVIDER_IDS = ['ollama', 'deepseek', 'anthropic'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** What a model is being asked to do. Each purpose has its own ordered list of providers. */
export const PURPOSES = ['triage', 'resolver'] as const;
export type Purpose = (typeof PURPOSES)[number];

export interface ToolCall {
  id: string;
  /** `arguments` is a JSON string everywhere inside Errorflow; providers convert at their own edge. */
  function: { name: string; arguments: string };
}

/** One turn of a conversation, in the OpenAI-style shape the agent loop uses for every provider. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** Per-call hints. A provider applies what its API can express and ignores the rest. */
export interface ChatOptions {
  /** The reply must be one JSON object (triage). */
  json?: boolean;
  temperature?: number;
  /** A context window to ask for, where the provider lets the caller choose (a local model does). */
  contextTokens?: number;
  /** Overrides the provider's own request timeout. */
  timeoutMs?: number;
}

/** What the agent loop and the triager need from a model. The one seam between them and any provider. */
export interface ChatClient {
  chat(messages: ChatMessage[], tools: readonly unknown[], options?: ChatOptions): Promise<ChatMessage>;
}

/**
 * Every provider fails with this, whatever its API looked like, so a caller (or a fallback chain) can
 * treat them alike. `status` is the HTTP status, 0 when the request never got an answer, 502 when the
 * answer was unusable.
 */
export class LlmError extends Error {
  readonly provider: ProviderId;
  readonly status: number;

  constructor(provider: ProviderId, status: number, message: string) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.name = 'LlmError';
  }
}

/** What a workflow is given: ask for a model by purpose and never name a provider. */
export interface LlmGateway {
  /** False when no provider is configured for this purpose, so the caller can use something else. */
  isAvailable(purpose: Purpose): boolean;
  /** A client for one run: it walks the purpose's providers in order and stops using one that failed. */
  clientFor(purpose: Purpose, onFallback?: FallbackListener): ChatClient;
  /** One call. Same as `clientFor(purpose).chat(...)`. */
  run(purpose: Purpose, messages: ChatMessage[], tools?: readonly unknown[], options?: ChatOptions): Promise<ChatMessage>;
}

/** Told when a provider fails; the next one in the list, if any, is tried next. */
export type FallbackListener = (failed: ProviderId, error: unknown) => void;
