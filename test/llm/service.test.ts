import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLlm } from '../../server/llm/index.ts';
import { ProviderRegistry } from '../../server/llm/registry.ts';
import { ConfigModelSelector } from '../../server/llm/selector.ts';
import { LlmService } from '../../server/llm/service.ts';
import type { ChatClient, ProviderId } from '../../server/llm/types.ts';

const named = (id: string, log: string[], fail = false): ChatClient => ({
  async chat() {
    log.push(id);
    if (fail) throw new Error(`${id} down`);
    return { role: 'assistant', content: id };
  },
});

describe('LlmService', () => {
  it('sends a call to the provider its purpose is set to, and nobody else', async () => {
    const log: string[] = [];
    const registry = new ProviderRegistry().register('ollama', () => named('ollama', log)).register('deepseek', () => named('deepseek', log));
    const service = new LlmService(new ConfigModelSelector({ triage: ['deepseek'], resolver: ['ollama'] }), registry);
    assert.equal((await service.run('triage', [])).content, 'deepseek');
    assert.equal((await service.run('resolver', [])).content, 'ollama');
    assert.deepEqual(log, ['deepseek', 'ollama']);
  });

  it('falls back down the list for its purpose', async () => {
    const log: string[] = [];
    const registry = new ProviderRegistry()
      .register('ollama', () => named('ollama', log, true))
      .register('deepseek', () => named('deepseek', log, true))
      .register('anthropic', () => named('anthropic', log));
    const service = new LlmService(new ConfigModelSelector({ triage: [], resolver: ['ollama', 'deepseek', 'anthropic'] }), registry);
    const failed: ProviderId[] = [];
    const reply = await service.clientFor('resolver', (id) => failed.push(id)).chat([], []);
    assert.equal(reply.content, 'anthropic');
    assert.deepEqual(failed, ['ollama', 'deepseek']);
  });

  it('says a purpose is unavailable when no provider is set for it', () => {
    const service = new LlmService(new ConfigModelSelector({ triage: [], resolver: ['ollama'] }), new ProviderRegistry().register('ollama', () => named('ollama', [])));
    assert.equal(service.isAvailable('triage'), false);
    assert.equal(service.isAvailable('resolver'), true);
  });

  it('refuses to build a provider that was never registered', () => {
    const service = new LlmService(new ConfigModelSelector({ triage: ['deepseek'], resolver: [] }), new ProviderRegistry());
    assert.throws(() => service.clientFor('triage'), /No model provider is registered as "deepseek"/);
  });
});

describe('createLlm', () => {
  it('wires only the providers that are set up', () => {
    const llm = createLlm({
      ollama: { url: 'http://localhost:11434', model: 'm' },
      ollamaConfigured: false,
      deepseek: null,
      anthropic: null,
      order: { triage: [], resolver: ['ollama'] },
    });
    assert.equal(llm.isAvailable('triage'), false);
    assert.equal(llm.isAvailable('resolver'), true);
  });
});
