import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { OllamaClient, OllamaError } from '../../../server/workflows/resolver/ollama-client.ts';
import type { OllamaMessage } from '../../../server/workflows/resolver/ollama-client.ts';

describe('OllamaClient', () => {
  let server: Server;
  let apiUrl: string;
  const requests: {
    method: string;
    url: string;
    headers: IncomingMessage['headers'];
    body: unknown;
  }[] = [];
  let respond: (req: {
    method: string;
    url: string;
  }) => { status: number; body: unknown };

  before(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        const { status, body: responseBody } = respond({
          method: req.method ?? '',
          url: req.url ?? '',
        });
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(responseBody));
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(() => {
    server.close();
  });

  const client = () =>
    new OllamaClient({
      apiUrl,
      model: 'qwen3',
    });

  it('request shape: POST to /api/chat with content-type, correct body, and NO authorization header', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        message: { role: 'assistant', content: 'OK' },
      },
    });

    const messages: OllamaMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is 2+2?' },
    ];
    const tools = [
      { type: 'function', function: { name: 'add', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'multiply', parameters: { type: 'object' } } },
    ];

    await client().chat(messages, tools);

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert(req !== undefined);
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/api/chat');
    assert.match(req.headers['content-type'] ?? '', /application\/json/);
    assert.equal(req.headers.authorization, undefined);
    assert.deepEqual(req.body, {
      model: 'qwen3',
      messages,
      tools,
      stream: false,
    });
  });

  it('outgoing tool_calls argument conversion: OllamaMessage JSON string arguments become parsed objects in request', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        message: { role: 'assistant', content: 'OK' },
      },
    });

    const messages: OllamaMessage[] = [
      { role: 'user', content: 'Read the file' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            function: { name: 'read_file', arguments: '{"path":"src/index.ts"}' },
          },
        ],
      },
    ];

    await client().chat(messages, []);

    assert.equal(requests.length, 1);
    const req = requests[0];
    assert(req !== undefined);
    const requestMessages = (req.body as Record<string, unknown>).messages as unknown[];
    assert(requestMessages !== undefined);
    const assistantMsg = requestMessages[1] as Record<string, unknown>;
    assert(assistantMsg !== undefined);
    const toolCalls = assistantMsg.tool_calls as unknown[];
    assert(toolCalls !== undefined);
    assert.equal(toolCalls.length, 1);
    const toolCall = toolCalls[0] as Record<string, unknown>;
    assert(toolCall !== undefined);
    const fn = toolCall.function as Record<string, unknown>;
    assert(fn !== undefined);
    assert.deepEqual(fn.arguments, { path: 'src/index.ts' });
  });

  it('qwen2.5-coder: a `tool_name {json}` text reply becomes a real tool call', async () => {
    respond = () => ({
      status: 200,
      body: {
        message: { role: 'assistant', content: 'read_file {"path": "apps/gateway/src/proxy/aiService.js"}' },
      },
    });

    const coder = new OllamaClient({ apiUrl, model: 'qwen2.5-coder:7b' });
    const result = await coder.chat([{ role: 'user', content: 'Fix the bug' }], []);

    assert.equal(result.tool_calls?.length, 1);
    assert.equal(result.tool_calls?.[0]?.function.name, 'read_file');
    assert.equal(result.content, null);
  });

  it('other models: the same text stays plain text (the named parser is qwen-only)', async () => {
    respond = () => ({
      status: 200,
      body: {
        message: { role: 'assistant', content: 'read_file {"path": "apps/gateway/src/proxy/aiService.js"}' },
      },
    });

    const result = await client().chat([{ role: 'user', content: 'Fix the bug' }], []);

    assert.equal(result.tool_calls, undefined);
    assert.equal(result.content, 'read_file {"path": "apps/gateway/src/proxy/aiService.js"}');
  });

  it('successful parse, plain text reply (no tool_calls)', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        message: { role: 'assistant', content: 'FIX: did the thing' },
      },
    });

    const result = await client().chat([{ role: 'user', content: 'Fix the bug' }], []);

    assert.equal(result.role, 'assistant');
    assert.equal(result.content, 'FIX: did the thing');
    assert.equal(result.tool_calls, undefined);
  });

  it('successful parse, tool_calls present with explicit id', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_abc',
              function: { name: 'read_file', arguments: { path: 'src/index.ts' } },
            },
          ],
        },
      },
    });

    const result = await client().chat([{ role: 'user', content: 'Read src/index.ts' }], []);

    assert.equal(result.role, 'assistant');
    assert.equal(result.content, '');
    assert(result.tool_calls !== undefined);
    assert.equal(result.tool_calls.length, 1);
    const toolCall = result.tool_calls[0];
    assert(toolCall !== undefined);
    assert.equal(toolCall.id, 'call_abc');
    assert.equal(toolCall.function.name, 'read_file');
    assert.equal(toolCall.function.arguments, '{"path":"src/index.ts"}');
    assert.deepEqual(JSON.parse(toolCall.function.arguments), { path: 'src/index.ts' });
  });

  it('tool_call missing an id synthesizes an id like ollama-call-<index>', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              function: { name: 'grep', arguments: { pattern: 'foo' } },
            },
          ],
        },
      },
    });

    const result = await client().chat([{ role: 'user', content: 'Search for foo' }], []);

    assert(result.tool_calls !== undefined);
    assert.equal(result.tool_calls.length, 1);
    const toolCall = result.tool_calls[0];
    assert(toolCall !== undefined);
    assert.match(toolCall.id, /^ollama-call-\d+$/);
  });

  it('multiple tool_calls in one reply are all normalized with distinct ids', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              function: { name: 'read_file', arguments: { path: 'src/index.ts' } },
            },
            {
              function: { name: 'grep', arguments: { pattern: 'bar' } },
            },
          ],
        },
      },
    });

    const result = await client().chat([{ role: 'user', content: 'Do stuff' }], []);

    assert(result.tool_calls !== undefined);
    assert.equal(result.tool_calls.length, 2);
    assert.equal(result.tool_calls[0]?.id, 'call_1');
    assert.match(result.tool_calls[1]?.id ?? '', /^ollama-call-1$/);
    assert.notEqual(result.tool_calls[0]?.id, result.tool_calls[1]?.id);
  });

  it('non-2xx response (500) throws OllamaError with correct status', async () => {
    requests.length = 0;
    respond = () => ({
      status: 500,
      body: { error: 'Internal server error' },
    });

    await assert.rejects(
      async () => {
        await client().chat([{ role: 'user', content: 'test' }], []);
      },
      (err: unknown) => {
        assert(err instanceof OllamaError);
        assert.equal(err.status, 500);
        assert.match(err.message, /Ollama API error/);
        return true;
      },
    );
  });

  it('network failure (unreachable server) throws OllamaError with status 0', async () => {
    const unreachableClient = new OllamaClient({
      apiUrl: 'http://127.0.0.1:1',
      model: 'qwen3',
    });

    await assert.rejects(
      async () => {
        await unreachableClient.chat([{ role: 'user', content: 'test' }], []);
      },
      (err: unknown) => {
        assert(err instanceof OllamaError);
        assert.equal(err.status, 0);
        assert.match(err.message, /Ollama request failed/);
        return true;
      },
    );
  });

  it('malformed JSON response body throws OllamaError with status 502', async () => {
    requests.length = 0;
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('not json at all');
    });

    await assert.rejects(
      async () => {
        await client().chat([{ role: 'user', content: 'test' }], []);
      },
      (err: unknown) => {
        assert(err instanceof OllamaError);
        assert.equal(err.status, 502);
        assert.match(err.message, /non-JSON response/);
        return true;
      },
    );

    // Restore the normal request handler
    server.removeAllListeners('request');
    server.on('request', (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        chunks.push(c);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString();
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body,
        });
        const { status, body: responseBody } = respond({
          method: req.method ?? '',
          url: req.url ?? '',
        });
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(responseBody));
      });
    });
  });

  it('response missing message field throws OllamaError with status 502', async () => {
    requests.length = 0;
    respond = () => ({
      status: 200,
      body: {},
    });

    await assert.rejects(
      async () => {
        await client().chat([{ role: 'user', content: 'test' }], []);
      },
      (err: unknown) => {
        assert(err instanceof OllamaError);
        assert.equal(err.status, 502);
        assert.match(err.message, /missing message/);
        return true;
      },
    );
  });

  describe('recovering <tool_call> tags from content', () => {
    // This is this model family's actual chat template (see `ollama show qwen2.5-coder:7b
    // --template`): it's told to wrap calls in <tool_call></tool_call>, written as its own
    // text, with Ollama responsible for lifting that into the structured tool_calls field —
    // which it doesn't always manage once the model adds narration around the tags.

    it('recovers a single tagged call when tool_calls comes back empty', async () => {
      respond = () => ({
        status: 200,
        body: {
          message: {
            role: 'assistant',
            content: '<tool_call>\n{"name": "read_file", "arguments": {"path": "src/index.js"}}\n</tool_call>',
          },
        },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls?.length, 1);
      assert.equal(result.tool_calls?.[0]?.function.name, 'read_file');
      assert.deepEqual(JSON.parse(result.tool_calls?.[0]?.function.arguments ?? '{}'), { path: 'src/index.js' });
      assert.equal(result.content, null);
    });

    it('recovers multiple tagged calls and keeps surrounding narration as remaining content', async () => {
      respond = () => ({
        status: 200,
        body: {
          message: {
            role: 'assistant',
            content:
              "Let me look at the files first.\n\n<tool_call>\n{\"name\": \"list_directory\", \"arguments\": {\"path\": \"src\"}}\n</tool_call>\n\n<tool_call>\n{\"name\": \"grep\", \"arguments\": {\"pattern\": \"map\"}}\n</tool_call>",
          },
        },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls?.length, 2);
      assert.deepEqual(result.tool_calls?.map((c) => c.function.name), ['list_directory', 'grep']);
      assert.equal(result.content, 'Let me look at the files first.');
    });

    it('does not touch content when Ollama already populated structured tool_calls', async () => {
      respond = () => ({
        status: 200,
        body: {
          message: {
            role: 'assistant',
            content: '<tool_call>\n{"name": "ignored", "arguments": {}}\n</tool_call>',
            tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: { path: 'a.ts' } } }],
          },
        },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      // Structured tool_calls already present — the fallback must not override it with the (unrelated) tagged one.
      assert.equal(result.tool_calls?.length, 1);
      assert.equal(result.tool_calls?.[0]?.function.name, 'read_file');
    });

    it('falls through to plain content when no valid tag is present (normal FIX:/SKIP: case)', async () => {
      respond = () => ({
        status: 200,
        body: { message: { role: 'assistant', content: 'SKIP: cannot localize it' } },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls, undefined);
      assert.equal(result.content, 'SKIP: cannot localize it');
    });

    it('drops a malformed tag silently rather than crashing, leaving content untouched', async () => {
      respond = () => ({
        status: 200,
        body: { message: { role: 'assistant', content: '<tool_call>\nnot valid json\n</tool_call>' } },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      // Nothing valid was recovered, so this is left exactly as Ollama sent it — rather than
      // guessing, it flows through to parseVerdict, which will correctly report no verdict.
      assert.equal(result.tool_calls, undefined);
      assert.equal(result.content, '<tool_call>\nnot valid json\n</tool_call>');
    });
  });

  describe('recovering bare JSON tool calls (no tags, no structured field)', () => {
    // The model's most common failure mode in practice: it skips both the structured
    // tool_calls field and the <tool_call> wrapper, and just writes
    // `{"name": ..., "arguments": {...}}` as plain text.

    it('recovers a single bare call', async () => {
      respond = () => ({
        status: 200,
        body: { message: { role: 'assistant', content: '{"name": "list_directory", "arguments": {}}' } },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls?.length, 1);
      assert.equal(result.tool_calls?.[0]?.function.name, 'list_directory');
      assert.equal(result.content, null);
    });

    it('keeps surrounding narration as remaining content', async () => {
      respond = () => ({
        status: 200,
        body: {
          message: {
            role: 'assistant',
            content: 'Let me check the files.\n\n{"name": "grep", "arguments": {"pattern": "map"}}\n\nI will look for the pattern.',
          },
        },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls?.length, 1);
      assert.equal(result.tool_calls?.[0]?.function.name, 'grep');
      assert.equal(result.content, 'Let me check the files.\n\n\n\nI will look for the pattern.');
    });

    it('does not get confused by braces inside edit_file old_string/new_string (code being edited)', async () => {
      const call = { name: 'edit_file', arguments: { path: 'a.js', old_string: 'if (x) { return {a: 1}; }', new_string: 'if (x) { return {a: 2}; }' } };
      respond = () => ({
        status: 200,
        body: { message: { role: 'assistant', content: JSON.stringify(call) } },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls?.length, 1);
      assert.deepEqual(JSON.parse(result.tool_calls?.[0]?.function.arguments ?? '{}'), call.arguments);
    });

    it('finds multiple sequential bare calls', async () => {
      respond = () => ({
        status: 200,
        body: {
          message: {
            role: 'assistant',
            content: '{"name": "list_directory", "arguments": {}}\n{"name": "grep", "arguments": {"pattern": "map"}}',
          },
        },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.deepEqual(result.tool_calls?.map((c) => c.function.name), ['list_directory', 'grep']);
    });

    it('ignores a JSON object that is not shaped like a tool call', async () => {
      respond = () => ({
        status: 200,
        body: { message: { role: 'assistant', content: 'The config looks like {"port": 3000, "host": "localhost"}.\n\nSKIP: unrelated to the issue' } },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls, undefined);
      assert.match(result.content ?? '', /SKIP: unrelated to the issue/);
    });

    it('prefers tagged calls over bare JSON when both styles are somehow present', async () => {
      respond = () => ({
        status: 200,
        body: {
          message: {
            role: 'assistant',
            content: '<tool_call>\n{"name": "read_file", "arguments": {"path": "a.ts"}}\n</tool_call>\n\n{"port": 3000}',
          },
        },
      });
      const result = await client().chat([{ role: 'user', content: 'test' }], []);
      assert.equal(result.tool_calls?.length, 1);
      assert.equal(result.tool_calls?.[0]?.function.name, 'read_file');
    });
  });
});
