import type { FieldErrors } from './types.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly fields: FieldErrors | undefined;

  constructor(status: number, message: string, fields?: FieldErrors) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.fields = fields;
  }
}

/** The request body could not be understood as a Sentry payload (see workflows/errors/sentry/). */
export class PayloadError extends HttpError {
  constructor(message: string) {
    super(400, message);
    this.name = 'PayloadError';
  }
}
