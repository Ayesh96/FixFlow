const { app, BrowserWindow, ipcMain, utilityProcess, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Dev: this file lives in <repo>/desktop, so the project root is one level up.
// Packaged: electron-builder copies the project (server/, bin/, scripts/, web/dist/, node_modules)
// into Resources/app alongside this app's own asar.
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

let onboardingWindow = null;
let mainWindow = null;
let serverProcess = null;

function showOnboarding() {
  onboardingWindow = new BrowserWindow({
    width: 560,
    height: 680,
    minWidth: 480,
    minHeight: 520,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    title: 'Set up FixFlow',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  onboardingWindow.loadFile(path.join(__dirname, 'onboarding.html'));
}

// Forks bin/fixflow.mjs in Electron's own bundled Node — no system Node install required.
// Resolves with the dashboard URL (including the login token) once the server prints it.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(ROOT, 'bin', 'fixflow.mjs'), [], { cwd: ROOT, stdio: 'pipe' });
    serverProcess = child;
    let buffer = '';
    let settled = false;

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/Dashboard\s+\S+\s+(http:\/\/\S+)/);
      if (match && !settled) {
        settled = true;
        resolve(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => console.error('[fixflow]', chunk.toString()));
    child.on('exit', (code) => {
      serverProcess = null;
      if (!settled) {
        settled = true;
        reject(new Error(`FixFlow exited before starting (code ${code}).\n${buffer}`));
      }
    });
  });
}

async function launchDashboard() {
  let url;
  try {
    url = await startServer();
  } catch (err) {
    dialog.showErrorBox('FixFlow failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }
  mainWindow = new BrowserWindow({ width: 1280, height: 860, title: 'FixFlow' });
  await mainWindow.loadURL(url);
}

// Shared setup helpers (live checks, validation). Network checks run here, in the main process,
// so API keys never reach the page's own JavaScript beyond the password inputs.
async function loadSetupChecks() {
  return import(pathToFileURL(path.join(ROOT, 'scripts', 'setup-checks.mjs')).href);
}

ipcMain.handle('setup:checkOllama', async (_event, url) => (await loadSetupChecks()).checkOllama(String(url ?? '')));
ipcMain.handle('setup:checkDeepseek', async (_event, apiKey) => (await loadSetupChecks()).checkDeepSeek(String(apiKey ?? ''), process.env.ORCH_DEEPSEEK_API_URL || undefined));
ipcMain.handle('setup:checkAnthropic', async (_event, apiKey) => (await loadSetupChecks()).checkAnthropic(String(apiKey ?? ''), process.env.ORCH_ANTHROPIC_API_URL || undefined));
ipcMain.handle('setup:checkPort', async (_event, port) => (await loadSetupChecks()).checkPort(Number(port)));

ipcMain.handle('setup:constants', async () => {
  const { LEVELS, POLL_INTERVALS } = await loadSetupChecks();
  return { LEVELS, POLL_INTERVALS };
});

ipcMain.handle('setup:pickFolder', async () => {
  const options = { title: 'Choose the FixFlow data folder', properties: ['openDirectory', 'createDirectory'] };
  const parent = BrowserWindow.getFocusedWindow() ?? onboardingWindow;
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

// Errors are thrown as JSON of the {field: message} map so the page can show each one under its field.
// Electron prefixes thrown errors in the renderer; the page strips that prefix.
ipcMain.handle('setup:save', async (_event, values) => {
  const { buildEnvFile } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'env-template.mjs')).href);
  const checks = await loadSetupChecks();

  const { errors = {} } = (await checks.validateValues(values)) ?? {};
  if (Object.keys(errors).length > 0) throw new Error(JSON.stringify(errors));

  // The page checked the ports a while ago; something may have taken one since. Writing .env and
  // then failing to listen would leave a broken setup behind, so check again right before writing.
  const busy = {};
  for (const key of ['port', 'ingestPort']) {
    const result = await checks.checkPort(Number(values[key]));
    if (!result.ok) busy[key] = `${result.error || 'This port is not available'}. Pick a different port.`;
  }
  if (Object.keys(busy).length > 0) throw new Error(JSON.stringify(busy));

  const envText = buildEnvFile(values);
  const server = await checks.validateWithServer(envText, ROOT);
  if (!server.ok) {
    const problems = server.problems?.length ? server.problems : ['These settings did not pass the server checks.'];
    throw new Error(problems.join('\n'));
  }

  fs.writeFileSync(ENV_PATH, envText);
  await launchDashboard();
  onboardingWindow?.close();
  onboardingWindow = null;
});

app.whenReady().then(() => {
  if (fs.existsSync(ENV_PATH)) {
    void launchDashboard();
  } else {
    showOnboarding();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => serverProcess?.kill());
