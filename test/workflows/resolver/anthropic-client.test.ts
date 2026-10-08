import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AnthropicClient, AnthropicError, FallbackClient, toAnthropicMessages } from '../../../server/workflows/resolver/anthropic-client.ts';
import type { ChatClient, OllamaMessage } from '../../../server/workflows/resolver/ollama-client.ts';

const TOOLS = [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];

describe('toAnthropicMessages', () => {
  it('lifts system out, turns tool calls into tool_use, and folds consecutive tool results into one user turn', () => {
    const history: OllamaMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'fix it' },
      { role: 'assistant', content: 'looking', tool_calls: [{ id: 'a', function: { name: 'read_file', arguments: '{"path":"x.js"}' } }, { id: 'b', function: { name: 'grep', arguments: 'not json' } }] },
      { role: 'tool', tool_call_id: 'a', content: 'file text' },
      { role: 'tool', tool_call_id: 'b', content: 'matches' },
    ];
    const { system, messages } = toAnthropicMessages(history);
    assert.equal(system, 'sys');
    assert.deepEqual(messages, [
      { role: 'user', content: 'fix it' },
      { role: 'assistant', content: [{ type: 'text', text: 'looking' }, { type: 'tool_use', id: 'a', name: 'read_file', input: { path: 'x.js' } }, { type: 'tool_use', id: 'b', name: 'grep', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'file text' }, { type: 'tool_result', tool_use_id: 'b', content: 'matches' }] },
    ]);
  });
});

describe('AnthropicClient', () => {
  let server: Server;
  let apiUrl: string;
  let seen: { headers: Record<string, unknown>; body: any } | null = null;
  let reply: { status: number; body: unknown } = { status: 200, body: {} };

  before(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen = { headers: req.headers, body: JSON.parse(raw) };
        res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  const client = () => new AnthropicClient({ apiUrl, apiKey: 'sk-test', model: 'haiku-x' });

  it('sends key, version, tools in Anthropic shape, and maps tool_use back to a tool call', async () => {
    reply = { status: 200, body: { content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.js' } }] } };
    const out = await client().chat([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], TOOLS);
    assert.equal(seen?.headers['x-api-key'], 'sk-test');
    assert.equal(seen?.headers['anthropic-version'], '2023-06-01');
    assert.equal(seen?.body.model, 'haiku-x');
    assert.equal(seen?.body.system, 's');
    assert.deepEqual(seen?.body.tools, [{ name: 'read_file', description: 'Read', input_schema: TOOLS[0]?.function.parameters }]);
    assert.deepEqual(out, { role: 'assistant', content: 'on it', tool_calls: [{ id: 'toolu_1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] });
  });

  it('returns plain text when there is no tool call', async () => {
    reply = { status: 200, body: { content: [{ type: 'text', text: 'FIX: done' }] } };
    assert.deepEqual(await client().chat([{ role: 'user', content: 'u' }], TOOLS), { role: 'assistant', content: 'FIX: done', tool_calls: undefined });
  });

  it('throws AnthropicError on API errors and unreachable servers', async () => {
    reply = { status: 401, body: { error: 'bad key' } };
    await assert.rejects(client().chat([{ role: 'user', content: 'u' }], TOOLS), (e: unknown) => e instanceof AnthropicError && e.status === 401);
    const dead = new AnthropicClient({ apiUrl: 'http://127.0.0.1:1', apiKey: 'k', model: 'm' });
    await assert.rejects(dead.chat([{ role: 'user', content: 'u' }], TOOLS), (e: unknown) => e instanceof AnthropicError && e.status === 0);
  });
});

describe('FallbackClient', () => {
  const ok = (text: string): ChatClient & { calls: number } => ({ calls: 0, async chat() { this.calls++; return { role: 'assistant', content: text }; } });
  const broken = (): ChatClient & { calls: number } => ({ calls: 0, async chat() { this.calls++; throw new Error('down'); } });

  it('uses the primary while it works', async () => {
    const primary = ok('haiku');
    const fallback = ok('qwen');
    assert.equal((await new FallbackClient(primary, fallback).chat([], [])).content, 'haiku');
    assert.equal(fallback.calls, 0);
  });

  it('switches to the fallback once, reports it, and does not retry the primary', async () => {
    const primary = broken();
    const fallback = ok('qwen');
    const reported: unknown[] = [];
    const client = new FallbackClient(primary, fallback, (e) => reported.push(e));
    assert.equal((await client.chat([], [])).content, 'qwen');
    assert.equal((await client.chat([], [])).content, 'qwen');
    assert.equal(primary.calls, 1);
    assert.equal(reported.length, 1);
  });

  it('surfaces the fallback error when both fail', async () => {
    await assert.rejects(new FallbackClient(broken(), broken()).chat([], []), /down/);
  });
});
