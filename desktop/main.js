const { app, BrowserWindow, ipcMain, utilityProcess, dialog, Menu, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

// Dev: this file lives in <repo>/desktop, so the project root is one level up.
// Packaged: electron-builder copies the project (server/, bin/, scripts/, web/dist/, node_modules)
// into Resources/app alongside this app's own asar.
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.join(__dirname, '..');
// Packaged, ROOT is inside the app: read-only in an AppImage or a translocated macOS app, and replaced
// on every update. So the built app keeps .env in its user-data folder and runs the server from there,
// since the server reads .env from its working directory.
const ENV_DIR = app.isPackaged ? app.getPath('userData') : ROOT;
const ENV_PATH = path.join(ENV_DIR, '.env');
/** Where builds before 1.1.0 wrote .env. */
const LEGACY_ENV_PATH = path.join(ROOT, '.env');
/** The user-data folder of builds from before the rename to Code Akos, when the app was called FixFlow. */
const PRE_RENAME_DIR = path.join(app.getPath('appData'), 'FixFlow');

let setupWindow = null;
let mainWindow = null;
let serverProcess = null;

const importScript = (name) => import(pathToFileURL(path.join(ROOT, 'scripts', name)).href);

// ---- Window size and position, remembered between launches ----------------------------------

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** The last bounds of window `name` if they still fit on a screen, else `fallback()`. */
function boundsFor(name, fallback) {
  const saved = readWindowState()[name];
  if (saved && screen.getAllDisplays().some(({ workArea: a }) => saved.x >= a.x && saved.y >= a.y && saved.x < a.x + a.width && saved.y < a.y + a.height)) {
    return saved;
  }
  return fallback(screen.getPrimaryDisplay().workArea);
}

function remember(win, name) {
  win.on('close', () => {
    const state = readWindowState();
    state[name] = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
      fs.writeFileSync(stateFile(), JSON.stringify(state));
    } catch {
      // Not worth interrupting the user over: the window just opens at its default size next time.
    }
  });
}

const centered = (area, width, height) => ({
  width,
  height,
  x: Math.round(area.x + (area.width - width) / 2),
  y: Math.round(area.y + (area.height - height) / 2),
});

// ---- External links ----------------------------------------------------------------------------

/**
 * Sends http(s) links that leave the app (target=_blank, window.open, or a plain navigation to
 * another origin) to the default browser instead of opening them inside the Code Akos window.
 */
function openLinksExternally(win) {
  const isExternal = (url) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return false;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
    let current;
    try {
      current = new URL(win.webContents.getURL());
    } catch {
      return true;
    }
    return target.origin !== current.origin;
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isExternal(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
}

// ---- Setup / settings window ------------------------------------------------------------------

/** `first` is the onboarding before .env exists; `settings` edits the current .env later. */
function openSetup(mode) {
  if (setupWindow) {
    setupWindow.focus();
    return;
  }
  const bounds = boundsFor('setup', (area) => centered(area, Math.min(760, area.width), Math.min(860, area.height)));
  setupWindow = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 560,
    backgroundColor: '#0a0a0a',
    title: mode === 'settings' ? 'Code Akos settings' : 'Set up Code Akos',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  openLinksExternally(setupWindow);
  remember(setupWindow, 'setup');
  setupWindow.on('closed', () => {
    setupWindow = null;
  });
  setupWindow.loadFile(path.join(__dirname, 'onboarding.html'), { query: { mode } });
}

// ---- Server -----------------------------------------------------------------------------------

// Forks bin/code-akos.mjs in Electron's own bundled Node — no system Node install required.
// Resolves with the dashboard URL (including the login token) once the server prints it.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(path.join(ROOT, 'bin', 'code-akos.mjs'), [], { cwd: ENV_DIR, stdio: 'pipe' });
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
    child.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
      console.error('[code-akos]', chunk.toString());
    });
    child.on('exit', (code) => {
      if (serverProcess === child) serverProcess = null;
      if (!settled) {
        settled = true;
        reject(new Error(`Code Akos exited before starting (code ${code}).\n${buffer.trim()}`));
      }
    });
  });
}

function stopServer() {
  const child = serverProcess;
  if (!child) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}

async function showDashboard(url) {
  if (mainWindow) {
    await mainWindow.loadURL(url);
    return;
  }
  const bounds = boundsFor('dashboard', (area) => centered(area, Math.round(area.width * 0.9), Math.round(area.height * 0.9)));
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0a0a0a',
    title: 'Code Akos',
    webPreferences: { preload: path.join(__dirname, 'dashboard-preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  if (bounds.maximized) mainWindow.maximize();
  openLinksExternally(mainWindow);
  remember(mainWindow, 'dashboard');
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(url);
}

async function launchDashboard() {
  let url;
  try {
    url = await startServer();
  } catch (err) {
    dialog.showErrorBox('Code Akos failed to start', err instanceof Error ? err.message : String(err));
    app.quit();
    return;
  }
  await showDashboard(url);
}

/**
 * Writes the new .env and (re)starts the server with it. If the server will not start, the old
 * .env (or none) is put back, the old server is started again, and the error goes to the page.
 */
async function applySettings(envText) {
  const previous = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : null;
  await stopServer();
  fs.mkdirSync(ENV_DIR, { recursive: true });
  fs.writeFileSync(ENV_PATH, envText);
  try {
    await showDashboard(await startServer());
  } catch (err) {
    if (previous === null) fs.rmSync(ENV_PATH, { force: true });
    else fs.writeFileSync(ENV_PATH, previous);
    if (previous !== null) await startServer().catch(() => {});
    throw new Error(`Code Akos did not start with these settings, so nothing was changed.\n${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Ports the running server holds; they are "busy" only because Code Akos itself is using them. */
async function ownPorts() {
  if (!serverProcess || !fs.existsSync(ENV_PATH)) return new Set();
  const { parseEnvFile } = await importScript('env-template.mjs');
  const current = parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8'));
  return new Set([current.port, current.ingestPort]);
}

async function checkPortForSetup(checks, port) {
  if ((await ownPorts()).has(port)) return { ok: true };
  return checks.checkPort(port);
}

// ---- IPC for the setup page -------------------------------------------------------------------

// Network checks run here, in the main process, so API keys never reach the page's own
// JavaScript beyond the password inputs.
const loadSetupChecks = () => importScript('setup-checks.mjs');

ipcMain.handle('setup:checkOllama', async (_event, url) => (await loadSetupChecks()).checkOllama(String(url ?? '')));
ipcMain.handle('setup:checkDeepseek', async (_event, apiKey) => (await loadSetupChecks()).checkDeepSeek(String(apiKey ?? ''), process.env.ORCH_DEEPSEEK_API_URL || undefined));
ipcMain.handle('setup:checkAnthropic', async (_event, apiKey) => (await loadSetupChecks()).checkAnthropic(String(apiKey ?? ''), process.env.ORCH_ANTHROPIC_API_URL || undefined));
ipcMain.handle('setup:checkPort', async (_event, port) => checkPortForSetup(await loadSetupChecks(), Number(port)));

ipcMain.handle('setup:constants', async () => {
  const { LEVEL_CHOICES, POLL_INTERVALS } = await loadSetupChecks();
  return { LEVEL_CHOICES, POLL_INTERVALS };
});

ipcMain.handle('app:openSettings', () => openSetup(fs.existsSync(ENV_PATH) ? 'settings' : 'first'));

/** The current settings, for the settings screen to start from; null before onboarding. */
ipcMain.handle('setup:current', async () => {
  if (!fs.existsSync(ENV_PATH)) return null;
  const { parseEnvFile } = await importScript('env-template.mjs');
  return parseEnvFile(fs.readFileSync(ENV_PATH, 'utf8'));
});

ipcMain.handle('setup:pickFolder', async () => {
  const options = { title: 'Choose the Code Akos data folder', properties: ['openDirectory', 'createDirectory'] };
  const parent = BrowserWindow.getFocusedWindow() ?? setupWindow;
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

// Errors are thrown as JSON of the {field: message} map so the page can show each one under its field.
// Electron prefixes thrown errors in the renderer; the page strips that prefix.
ipcMain.handle('setup:save', async (_event, values) => {
  const { buildEnvFile } = await importScript('env-template.mjs');
  const checks = await loadSetupChecks();

  const { errors = {} } = (await checks.validateValues(values)) ?? {};
  if (Object.keys(errors).length > 0) throw new Error(JSON.stringify(errors));

  // The page checked the ports a while ago; something may have taken one since. Writing .env and
  // then failing to listen would leave a broken setup behind, so check again right before writing.
  const busy = {};
  for (const key of ['port', 'ingestPort']) {
    const result = await checkPortForSetup(checks, Number(values[key]));
    if (!result.ok) busy[key] = `${result.error || 'This port is not available'}. Pick a different port.`;
  }
  if (Object.keys(busy).length > 0) throw new Error(JSON.stringify(busy));

  const envText = buildEnvFile(values);
  const server = await checks.validateWithServer(envText, ROOT);
  if (!server.ok) {
    const problems = server.problems?.length ? server.problems : ['These settings did not pass the server checks.'];
    throw new Error(problems.join('\n'));
  }

  await applySettings(envText);
  setupWindow?.close();
});

// ---- Menu -------------------------------------------------------------------------------------

function buildMenu() {
  const settings = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSetup(fs.existsSync(ENV_PATH) ? 'settings' : 'first') };
  const template = [
    ...(process.platform === 'darwin'
      ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, settings, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
      : [{ label: 'File', submenu: [settings, { type: 'separator' }, { role: 'quit' }] }]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Brings settings saved by an older build over to ENV_PATH, once: from the FixFlow user-data folder
 * (before the rename), or from inside the app (before 1.1.0). The window size comes along when there is one.
 */
function migrateLegacyEnv() {
  if (ENV_PATH === LEGACY_ENV_PATH || fs.existsSync(ENV_PATH)) return;
  const fromRename = path.join(PRE_RENAME_DIR, '.env');
  const source = [fromRename, LEGACY_ENV_PATH].find((file) => fs.existsSync(file));
  if (!source) return;
  try {
    fs.mkdirSync(ENV_DIR, { recursive: true });
    fs.copyFileSync(source, ENV_PATH);
    const oldState = path.join(PRE_RENAME_DIR, 'window-state.json');
    if (source === fromRename && fs.existsSync(oldState) && !fs.existsSync(stateFile())) fs.copyFileSync(oldState, stateFile());
  } catch {
    // The setup runs again instead, which is what a first launch looks like anyway.
  }
}

app.whenReady().then(() => {
  migrateLegacyEnv();
  buildMenu();
  if (fs.existsSync(ENV_PATH)) {
    void launchDashboard();
  } else {
    openSetup('first');
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => serverProcess?.kill());
