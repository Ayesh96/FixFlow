import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadAnthropic, loadDeepSeek, loadLlmSettings, loadOllama } from '../../server/llm/config.ts';

describe('model settings', () => {
  it('reads Ollama and trims its trailing slash, and is off when unset', () => {
    assert.equal(loadOllama({}), null);
    assert.deepEqual(loadOllama({ ORCH_OLLAMA_URL: 'http://127.0.0.1:11434/' }), { url: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b' });
  });

  it('enables DeepSeek only when an API key is set', () => {
    assert.equal(loadDeepSeek({}), null);
    assert.deepEqual(loadDeepSeek({ ORCH_DEEPSEEK_API_KEY: ' k ' }), { apiUrl: 'https://api.deepseek.com', apiKey: 'k', model: 'deepseek-flash' });
    assert.deepEqual(loadDeepSeek({ ORCH_DEEPSEEK_API_KEY: 'k', ORCH_DEEPSEEK_API_URL: 'http://x/', ORCH_DEEPSEEK_MODEL: 'm' }), { apiUrl: 'http://x', apiKey: 'k', model: 'm' });
  });

  it('enables Anthropic only when an API key is set', () => {
    assert.equal(loadAnthropic({}), null);
    assert.deepEqual(loadAnthropic({ ORCH_ANTHROPIC_API_KEY: ' k ' }), { apiUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-haiku-4-5' });
  });
});

describe('loadLlmSettings: which models each purpose tries', () => {
  it('with nothing set: the resolver has its local Ollama, and triage has no model', () => {
    const s = loadLlmSettings({});
    assert.deepEqual(s.order, { triage: [], resolver: ['ollama'] });
    assert.equal(s.ollamaConfigured, false);
    assert.deepEqual(s.ollama, { url: 'http://localhost:11434', model: 'qwen2.5-coder:7b' });
  });

  it('defaults to ollama, then deepseek, then anthropic, skipping what is not set up', () => {
    const all = { ORCH_OLLAMA_URL: 'http://o', ORCH_DEEPSEEK_API_KEY: 'd', ORCH_ANTHROPIC_API_KEY: 'a' };
    assert.deepEqual(loadLlmSettings(all).order, { triage: ['ollama', 'deepseek', 'anthropic'], resolver: ['ollama', 'deepseek', 'anthropic'] });
    assert.deepEqual(loadLlmSettings({ ORCH_ANTHROPIC_API_KEY: 'a', ORCH_DEEPSEEK_API_KEY: 'd' }).order, { triage: ['deepseek', 'anthropic'], resolver: ['ollama', 'deepseek', 'anthropic'] });
  });

  it('takes an order by name: per purpose, else for all, and drops repeats', () => {
    const keys = { ORCH_DEEPSEEK_API_KEY: 'd', ORCH_ANTHROPIC_API_KEY: 'a' };
    assert.deepEqual(loadLlmSettings({ ...keys, ORCH_LLM_PROVIDERS: 'anthropic, deepseek, anthropic' }).order, { triage: ['anthropic', 'deepseek'], resolver: ['anthropic', 'deepseek'] });
    assert.deepEqual(loadLlmSettings({ ...keys, ORCH_LLM_PROVIDERS: 'anthropic', ORCH_RESOLVER_PROVIDERS: 'deepseek,ollama' }).order, { triage: ['anthropic'], resolver: ['deepseek', 'ollama'] });
  });

  it('refuses a name it does not know, and a provider that is named but not set up', () => {
    assert.throws(() => loadLlmSettings({ ORCH_LLM_PROVIDERS: 'gpt' }), /unknown providers: gpt/);
    assert.throws(() => loadLlmSettings({ ORCH_RESOLVER_PROVIDERS: 'deepseek' }), /ORCH_DEEPSEEK_API_KEY/);
    assert.throws(() => loadLlmSettings({ ORCH_TRIAGE_PROVIDERS: 'ollama' }), /ORCH_OLLAMA_URL/);
  });
});
