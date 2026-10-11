import { FallbackChain } from './fallback-chain.ts';
import type { ProviderRegistry } from './registry.ts';
import type { ModelSelector } from './selector.ts';
import type { ChatClient, ChatMessage, ChatOptions, FallbackListener, LlmGateway, Purpose } from './types.ts';

/**
 * The single place a model is triggered from. A caller names its purpose; the selector says which
 * providers that means, the registry builds them, and the call goes into the first one's wrapper, with
 * the rest behind it as fallbacks. Nothing above this knows which provider answered.
 */
export class LlmService implements LlmGateway {
  private readonly selector: ModelSelector;
  private readonly registry: ProviderRegistry;

  constructor(selector: ModelSelector, registry: ProviderRegistry) {
    this.selector = selector;
    this.registry = registry;
  }

  isAvailable(purpose: Purpose): boolean {
    return this.selector.providersFor(purpose).length > 0;
  }

  clientFor(purpose: Purpose, onFallback?: FallbackListener): ChatClient {
    const links = this.selector.providersFor(purpose).map((id) => ({ id, client: this.registry.create(id) }));
    return new FallbackChain(links, onFallback);
  }

  run(purpose: Purpose, messages: ChatMessage[], tools: readonly unknown[] = [], options?: ChatOptions): Promise<ChatMessage> {
    return this.clientFor(purpose).chat(messages, tools, options);
  }
}
