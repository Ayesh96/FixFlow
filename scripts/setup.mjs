// Interactive first-run setup: asks for every .env.example setting and writes .env.
// Run directly with `npm run setup`, or it runs itself once, automatically, from
// ensure-build.mjs and bin/fixflow.mjs when no .env exists yet.
import './check-node.mjs';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEnvFile } from './env-template.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = join(root, '.env');

if (!process.stdin.isTTY) {
  console.error('Setup needs an interactive terminal. Copy .env.example to .env by hand instead, or run `npm run setup` from a terminal.');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
let done = false;
rl.on('close', () => {
  if (!done) console.log('\nSetup cancelled. Nothing was written.');
  process.exit(done ? 0 : 1);
});

const ask = async (question, fallback = '') => (await rl.question(fallback ? `${question} [${fallback}] ` : `${question} `)).trim() || fallback;
const askYesNo = async (question, fallbackYes) => {
  const label = fallbackYes ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${question} [${label}] `)).trim().toLowerCase();
  if (answer === '') return fallbackYes;
  return answer === 'y' || answer === 'yes';
};
const askInt = async (question, fallback) => {
  while (true) {
    const answer = await ask(question, String(fallback));
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 0) return n;
    console.log('  Please enter a whole number.');
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

  const port = await askInt('Dashboard port', 7420);
  const dataDir = await ask('Data folder (token, databases, key and clones)', '~/.fixflow');

  console.log('\nModels — triage falls back to built-in rules without one; the resolver needs at least one.');
  const providers = [];
  const useOllama = await askYesNo('Set up Ollama (runs a model locally)?', true);
  let ollamaUrl = '';
  let ollamaModel = '';
  if (useOllama) {
    providers.push('ollama');
    ollamaUrl = await ask('  Ollama URL', 'http://localhost:11434');
    ollamaModel = await ask('  Ollama model (`ollama pull <model>` first)', 'qwen2.5-coder:7b');
  }
  const useDeepseek = await askYesNo('Set up DeepSeek (hosted; sends error text and source code to it)?', false);
  let deepseekKey = '';
  let deepseekModel = '';
  if (useDeepseek) {
    deepseekKey = await ask('  DeepSeek API key');
    if (deepseekKey) {
      providers.push('deepseek');
      deepseekModel = await ask('  DeepSeek model', 'deepseek-flash');
    } else {
      console.log('  No key entered — skipping DeepSeek.');
    }
  }
  const useAnthropic = await askYesNo('Set up Anthropic (hosted; sends error text and source code to it)?', false);
  let anthropicKey = '';
  let anthropicModel = '';
  if (useAnthropic) {
    anthropicKey = await ask('  Anthropic API key');
    if (anthropicKey) {
      providers.push('anthropic');
      anthropicModel = await ask('  Anthropic model', 'claude-haiku-4-5');
    } else {
      console.log('  No key entered — skipping Anthropic.');
    }
  }
  let providerOrder = providers.join(',');
  if (providers.length > 1) providerOrder = await ask('  Order to try them in, first to last', providerOrder);

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
    ingestPort = await askInt('  Ingest port (separate from the dashboard)', 3000);
    ingestHost = await ask('  Ingest host (0.0.0.0 also accepts reports from other machines)', '127.0.0.1');
    dsnKey = await ask('  Require this sentry_key on ingest requests (blank = no check)');
    githubLabels = await ask('  Labels applied to new GitHub issues', 'bug,sentry');
    minLevel = await ask('  Lowest level filed on GitHub (others are still stored)', 'error');
    commentThresholds = await ask('  Event counts at which it comments on the GitHub issue', '100,1000,10000');
    retentionDays = await askInt('  Days to keep raw events (0 keeps everything)', 30);
  }

  console.log('\nResolver — attempts a fix and opens a pull request for issues FixFlow filed.');
  const resolverEnabled = await askYesNo('Enable the resolver?', true);
  let pollInterval = 300000;
  let maxConcurrent = 3;
  let maxAttempts = 3;
  let retrySkipped = false;
  if (resolverEnabled) {
    pollInterval = await askInt('  Poll interval, ms (minimum 30000)', 300000);
    maxConcurrent = await askInt('  Max fixes running at once', 3);
    maxAttempts = await askInt('  Max attempts per issue before it stops on its own', 3);
    retrySkipped = await askYesNo('  Retry SKIPPED issues every poll (testing aid)?', false);
  }

  writeFileSync(
    envPath,
    buildEnvFile({
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
    }),
  );

  console.log(`\nWrote ${envPath}`);
  if (useDeepseek && !deepseekKey) console.log('Note: no DeepSeek key was entered, so it was left out.');
  if (useAnthropic && !anthropicKey) console.log('Note: no Anthropic key was entered, so it was left out.');
  console.log('Run `npm start` to launch FixFlow with this configuration.');
}

await main();
done = true;
rl.close();
