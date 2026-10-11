import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AnthropicProvider } from '../../server/llm/providers/anthropic.ts';
import { DeepSeekProvider } from '../../server/llm/providers/deepseek.ts';
import { OllamaProvider } from '../../server/llm/providers/ollama.ts';
import { LlmError, type ChatClient, type ProviderId } from '../../server/llm/types.ts';

const TOOLS = [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];

/** Each provider's answer to the same two questions, in its own wire format. */
const WIRE: Record<ProviderId, { text: unknown; tool: unknown }> = {
  ollama: {
    text: { message: { role: 'assistant', content: 'hi' } },
    tool: { message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'read_file', arguments: { path: 'a.js' } } }] } },
  },
  deepseek: {
    text: { choices: [{ message: { role: 'assistant', content: 'hi' } }] },
    tool: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] } }] },
  },
  anthropic: {
    text: { content: [{ type: 'text', text: 'hi' }] },
    tool: { content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.js' } }] },
  },
};

/**
 * Whatever sits behind it, a provider has to look the same from outside: that is what lets a chain
 * put any of them in any other's place. Every provider runs through the same expectations.
 */
describe('provider contract', () => {
  let server: Server;
  let apiUrl: string;
  let answer: { status: number; body: unknown } = { status: 200, body: {} };

  before(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(answer.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer.body)));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const build = (id: ProviderId, url: string): ChatClient =>
    id === 'ollama'
      ? new OllamaProvider({ apiUrl: url, model: 'm' })
      : id === 'deepseek'
        ? new DeepSeekProvider({ apiUrl: url, apiKey: 'k', model: 'm', retryDelayMs: 0 })
        : new AnthropicProvider({ apiUrl: url, apiKey: 'k', model: 'm' });

  for (const id of ['ollama', 'deepseek', 'anthropic'] as const) {
    describe(id, () => {
      it('answers a plain reply with an assistant message and no tool calls', async () => {
        answer = { status: 200, body: WIRE[id].text };
        const out = await build(id, apiUrl).chat([{ role: 'user', content: 'u' }], TOOLS);
        assert.equal(out.role, 'assistant');
        assert.equal(out.content, 'hi');
        assert.equal(out.tool_calls, undefined);
      });

      it('answers a tool call with the same id, name and JSON-string arguments', async () => {
        answer = { status: 200, body: WIRE[id].tool };
        const out = await build(id, apiUrl).chat([{ role: 'user', content: 'u' }], TOOLS);
        assert.ok(!out.content); // no text beside the call: '' or null, which every caller reads alike
        assert.deepEqual(out.tool_calls, [{ id: 't1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }]);
      });

      it('fails with an LlmError that names it, for a server error and for no server at all', async () => {
        answer = { status: 500, body: { error: 'boom' } };
        await assert.rejects(build(id, apiUrl).chat([{ role: 'user', content: 'u' }], TOOLS), (e: unknown) => e instanceof LlmError && e.provider === id && e.status === 500);
        await assert.rejects(build(id, 'http://127.0.0.1:1').chat([{ role: 'user', content: 'u' }], TOOLS), (e: unknown) => e instanceof LlmError && e.provider === id && e.status === 0);
      });
    });
  }
});
