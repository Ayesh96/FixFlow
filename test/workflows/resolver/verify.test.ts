import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ExecFn, ExecOptions, ExecResult } from '../../../server/workflows/resolver/exec.ts';
import type { VerifyCommand } from '../../../server/workflows/resolver/verify.ts';
import { runVerify } from '../../../server/workflows/resolver/verify.ts';

test('command undefined returns ran false and never calls exec', async () => {
  let execCalled = false;
  const fakeExec: ExecFn = async () => {
    execCalled = true;
    return { stdout: '', stderr: '' };
  };

  const result = await runVerify(undefined, '/tmp', fakeExec);

  assert.equal(result.ran, false);
  assert.equal(result.passed, false);
  assert.equal(result.output, '');
  assert.equal(execCalled, false);
});

test('command.argv empty returns ran false and never calls exec', async () => {
  let execCalled = false;
  const fakeExec: ExecFn = async () => {
    execCalled = true;
    return { stdout: '', stderr: '' };
  };

  const command: VerifyCommand = { argv: [] };
  const result = await runVerify(command, '/tmp', fakeExec);

  assert.equal(result.ran, false);
  assert.equal(result.passed, false);
  assert.equal(result.output, '');
  assert.equal(execCalled, false);
});

test('successful exec returns ran true and passed true', async () => {
  const fakeExec: ExecFn = async () => {
    return { stdout: 'ok\n', stderr: '' };
  };

  const command: VerifyCommand = { argv: ['npm', 'test'] };
  const result = await runVerify(command, '/tmp', fakeExec);

  assert.equal(result.ran, true);
  assert.equal(result.passed, true);
  assert(result.output.includes('ok'));
  assert.equal(result.output, 'ok\n');
});

test('exec rejection with stdout and stderr returns ran true and passed false', async () => {
  const fakeExec: ExecFn = async () => {
    const error = new Error('exit 1');
    Object.assign(error, { stdout: 'partial output', stderr: 'boom' });
    throw error;
  };

  const command: VerifyCommand = { argv: ['npm', 'test'] };
  const result = await runVerify(command, '/tmp', fakeExec);

  assert.equal(result.ran, true);
  assert.equal(result.passed, false);
  assert(result.output.includes('partial output'));
  assert(result.output.includes('boom'));
});

test('exec rejection with no stdout/stderr returns ran true and passed false with empty output', async () => {
  const fakeExec: ExecFn = async () => {
    throw new Error('timeout');
  };

  const command: VerifyCommand = { argv: ['npm', 'test'] };
  const result = await runVerify(command, '/tmp', fakeExec);

  assert.equal(result.ran, true);
  assert.equal(result.passed, false);
  assert.equal(result.output, '');
});

test('long output gets truncated to 4000 chars plus marker', async () => {
  const longString = 'x'.repeat(5000);
  const fakeExec: ExecFn = async () => {
    return { stdout: longString, stderr: '' };
  };

  const command: VerifyCommand = { argv: ['npm', 'test'] };
  const result = await runVerify(command, '/tmp', fakeExec);

  assert(result.output.length < 5000);
  assert(result.output.endsWith('... (truncated)'));
});

test('exec is called with correct arguments and cwd', async () => {
  let capturedFile: string | undefined;
  let capturedArgs: string[] | undefined;
  let capturedOptions: ExecOptions | undefined;

  const fakeExec: ExecFn = async (file, args, options) => {
    capturedFile = file;
    capturedArgs = args;
    capturedOptions = options;
    return { stdout: 'ok\n', stderr: '' };
  };

  const command: VerifyCommand = { argv: ['npm', 'test', '--verbose'] };
  await runVerify(command, '/home/project', fakeExec);

  assert.equal(capturedFile, 'npm');
  assert.deepEqual(capturedArgs, ['test', '--verbose']);
  assert.equal(capturedOptions?.cwd, '/home/project');
  assert.equal(capturedOptions?.timeoutMs, 5 * 60 * 1000);
});
