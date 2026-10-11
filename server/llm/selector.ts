import type { ProviderId, Purpose } from './types.ts';

/**
 * Decides which models a purpose uses, and in what order. Today that is settings read at startup; a
 * per-user or per-project choice is another class behind this interface and changes nothing else.
 */
export interface ModelSelector {
  providersFor(purpose: Purpose): readonly ProviderId[];
}

/** The order is fixed when the selector is built, typically from the environment. */
export class ConfigModelSelector implements ModelSelector {
  private readonly order: Readonly<Record<Purpose, readonly ProviderId[]>>;

  constructor(order: Readonly<Record<Purpose, readonly ProviderId[]>>) {
    this.order = order;
  }

  providersFor(purpose: Purpose): readonly ProviderId[] {
    return this.order[purpose];
  }
}
