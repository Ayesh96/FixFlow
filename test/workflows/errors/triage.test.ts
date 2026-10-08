import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, describe, it } from 'node:test';
import { ollamaTriager } from '../../../server/workflows/errors/triage.ts';
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

  it("uses the model's verdict and sends the error with its frames", async () => {
    const triage = ollamaTriager({ url: await ready, model: 'm' });
    reply = () => content('{"small_fix": false, "reason": "x"}');
    assert.equal(await triage(normalized(jsEvent())), false); // the heuristic alone would say true
    assert.match(seen, /getUserId/);
    reply = () => content('{"small_fix": true, "reason": "x"}');
    assert.equal(await triage(normalized(pyEvent())), true); // the heuristic alone would say false
  });

  it('falls back to the heuristic on server errors, bad JSON, or an unreachable Ollama', async () => {
    const url = await ready;
    reply = () => ({ status: 500, body: 'no' });
    assert.equal(await ollamaTriager({ url, model: 'm' })(normalized(jsEvent())), true);
    reply = () => content('not json');
    assert.equal(await ollamaTriager({ url, model: 'm' })(normalized(pyEvent())), false);
    assert.equal(await ollamaTriager({ url: 'http://127.0.0.1:1', model: 'm' })(normalized(jsEvent())), true);
  });
});
