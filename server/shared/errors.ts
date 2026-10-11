/** A GitHub API call that failed. `status` is the HTTP status, 0 when no answer came, 502 when it was unusable. */
export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'GitHubError';
  }
}

/** Every problem found while reading a workflow's settings, reported together. */
export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.problems = problems;
    this.name = 'ConfigError';
  }
}
