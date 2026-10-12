// Checks behind the setup wizards: each one reports what it found instead of throwing, so the
// terminal wizard (scripts/setup.mjs) and the desktop app (desktop/main.js) can show it as-is.
import { createServer } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LEVELS = ['debug', 'info', 'warning', 'error', 'fatal'];

export const POLL_INTERVALS = [
  { label: '1 minute', ms: 60000 },
  { label: '5 minutes', ms: 300000 },
  { label: '15 minutes', ms: 900000 },
  { label: '30 minutes', ms: 1800000 },
  { label: '1 hour', ms: 3600000 },
];

// Same floor as RESOLVER_MIN_POLL_INTERVAL_MS in server/constants.ts.
const MIN_POLL_INTERVAL_MS = 30000;

export async function checkPort(port, host = '127.0.0.1') {
  try {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, host, () => server.close(resolve));
    });
    return { ok: true };
  } catch (err) {
    if (err.code === 'EADDRINUSE') return { ok: false, error: `Port ${port} is already in use` };
    return { ok: false, error: err.message };
  }
}

export async function checkOllama(url) {
  const base = url.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
  } catch {
    return { ok: false, models: [], error: `Cannot reach Ollama at ${url}` };
  }
  if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
  try {
    const data = await res.json();
    return { ok: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    return { ok: false, models: [], error: `Unexpected reply from Ollama at ${url}` };
  }
}

export function checkDeepSeek(apiKey, apiUrl = 'https://api.deepseek.com') {
  return listModels(apiUrl, '/models', { Authorization: `Bearer ${apiKey}` }, 8000);
}

export function checkAnthropic(apiKey, apiUrl = 'https://api.anthropic.com') {
  return listModels(apiUrl, '/v1/models', { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, 8000);
}

async function listModels(apiUrl, path, headers, timeoutMs) {
  const base = apiUrl.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { ok: false, models: [], unreachable: true, error: `Cannot reach ${apiUrl}` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, models: [], error: 'Invalid API key' };
  if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
  try {
    const data = await res.json();
    return { ok: true, models: (data.data ?? []).map((m) => m.id) };
  } catch {
    return { ok: false, models: [], error: `Unexpected reply from ${apiUrl}` };
  }
}

const isBlank = (x) => x === undefined || x === null || String(x).trim() === '';
// Blank means the server's default, so it is valid; anything else must be an integer.
const intOr = (x, fallback) => (isBlank(x) ? fallback : Number(String(x).trim()));
const isInt = (n, min, max = Infinity) => Number.isInteger(n) && n >= min && n <= max;
const list = (x) => String(x ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function validateValues(v) {
  const errors = {};

  const port = intOr(v.port, NaN);
  if (!isInt(port, 1, 65535)) errors.port = 'Port must be a whole number from 1 to 65535';

  if (v.errorsEnabled) {
    const ingestPort = intOr(v.ingestPort, 3000);
    if (!isInt(ingestPort, 1, 65535)) errors.ingestPort = 'Ingest port must be a whole number from 1 to 65535';
    else if (ingestPort === port) errors.ingestPort = 'Ingest port must differ from the dashboard port';

    if (String(v.ingestHost ?? '').trim() === '') errors.ingestHost = 'Ingest host cannot be empty';

    const minLevel = isBlank(v.minLevel) ? 'error' : String(v.minLevel).trim();
    if (!LEVELS.includes(minLevel)) errors.minLevel = `Minimum level must be one of: ${LEVELS.join(', ')}`;

    const thresholds = list(v.commentThresholds).map(Number);
    if (thresholds.some((n) => !isInt(n, 2))) errors.commentThresholds = 'Comment thresholds must be whole numbers of 2 or more, separated by commas';

    if (!isInt(intOr(v.retentionDays, 30), 0)) errors.retentionDays = 'Retention must be a whole number of days, 0 or more';
  }

  if (v.resolverEnabled) {
    if (!isInt(intOr(v.pollInterval, 300000), MIN_POLL_INTERVAL_MS)) errors.pollInterval = 'Poll interval must be at least 30 seconds';
    if (!isInt(intOr(v.maxConcurrent, 3), 1)) errors.maxConcurrent = 'Max concurrent fixes must be a whole number, 1 or more';
    if (!isInt(intOr(v.maxAttempts, 3), 1)) errors.maxAttempts = 'Max attempts must be a whole number, 1 or more';
  }

  const keyFor = { ollama: v.useOllama, deepseek: !isBlank(v.deepseekKey), anthropic: !isBlank(v.anthropicKey) };
  const setUpBy = { ollama: 'Ollama URL', deepseek: 'DeepSeek API key', anthropic: 'Anthropic API key' };
  const problems = [];
  for (const id of list(v.providerOrder).map((s) => s.toLowerCase())) {
    if (!(id in setUpBy)) problems.push(`${id} is not a known provider (use ollama, deepseek or anthropic)`);
    else if (!keyFor[id]) problems.push(`${id} is in the order but its ${setUpBy[id]} is not set`);
  }
  if (problems.length > 0) errors.providerOrder = problems.join('; ');

  return { errors };
}

export async function validateWithServer(envText, root) {
  const env = {};
  for (const raw of String(envText).split(/\r?\n/)) {
    const line = raw.trim();
    const eq = line.indexOf('=');
    if (!line || line.startsWith('#') || eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }

  try {
    const { loadConfig } = await import(pathToFileURL(join(root, 'server', 'config.ts')).href);
    loadConfig(env);
    return { ok: true, problems: [] };
  } catch (err) {
    const problems = Array.isArray(err?.problems) ? err.problems : [err?.message ?? String(err)];
    return { ok: false, problems };
  }
}
