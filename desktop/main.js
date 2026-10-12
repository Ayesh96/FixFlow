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
    width: 720,
    height: 860,
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

ipcMain.handle('setup:save', async (_event, values) => {
  const { buildEnvFile } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'env-template.mjs')).href);
  fs.writeFileSync(ENV_PATH, buildEnvFile(values));
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
