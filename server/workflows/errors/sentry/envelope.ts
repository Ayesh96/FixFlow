import { PayloadError } from '../../../errors.ts';
import { isRecord } from './util.ts';

export interface Envelope {
  /** `event_id` from the envelope header, if present. */
  eventId: string | null;
  items: EnvelopeItem[];
}

export interface EnvelopeItem {
  type: string;
  payload: Buffer;
}

const NEWLINE = 0x0a;

function readLine(buf: Buffer, start: number): { line: Buffer; next: number } {
  const nl = buf.indexOf(NEWLINE, start);
  const end = nl === -1 ? buf.length : nl;
  return { line: buf.subarray(start, end), next: end + 1 };
}

function parseHeader(line: Buffer, what: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(line.toString('utf8'));
    if (isRecord(value)) return value;
  } catch {
    // fall through to the error below
  }
  throw new PayloadError(`Malformed ${what} header in envelope`);
}

/**
 * Parses the Sentry envelope wire format: a JSON header line followed by
 * `item-header\npayload\n` pairs. Length-prefixed payloads may contain newlines
 * or binary data, so positions are tracked in bytes, not characters.
 */
export function parseEnvelope(body: Buffer): Envelope {
  const head = readLine(body, 0);
  const header = parseHeader(head.line, 'envelope');
  const items: EnvelopeItem[] = [];
  let pos = head.next;

  while (pos < body.length) {
    const { line, next } = readLine(body, pos);
    if (line.length === 0) {
      pos = next;
      continue;
    }
    const itemHeader = parseHeader(line, 'item');
    const type = typeof itemHeader.type === 'string' ? itemHeader.type : '';
    const length = itemHeader.length;

    if (typeof length === 'number' && Number.isInteger(length) && length >= 0) {
      if (next + length > body.length) throw new PayloadError('Envelope item length exceeds body size');
      items.push({ type, payload: body.subarray(next, next + length) });
      pos = next + length + 1; // skip the newline terminating the payload
    } else {
      const payload = readLine(body, next);
      items.push({ type, payload: payload.line });
      pos = payload.next;
    }
  }

  return { eventId: typeof header.event_id === 'string' ? header.event_id : null, items };
}
