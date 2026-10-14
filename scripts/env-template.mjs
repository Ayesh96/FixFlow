// Shared .env formatting used by both setup wizards: the terminal one (scripts/setup.mjs)
// and the desktop app's GUI one (desktop/main.js). Keeps their output identical.

// value === '' writes the line commented out, showing `shown` (the default) for reference.
const line = (key, value, shown = '') => (value === '' ? `# ${key}=${shown}` : `${key}=${value}`);

/** Reads a .env the wizard (or a person) wrote back into the values buildEnvFile takes. */
export function parseEnvFile(text) {
  const env = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const get = (key, fallback = '') => env[key] ?? fallback;
  const num = (key, fallback) => {
    const n = Number(env[key]);
    return env[key] !== undefined && Number.isInteger(n) ? n : fallback;
  };
  const on = (key) => /^(?:1|true|yes|on)$/i.test(get(key));
  const deepseekKey = get('ORCH_DEEPSEEK_API_KEY');
  const anthropicKey = get('ORCH_ANTHROPIC_API_KEY');
  const useOllama = Boolean(env.ORCH_OLLAMA_URL);
  const configured = [useOllama && 'ollama', deepseekKey && 'deepseek', anthropicKey && 'anthropic'].filter(Boolean);
  return {
    port: num('PORT', 7420),
    dataDir: get('ORCH_DATA_DIR', '~/.code-akos'),
    providerOrder: get('ORCH_LLM_PROVIDERS') || configured.join(','),
    useOllama,
    ollamaUrl: get('ORCH_OLLAMA_URL', 'http://localhost:11434'),
    ollamaModel: get('ORCH_OLLAMA_MODEL'),
    deepseekKey,
    deepseekModel: get('ORCH_DEEPSEEK_MODEL'),
    anthropicKey,
    anthropicModel: get('ORCH_ANTHROPIC_MODEL'),
    errorsEnabled: true,
    ingestPort: num('ORCH_ERRORS_INGEST_PORT', 3000),
    ingestHost: get('ORCH_ERRORS_INGEST_HOST', '127.0.0.1'),
    dsnKey: get('ORCH_ERRORS_DSN_PUBLIC_KEY'),
    githubLabels: get('ORCH_ERRORS_GITHUB_LABELS', 'bug,sentry'),
    minLevel: get('ORCH_ERRORS_MIN_LEVEL', 'error'),
    commentThresholds: get('ORCH_ERRORS_COMMENT_THRESHOLDS', '100,1000,10000'),
    retentionDays: num('ORCH_ERRORS_RETENTION_DAYS', 30),
    resolverEnabled: true,
    pollInterval: num('ORCH_RESOLVER_POLL_INTERVAL_MS', 300000),
    maxConcurrent: num('ORCH_RESOLVER_MAX_CONCURRENT_FIXES', 3),
    maxAttempts: num('ORCH_RESOLVER_MAX_ATTEMPTS', 3),
    maxTurns: num('ORCH_RESOLVER_MAX_TURNS', 20),
    retrySkipped: on('ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS'),
  };
}

export function buildEnvFile(v) {
  return [
    '# Code Akos configuration, written by the setup wizard. Re-run it any time to change these, or edit by hand.',
    '',
    `PORT=${v.port}`,
    '',
    '# Where the token, databases, encryption key and clones live.',
    line('ORCH_DATA_DIR', v.dataDir === '~/.code-akos' ? '' : v.dataDir, '~/.code-akos'),
    '',
    '# GitHub tokens are NOT configured here: each project has its own, stored encrypted in',
    '# <data folder>/projects.db. Add projects on the Projects tab.',
    '',
    '# Models. Triage and the resolver each try these in order and fall back down the list when one fails.',
    line('ORCH_LLM_PROVIDERS', v.providerOrder, 'ollama,deepseek,anthropic'),
    '',
    '# Local Ollama: triages new errors and writes fixes. Triage uses it only when the URL is set.',
    line('ORCH_OLLAMA_URL', v.useOllama ? v.ollamaUrl : '', 'http://localhost:11434'),
    line('ORCH_OLLAMA_MODEL', v.useOllama ? v.ollamaModel : '', 'qwen2.5-coder:7b'),
    '',
    '# DeepSeek (hosted; error text and source code are sent to it).',
    line('ORCH_DEEPSEEK_API_KEY', v.deepseekKey),
    line('ORCH_DEEPSEEK_MODEL', v.deepseekKey ? v.deepseekModel : '', 'deepseek-flash'),
    '',
    '# Anthropic (hosted; error text and source code are sent to it).',
    line('ORCH_ANTHROPIC_API_KEY', v.anthropicKey),
    line('ORCH_ANTHROPIC_MODEL', v.anthropicKey ? v.anthropicModel : '', 'claude-haiku-4-5'),
    '',
    '# ---- Errors -------------------------------------------------------------------------------',
    `ORCH_ERRORS_ENABLED=${v.errorsEnabled ? 1 : 0}`,
    line('ORCH_ERRORS_INGEST_PORT', v.errorsEnabled ? v.ingestPort : '', '3000'),
    line('ORCH_ERRORS_INGEST_HOST', v.errorsEnabled ? v.ingestHost : '', '127.0.0.1'),
    line('ORCH_ERRORS_DSN_PUBLIC_KEY', v.dsnKey),
    line('ORCH_ERRORS_GITHUB_LABELS', v.errorsEnabled ? v.githubLabels : '', 'bug,sentry'),
    line('ORCH_ERRORS_MIN_LEVEL', v.errorsEnabled ? v.minLevel : '', 'error'),
    line('ORCH_ERRORS_COMMENT_THRESHOLDS', v.errorsEnabled ? v.commentThresholds : '', '100,1000,10000'),
    line('ORCH_ERRORS_RETENTION_DAYS', v.errorsEnabled ? v.retentionDays : '', '30'),
    '',
    '# ---- Resolver -----------------------------------------------------------------------------',
    `ORCH_RESOLVER_ENABLED=${v.resolverEnabled ? 1 : 0}`,
    line('ORCH_RESOLVER_POLL_INTERVAL_MS', v.resolverEnabled ? v.pollInterval : '', '300000'),
    line('ORCH_RESOLVER_MAX_CONCURRENT_FIXES', v.resolverEnabled ? v.maxConcurrent : '', '3'),
    line('ORCH_RESOLVER_MAX_ATTEMPTS', v.resolverEnabled ? v.maxAttempts : '', '3'),
    line('ORCH_RESOLVER_MAX_TURNS', v.resolverEnabled ? v.maxTurns : '', '20'),
    line('ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS', v.resolverEnabled && v.retrySkipped ? 1 : '', '0'),
    '',
  ].join('\n');
}
