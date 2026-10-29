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
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onChange: (fn) => ipcRenderer.on('updates:event', (e, s) => fn(s)),
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
  latex: {
    openFolder: (opts) => ipcRenderer.invoke('latex:open-folder', opts),
    list: () => ipcRenderer.invoke('latex:list'),
    sources: () => ipcRenderer.invoke('latex:sources'),
    read: (rel) => ipcRenderer.invoke('latex:read', rel),
    write: (rel, text) => ipcRenderer.invoke('latex:write', rel, text),
    create: (rel, opts) => ipcRenderer.invoke('latex:create', rel, opts),
    rename: (from, to) => ipcRenderer.invoke('latex:rename', from, to),
    remove: (rel) => ipcRenderer.invoke('latex:delete', rel),
    upload: (dir) => ipcRenderer.invoke('latex:upload', dir),
    importFiles: (files, dir) => ipcRenderer.invoke('latex:import-paths', [...files].map((f) => webUtils.getPathForFile(f)), dir),
    engines: () => ipcRenderer.invoke('latex:engines'),
    compile: (opts) => ipcRenderer.invoke('latex:compile', opts),
    stop: () => ipcRenderer.invoke('latex:stop'),
    reveal: (rel) => ipcRenderer.invoke('latex:reveal', rel),
    savePdf: (main) => ipcRenderer.invoke('latex:save-pdf', main),
    openPdf: (main) => ipcRenderer.invoke('latex:open-pdf-external', main),
  },
  data: {
    openDialog: () => ipcRenderer.invoke('data:open-dialog'),
    launch: () => ipcRenderer.invoke('data:launch'),
    fromFiles: (files) => ipcRenderer.invoke('data:from-paths', [...files].map((f) => webUtils.getPathForFile(f))),
    read: (handle, offset, length) => ipcRenderer.invoke('data:read', handle, offset, length),
    saveBytes: (req) => ipcRenderer.invoke('data:save-bytes', req),
    beginWrite: (req) => ipcRenderer.invoke('data:begin-write', req),
    write: (id, text) => ipcRenderer.invoke('data:write', id, text),
    endWrite: (id) => ipcRenderer.invoke('data:end-write', id),
    savePdf: (req) => ipcRenderer.invoke('data:save-pdf', req),
    saveProject: (req) => ipcRenderer.invoke('data:save-project', req),
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
