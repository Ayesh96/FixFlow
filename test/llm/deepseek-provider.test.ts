import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { DeepSeekError, DeepSeekProvider } from '../../server/llm/providers/deepseek.ts';
import { LlmError, type ChatMessage } from '../../server/llm/types.ts';

const TOOLS = [{ type: 'function', function: { name: 'read_file', description: 'Read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];

describe('DeepSeekProvider', () => {
  let server: Server;
  let apiUrl: string;
  let requests: { url: string; headers: Record<string, unknown>; body: any }[] = [];
  let replies: { status: number; body: unknown }[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        requests.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw) });
        const reply = replies.length > 1 ? (replies.shift() as { status: number; body: unknown }) : (replies[0] as { status: number; body: unknown });
        res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  beforeEach(() => {
    requests = [];
    replies = [];
  });

  const provider = () => new DeepSeekProvider({ apiUrl, apiKey: 'sk-ds', model: 'deepseek-flash', retryDelayMs: 0 });
  const answer = (message: unknown) => ({ status: 200, body: { choices: [{ message }] } });

  it('posts to chat/completions with a bearer key, and sends the tools as they are', async () => {
    replies = [answer({ role: 'assistant', content: 'hello' })];
    await provider().chat([{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], TOOLS);
    const req = requests[0];
    assert.equal(req?.url, '/chat/completions');
    assert.equal(req?.headers.authorization, 'Bearer sk-ds');
    assert.equal(req?.body.model, 'deepseek-flash');
    // Thinking is on by default at DeepSeek and then needs reasoning_content echoed back, so it is always asked off.
    assert.deepEqual(req?.body.thinking, { type: 'disabled' });
    assert.equal(req?.body.stream, false);
    assert.deepEqual(req?.body.tools, TOOLS);
    assert.deepEqual(req?.body.messages, [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
    assert.equal('response_format' in req?.body, false);
  });

  it('reads native tool calls into Errorflow tool calls, keeping the ids', async () => {
    replies = [answer({ role: 'assistant', content: 'looking', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] })];
    const out = await provider().chat([{ role: 'user', content: 'u' }], TOOLS);
    assert.deepEqual(out, { role: 'assistant', content: 'looking', tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.js"}' } }] });
  });

  it('sends a history with tool calls and results in the form the API requires', async () => {
    replies = [answer({ role: 'assistant', content: 'FIX: done' })];
    const history: ChatMessage[] = [
      { role: 'user', content: 'fix it' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', function: { name: 'read_file', arguments: '{"path":"x.js"}' } }, { id: 'b', function: { name: 'read_file', arguments: 'not json' } }] },
      { role: 'tool', tool_call_id: 'a', content: 'file text' },
      { role: 'tool', tool_call_id: 'b', content: null },
    ];
    await provider().chat(history, TOOLS);
    assert.deepEqual(requests[0]?.body.messages, [
      { role: 'user', content: 'fix it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'read_file', arguments: '{"path":"x.js"}' } },
          { id: 'b', type: 'function', function: { name: 'read_file', arguments: '{}' } }, // malformed arguments are not echoed back
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: 'file text' },
      { role: 'tool', tool_call_id: 'b', content: '' },
    ]);
  });

  it('asks for JSON mode and a temperature when the caller does', async () => {
    replies = [answer({ role: 'assistant', content: '{"small_fix":false}' })];
    const out = await provider().chat([{ role: 'user', content: 'u' }], [], { json: true, temperature: 0 });
    assert.deepEqual(requests[0]?.body.response_format, { type: 'json_object' });
    assert.equal(requests[0]?.body.temperature, 0);
    assert.equal('tools' in requests[0]?.body, false); // no tools offered, none sent
    assert.equal(out.content, '{"small_fix":false}');
  });

  it('accepts object arguments, ignores reasoning_content, and names a call that has no id', async () => {
    replies = [answer({ role: 'assistant', content: '', reasoning_content: 'thinking...', tool_calls: [{ type: 'function', function: { name: 'read_file', arguments: { path: 'b.js' } } }] })];
    const out = await provider().chat([{ role: 'user', content: 'u' }], TOOLS);
    assert.equal(out.content, null);
    assert.deepEqual(out.tool_calls, [{ id: 'deepseek-call-0', function: { name: 'read_file', arguments: '{"path":"b.js"}' } }]);
    assert.equal('reasoning_content' in out, false);
  });

  it('drops a tool call that names no tool instead of running something nameless', async () => {
    replies = [answer({ role: 'assistant', content: 'FIX: x', tool_calls: [{ id: 'c', type: 'function', function: { arguments: '{}' } }] })];
    const out = await provider().chat([{ role: 'user', content: 'u' }], TOOLS);
    assert.equal(out.tool_calls, undefined);
    assert.equal(out.content, 'FIX: x');
  });

  it('recovers a call written into the text, but only for a tool that was offered', async () => {
    replies = [answer({ role: 'assistant', content: 'Let me look.\n<tool_call>{"name":"read_file","arguments":{"path":"c.js"}}</tool_call>' })];
    const out = await provider().chat([{ role: 'user', content: 'u' }], TOOLS);
    assert.deepEqual(out.tool_calls, [{ id: 'deepseek-tag-0', function: { name: 'read_file', arguments: '{"path":"c.js"}' } }]);
    assert.equal(out.content, 'Let me look.');

    replies = [answer({ role: 'assistant', content: '<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>' })];
    assert.equal((await provider().chat([{ role: 'user', content: 'u' }], TOOLS)).tool_calls, undefined);
  });

  it('retries a rate limit once, then gives up with the status', async () => {
    replies = [{ status: 429, body: { error: 'slow down' } }, answer({ role: 'assistant', content: 'ok' })];
    assert.equal((await provider().chat([{ role: 'user', content: 'u' }], [])).content, 'ok');
    assert.equal(requests.length, 2);

    requests = [];
    replies = [{ status: 503, body: 'down' }];
    await assert.rejects(provider().chat([{ role: 'user', content: 'u' }], []), (e: unknown) => e instanceof DeepSeekError && e.status === 503);
    assert.equal(requests.length, 2);
  });

  it('does not retry a bad key or an empty balance', async () => {
    for (const status of [401, 402]) {
      requests = [];
      replies = [{ status, body: { error: { message: 'no' } } }];
      await assert.rejects(provider().chat([{ role: 'user', content: 'u' }], []), (e: unknown) => e instanceof LlmError && e.provider === 'deepseek' && e.status === status);
      assert.equal(requests.length, 1);
    }
  });

  it('throws DeepSeekError for an unreachable server, a non-JSON body and a missing choice', async () => {
    const dead = new DeepSeekProvider({ apiUrl: 'http://127.0.0.1:1', apiKey: 'k', model: 'm', retryDelayMs: 0 });
    await assert.rejects(dead.chat([{ role: 'user', content: 'u' }], []), (e: unknown) => e instanceof DeepSeekError && e.status === 0);
    replies = [{ status: 200, body: 'not json' }];
    await assert.rejects(provider().chat([{ role: 'user', content: 'u' }], []), (e: unknown) => e instanceof DeepSeekError && e.status === 502);
    replies = [{ status: 200, body: { choices: [] } }];
    await assert.rejects(provider().chat([{ role: 'user', content: 'u' }], []), /missing choices/);
  });
});
