/** A program and its arguments, run without a shell. */
export interface VerifyCommand {
  argv: string[];
}

import { defaultExec, type ExecFn } from './exec.ts';

export interface VerifyResult {
  ran: boolean;
  passed: boolean;
  output: string;
}

function combine(stdout: string, stderr: string): string {
  const combined = `${stdout}${stderr}`;
  const maxLength = 4000;
  if (combined.length <= maxLength) {
    return combined;
  }
  return combined.slice(0, maxLength) + '\n... (truncated)';
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
  const timeoutMs = 5 * 60 * 1000;

  try {
    const result = await exec(file, args, { cwd, timeoutMs });
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
