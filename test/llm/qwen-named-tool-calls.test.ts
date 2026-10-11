import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractNamedToolCalls, isQwenCoderModel } from '../../server/llm/providers/qwen-named-tool-calls.ts';

const KNOWN = new Set(['read_file', 'list_directory', 'grep', 'edit_file']);

describe('isQwenCoderModel', () => {
  it('matches the qwen2.5-coder family, any tag', () => {
    assert.equal(isQwenCoderModel('qwen2.5-coder:7b'), true);
    assert.equal(isQwenCoderModel('qwen2.5-coder'), true);
  });

  it('does not match other models', () => {
    assert.equal(isQwenCoderModel('qwen3:8b'), false);
    assert.equal(isQwenCoderModel('qwen2.5:7b'), false);
    assert.equal(isQwenCoderModel('llama3'), false);
  });
});

describe('extractNamedToolCalls', () => {
  it('turns `tool_name {json}` text into a call with those arguments', () => {
    const result = extractNamedToolCalls('read_file {"path": "apps/gateway/src/proxy/aiService.js"}', KNOWN);
    assert.deepEqual(result.calls, [
      { name: 'read_file', arguments: '{"path":"apps/gateway/src/proxy/aiService.js"}' },
    ]);
    assert.equal(result.remainder, '');
  });

  it('keeps braces inside string arguments intact', () => {
    const result = extractNamedToolCalls('edit_file {"path": "a.js", "old_string": "x {", "new_string": "y }"}', KNOWN);
    assert.equal(result.calls.length, 1);
    assert.deepEqual(JSON.parse(result.calls[0]?.arguments ?? ''), { path: 'a.js', old_string: 'x {', new_string: 'y }' });
  });

  it('ignores names that are not tools', () => {
    const result = extractNamedToolCalls('delete_everything {"path": "/"}', KNOWN);
    assert.deepEqual(result.calls, []);
    assert.equal(result.remainder, 'delete_everything {"path": "/"}');
  });

  it('ignores a known name followed by something that is not a JSON object', () => {
    const result = extractNamedToolCalls('grep {not json}', KNOWN);
    assert.deepEqual(result.calls, []);
  });

  it('keeps the surrounding prose and returns every call in order', () => {
    const text = 'Let me look.\nread_file {"path": "a.js"}\nThen: grep {"pattern": "limit"}';
    const result = extractNamedToolCalls(text, KNOWN);
    assert.deepEqual(result.calls.map((call) => call.name), ['read_file', 'grep']);
    assert.equal(result.remainder, 'Let me look.\n\nThen:');
  });

  it('leaves plain prose untouched', () => {
    const result = extractNamedToolCalls('FIX: changed the parser', KNOWN);
    assert.deepEqual(result.calls, []);
    assert.equal(result.remainder, 'FIX: changed the parser');
  });
});
