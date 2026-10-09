import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { ollamaTriager, rulesTriage } from '../../../server/workflows/errors/triage.ts';
import { jsEvent, normalized, pyEvent } from './fixtures.ts';

describe('ollamaTriager', () => {
  let reply: () => { status: number; body: string } = () => ({ status: 200, body: '' });
  let seen = '';
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen = data;
      const { status, body } = reply();
      res.writeHead(status).end(body);
    });
  });
  const ready = new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  after(() => server.close());
  const content = (c: string) => ({ status: 200, body: JSON.stringify({ message: { content: c } }) });

  it("uses the model's verdict and wording, and sends the error with its frames", async () => {
    const triage = ollamaTriager({ url: await ready, model: 'm' });
    reply = () => content('{"small_fix": false, "message": "Needs a redesign.", "suggestion": "Look first.", "tags": ["needs-human", "bogus", "bot-safe"]}');
    const no = await triage(normalized(jsEvent())); // the rules alone would say bot-safe
    assert.deepEqual([no.tags, no.message, no.suggestion, no.source], [['needs-human'], 'Needs a redesign.', 'Look first.', 'model']);
    assert.match(seen, /getUserId/);
    assert.match(seen, /Level: error/);
    reply = () => content('{"small_fix": true, "message": "m", "suggestion": "s", "tags": []}');
    assert.deepEqual((await triage(normalized(pyEvent()))).tags, ['bot-safe']); // the rules alone would say no
  });

  it("never lets the rules' wording contradict the model when it leaves its own out", async () => {
    const triage = ollamaTriager({ url: await ready, model: 'm' });
    reply = () => content('{"small_fix": false}');
    const result = await triage(normalized(jsEvent())); // the rules would say "looks like a small fix"
    assert.deepEqual(result.tags, ['needs-human']);
    assert.doesNotMatch(`${result.message} ${result.suggestion}`, /small fix/i);
  });

  it('falls back to the rules on server errors, bad JSON, a missing verdict, or an unreachable Ollama', async () => {
    const url = await ready;
    reply = () => ({ status: 500, body: 'no' });
    assert.deepEqual(await ollamaTriager({ url, model: 'm' })(normalized(jsEvent())), rulesTriage(normalized(jsEvent())));
    reply = () => content('not json');
    assert.equal((await ollamaTriager({ url, model: 'm' })(normalized(pyEvent()))).source, 'rules');
    reply = () => content('{"message": "no verdict"}');
    assert.equal((await ollamaTriager({ url, model: 'm' })(normalized(pyEvent()))).source, 'rules');
    assert.equal((await ollamaTriager({ url: 'http://127.0.0.1:1', model: 'm' })(normalized(jsEvent()))).tags[0], 'bot-safe');
  });
});

describe('rulesTriage: more of what real apps send', () => {
  const frame = (fn: string, inApp = true) => ({ filename: 'main.py', function: fn, lineno: 5, in_app: inApp });
  const crash = (type: string, value: string, frames = [frame('handler')]) => normalized({ event_id: 'c'.repeat(32), platform: 'python', level: 'error', exception: { values: [{ type, value, stacktrace: { frames } }] } });
  const logged = (text: string, level = 'error', frames = [frame('display_sleep')]) =>
    normalized({ event_id: 'd'.repeat(32), platform: 'python', level, message: text, threads: { values: [{ current: true, stacktrace: { frames } }] } });

  it("recognises Python's small mistakes as bot-safe, not only JavaScript's", () => {
    assert.deepEqual(rulesTriage(crash('NameError', "name 'VOLUME_STP' is not defined")).tags, ['bot-safe']);
    assert.deepEqual(rulesTriage(crash('AttributeError', "'NoneType' object has no attribute 'rstrip'")).tags, ['bot-safe']);
    assert.deepEqual(rulesTriage(crash('TypeError', "'NoneType' object is not subscriptable")).tags, ['bot-safe']);
    assert.deepEqual(rulesTriage(crash('AttributeError', "'str' object has no attribute 'foo'")).tags, ['needs-human'], 'only the None cases are a plain missing check');
    assert.deepEqual(rulesTriage(crash('NameError', "name 'x' is not defined", [frame('lib', false)])).tags.includes('bot-safe'), false, 'not in the app, nothing to fix here');
  });

  it('blames a permission or setting, not the code, and says what to do', () => {
    const r = rulesTriage(crash('HTTPException', 'osascript is not allowed assistive access. (-1719)'));
    assert.deepEqual(r.tags, ['infrastructure', 'needs-human']);
    assert.match(r.message, /permissions or configuration/);
    assert.match(r.suggestion, /Fix the permission or setting/);
  });

  it('treats a logged message that carries a stack as real, pointing at the code that logged it', () => {
    const r = rulesTriage(logged('display sleep failed: pmset returned a non-zero exit code'));
    assert.deepEqual(r.tags, ['needs-human']);
    assert.match(r.message, /logged from display_sleep \(main\.py:5\)/);
    assert.deepEqual(rulesTriage(logged('upstream timed out after 30s')).tags, ['infrastructure', 'needs-human']);
    assert.deepEqual(rulesTriage(logged('osascript is not allowed assistive access')).tags, ['infrastructure', 'needs-human']);
  });

  it('still reads a test message as a test when it came with a stack', () => {
    const r = rulesTriage(logged('errorflow test from MacRemote', 'info'));
    assert.deepEqual(r.tags, ['test-event'], 'there is a stack, so no no-stack-trace tag');
    assert.match(r.suggestion, /^Don't report it/);
  });
});

describe('ollamaTriager: what the model does not get to overrule', () => {
  let reply = '';
  let seen = '';
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      seen = data;
      res.writeHead(200).end(JSON.stringify({ message: { content: reply } }));
    });
  });
  const ready = new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`)));
  after(() => server.close());
  const ask = async (event: ReturnType<typeof normalized>, answer: Record<string, unknown>) => {
    reply = JSON.stringify(answer);
    return ollamaTriager({ url: await ready, model: 'm' })(event);
  };
  const crash = (type: string, value: string, inApp = true) => normalized({ event_id: 'c'.repeat(32), platform: 'python', level: 'error', exception: { values: [{ type, value, stacktrace: { frames: [{ filename: 'main.py', function: 'f', lineno: 3, in_app: inApp, vars: { direction: "'up'" } }] } }] }, request: { method: 'POST', url: 'http://h/volume/up' } });
  const note = (event: ReturnType<typeof normalized>) => ({ ...event });

  it("never lets a small fix also be tagged needs-human", async () => {
    const r = await ask(crash('NameError', "name 'x' is not defined"), { small_fix: true, message: 'm', suggestion: 's', tags: ['needs-human', 'infrastructure'] });
    assert.deepEqual(r.tags, ['bot-safe', 'infrastructure']);
  });

  it('refuses bot-safe where there is no app code to fix: a log line, or a failure inside a library', async () => {
    const message = normalized({ event_id: 'm'.repeat(32), platform: 'python', level: 'error', message: '[Errno 48] address already in use' });
    assert.deepEqual((await ask(message, { small_fix: true, message: 'm', suggestion: 's', tags: [] })).tags, ['no-stack-trace', 'needs-human']);
    assert.deepEqual((await ask(crash('RangeError', 'x', false), { small_fix: true, message: 'm', suggestion: 's', tags: [] })).tags, ['needs-human']);
  });

  it('replaces "Don\'t report it" said about a real failure, but keeps it for a test', async () => {
    const real = await ask(crash('HTTPException', 'osascript is not allowed assistive access'), { small_fix: false, message: 'Permissions.', suggestion: "Don't report it. Ask your admin.", tags: ['infrastructure'] });
    assert.doesNotMatch(real.suggestion, /^Don't report it/);
    assert.equal(real.message, 'Permissions.', 'its explanation is kept');
    const test = normalized({ event_id: 't'.repeat(32), platform: 'python', level: 'info', message: 'errorflow test from MacRemote' });
    const kept = await ask(test, { small_fix: false, message: 'A test.', suggestion: "Don't report it", tags: ['test-event'] });
    assert.deepEqual([kept.tags, kept.suggestion], [['test-event', 'no-stack-trace'], "Don't report it"]);
  });

  it('drops test-event from a real exception, and always states the missing stack as a fact', async () => {
    const r = await ask(crash('KeyError', "'x'"), { small_fix: false, message: 'm', suggestion: 's', tags: ['test-event'] });
    assert.deepEqual(r.tags, ['needs-human']);
    const bare = normalized({ event_id: 'b'.repeat(32), platform: 'python', level: 'error', exception: { values: [{ type: 'ValueError', value: 'never raised' }] } });
    assert.ok((await ask(bare, { small_fix: false, message: 'm', suggestion: 's', tags: ['needs-human'] })).tags.includes('no-stack-trace'));
  });

  it('only calls something third-party when its stack really never enters the app', async () => {
    const answer = { small_fix: false, message: 'm', suggestion: 's', tags: ['third-party'] };
    assert.deepEqual((await ask(crash('NameError', "name 'x' is not defined"), answer)).tags, ['needs-human'], 'the top frame is app code');
    const bare = normalized({ event_id: 'b'.repeat(32), platform: 'python', level: 'error', exception: { values: [{ type: 'ValueError', value: 'never raised' }] } });
    assert.deepEqual((await ask(bare, answer)).tags, ['no-stack-trace', 'needs-human'], 'there is no stack to be inside of');
    assert.deepEqual((await ask(crash('RangeError', 'x', false), answer)).tags, ['third-party', 'needs-human'], 'a real library failure keeps it');
  });

  it('gives the model the locals and the request, so it can say which input broke what', async () => {
    await ask(note(crash('NameError', "name 'x' is not defined")), { small_fix: true, message: 'm', suggestion: 's', tags: [] });
    assert.match(seen, /Request: POST \/volume\/up/);
    assert.match(seen, /locals: direction='up'/);
  });
});

describe('rulesTriage', () => {
  const message = (text: string, level = 'info') => normalized({ event_id: 'm'.repeat(32), platform: 'python', level, message: text, tags: { service: 'macremote' } });

  it('calls a test message a test message, names no culprit, and says not to report it', () => {
    const r = rulesTriage(message('errorflow test from MacRemote'));
    assert.deepEqual(r.tags, ['test-event', 'no-stack-trace']);
    assert.match(r.message, /test message/i);
    assert.match(r.message, /no culprit/i);
    assert.match(r.suggestion, /^Don't report it/);
    assert.equal(r.source, 'rules');
  });

  it('tells a plain log line from a test, and a missing stack trace from both', () => {
    assert.deepEqual(rulesTriage(message('disk is 91% full', 'warning')).tags, ['no-stack-trace', 'needs-human']);
    const bare = normalized({ event_id: 'b'.repeat(32), platform: 'other', level: 'error', exception: { values: [{ type: 'LogError', value: 'who knows' }] } });
    assert.deepEqual(rulesTriage(bare).tags, ['no-stack-trace', 'needs-human']);
    assert.match(rulesTriage(bare).message, /culprit cannot be located/);
  });

  it('names the culprit in the app, marks small fixes bot-safe, and sends the rest to a person', () => {
    const small = rulesTriage(normalized(jsEvent()));
    assert.deepEqual(small.tags, ['bot-safe']);
    assert.match(small.message, /getUserId/);
    assert.deepEqual(rulesTriage(normalized(pyEvent())).tags, ['needs-human']);
  });

  it('spots network trouble and failures inside a library', () => {
    const frame = (inApp: boolean) => ({ filename: 'x.js', function: 'f', lineno: 1, in_app: inApp });
    const err = (type: string, value: string, inApp: boolean) => normalized({ ...jsEvent(), exception: { values: [{ type, value, stacktrace: { frames: [frame(inApp)] } }] } });
    assert.deepEqual(rulesTriage(err('Error', 'connect ECONNREFUSED 127.0.0.1:5432', true)).tags, ['infrastructure', 'needs-human']);
    assert.deepEqual(rulesTriage(err('RangeError', 'Invalid array length', false)).tags, ['third-party', 'needs-human']);
  });
});
