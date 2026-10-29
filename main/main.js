'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const settings = require('./settings');
const claude = require('./claude');
const formats = require('./formats');

const ACCENT = { home: '#3b4a6b', docs: '#2f5aa8', sheets: '#1b7a4b', slides: '#c2532d' };
const TITLES = { home: 'Rea Office', docs: 'Rea Docs', sheets: 'Rea Sheets', slides: 'Rea Slides' };
const DIST = path.join(__dirname, '..', 'dist');

const launches = new Map(); // webContents id -> { app, file }
const dirty = new Set(); // webContents ids with unsaved changes

function openWindow(appName, file = null) {
  const win = new BrowserWindow({
    width: appName === 'home' ? 1060 : 1360,
    height: appName === 'home' ? 720 : 880,
    minWidth: 820,
    minHeight: 560,
    title: TITLES[appName],
    backgroundColor: '#f3f4f7',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: ACCENT[appName], symbolColor: '#ffffff', height: 40 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  launches.set(win.webContents.id, { app: appName, file });
  const id = win.webContents.id;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    launches.delete(id);
    dirty.delete(id);
  });
  win.on('close', (e) => {
    if (!dirty.has(id)) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Do you want to save your changes?',
      detail: 'Your changes will be lost if you don’t save them.',
    });
    if (choice === 0) win.webContents.send('app:save-and-close');
    if (choice === 1) {
      dirty.delete(id);
      win.close();
    }
  });
  // Links in documents open in the system browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  win.loadFile(path.join(DIST, `${appName}.html`));
  return win;
}

async function openPath(file, fromWin) {
  const appName = formats.appForFile(file);
  if (!appName) {
    dialog.showErrorBox('Can’t open file', `Rea Office doesn't know how to open ${path.basename(file)}.`);
    return;
  }
  try {
    const info = await formats.openFile(file);
    settings.addRecent(appName, file);
    // Reuse an empty home window; otherwise open a new one.
    if (fromWin && launches.get(fromWin.webContents.id)?.app === 'home') {
      openWindow(appName, info);
      fromWin.close();
    } else {
      openWindow(appName, info);
    }
  } catch (err) {
    dialog.showErrorBox('Can’t open file', String(err.message || err));
  }
}

function senderWin(e) {
  return BrowserWindow.fromWebContents(e.sender);
}

ipcMain.handle('app:launch-info', (e) => ({
  ...(launches.get(e.sender.id) || { app: 'home', file: null }),
  platform: process.platform,
  version: app.getVersion(),
}));

ipcMain.handle('app:new', (e, appName) => {
  openWindow(appName);
});

ipcMain.handle('app:home', () => {
  openWindow('home');
});

ipcMain.handle('app:open-dialog', async (e, appName) => {
  const win = senderWin(e);
  const exts = appName && formats.APPS[appName] ? formats.APPS[appName].open : Object.values(formats.APPS).flatMap((a) => a.open);
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: exts }, { name: 'All files', extensions: ['*'] }],
  });
  for (const file of res.filePaths) await openPath(file, win);
});

ipcMain.handle('app:open-path', (e, file) => openPath(file, senderWin(e)));

ipcMain.handle('app:save', async (e, { app: appName, payload, path: current, saveAs, suggestedName }) => {
  const win = senderWin(e);
  let file = saveAs ? null : current;
  if (!file) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: current || suggestedName || 'Untitled',
      filters: formats.APPS[appName].save,
    });
    if (res.canceled || !res.filePath) return null;
    file = res.filePath;
    if (!path.extname(file)) file += `.${formats.APPS[appName].save[0].extensions[0]}`;
  }
  try {
    const saved = await formats.saveFile(appName, file, payload);
    const exported = appName === 'slides' && saved.ext === 'pptx';
    if (!exported) settings.addRecent(appName, file);
    return { ...saved, exported };
  } catch (err) {
    dialog.showErrorBox('Couldn’t save', String(err.message || err));
    return null;
  }
});

ipcMain.handle('app:export-pdf', async (e, { suggestedName, landscape, pageSize }) => {
  const win = senderWin(e);
  const res = await dialog.showSaveDialog(win, {
    defaultPath: `${suggestedName || 'Untitled'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    landscape: !!landscape,
    pageSize: pageSize || 'Letter',
    margins: pageSize ? { marginType: 'none' } : undefined,
  });
  await require('fs/promises').writeFile(res.filePath, pdf);
  shell.openPath(res.filePath);
  return res.filePath;
});

ipcMain.handle('app:print', (e) => {
  senderWin(e).webContents.print({ printBackground: true });
});

ipcMain.handle('app:set-dirty', (e, isDirty) => {
  if (isDirty) dirty.add(e.sender.id);
  else dirty.delete(e.sender.id);
  senderWin(e)?.setDocumentEdited?.(isDirty);
});

ipcMain.handle('app:set-title', (e, title) => {
  senderWin(e)?.setTitle(title);
});

ipcMain.handle('app:close', (e) => {
  dirty.delete(e.sender.id);
  senderWin(e)?.close();
});

ipcMain.handle('app:fullscreen', (e, on) => {
  senderWin(e)?.setFullScreen(!!on);
});

ipcMain.handle('app:recent', () => settings.recent());
ipcMain.handle('app:open-external', (e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('settings:get', () => settings.publicSettings());
ipcMain.handle('settings:set', (e, patch) => settings.update(patch || {}));

ipcMain.on('claude:start', (e, { id, payload }) => {
  claude.start(e.sender, id, payload);
});
ipcMain.on('claude:cancel', (e, id) => claude.cancel(id));
ipcMain.handle('claude:verify', (e, key) => claude.verify(key));

function filesFromArgv(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && formats.appForFile(a));
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'New Document', accelerator: 'Cmd+Shift+D', click: () => openWindow('docs') },
        { label: 'New Spreadsheet', accelerator: 'Cmd+Shift+E', click: () => openWindow('sheets') },
        { label: 'New Presentation', accelerator: 'Cmd+Shift+P', click: () => openWindow('slides') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
}

const pending = [];
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (app.isReady()) openPath(file);
  else pending.push(file);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const files = filesFromArgv(argv);
    if (files.length) files.forEach((f) => openPath(f));
    else openWindow('home');
  });

  app.whenReady().then(() => {
    app.setAppUserModelId?.('tools.rea.office');
    buildMenu();
    const files = [...pending, ...filesFromArgv(process.argv)];
    const startApp = process.env.REA_OFFICE_START;
    if (files.length) files.forEach((f) => openPath(f));
    else openWindow(TITLES[startApp] ? startApp : 'home');
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) openWindow('home');
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
