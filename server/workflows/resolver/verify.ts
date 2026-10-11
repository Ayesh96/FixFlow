/** A program and its arguments, run without a shell. */
export interface VerifyCommand {
  argv: string[];
}

import { VERIFY_OUTPUT_MAX_CHARS, VERIFY_TIMEOUT_MS } from '../../constants.ts';
import { defaultExec, type ExecFn } from './exec.ts';

export interface VerifyResult {
  ran: boolean;
  passed: boolean;
  output: string;
}

function combine(stdout: string, stderr: string): string {
  const combined = `${stdout}${stderr}`;
  if (combined.length <= VERIFY_OUTPUT_MAX_CHARS) {
    return combined;
  }
  return combined.slice(0, VERIFY_OUTPUT_MAX_CHARS) + '\n... (truncated)';
}

export async function runVerify(
  command: VerifyCommand | undefined,
  cwd: string,
  exec: ExecFn = defaultExec,
): Promise<VerifyResult> {
  if (!command || command.argv.length === 0) {
    return { ran: false, passed: false, output: '' };
  }

  const file = command.argv[0]!;
  const args = command.argv.slice(1);

  try {
    const result = await exec(file, args, { cwd, timeoutMs: VERIFY_TIMEOUT_MS });
    return {
      ran: true,
      passed: true,
      output: combine(result.stdout, result.stderr),
    };
  } catch (err) {
    const stdout =
      typeof (err as { stdout?: unknown }).stdout === 'string'
        ? (err as { stdout: string }).stdout
        : '';
    const stderr =
      typeof (err as { stderr?: unknown }).stderr === 'string'
        ? (err as { stderr: string }).stderr
        : '';
    return {
      ran: true,
      passed: false,
      output: combine(stdout, stderr),
    };
  }
}
