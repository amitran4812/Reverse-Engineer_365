'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();
ipcRenderer.on('claude:event', (e, evt) => {
  listeners.get(evt.id)?.(evt);
  if (evt.type === 'done' || evt.type === 'error') listeners.delete(evt.id);
});

let saveAndClose = null;
ipcRenderer.on('app:save-and-close', () => saveAndClose?.());

contextBridge.exposeInMainWorld('office', {
  launchInfo: () => ipcRenderer.invoke('app:launch-info'),
  newWindow: (app) => ipcRenderer.invoke('app:new', app),
  home: () => ipcRenderer.invoke('app:home'),
  openDialog: (app) => ipcRenderer.invoke('app:open-dialog', app),
  openPath: (file) => ipcRenderer.invoke('app:open-path', file),
  save: (req) => ipcRenderer.invoke('app:save', req),
  exportPdf: (opts) => ipcRenderer.invoke('app:export-pdf', opts || {}),
  print: () => ipcRenderer.invoke('app:print'),
  setDirty: (d) => ipcRenderer.invoke('app:set-dirty', !!d),
  setTitle: (t) => ipcRenderer.invoke('app:set-title', String(t)),
  close: () => ipcRenderer.invoke('app:close'),
  fullscreen: (on) => ipcRenderer.invoke('app:fullscreen', on),
  recent: () => ipcRenderer.invoke('app:recent'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  onSaveAndClose: (fn) => {
    saveAndClose = fn;
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  claude: {
    // Streams a response. onEvent receives {type:'text'|'done'|'error', ...}.
    stream: (id, payload, onEvent) => {
      listeners.set(id, onEvent);
      ipcRenderer.send('claude:start', { id, payload });
    },
    cancel: (id) => ipcRenderer.send('claude:cancel', id),
    verify: (key) => ipcRenderer.invoke('claude:verify', key),
  },
});
