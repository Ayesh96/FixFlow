import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { logFileFor, logLine, parseLogLine, readLog, removeLog } from '../../../server/workflows/resolver/log.ts';

const quiet = <T>(fn: () => T): T => {
  const original = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = original;
  }
};

describe('resolver log', () => {
  it('reads back what was written, each line split into its time, step and detail', async () => {
    const file = logFileFor(mkdtempSync(join(tmpdir(), 'resolver-log-')), { owner: 'acme', repo: 'web' }, 7)!;
    assert.match(file, /acme-web-issue-7\.log$/);
    quiet(() => {
      logLine(file, '[resolver] ---- attempt started for issue #7 ----');
      logLine(file, '[resolver] agent turn 1/30 for issue #7', { tool_calls: ['read_file({"path":"a {b}.ts"})'], content: 'Looking' });
      logLine(file, '[resolver] Pushed code-akos/issue-7');
    });

    const entries = await readLog(file);
    assert.deepEqual(
      entries.map((e) => e.message),
      ['---- attempt started for issue #7 ----', 'agent turn 1/30 for issue #7', 'Pushed code-akos/issue-7'],
    );
    assert.deepEqual(entries[1]?.detail, { tool_calls: ['read_file({"path":"a {b}.ts"})'], content: 'Looking' });
    assert.ok(entries.every((e) => e.at && !Number.isNaN(Date.parse(e.at))));
  });

  it('keeps a message that contains " {" whole when there is no detail after it', () => {
    assert.deepEqual(parseLogLine('2026-01-01T00:00:00.000Z [resolver] Failed: unexpected { in config'), { at: '2026-01-01T00:00:00.000Z', message: 'Failed: unexpected { in config' });
  });

  it('shows a line it cannot read as it was written, and is empty when there is no log yet', async () => {
    assert.deepEqual(parseLogLine('not a log line'), { at: null, message: 'not a log line' });
    assert.deepEqual(await readLog(join(tmpdir(), 'no-such-resolver-log.log')), []);
  });

  it('removes a log and its rotated copy', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'resolver-log-')), 'x.log');
    writeFileSync(file, 'a\n');
    writeFileSync(`${file}.1`, 'b\n');
    await removeLog(file);
    assert.equal(existsSync(file) || existsSync(`${file}.1`), false);
  });
});
