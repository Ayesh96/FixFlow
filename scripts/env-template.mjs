// Shared .env formatting used by both setup wizards: the terminal one (scripts/setup.mjs)
// and the desktop app's GUI one (desktop/main.js). Keeps their output identical.

// value === '' writes the line commented out, showing `shown` (the default) for reference.
const line = (key, value, shown = '') => (value === '' ? `# ${key}=${shown}` : `${key}=${value}`);

export function buildEnvFile(v) {
  return [
    '# FixFlow configuration, written by the setup wizard. Re-run it any time to change these, or edit by hand.',
    '',
    `PORT=${v.port}`,
    '',
    '# Where the token, databases, encryption key and clones live.',
    line('ORCH_DATA_DIR', v.dataDir === '~/.fixflow' ? '' : v.dataDir, '~/.fixflow'),
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
    line('ORCH_RESOLVER_RETRY_SKIPPED_ATTEMPTS', v.resolverEnabled && v.retrySkipped ? 1 : '', '0'),
    '',
  ].join('\n');
}
