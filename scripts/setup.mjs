// Interactive first-run setup: asks for every .env.example setting and writes .env.
// Run directly with `npm run setup`, or it runs itself once, automatically, from
// ensure-build.mjs and bin/fixflow.mjs when no .env exists yet.
import './check-node.mjs';
import { existsSync, writeFileSync, mkdirSync, accessSync, constants } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvFile } from './env-template.mjs';
import {
  LEVELS,
  POLL_INTERVALS,
  checkPort,
  checkOllama,
  checkDeepSeek,
  checkAnthropic,
  validateValues,
  validateWithServer,
} from './setup-checks.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = join(root, '.env');

if (!process.stdin.isTTY) {
  console.error('Setup needs an interactive terminal. Copy .env.example to .env by hand instead, or run `npm run setup` from a terminal.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let done = false;
let exitCode = 0;
rl.on('close', () => {
  if (!done) console.log('\nSetup cancelled. Nothing was written.');
  process.exit(done ? exitCode : 1);
});

const isWhole = (s) => /^\d+$/.test(s);

const ask = async (question, fallback = '') => (await rl.question(fallback ? `${question} [${fallback}] ` : `${question} `)).trim() || fallback;
const askYesNo = async (question, fallbackYes) => {
  const label = fallbackYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${label}] `)).trim().toLowerCase();
  if (answer === '') return fallbackYes;
  return answer === 'y' || answer === 'yes';
};
const askInt = async (question, fallback, min = 0) => {
  while (true) {
    const answer = await ask(question, String(fallback));
    if (isWhole(answer) && Number(answer) >= min) return Number(answer);
    console.log(min > 0 ? `  Please enter a whole number, ${min} or more.` : '  Please enter a whole number.');
  }
};
const askPort = async (question, fallback, otherPort) => {
  while (true) {
    const answer = await ask(question, String(fallback));
    const n = isWhole(answer) ? Number(answer) : 0;
    if (n < 1 || n > 65535) {
      console.log('  Please enter a port number from 1 to 65535.');
      continue;
    }
    if (n === otherPort) {
      console.log(`  That is the dashboard port (${otherPort}). Pick a different one.`);
      continue;
    }
    const check = await checkPort(n);
    if (!check.ok) {
      console.log(`  ${check.error || `Port ${n} is not available.`}`);
      continue;
    }
    return n;
  }
};
// Expands a leading ~ only for the check; the answer is kept as typed.
const askDataDir = async (question, fallback) => {
  while (true) {
    const answer = await ask(question, fallback);
    const expanded = answer === '~' || answer.startsWith('~/') ? join(homedir(), answer.slice(1)) : answer;
    try {
      mkdirSync(resolve(expanded), { recursive: true });
      accessSync(resolve(expanded), constants.W_OK);
      return answer;
    } catch (err) {
      console.log(`  Cannot use ${answer}: ${err.message}. Pick another folder.`);
    }
  }
};
const askThresholds = async (question, fallback) => {
  while (true) {
    const parts = (await ask(question, fallback)).split(',').map((p) => p.trim());
    if (parts.every((p) => isWhole(p) && Number(p) >= 2)) return parts.join(',');
    console.log('  Enter counts as a comma-separated list of whole numbers, each 2 or more (e.g. 100,1000,10000).');
  }
};
// Numbered choice. Enter returns defaultIndex. Returns the chosen index.
const pick = async (title, labels, defaultIndex) => {
  if (title) console.log(`  ${title}`);
  labels.forEach((label, i) => console.log(`    ${i + 1}) ${label}`));
  while (true) {
    const answer = (await rl.question(`  Choice [${defaultIndex + 1}] `)).trim();
    if (answer === '') return defaultIndex;
    const n = isWhole(answer) ? Number(answer) : 0;
    if (n >= 1 && n <= labels.length) return n - 1;
    console.log(`  Please enter a number from 1 to ${labels.length}.`);
  }
};
// Picks from a live model list when there is one, otherwise asks for the name as text.
const pickModel = async (models, fallback, question) => {
  if (!models.length) return ask(question, fallback);
  const idx = models.indexOf(fallback);
  return models[await pick('Models available:', models, idx >= 0 ? idx : 0)];
};
// Asks for an API key and checks it. Blank skips the provider. An unreachable host
// is only a warning, so the user can carry on without a model list.
const askProviderKey = async (name, check) => {
  while (true) {
    const key = await ask(`  ${name} API key (blank to skip)`);
    if (!key) return { key: '', models: [] };
    const r = await check(key);
    if (r.ok) return { key, models: r.models ?? [] };
    if (r.unreachable) {
      console.log(`  Could not reach ${name} to check the key${r.error ? `: ${r.error}` : ''}. Continuing without a check.`);
      return { key, models: [] };
    }
    console.log(`  ${name} rejected that key${r.error ? `: ${r.error}` : ''}. Try again, or leave blank to skip ${name}.`);
  }
};

async function main() {
  if (existsSync(envPath)) {
    const overwrite = await askYesNo('.env already exists. Overwrite it?', false);
    if (!overwrite) {
      console.log('Keeping the existing .env. Nothing changed.');
      return;
    }
  }

  console.log('FixFlow setup — press Enter to accept the default shown in [brackets]. Everything here is optional.\n');

  const port = await askPort('Dashboard port', 7420);
  const dataDir = await askDataDir('Data folder (token, databases, key and clones)', '~/.fixflow');

  console.log('\nModels — triage falls back to built-in rules without one; the resolver needs at least one.');
  const providers = [];
  const useOllama = await askYesNo('Set up Ollama (runs a model locally)?', true);
  let ollamaUrl = '';
  let ollamaModel = '';
  if (useOllama) {
    providers.push('ollama');
    ollamaUrl = await ask('  Ollama URL', 'http://localhost:11434');
    const check = await checkOllama(ollamaUrl);
    const models = check.ok ? check.models ?? [] : [];
    if (!check.ok) {
      console.log(`  Warning: could not reach Ollama at ${ollamaUrl}${check.error ? ` (${check.error})` : ''}. Continuing; type the model name yourself.`);
    } else if (!models.length) {
      console.log('  Ollama is running but has no models yet. Get the default with: ollama pull qwen2.5-coder:7b');
    }
    ollamaModel = await pickModel(models, 'qwen2.5-coder:7b', '  Ollama model (`ollama pull <model>` first)');
  }
  const useDeepseek = await askYesNo('Set up DeepSeek (hosted; sends error text and source code to it)?', false);
  let deepseekKey = '';
  let deepseekModel = '';
  if (useDeepseek) {
    const found = await askProviderKey('DeepSeek', checkDeepSeek);
    deepseekKey = found.key;
    if (deepseekKey) {
      providers.push('deepseek');
      deepseekModel = await pickModel(found.models, 'deepseek-flash', '  DeepSeek model');
    } else {
      console.log('  No key entered — skipping DeepSeek.');
    }
  }
  const useAnthropic = await askYesNo('Set up Anthropic (hosted; sends error text and source code to it)?', false);
  let anthropicKey = '';
  let anthropicModel = '';
  if (useAnthropic) {
    const found = await askProviderKey('Anthropic', checkAnthropic);
    anthropicKey = found.key;
    if (anthropicKey) {
      providers.push('anthropic');
      anthropicModel = await pickModel(found.models, 'claude-haiku-4-5', '  Anthropic model');
    } else {
      console.log('  No key entered — skipping Anthropic.');
    }
  }
  let providerOrder = providers.join(',');
  if (providers.length > 1) {
    while (true) {
      const names = (await ask('  Order to try them in, first to last', providerOrder)).split(',').map((s) => s.trim());
      const bad = names.filter((n) => !providers.includes(n));
      if (bad.length || new Set(names).size !== names.length) {
        console.log(`  Use only ${providers.join(', ')}, each once, separated by commas.`);
        continue;
      }
      providerOrder = names.join(',');
      break;
    }
  }

  console.log('\nErrors — the Sentry-compatible ingest endpoint and GitHub issue filing.');
  const errorsEnabled = await askYesNo('Enable error tracking?', true);
  let ingestPort = 3000;
  let ingestHost = '127.0.0.1';
  let dsnKey = '';
  let githubLabels = 'bug,sentry';
  let minLevel = 'error';
  let commentThresholds = '100,1000,10000';
  let retentionDays = 30;
  if (errorsEnabled) {
    ingestPort = await askPort('  Ingest port (separate from the dashboard)', 3000, port);
    const hostIndex = await pick('Ingest host:', [
      'this machine only (127.0.0.1)',
      'network too (0.0.0.0, anyone who can reach the port can file errors)',
    ], 0);
    ingestHost = hostIndex === 1 ? '0.0.0.0' : '127.0.0.1';
    dsnKey = await ask('  Require this sentry_key on ingest requests (blank = no check)');
    githubLabels = await ask('  Labels applied to new GitHub issues', 'bug,sentry');
    const levelIndex = Math.max(0, LEVELS.indexOf('error'));
    minLevel = LEVELS[await pick('Lowest level filed on GitHub (others are still stored):', LEVELS, levelIndex)];
    commentThresholds = await askThresholds('  Event counts at which it comments on the GitHub issue', '100,1000,10000');
    retentionDays = await askInt('  Days to keep raw events (0 keeps everything)', 30, 0);
  }

  console.log('\nResolver — attempts a fix and opens a pull request for issues FixFlow filed.');
  const resolverEnabled = await askYesNo('Enable the resolver?', true);
  let pollInterval = 300000;
  let maxConcurrent = 3;
  let maxAttempts = 3;
  let retrySkipped = false;
  if (resolverEnabled) {
    const pollDefault = Math.max(0, POLL_INTERVALS.findIndex((p) => p.ms === 300000));
    pollInterval = POLL_INTERVALS[await pick('Poll interval:', POLL_INTERVALS.map((p) => p.label), pollDefault)].ms;
    maxConcurrent = await askInt('  Max fixes running at once', 3, 1);
    maxAttempts = await askInt('  Max attempts per issue before it stops on its own', 3, 1);
    retrySkipped = await askYesNo('  Retry SKIPPED issues every poll (testing aid)?', false);
  }

  const values = {
    port,
    dataDir,
    providerOrder,
    useOllama,
    ollamaUrl,
    ollamaModel,
    deepseekKey,
    deepseekModel,
    anthropicKey,
    anthropicModel,
    errorsEnabled,
    ingestPort,
    ingestHost,
    dsnKey,
    githubLabels,
    minLevel,
    commentThresholds,
    retentionDays,
    resolverEnabled,
    pollInterval,
    maxConcurrent,
    maxAttempts,
    retrySkipped,
  };

  const envText = buildEnvFile(values);
  const problems = [];
  const { errors = {} } = (await validateValues(values)) ?? {};
  for (const [field, message] of Object.entries(errors)) problems.push(`${field}: ${message}`);
  const server = await validateWithServer(envText, root);
  for (const p of server?.problems ?? []) problems.push(typeof p === 'string' ? p : p.message ?? JSON.stringify(p));
  if (server?.ok === false && !problems.length) problems.push('the server rejected this configuration');
  if (problems.length) {
    console.error('\nSetup found problems, so nothing was written:');
    for (const p of problems) console.error(`  - ${p}`);
    exitCode = 1;
    return;
  }

  writeFileSync(envPath, envText);

  console.log(`\nWrote ${envPath}`);
  if (useDeepseek && !deepseekKey) console.log('Note: no DeepSeek key was entered, so it was left out.');
  if (useAnthropic && !anthropicKey) console.log('Note: no Anthropic key was entered, so it was left out.');
  console.log('Run `npm start` to launch FixFlow with this configuration.');
}

await main();
done = true;
rl.close();
