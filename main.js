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

// ---- impresión: caché de impresoras y ventana de impresión persistente ----
let cachedPrinters = [], printersBusy = null;
let printWorker = null, printWorkerReady = null, printQueue = Promise.resolve();
function refreshPrinters() {
  if (printersBusy) return printersBusy;
  if (!win || win.isDestroyed()) return Promise.resolve(cachedPrinters);
  printersBusy = win.webContents.getPrintersAsync()
    .then(list => (cachedPrinters = list.map(p => ({ name: p.name, displayName: p.displayName || p.name, status: p.status, isDefault: !!p.isDefault }))))
    .catch(() => cachedPrinters)
    .finally(() => { printersBusy = null; });
  return printersBusy;
}
function getPrintWorker() {
  if (printWorker && !printWorker.isDestroyed()) return printWorkerReady;
  const w = printWorker = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  printWorkerReady = new Promise(res => w.webContents.ipc.once('print-window-ready', () => res(w)));
  w.webContents.on('render-process-gone', () => { if (!w.isDestroyed()) w.destroy(); });
  w.on('closed', () => { if (printWorker === w) printWorker = null; });
  w.loadURL('app://pliego/index.html#print');
  return printWorkerReady;
}
function printJob(o) {
  return new Promise(resolve => {
    let done = false, w = null;
    const finish = r => {
      if (done) return; done = true; clearTimeout(timer);
      if (w && !w.isDestroyed()) { w.removeListener('closed', onClosed); w.webContents.ipc.removeListener('print-rendered', onRendered); }
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, why: 'La impresora no respondió a tiempo.' }), 180000);
    const onClosed = () => finish({ ok: false, why: 'La ventana de impresión se cerró.' });
    const onRendered = () => {
      const opts = {
        silent: true, printBackground: true, margins: { marginType: 'none' },
        copies: Math.max(1, o.copies | 0 || 1), collate: o.collate !== false,
        landscape: !!o.landscape, color: o.color !== false, duplexMode: o.duplexMode || 'simplex'
      };
      if (o.deviceName) opts.deviceName = o.deviceName;
      if (o.pageSize) opts.pageSize = o.pageSize;
      if (o.paperTray != null && o.paperTray !== '') opts.paperTray = o.paperTray;
      try { w.webContents.print(opts, (ok, why) => finish({ ok, why: why || '' })); }
      catch (e) { finish({ ok: false, why: e.message }); }
    };
    // el rango se resuelve al dibujar: la ventana solo prepara las páginas pedidas, sin copiar el PDF
    const pages = Array.isArray(o.pageRanges) ? o.pageRanges.flatMap(r => Array.from({ length: Math.max(0, r.to - r.from + 1) }, (_, k) => r.from + k)) : null;
    const layout = { mode: o.scaleMode || 'fit', scale: o.scaleFactor || 100, gray: o.color === false, pages };
    getPrintWorker().then(pw => {
      if (done) return;
      w = pw; w.once('closed', onClosed); w.webContents.ipc.once('print-rendered', onRendered);
      w.webContents.send('print-job', o.pdfBuffer, layout);
    });
  });
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
  win.on('closed', () => { win = null; rendererReady = false; if (printWorker && !printWorker.isDestroyed()) printWorker.destroy(); });
  win.webContents.once('did-finish-load', () => { refreshPrinters(); setTimeout(getPrintWorker, 1500); });
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

  // guardar como PDF desde el diálogo de impresión, sin pasar por ningún driver de impresora
  ipcMain.handle('pliego:save-pdf-file', async (_e, { buffer, bytes, defaultName }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Guardar PDF escalado', defaultPath: path.join(lastDir, defaultName || 'documento.pdf'), filters: [{ name: 'Documento PDF (*.pdf)', extensions: ['pdf'] }] });
    if (canceled || !filePath) return { success: false };
    await fs.promises.writeFile(filePath, Buffer.from(buffer || bytes));
    lastDir = path.dirname(filePath);
    return { success: true, filePath };
  });

  ipcMain.handle('write-file', async (_e, { path: p, data }) => {
    await fs.promises.writeFile(p, Buffer.from(data));
    return true;
  });

  // impresoras: lista en memoria, se actualiza en segundo plano y nunca bloquea el diálogo
  ipcMain.handle('pliego:get-printers', async (_e, refresh) => {
    if (!cachedPrinters.length) return (await refreshPrinters()) || [];
    if (refresh) refreshPrinters();
    return cachedPrinters;
  });

  // impresión directa: una sola ventana oculta (modo #print) que se reutiliza; las órdenes van en fila
  ipcMain.handle('pliego:silent-print', (_e, o = {}) => (printQueue = printQueue.then(() => printJob(o))));

  ipcMain.handle('reveal', (_e, p) => { shell.showItemInFolder(p); return true; });

  createWindow();
  setInterval(refreshPrinters, 60000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
