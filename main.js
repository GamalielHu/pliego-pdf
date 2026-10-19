// Pliego · Editor PDF — programa de escritorio (Electron)
const { app, BrowserWindow, protocol, net, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const WWW = path.join(__dirname, 'www');
let win = null;
let rendererReady = false;
let pending = [];          // archivos recibidos antes de que la ventana esté lista
let lastDir = app.getPath('documents');

// protocolo propio: la app se sirve como app://pliego/… (permite workers, wasm y fetch sin internet)
protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

// una sola ventana: abrir un PDF con doble clic lo manda a la ventana existente
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    sendFiles(pdfArgs(argv));
  });
}

function pdfArgs(argv) {
  return argv.slice(1).filter(a => /\.(pdf|png|jpe?g|webp|gif|bmp)$/i.test(a) && fs.existsSync(a));
}
function readFiles(paths) {
  return paths.map(p => ({ name: path.basename(p), path: p, data: fs.readFileSync(p) }));
}
function sendFiles(paths) {
  if (!paths.length) return;
  if (win && rendererReady) win.webContents.send('open-files', readFiles(paths));
  else pending.push(...paths);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 900, minWidth: 720, minHeight: 520,
    title: 'Pliego · Editor PDF',
    backgroundColor: '#e4e2de',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadURL('app://pliego/index.html');

  // enlaces externos se abren en el navegador
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  // cambios sin guardar al cerrar
  win.webContents.on('will-prevent-unload', e => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Salir sin guardar', 'Cancelar'], defaultId: 1, cancelId: 1,
      title: 'Cambios sin guardar', message: 'Tienes cambios sin guardar.', detail: 'Si sales ahora se perderán. Usa Guardar (Ctrl+S) para conservarlos.'
    });
    if (r === 0) e.preventDefault();
  });

  // F12 abre las herramientas de diagnóstico, Ctrl+R recarga
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  win.on('closed', () => { win = null; rendererReady = false; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (!p || p === '/') p = '/index.html';
    const file = path.normalize(path.join(WWW, p));
    if (!file.startsWith(WWW)) return new Response('Prohibido', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  ipcMain.on('renderer-ready', () => {
    rendererReady = true;
    const first = pdfArgs(process.argv);
    const all = [...first, ...pending]; pending = [];
    if (all.length) win.webContents.send('open-files', readFiles([...new Set(all)]));
  });

  ipcMain.handle('open-dialog', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Abrir PDF o imágenes', defaultPath: lastDir,
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF e imágenes', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }, { name: 'Todos los archivos', extensions: ['*'] }]
    });
    if (r.canceled || !r.filePaths.length) return [];
    lastDir = path.dirname(r.filePaths[0]);
    return readFiles(r.filePaths);
  });

  ipcMain.handle('save-file', async (_e, { name, data, filters }) => {
    const r = await dialog.showSaveDialog(win, { title: 'Guardar como', defaultPath: path.join(lastDir, name), filters });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.writeFile(r.filePath, Buffer.from(data));
    lastDir = path.dirname(r.filePath);
    return r.filePath;
  });

  ipcMain.handle('write-file', async (_e, { path: p, data }) => {
    await fs.promises.writeFile(p, Buffer.from(data));
    return true;
  });

  ipcMain.handle('reveal', (_e, p) => { shell.showItemInFolder(p); return true; });

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
