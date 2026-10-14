const { app, BrowserWindow, ipcMain, dialog, session, shell, safeStorage, Menu } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { createController } = require('./controller.cjs');

app.setName('GIDEON');
app.setPath('userData', path.join(app.getPath('appData'), 'GIDEON'));
const instance = app.requestSingleInstanceLock();
if (!instance) app.quit();
let setupWindow, panelWindow, controller, quitting = false, microphoneConsent = false;
const runtimeRoot = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.resolve(__dirname, '..');
const nodePath = app.isPackaged ? path.join(process.resourcesPath, 'node', 'node.exe')
  : process.env.GIDEON_DESKTOP_NODE || spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout?.trim();
const stateDir = path.join(app.getPath('userData'), 'state');
const indexPath = path.join(__dirname, 'ui', 'index.html');
let panelOrigin;

function secureStoreAvailable() {
  return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
}

function setup() {
  setupWindow = new BrowserWindow({
    title: 'GIDEON', width: 1040, height: 790, minWidth: 720, minHeight: 620,
    backgroundColor: '#081421', icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false, autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setupWindow.webContents.on('will-navigate', event => event.preventDefault());
  setupWindow.on('close', event => {
    if (!quitting && panelWindow && !panelWindow.isDestroyed()) { event.preventDefault(); setupWindow.hide(); panelWindow.show(); }
  });
  setupWindow.on('closed', () => { setupWindow = undefined; });
  void setupWindow.loadFile(indexPath);
}

function authorized(event) {
  if (!setupWindow || event.sender !== setupWindow.webContents || !event.senderFrame) throw new Error('Bu pencere GIDEON ayarlarına erişemez.');
  try {
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== 'file:' || path.resolve(fileURLToPath(url)) !== path.resolve(indexPath)) throw new Error();
  } catch { throw new Error('GIDEON ayar penceresi doğrulanamadı.'); }
}

function isPanelUrl(raw) {
  try { return new URL(raw).origin === panelOrigin; } catch { return false; }
}

async function openPanel() {
  if (!controller?.getStatus().gatewayReady) throw new Error('GIDEON hazırlanıyor; kısa bir süre bekleyin.');
  if (panelWindow && !panelWindow.isDestroyed()) { panelWindow.show(); panelWindow.focus(); return; }
  const config = JSON.parse(await readFile(path.join(stateDir, 'openclaw.json'), 'utf8'));
  const port = config.gateway?.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || config.gateway?.bind !== 'loopback' || config.gateway?.auth?.mode !== 'token') {
    throw new Error('Yerel GIDEON bağlantısı doğrulanamadı.');
  }
  panelOrigin = `http://127.0.0.1:${port}`;
  const panelSession = session.fromPartition('persist:gideon-panel');
  panelSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) =>
    permission === 'media' && microphoneConsent && isPanelUrl(requestingOrigin) && details.mediaType !== 'video');
  panelSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
    const audioOnly = Array.isArray(details.mediaTypes) && details.mediaTypes.length > 0 && details.mediaTypes.every(t => t === 'audio');
    if (!panelWindow || webContents !== panelWindow.webContents || permission !== 'media' || !audioOnly || !isPanelUrl(details.requestingUrl || webContents.getURL())) {
      callback(false); return;
    }
    const answer = await dialog.showMessageBox(panelWindow, { type: 'question', title: 'GIDEON mikrofon izni', message: 'Sesli görüşme için mikrofonunu kullanabilir miyim?', detail: 'Görüşme açıkken sesiniz seçtiğiniz Google sağlayıcısına gönderilir. Kameraya izin verilmez.', buttons: ['İzin ver', 'Reddet'], defaultId: 1, cancelId: 1 });
    microphoneConsent = answer.response === 0; callback(microphoneConsent);
  });
  panelWindow = new BrowserWindow({
    title: 'GIDEON', width: 1400, height: 960, minWidth: 900, minHeight: 650,
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#081421', show: false, autoHideMenuBar: false,
    webPreferences: { partition: 'persist:gideon-panel', contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  panelWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  panelWindow.webContents.on('will-navigate', (event, url) => { if (!isPanelUrl(url)) event.preventDefault(); });
  panelWindow.webContents.on('did-fail-load', () => { if (setupWindow && !setupWindow.isDestroyed()) setupWindow.show(); });
  panelWindow.once('ready-to-show', () => { panelWindow?.show(); setupWindow?.hide(); });
  panelWindow.on('closed', () => { panelWindow = undefined; microphoneConsent = false; app.quit(); });
  // Token stays in the isolated official panel; it is never sent through setup IPC.
  await panelWindow.loadURL(`${panelOrigin}/#token=${encodeURIComponent(config.gateway.auth.token)}`);
}

function closePanel() {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.removeAllListeners('closed'); panelWindow.destroy(); panelWindow = undefined;
    microphoneConsent = false;
  }
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.show();
}

if (instance) {
  app.on('second-instance', () => {
    const window = panelWindow || setupWindow;
    if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'GIDEON', submenu: [
        { label: 'Sohbeti aç', click: () => { void openPanel().catch(() => setupWindow?.show()); } },
        { label: 'Bağlantı ayarları', accelerator: 'CmdOrCtrl+,', click: () => { if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.show(); setupWindow.focus(); } } },
        { type: 'separator' }, { label: 'Kapat', role: 'quit' },
      ] },
      { label: 'Düzenle', submenu: [{ role: 'undo', label: 'Geri al' }, { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' }, { role: 'selectAll', label: 'Tümünü seç' }] },
    ]));
    setup();
    controller = createController({
      stateDir, nodePath, runtimeRoot,
      secureStore: { available: secureStoreAvailable, encrypt: value => safeStorage.encryptString(value), decrypt: buffer => safeStorage.decryptString(buffer) },
      onStatus: status => { if (setupWindow && !setupWindow.isDestroyed()) setupWindow.webContents.send('gideon:status-changed', status); },
    });
    const actions = {
      'gideon:status': () => controller.getStatus(),
      'gideon:save-key': async key => { closePanel(); return controller.saveKey(key); },
      'gideon:start': () => controller.start(),
      'gideon:stop': async () => { closePanel(); return controller.stop(); },
      'gideon:forget-key': async () => { closePanel(); return controller.forgetKey(); },
      'gideon:open-panel': () => openPanel(),
      'gideon:key-page': () => shell.openExternal('https://aistudio.google.com/api-keys'),
    };
    for (const [name, action] of Object.entries(actions)) ipcMain.handle(name, async (event, ...args) => {
      authorized(event);
      try { return await action(...args); } catch { throw new Error('Bu işlem tamamlanamadı. GIDEON penceresindeki durumu kontrol edip yeniden deneyin.'); }
    });
    const status = await controller.initialize();
    if (status.hasKey) {
      const ready = await controller.start();
      if (ready.gatewayReady) await openPanel();
    }
  }).catch(async () => {
    await dialog.showMessageBox({ type: 'error', title: 'GIDEON', message: 'GIDEON başlatılamadı.', detail: 'Programı kapatıp yeniden açın. Sorun sürerse hata durumunu paylaşın; bağlantı anahtarınızı paylaşmayın.' });
    app.quit();
  });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    Promise.resolve(controller?.stop()).finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
