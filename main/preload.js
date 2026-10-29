'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  newWith: (spec) => ipcRenderer.invoke('app:new-with', spec),
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (name) => ipcRenderer.invoke('accounts:add', name),
    rename: (id, name) => ipcRenderer.invoke('accounts:rename', id, name),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    open: (id) => ipcRenderer.invoke('accounts:open', id),
  },
  onSaveAndClose: (fn) => {
    saveAndClose = fn;
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    connect: (id) => ipcRenderer.invoke('cloud:connect', id),
    disconnect: (id) => ipcRenderer.invoke('cloud:disconnect', id),
    list: (id, opts) => ipcRenderer.invoke('cloud:list', id, opts),
    open: (id, file) => ipcRenderer.invoke('cloud:open', id, file),
    saveNew: (req) => ipcRenderer.invoke('cloud:save-new', req),
    sheet: (local, op, args) => ipcRenderer.invoke('cloud:sheet', local, op, args),
    share: (local, op, args) => ipcRenderer.invoke('cloud:share', local, op, args),
  },
  claude: {
    // Streams a response. onEvent receives {type:'text'|'done'|'error', ...}.
    stream: (id, payload, onEvent) => {
      listeners.set(id, onEvent);
      ipcRenderer.send('claude:start', { id, payload });
    },
    cancel: (id) => ipcRenderer.send('claude:cancel', id),
    verify: (key) => ipcRenderer.invoke('claude:verify', key),
    models: (provider, key) => ipcRenderer.invoke('ai:models', provider, key),
    attach: () => ipcRenderer.invoke('claude:attach-dialog'),
    // Dropped File objects: the path is only readable here in the preload.
    attachFiles: (files) => ipcRenderer.invoke('claude:attach-paths', [...files].map((f) => webUtils.getPathForFile(f))),
  },
});
