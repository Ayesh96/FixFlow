import type { LlmSettings } from './config.ts';
import { AnthropicProvider } from './providers/anthropic.ts';
import { DeepSeekProvider } from './providers/deepseek.ts';
import { OllamaProvider } from './providers/ollama.ts';
import { ProviderRegistry } from './registry.ts';
import { ConfigModelSelector } from './selector.ts';
import { LlmService } from './service.ts';

export { loadLlmSettings, type LlmSettings } from './config.ts';
export { LlmError, type ChatClient, type ChatMessage, type ChatOptions, type LlmGateway, type ProviderId, type Purpose, type ToolCall } from './types.ts';
export { LlmService } from './service.ts';

/**
 * Where the concrete providers are wired up from settings: the only file that names them all. A new
 * provider is a class, one `register` line here, and its name in types.ts.
 */
export function createLlm(settings: LlmSettings): LlmService {
  const registry = new ProviderRegistry().register('ollama', () => new OllamaProvider({ apiUrl: settings.ollama.url, model: settings.ollama.model }));
  const { deepseek, anthropic } = settings;
  if (deepseek) registry.register('deepseek', () => new DeepSeekProvider(deepseek));
  if (anthropic) registry.register('anthropic', () => new AnthropicProvider(anthropic));
  return new LlmService(new ConfigModelSelector(settings.order), registry);
}
