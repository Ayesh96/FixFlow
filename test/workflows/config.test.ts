import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { githubCloneUrl, loadAnthropic, loadOllama } from '../../server/workflows/config.ts';

describe('shared workflow settings', () => {
  it('reads Ollama and trims its trailing slash, and is off when unset', () => {
    assert.equal(loadOllama({}), null);
    assert.deepEqual(loadOllama({ ORCH_OLLAMA_URL: 'http://127.0.0.1:11434/' }), { url: 'http://127.0.0.1:11434', model: 'qwen2.5-coder:7b' });
  });

  it('enables the hosted model only when an API key is set', () => {
    assert.equal(loadAnthropic({}), null);
    assert.deepEqual(loadAnthropic({ ORCH_ANTHROPIC_API_KEY: ' k ' }), { apiUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'claude-haiku-4-5' });
  });

  it('clones from github.com unless told otherwise, and takes a different address for GitHub Enterprise', () => {
    assert.equal(githubCloneUrl({}), 'https://github.com/{repo}.git');
    assert.equal(githubCloneUrl({ ORCH_GITHUB_CLONE_URL: ' https://git.example.com/{repo}.git ' }), 'https://git.example.com/{repo}.git');
  });

  it('refuses a clone address with nowhere to put the repository, rather than cloning the wrong thing', () => {
    assert.throws(() => githubCloneUrl({ ORCH_GITHUB_CLONE_URL: 'https://git.example.com/some/repo.git' }), /\{repo\}/);
  });
});
