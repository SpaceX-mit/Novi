const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

let serverProcess;
let mainWindow;
let port = Number(process.env.NOVI_PORT || 0);

if (process.env.NOVI_DESKTOP_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.NOVI_DESKTOP_USER_DATA_DIR));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const selected = probe.address().port; probe.close((error) => error ? reject(error) : resolve(selected)); });
  });
}

function waitForServer(url, attempts = 50) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, (response) => { response.resume(); if (response.statusCode === 200) resolve(); else if (attempts-- > 0) setTimeout(check, 100); else reject(new Error(`Novi server returned ${response.statusCode}`)); });
      request.on('error', () => { if (attempts-- > 0) setTimeout(check, 100); else reject(new Error('Novi server did not start')); });
    };
    check();
  });
}

async function createWindow() {
  if (!hasSingleInstanceLock) return;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) port = await freePort();
  const dataFile = process.env.NOVI_DATA_FILE || path.join(app.getPath('userData'), 'novi.json');
  const releaseBuild = app.isPackaged || process.env.NOVI_RELEASE_BUILD === 'true';
  // Electron's executable needs this flag when reused as the Node runtime.
  serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server.mjs')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NOVI_RELEASE_BUILD: String(releaseBuild), PORT: String(port), HOST: '127.0.0.1', NOVI_DATA_FILE: dataFile }, stdio: 'inherit' });
  await waitForServer(`http://127.0.0.1:${port}/api/health`);
  mainWindow = new BrowserWindow({ width: 1360, height: 900, minWidth: 900, minHeight: 640, title: 'Novi', backgroundColor: '#f7f8fa', webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { try { const parsed = new URL(url); if (['http:', 'https:'].includes(parsed.protocol)) shell.openExternal(parsed.toString()); } catch {} return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    try {
      const destination = new URL(target);
      // Same-origin application routes and HTTPS identity-provider redirects are
      // allowed; arbitrary HTTP and non-web protocols never load in the window.
      if (destination.origin !== `http://127.0.0.1:${port}` && destination.protocol !== 'https:') event.preventDefault();
    } catch { event.preventDefault(); }
  });
  if (process.env.NOVI_DESKTOP_SMOKE === 'true') {
    const result = await mainWindow.webContents.executeJavaScript(`fetch('/api/billing').then((response) => response.json()).then((billing) => ({ title: document.title, ready: Boolean(document.querySelector('#new-project') && document.querySelector('#source-search')), monthlyGenerations: billing.limits.monthlyGenerations }))`);
    const expectedMonthlyGenerations = releaseBuild ? 100 : 1000;
    if (!result.ready || !String(result.title).includes('Novi') || result.monthlyGenerations !== expectedMonthlyGenerations) throw new Error('Novi desktop DOM or quota smoke failed');
    console.log('desktop-smoke: Electron service, secure window and shared UI loaded');
    mainWindow.close(); app.quit();
  }
}

app.whenReady().then(createWindow).catch((error) => { console.error(error); app.quit(); });
app.on('window-all-closed', () => { if (serverProcess) serverProcess.kill(); app.quit(); });
app.on('before-quit', () => { if (serverProcess) serverProcess.kill(); });
