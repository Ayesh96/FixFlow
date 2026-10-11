import type { ChatClient, ProviderId } from './types.ts';

export type ProviderFactory = () => ChatClient;

/** Knows how to build each provider. It holds no settings of its own: a factory closes over them. */
export class ProviderRegistry {
  private readonly factories = new Map<ProviderId, ProviderFactory>();

  register(id: ProviderId, factory: ProviderFactory): this {
    this.factories.set(id, factory);
    return this;
  }

  has(id: ProviderId): boolean {
    return this.factories.has(id);
  }

  create(id: ProviderId): ChatClient {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`No model provider is registered as "${id}"`);
    return factory();
  }
}
