'use strict';

const path = require('path');
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } = require('electron');
const profiles = require('./profiles');

const account = profiles.init(); // before anything reads userData
const settings = require('./settings');
const claude = require('./claude');
const formats = require('./formats');
const cloud = require('./cloud');
const attachments = require('./attachments');
const generated = require('./generated');
const updates = require('./updates');
const latex = require('./latex');
const data = require('./data');

const ACCENT = { home: '#3b4a6b', docs: '#2f5aa8', sheets: '#1b7a4b', slides: '#c2532d' };
const TITLES = { home: 'Work', docs: 'Write', sheets: 'Plot', slides: 'Present' };
const DIST = path.join(__dirname, '..', 'dist');

const launches = new Map(); // webContents id -> { app, file }
const dirty = new Set(); // webContents ids with unsaved changes

const ICON = { home: 'work', docs: 'write', sheets: 'plot', slides: 'present' };
const iconFile = (appName) => path.join(app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '..', 'build', 'apps'), `${ICON[appName]}.ico`);
const aumid = (appName) => ['tools.rea.office', appName === 'home' ? null : appName, account.id === 'default' ? null : account.id].filter(Boolean).join('.');
const relaunchArgs = (appName) => [...(app.isPackaged ? [] : [`"${app.getAppPath()}"`]), `--rea-account=${account.id}`, ...(appName === 'home' ? [] : [`--rea-new=${appName}`])].join(' ');

// On Windows each app gets its own taskbar group and icon, matching the
// Write, Plot and Present shortcuts the installer makes.
function windowsIdentity(win, appName) {
  if (process.platform !== 'win32') return;
  win.setAppDetails({
    appId: aumid(appName),
    appIconPath: iconFile(appName),
    appIconIndex: 0,
    relaunchCommand: `"${process.execPath}" ${relaunchArgs(appName)}`,
    relaunchDisplayName: TITLES[appName],
  });
  win.setIcon(iconFile(appName));
}

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
  windowsIdentity(win, appName);
  launches.set(win.webContents.id, { app: appName, file });
  const id = win.webContents.id;
  win.once('ready-to-show', () => win.show());
  // A window that never paints would keep Work running with nothing on screen.
  const shown = setTimeout(() => !win.isDestroyed() && !win.isVisible() && win.show(), 8000);
  win.webContents.on('render-process-gone', () => {
    dirty.delete(id);
    if (!win.isDestroyed()) win.destroy();
  });
  win.webContents.on('unresponsive', () => {
    if (!win.isVisible()) win.destroy();
  });
  win.on('closed', () => {
    clearTimeout(shown);
    launches.delete(id);
    dirty.delete(id);
    data.closeOwner(id);
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
  win.loadFile(path.join(DIST, `${file?.latex ? 'latex' : appName}.html`));
  return win;
}

async function openPath(file, fromWin) {
  const appName = formats.appForFile(file);
  if (!appName) {
    dialog.showErrorBox('Can’t open file', `Work doesn't know how to open ${path.basename(file)}.`);
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
  account: profiles.active(),
}));

ipcMain.handle('app:new', (e, appName, opts) => {
  // Write can start as notes.
  openWindow(appName, appName === 'docs' && opts?.notes ? { path: null, name: 'Notes', notes: true, data: { html: '' } } : null);
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
    if (cloud.bindingFor(file)) {
      try {
        return { ...saved, exported, cloud: await cloud.uploadBack(file) };
      } catch (err) {
        dialog.showErrorBox('Couldn’t upload', `Your changes are saved on this computer, but uploading them failed: ${err.message || err}`);
        return null;
      }
    }
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
  let pdf;
  // The page margins take the window's grey background colour, so print on white.
  win.setBackgroundColor('#ffffff');
  try {
    pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: !!landscape,
      pageSize: pageSize || 'Letter',
      margins: pageSize ? { marginType: 'none' } : undefined,
    });
  } catch (err) {
    throw new Error(`Couldn’t make the PDF: ${err.message || err}`);
  } finally {
    win.setBackgroundColor('#f3f4f7');
  }
  try {
    await require('fs/promises').writeFile(res.filePath, pdf);
  } catch (err) {
    // Windows locks a PDF that's open in a viewer.
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw new Error(`Couldn’t save ${path.basename(res.filePath)}. If it’s open in a PDF viewer, close it and try again, or pick another name.`);
    throw new Error(`Couldn’t save the PDF: ${err.message || err}`);
  }
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
  const a = profiles.active();
  senderWin(e)?.setTitle(a.count > 1 ? `${title} (${a.name})` : title);
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

// Cloud drives. Errors go back to the renderer as { error } so it can show them inline.
const safe = (fn) => async (e, ...args) => {
  try {
    return await fn(e, ...args);
  } catch (err) {
    return { error: String(err.message || err) };
  }
};
// Plot's analysis workspace: data files by handle, exports.
ipcMain.handle('data:open-dialog', safe((e) => data.openDialog(senderWin(e), e.sender.id)));
ipcMain.handle('data:launch', safe((e, step) => {
  const a = launches.get(e.sender.id)?.file?.analysis;
  const file = Number.isInteger(step) ? a?.steps?.[step] : a?.path;
  return file ? data.register(e.sender.id, file) : null;
}));
ipcMain.handle('data:from-paths', safe((e, paths) => Promise.all((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p).slice(0, 1).map((p) => data.register(e.sender.id, p)))));
ipcMain.handle('data:read', (e, handle, offset, length) => data.read(e.sender.id, handle, offset, length));
ipcMain.handle('data:save-bytes', safe((e, req) => data.saveBytes(senderWin(e), req)));
ipcMain.handle('data:begin-write', safe((e, req) => data.beginWrite(senderWin(e), e.sender.id, req)));
ipcMain.handle('data:write', safe((e, id, text) => data.write(e.sender.id, id, String(text))));
ipcMain.handle('data:end-write', safe((e, id) => data.endWrite(e.sender.id, id)));
ipcMain.handle('data:save-pdf', safe((e, req) => data.savePdf(senderWin(e), req)));
ipcMain.handle('data:save-project', safe(async (e, req) => {
  const saved = await data.saveBytes(senderWin(e), { ...req, filters: [{ name: 'Plot analysis', extensions: ['workplot'] }] });
  if (saved) settings.addRecent('sheets', saved.path);
  return saved;
}));
ipcMain.handle('sheets:open-table', safe(async (e) => {
  const res = await dialog.showOpenDialog(senderWin(e), {
    title: 'Choose a file to combine',
    properties: ['openFile'],
    filters: [{ name: 'Spreadsheets', extensions: formats.TABLE_EXTS }, { name: 'All files', extensions: ['*'] }],
  });
  return res.canceled || !res.filePaths[0] ? null : formats.readTable(res.filePaths[0]);
}));
ipcMain.handle('cloud:status', () => cloud.status());
ipcMain.handle('cloud:connect', safe((e, id) => cloud.connect(id)));
ipcMain.handle('cloud:disconnect', safe((e, id) => cloud.disconnect(id)));
ipcMain.handle('cloud:list', safe((e, id, opts) => cloud.list(id, opts || {})));
ipcMain.handle('cloud:open', safe(async (e, id, file) => {
  const got = await cloud.download(id, file);
  const appName = formats.appForFile(got.path);
  if (!appName) throw new Error(`Work can't open ${file.name}.`);
  const info = await formats.openFile(got.path);
  info.cloud = { provider: id, label: got.label, native: got.native, live: got.native === 'Google Sheets' };
  const from = senderWin(e);
  openWindow(appName, info);
  if (from && launches.get(from.webContents.id)?.app === 'home') from.close();
  return { ok: true };
}));
ipcMain.handle('cloud:save-new', safe((e, { provider, folder, name, app: appName, payload }) =>
  cloud.saveNew(provider, { folder, name }, (local) => formats.saveFile(appName, local, payload))));
ipcMain.handle('cloud:share', safe((e, local, op, args) => cloud.share(local, op, args)));
ipcMain.handle('accounts:list', () => profiles.list());
ipcMain.handle('accounts:add', safe((e, name) => profiles.add(name)));
ipcMain.handle('accounts:rename', safe((e, id, name) => profiles.rename(id, name)));
ipcMain.handle('accounts:remove', safe((e, id) => profiles.remove(id)));
ipcMain.handle('accounts:open', safe((e, id) => profiles.open(id)));
ipcMain.handle('cloud:sheet', safe((e, local, op, args) => cloud.sheet(local, op, args)));

ipcMain.handle('settings:get', () => settings.publicSettings());
ipcMain.handle('settings:set', (e, patch) => {
  const out = settings.update(patch || {});
  if (typeof patch?.autoUpdate === 'boolean') updates.schedule();
  return out;
});
ipcMain.handle('updates:status', () => updates.status());
ipcMain.handle('updates:check', () => updates.check());
ipcMain.handle('updates:install', () => updates.install());

ipcMain.on('claude:start', (e, { id, payload }) => {
  claude.start(e.sender, id, payload);
});
ipcMain.on('claude:cancel', (e, id) => claude.cancel(id));
ipcMain.handle('claude:attach-dialog', async (e) => {
  const res = await dialog.showOpenDialog(senderWin(e), {
    title: 'Attach files for Claude',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Files Claude can read', extensions: attachments.EXTENSIONS }, { name: 'All files', extensions: ['*'] }],
  });
  return res.canceled ? [] : attachments.loadAll(res.filePaths);
});
ipcMain.handle('claude:attach-images', (e, list) => attachments.fromImages(list));
ipcMain.handle('claude:attach-paths', (e, paths) => attachments.loadAll((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && p).slice(0, 20)));
// Opens something Claude made in a new Write, Plot or Present window (unsaved).
ipcMain.handle('app:new-with', safe(async (e, spec) => {
  const info = await generated.toFileInfo(spec);
  openWindow(info.app, info);
  return { ok: true };
}));
// LaTeX projects. Every call works inside the folder this window opened.
function latexRoot(e) {
  const root = launches.get(e.sender.id)?.file?.latex?.root;
  if (!root) throw new Error('This window has no LaTeX project open.');
  return root;
}

async function openLatexFolder(win, { create = false } = {}) {
  const res = await dialog.showOpenDialog(win, {
    title: create ? 'Choose a folder for the new LaTeX project' : 'Open a LaTeX project folder',
    buttonLabel: create ? 'Create project here' : 'Open project',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  const root = res.filePaths[0];
  if (res.canceled || !root) return null;
  await require('fs/promises').mkdir(root, { recursive: true });
  await latex.scaffold(root);
  return openLatexProject(win, root);
}

async function openLatexProject(win, root) {
  const main = await latex.mainFile(root);
  if (main) settings.addRecent('docs', path.join(root, main));
  openWindow('docs', { app: 'docs', path: main ? path.join(root, main) : null, name: path.basename(root), ext: 'tex', latex: { root, main, open: main } });
  if (win && launches.get(win.webContents.id)?.app === 'home') win.close();
  return { ok: true };
}

ipcMain.handle('latex:open-folder', safe((e, opts) => openLatexFolder(senderWin(e), opts || {})));
const ZIP_FILTER = [{ name: 'Zipped LaTeX project', extensions: ['zip'] }];
async function pickZip(win, title) {
  const res = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters: ZIP_FILTER });
  return res.canceled ? null : res.filePaths[0];
}
const zipArg = (p) => (typeof p === 'string' && /\.zip$/i.test(p) ? p : null);
// A .zip of a whole project: unpacked next to the .zip, then opened like a folder.
ipcMain.handle('latex:open-zip', safe(async (e, zipPath) => {
  const src = zipArg(zipPath) || await pickZip(senderWin(e), 'Upload a LaTeX project (.zip)');
  if (!src) return null;
  const root = latex.zipFolder(src);
  try {
    const res = await latex.importZip(src, root);
    if (!res.added.some((p) => /\.tex$/i.test(p))) throw new Error('There are no .tex files in that .zip.');
  } catch (err) {
    await require('fs/promises').rm(root, { recursive: true, force: true });
    throw err;
  }
  return openLatexProject(senderWin(e), root);
}));
ipcMain.handle('latex:import-zip', safe(async (e, dir, zipPath) => {
  const src = zipArg(zipPath) || await pickZip(senderWin(e), 'Add the files in a .zip to this project');
  return src ? latex.importZip(src, latexRoot(e), dir) : { ok: true, added: [] };
}));
ipcMain.handle('latex:list', safe((e) => latex.list(latexRoot(e))));
ipcMain.handle('latex:sources', safe((e) => latex.sources(latexRoot(e))));
ipcMain.handle('latex:read', safe((e, rel) => latex.read(latexRoot(e), rel)));
ipcMain.handle('latex:write', safe((e, rel, text) => latex.write(latexRoot(e), rel, text)));
ipcMain.handle('latex:create', safe((e, rel, opts) => latex.create(latexRoot(e), rel, opts || {})));
ipcMain.handle('latex:rename', safe((e, from, to) => latex.rename(latexRoot(e), from, to)));
ipcMain.handle('latex:delete', safe(async (e, rel) => {
  const full = latex.inside(latexRoot(e), rel);
  if (full === latexRoot(e)) throw new Error('Can’t delete the project folder here.');
  await shell.trashItem(full);
  return { ok: true };
}));
ipcMain.handle('latex:import-paths', safe((e, paths, dir) => latex.importPaths(latexRoot(e), (Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string').slice(0, 100), dir)));
ipcMain.handle('latex:upload', safe(async (e, dir) => {
  const res = await dialog.showOpenDialog(senderWin(e), {
    title: 'Add files to the project',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'LaTeX project files', extensions: ['tex', 'bib', 'png', 'jpg', 'jpeg', 'pdf', 'eps', 'svg', 'sty', 'cls', 'bst', 'csv', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  return res.canceled ? { ok: true, added: [] } : latex.importPaths(latexRoot(e), res.filePaths, dir);
}));
ipcMain.handle('latex:engines', () => latex.engines());
ipcMain.handle('latex:compile', safe((e, opts) => latex.compile(latexRoot(e), opts || {})));
ipcMain.handle('latex:stop', safe((e) => latex.stop(latexRoot(e))));
ipcMain.handle('latex:reveal', safe((e, rel) => shell.showItemInFolder(latex.inside(latexRoot(e), rel || ''))));
ipcMain.handle('latex:save-pdf', safe(async (e, main) => {
  const pdf = await latex.lastPdf(latexRoot(e), main);
  if (!pdf) throw new Error('Compile the project first.');
  const res = await dialog.showSaveDialog(senderWin(e), {
    defaultPath: path.join(latexRoot(e), path.basename(pdf)),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await require('fs/promises').copyFile(pdf, res.filePath);
  return { ok: true, path: res.filePath, name: path.basename(res.filePath) };
}));
ipcMain.handle('latex:open-pdf-external', safe(async (e, main) => {
  const pdf = await latex.lastPdf(latexRoot(e), main);
  if (!pdf) throw new Error('Compile the project first.');
  await shell.openPath(pdf);
  return { ok: true };
}));

ipcMain.handle('notes:image', (e, prompt) => require('./ai').image(prompt));
ipcMain.handle('notes:fetch-link', (e, url) => require('./links').fetchLink(url));
ipcMain.handle('claude:verify', (e, key) => claude.verify(key));
ipcMain.handle('ai:models', (e, provider, key) => require('./ai').models(provider, key));
ipcMain.handle('chatgpt:sign-in', async () => {
  try {
    return { ok: true, ...(await require('./chatgpt').signIn()) };
  } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
});
ipcMain.handle('chatgpt:sign-out', () => {
  require('./chatgpt').signOut();
  if (settings.readRaw().provider === 'chatgpt') settings.update({ provider: 'anthropic' });
  return settings.publicSettings();
});
// An API key the person just copied from a provider's key page, so it can be filled in for them.
const KEY_SHAPES = { anthropic: /^sk-ant-[\w-]{20,}$/, openai: /^sk-[\w-]{20,}$/, gemini: /^AIza[\w-]{30,}$/ };
ipcMain.handle('app:clipboard-key', (e, provider) => {
  const text = clipboard.readText().trim();
  return KEY_SHAPES[provider]?.test(text) && !(provider === 'openai' && text.startsWith('sk-ant-')) ? text : '';
});

// --rea-new=docs|sheets|slides comes from the taskbar jump list.
const newFromArgv = (argv) => TITLES[argv.find((a) => a.startsWith('--rea-new='))?.slice(10)] ? argv.find((a) => a.startsWith('--rea-new=')).slice(10) : null;

function jumpList() {
  if (process.platform !== 'win32') return;
  app.setUserTasks(['docs', 'sheets', 'slides'].map((x) => ({
    program: process.execPath,
    arguments: relaunchArgs(x),
    iconPath: iconFile(x),
    iconIndex: 0,
    title: `New in ${TITLES[x]}`,
    description: `Open a blank ${TITLES[x]} window`,
  })));
}

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
    else openWindow(newFromArgv(argv) || 'home');
  });

  app.whenReady().then(() => {
    app.setAppUserModelId?.(aumid('home'));
    buildMenu();
    const files = [...pending, ...filesFromArgv(process.argv)];
    jumpList();
    updates.schedule();
    const startApp = newFromArgv(process.argv) || process.env.REA_OFFICE_START;
    if (files.length) files.forEach((f) => openPath(f));
    else openWindow(TITLES[startApp] ? startApp : 'home');
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) openWindow('home');
    });
  }).catch((err) => {
    // Never linger in the background after a failed start.
    dialog.showErrorBox('Work could not start', String(err?.stack || err));
    app.exit(1);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
