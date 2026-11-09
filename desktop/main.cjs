const { app, BrowserWindow, dialog, ipcMain, screen, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { LibraryStore } = require('./library.cjs');

app.setName('Folio Reader');
let window, store, boundsTimer, closing = false;
const entry = path.join(__dirname, 'ui', 'index.html');
const entryURL = pathToFileURL(entry).href;

function trustedSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== entryURL) throw new Error('Untrusted request.');
}
function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => { trustedSender(event); return operation(...args); });
}

function restoredBounds(saved) {
  const area = saved ? screen.getDisplayMatching(saved).workArea : screen.getPrimaryDisplay().workArea;
  const width = Math.min(area.width, Math.max(360, saved?.width || 820));
  const height = Math.min(area.height, Math.max(360, saved?.height || 720));
  const x = Math.max(area.x, Math.min(saved?.x ?? Math.round(area.x + (area.width - width) / 2), area.x + area.width - width));
  const y = Math.max(area.y, Math.min(saved?.y ?? Math.round(area.y + (area.height - height) / 2), area.y + area.height - height));
  return { x, y, width, height };
}

function rememberBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (window && !window.isDestroyed() && !window.isMinimized()) store.setWindowBounds(window.getNormalBounds()).catch(error => console.error('Unable to save window size:', error.message));
  }, 300);
}

async function createWindow() {
  window = new BrowserWindow({
    ...restoredBounds(store.getWindowBounds()), minWidth: 360, minHeight: 360,
    resizable: true, title: 'Folio Reader', backgroundColor: '#f5f6f8',
    show: false, alwaysOnTop: store.snapshot().alwaysOnTop,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== entryURL) event.preventDefault(); });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.on('resize', rememberBounds);
  window.on('move', rememberBounds);
  window.on('close', event => {
    if (closing) return;
    event.preventDefault(); closing = true; clearTimeout(boundsTimer);
    store.setWindowBounds(window.getNormalBounds()).then(() => store.flush()).catch(error => console.error('Unable to save window size:', error.message)).finally(() => window.destroy());
  });
  window.on('closed', () => { window = null; });
  await window.loadFile(entry);
  window.show();
  if (store.recoveryNotice) {
    dialog.showMessageBox(window, { type: 'warning', title: 'Library recovery', message: store.recoveryNotice });
    store.recoveryNotice = null;
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    store = await LibraryStore.open(app.getPath('userData'));
    Menu.setApplicationMenu(null);
    handle('reader:get-library', () => store.snapshot());
    handle('reader:import-books', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Import PDF books', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
      return result.canceled ? { library: store.snapshot(), importedIds: [], errors: [] } : store.importBooks(result.filePaths);
    });
    handle('reader:read-book', id => store.readBook(id));
    handle('reader:save-progress', progress => store.saveProgress(progress));
    handle('reader:remove-book', async id => {
      const book = store.requireBook(id);
      const result = await dialog.showMessageBox(window, { type: 'question', title: 'Remove book', message: `Remove “${book.title}” from this library?`, detail: 'The imported copy and its reading progress will be deleted. Your original PDF will stay where it is.', buttons: ['Keep book', 'Remove book'], defaultId: 0, cancelId: 0, noLink: true });
      return result.response === 1 ? store.removeBook(id) : store.snapshot();
    });
    handle('reader:set-always-on-top', async value => { await store.setAlwaysOnTop(value); window.setAlwaysOnTop(value); return value; });
    await createWindow();
  }).catch(error => { dialog.showErrorBox('Folio Reader could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
