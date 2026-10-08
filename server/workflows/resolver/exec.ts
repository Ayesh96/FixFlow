import { execFile } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/** Runs a command from an argument array (never a shell), with a hard timeout. A seam for tests. */
export type ExecFn = (file: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

export const defaultExec: ExecFn = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr });
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });
