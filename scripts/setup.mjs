// Interactive first-run setup: asks for every .env.example setting and writes .env.
// Run directly with `npm run setup`, or it runs itself once, automatically, from
// ensure-build.mjs and bin/code-akos.mjs when no .env exists yet. When a .env already exists
// and the user chooses to overwrite it, the same questions run with its values as defaults.
import './check-node.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync, accessSync, constants } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvFile, parseEnvFile } from './env-template.mjs';
import {
  LEVEL_CHOICES,
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
// keepPort is set only while editing: the running server may already hold the port the .env uses.
const askPort = async (question, fallback, otherPort, keepPort) => {
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
    if (n === keepPort) return n;
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
// keepCurrent (editing) keeps the current model on the list even if the provider no longer lists it.
const pickModel = async (models, fallback, question, keepCurrent = false) => {
  if (!models.length) return ask(question, fallback);
  const list = keepCurrent && !models.includes(fallback) ? [fallback, ...models] : models;
  const idx = list.indexOf(fallback);
  return list[await pick('Models available:', list, idx >= 0 ? idx : 0)];
};
// A stored key is shown as [••••1234]: enough to recognise it, never the whole key.
const maskKey = (key) => `[••••${key.length > 4 ? key.slice(-4) : ''}]`;
// Asks for an API key and checks it. Blank skips the provider, or keeps the stored key when there is one.
// An unreachable host is only a warning, so the user can carry on without a model list.
const askProviderKey = async (name, check, stored = '') => {
  while (true) {
    const prompt = stored ? `  ${name} API key ${maskKey(stored)} (Enter keeps it)` : `  ${name} API key (blank to skip)`;
    const key = (await rl.question(`${prompt} `)).trim();
    if (!key && stored) {
      // The check only fetches the model list here, so a failure is not an error.
      const r = await check(stored);
      return { key: stored, models: r.ok ? (r.models ?? []) : [] };
    }
    if (!key) return { key: '', models: [] };
    const r = await check(key);
    if (r.ok) return { key, models: r.models ?? [] };
    if (r.unreachable) {
      console.log(`  Could not reach ${name} to check the key${r.error ? `: ${r.error}` : ''}. Continuing without a check.`);
      return { key, models: [] };
    }
    console.log(`  ${name} rejected that key${r.error ? `: ${r.error}` : ''}. Try again, or leave blank to ${stored ? 'keep the stored key' : `skip ${name}`}.`);
  }
};
// The ingest sentry_key. Blank means no check on a first run. A stored key is masked: Enter keeps it, "-" removes it.
const askAccessKey = async (question, stored) => {
  if (!stored) return ask(`${question} (blank = no check)`);
  const answer = (await rl.question(`${question} ${maskKey(stored)} (Enter keeps it, - removes it) `)).trim();
  if (answer === '') return stored;
  return answer === '-' ? '' : answer;
};
// Asks for the Ollama address until it answers with at least one model. The user can also
// turn Ollama off instead. Returns { url, model }, or null when Ollama is turned off.
const askOllama = async (d, keepCurrent) => {
  let url = d.ollamaUrl;
  while (true) {
    url = await ask('  Ollama URL', url);
    const check = await checkOllama(url);
    if (check.ok && check.models?.length) {
      const model = await pickModel(check.models, d.ollamaModel || 'qwen2.5-coder:7b', '  Ollama model (`ollama pull <model>` first)', keepCurrent);
      return { url, model };
    }
    if (check.ok) console.log('  Ollama is running but has no models yet. Get the default with: ollama pull qwen2.5-coder:7b');
    else console.log(`  Could not reach Ollama at ${url}${check.error ? ` (${check.error})` : ''}.`);
    const next = await pick('What now?', ['Enter the Ollama address again', 'Turn Ollama off'], 0);
    if (next === 1) return null;
  }
};

async function main() {
  const editing = existsSync(envPath);
  if (editing) {
    const overwrite = await askYesNo('.env already exists. Overwrite it?', false);
    if (!overwrite) {
      console.log('Keeping the existing .env. Nothing changed.');
      return;
    }
  }
  // Every question below defaults to the matching value in the current .env. A first run uses the
  // defaults of an empty .env, which are the ones the wizard has always offered.
  const d = parseEnvFile(editing ? readFileSync(envPath, 'utf8') : '');

  console.log(editing
    ? 'Code Akos setup — editing the existing settings. Press Enter to keep each value shown in [brackets]. Everything here is optional.\n'
    : 'Code Akos setup — press Enter to accept the default shown in [brackets]. Everything here is optional.\n');

  const port = await askPort('Dashboard port', d.port, undefined, editing ? d.port : undefined);
  const dataDir = await askDataDir('Data folder (token, databases, key and clones)', d.dataDir);

  console.log('\nModels — at least one is required; the resolver writes fixes with it.');
  let providers = [];
  let useOllama = false;
  let ollamaUrl = '';
  let ollamaModel = '';
  let deepseekKey = '';
  let deepseekModel = '';
  let anthropicKey = '';
  let anthropicModel = '';
  while (true) {
    providers = [];
    useOllama = false;
    ollamaUrl = '';
    ollamaModel = '';
    if (await askYesNo('Set up Ollama (runs a model locally)?', editing ? d.useOllama : true)) {
      const ollama = await askOllama(d, editing);
      if (ollama) {
        useOllama = true;
        ollamaUrl = ollama.url;
        ollamaModel = ollama.model;
        providers.push('ollama');
      }
    }
    deepseekKey = '';
    deepseekModel = '';
    if (await askYesNo('Set up DeepSeek (hosted; sends error text and source code to it)?', Boolean(d.deepseekKey))) {
      const found = await askProviderKey('DeepSeek', (key) => checkDeepSeek(key, process.env.ORCH_DEEPSEEK_API_URL || undefined), d.deepseekKey);
      deepseekKey = found.key;
      if (deepseekKey) {
        providers.push('deepseek');
        deepseekModel = await pickModel(found.models, d.deepseekModel || 'deepseek-flash', '  DeepSeek model', editing);
      } else {
        console.log('  No key entered — skipping DeepSeek.');
      }
    }
    anthropicKey = '';
    anthropicModel = '';
    if (await askYesNo('Set up Anthropic (hosted; sends error text and source code to it)?', Boolean(d.anthropicKey))) {
      const found = await askProviderKey('Anthropic', (key) => checkAnthropic(key, process.env.ORCH_ANTHROPIC_API_URL || undefined), d.anthropicKey);
      anthropicKey = found.key;
      if (anthropicKey) {
        providers.push('anthropic');
        anthropicModel = await pickModel(found.models, d.anthropicModel || 'claude-haiku-4-5', '  Anthropic model', editing);
      } else {
        console.log('  No key entered — skipping Anthropic.');
      }
    }
    if (providers.length) break;
    console.log('Set up at least one model; the resolver needs one to write fixes.');
  }
  // The current order is kept where it still applies; providers that are new go at the end.
  const currentOrder = d.providerOrder.split(',').map((s) => s.trim()).filter((p) => providers.includes(p));
  let providerOrder = [...new Set([...currentOrder, ...providers])].join(',');
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
  const ingestPort = await askPort('  Ingest port (separate from the dashboard)', d.ingestPort, port, editing ? d.ingestPort : undefined);
  const hostIndex = await pick('Ingest host:', [
    'this machine only (127.0.0.1)',
    'network too (0.0.0.0, anyone who can reach the port can file errors)',
  ], d.ingestHost === '0.0.0.0' ? 1 : 0);
  const ingestHost = hostIndex === 1 ? '0.0.0.0' : '127.0.0.1';
  const dsnKey = await askAccessKey('  Require this sentry_key on ingest requests', d.dsnKey);
  const githubLabels = await ask('  Labels applied to new GitHub issues', d.githubLabels);
  // ORCH_ERRORS_MIN_LEVEL is a threshold, so each choice files that level and everything above it.
  const levelValue = LEVEL_CHOICES.some((c) => c.value === d.minLevel) ? d.minLevel : 'error';
  const levelIndex = LEVEL_CHOICES.findIndex((c) => c.value === levelValue);
  const minLevel = LEVEL_CHOICES[await pick('Lowest level filed on GitHub (others are still stored):', LEVEL_CHOICES.map((c) => c.label), levelIndex)].value;
  const commentThresholds = await askThresholds('  Event counts at which it comments on the GitHub issue', d.commentThresholds);
  const retentionDays = await askInt('  Days to keep raw events (0 keeps everything)', d.retentionDays, 0);

  console.log('\nResolver — attempts a fix and opens a pull request for issues Code Akos filed.');
  // A poll interval set by hand that is not one of the choices is offered as its own choice, so Enter keeps it.
  const pollChoices = POLL_INTERVALS.some((p) => p.ms === d.pollInterval)
    ? POLL_INTERVALS
    : [...POLL_INTERVALS, { label: `${d.pollInterval} ms (current)`, ms: d.pollInterval }];
  const pollIndex = pollChoices.findIndex((p) => p.ms === d.pollInterval);
  const pollInterval = pollChoices[await pick('Poll interval:', pollChoices.map((p) => p.label), pollIndex)].ms;
  const maxConcurrent = await askInt('  Max fixes running at once', d.maxConcurrent, 1);
  const maxAttempts = await askInt('  Max attempts per issue before it stops on its own', d.maxAttempts, 1);
  const retrySkipped = await askYesNo('  Retry SKIPPED issues every poll (testing aid)?', d.retrySkipped);

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
    errorsEnabled: true,
    ingestPort,
    ingestHost,
    dsnKey,
    githubLabels,
    minLevel,
    commentThresholds,
    retentionDays,
    resolverEnabled: true,
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
  console.log('Run `npm start` to launch Code Akos with this configuration.');
}

await main();
done = true;
rl.close();
