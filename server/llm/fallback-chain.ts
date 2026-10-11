import type { ChatClient, ChatMessage, ChatOptions, FallbackListener, ProviderId } from './types.ts';

export interface ChainLink {
  id: ProviderId;
  client: ChatClient;
}

/**
 * Tries its clients in order. One that fails (no network, a bad key, a rate limit, an outage) is not
 * asked again by this chain, and the run carries on with the next. The history has the same shape for
 * every provider, so the next one simply continues the same conversation.
 *
 * It is one run's worth of memory: make a new chain per run, so a provider that was down is tried again
 * the next time.
 */
export class FallbackChain implements ChatClient {
  private readonly links: readonly ChainLink[];
  private readonly onFallback: FallbackListener;
  private readonly failed = new Set<ProviderId>();

  constructor(links: readonly ChainLink[], onFallback: FallbackListener = () => {}) {
    this.links = links;
    this.onFallback = onFallback;
  }

  async chat(messages: ChatMessage[], tools: readonly unknown[], options?: ChatOptions): Promise<ChatMessage> {
    let lastError: unknown = new Error('No model is configured');
    for (const link of this.links) {
      if (this.failed.has(link.id)) continue;
      try {
        return await link.client.chat(messages, tools, options);
      } catch (err) {
        this.failed.add(link.id);
        lastError = err;
        this.onFallback(link.id, err);
      }
    }
    throw lastError;
  }
}
