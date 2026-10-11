import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FallbackChain } from '../../server/llm/fallback-chain.ts';
import type { ChatClient, ProviderId } from '../../server/llm/types.ts';

const ok = (text: string): ChatClient & { calls: number } => ({ calls: 0, async chat() { this.calls++; return { role: 'assistant', content: text }; } });
const broken = (message = 'down'): ChatClient & { calls: number } => ({ calls: 0, async chat() { this.calls++; throw new Error(message); } });

describe('FallbackChain', () => {
  it('uses the first client while it works, and never touches the rest', async () => {
    const [a, b] = [ok('a'), ok('b')];
    const chain = new FallbackChain([{ id: 'ollama', client: a }, { id: 'deepseek', client: b }]);
    assert.equal((await chain.chat([], [])).content, 'a');
    assert.equal(b.calls, 0);
  });

  it('walks the whole list in order, reporting each failure', async () => {
    const [a, b, c] = [broken('a down'), broken('b down'), ok('c')];
    const failed: [ProviderId, string][] = [];
    const chain = new FallbackChain(
      [{ id: 'ollama', client: a }, { id: 'deepseek', client: b }, { id: 'anthropic', client: c }],
      (id, err) => failed.push([id, (err as Error).message]),
    );
    assert.equal((await chain.chat([], [])).content, 'c');
    assert.deepEqual(failed, [['ollama', 'a down'], ['deepseek', 'b down']]);
  });

  it('stops asking a client that failed, for the rest of the run', async () => {
    const [a, b] = [broken(), ok('b')];
    const chain = new FallbackChain([{ id: 'ollama', client: a }, { id: 'deepseek', client: b }]);
    await chain.chat([], []);
    await chain.chat([], []);
    assert.equal(a.calls, 1);
    assert.equal(b.calls, 2);
  });

  it('throws the last error when every client fails, and a plain one when there are none', async () => {
    await assert.rejects(new FallbackChain([{ id: 'ollama', client: broken('first') }, { id: 'deepseek', client: broken('last') }]).chat([], []), /last/);
    await assert.rejects(new FallbackChain([]).chat([], []), /No model is configured/);
  });

  it('passes the call options through to the client', async () => {
    let seen: unknown;
    const client: ChatClient = { chat: async (_m, _t, options) => ((seen = options), { role: 'assistant', content: 'x' }) };
    await new FallbackChain([{ id: 'ollama', client }]).chat([], [], { json: true });
    assert.deepEqual(seen, { json: true });
  });
});
