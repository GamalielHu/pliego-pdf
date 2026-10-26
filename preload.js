// Puente seguro entre la ventana del editor y el sistema (abrir y guardar archivos)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pliego', {
  desktop: true,
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  writeFile: (path, data) => ipcRenderer.invoke('write-file', { path, data }),
  reveal: (path) => ipcRenderer.invoke('reveal', path),
  onOpenFiles: (cb) => ipcRenderer.on('open-files', (_e, files) => cb(files)),
  ready: () => ipcRenderer.send('renderer-ready'),
  printPdf: (pdfBytes, printOptions) => ipcRenderer.invoke('pliego:print-pdf', pdfBytes, printOptions),
  onPrintJob: (cb) => ipcRenderer.once('print-job', (_e, bytes) => cb(bytes)),
  printWindowReady: () => ipcRenderer.send('print-window-ready'),
  printRendered: () => ipcRenderer.send('print-rendered')
});
