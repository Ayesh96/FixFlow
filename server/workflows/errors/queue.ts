/**
 * Runs jobs one at a time, in order. Serial execution keeps us well under GitHub's
 * secondary rate limits (which forbid concurrent content creation) and bounds memory
 * by rejecting work once `maxSize` jobs are waiting.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private size = 0;

  private readonly maxSize: number;
  private readonly onError: (err: unknown) => void;

  constructor(maxSize: number, onError: (err: unknown) => void) {
    this.maxSize = maxSize;
    this.onError = onError;
  }

  /** Returns false (and drops the job) if the queue is full. */
  push(job: () => Promise<void>): boolean {
    if (this.size >= this.maxSize) return false;
    this.size++;
    this.tail = this.tail
      .then(job)
      .catch(this.onError)
      .finally(() => {
        this.size--;
      });
    return true;
  }

  /** Resolves once every job pushed so far has finished. */
  drain(): Promise<void> {
    return this.tail;
  }
}
