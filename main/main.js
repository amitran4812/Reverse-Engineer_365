'use strict';

const path = require('path');
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } = require('electron');
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
const pdfFiles = require('./pdf');
const templates = require('./templates');
const projects = require('./projects');

const ACCENT = { home: '#3b4a6b', docs: '#2f5aa8', sheets: '#1b7a4b', slides: '#c2532d', pdf: '#0f7b87' };
const TITLES = { home: 'Work', docs: 'Write', sheets: 'Plot', slides: 'Present', pdf: 'Read' };
const DIST = path.join(__dirname, '..', 'dist');

// Light, dark or follow the system. Electron passes the choice to every page as
// prefers-color-scheme; the title bar buttons on Windows and Linux get the
// same color as the page's title bar (dark.css mixes the accent the same way).
const DARK_BASE = [0x1b, 0x1d, 0x21];
const dark = () => nativeTheme.shouldUseDarkColors;
function titleColor(appName) {
  const hex = ACCENT[appName] || ACCENT.docs;
  if (!dark()) return hex;
  const n = parseInt(hex.slice(1), 16);
  const rgb = [n >> 16, (n >> 8) & 255, n & 255].map((v, i) => Math.round(v * 0.42 + DARK_BASE[i] * 0.58));
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
const windowBackground = () => (dark() ? '#17181b' : '#f3f4f7');
function applyTheme() {
  nativeTheme.themeSource = settings.publicSettings().theme;
}
nativeTheme.on('updated', () => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.setBackgroundColor(windowBackground());
    const appName = launches.get(win.webContents.id)?.app;
    if (process.platform !== 'darwin' && appName) win.setTitleBarOverlay?.({ color: titleColor(appName), symbolColor: '#ffffff', height: 40 });
  }
});

const launches = new Map(); // webContents id -> { app, file }
const dirty = new Set(); // webContents ids with unsaved changes

const ICON = { home: 'work', docs: 'write', sheets: 'plot', slides: 'present', pdf: 'read' };
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
    backgroundColor: windowBackground(),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? true : { color: titleColor(appName), symbolColor: '#ffffff', height: 40 },
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
  if (appName === 'pdf') pdfFiles.setFile(id, file?.path);
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
    fresh.delete(id);
    data.closeOwner(id);
    pdfFiles.setFile(id, null);
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

// Write's modes get their own place in Recent.
const kindOf = (info) => (info?.latex ? 'latex' : info?.notes || info?.data?.notes ? 'notes' : null);
const cloudInfo = (b) => ({ provider: b.provider, label: b.label, native: b.native, live: b.native === 'Google Sheets' });
const recentCloud = (b) => (b ? { provider: b.provider, id: b.id, parent: b.parent, name: b.name, native: b.native, label: b.label, modified: b.modified } : null);

async function openPath(file, fromWin) {
  const appName = formats.appForFile(file);
  if (!appName) {
    dialog.showErrorBox('Can’t open file', `Work doesn't know how to open ${path.basename(file)}.`);
    return;
  }
  try {
    // A file that came from a cloud drive reopens from its cached copy; the
    // drive is only asked again if the copy is gone.
    const entry = settings.recentEntry(file);
    const fromCloud = entry?.cloud || null;
    if (fromCloud && !require('fs').existsSync(file)) {
      const got = await cloud.download(fromCloud.provider, { id: fromCloud.id, name: fromCloud.name });
      if (got.path !== file) {
        await require('fs/promises').mkdir(path.dirname(file), { recursive: true });
        await require('fs/promises').copyFile(got.path, file);
      }
      cloud.restore(file, cloud.bindingFor(got.path));
    } else if (fromCloud) {
      cloud.restore(file, fromCloud);
    }
    const info = await formats.openFile(file);
    if (fromCloud) info.cloud = cloudInfo(cloud.bindingFor(file));
    settings.addRecent(appName, file, { kind: kindOf(info) });
    const win = openWindow(appName, info);
    // Reuse an empty home window; otherwise open a new one.
    if (fromWin && launches.get(fromWin.webContents.id)?.app === 'home') fromWin.close();
    if (fromCloud) refreshFromCloud(win, file);
  } catch (err) {
    dialog.showErrorBox('Can’t open file', String(err.message || err));
  }
}

// After a cached cloud file opens, check the drive in the background. A newer
// version replaces the cache and reloads the window, unless it has unsaved
// changes: then the window offers the reload itself.
const fresh = new Map(); // webContents id -> { file, copy }
async function refreshFromCloud(win, file) {
  let copy;
  try {
    copy = await cloud.fresher(file);
  } catch {
    return; // offline or signed out: the cached copy is what there is
  }
  if (!copy || win.isDestroyed()) return;
  const id = win.webContents.id;
  if (launches.get(id)?.file?.path !== file) return;
  fresh.set(id, { file, copy });
  if (dirty.has(id)) win.webContents.send('app:cloud-newer', copy.label);
  else await useFresh(win);
}

async function useFresh(win) {
  const id = win.webContents.id;
  const pending = fresh.get(id);
  if (!pending) return false;
  fresh.delete(id);
  await cloud.applyFresh(pending.file, pending.copy);
  settings.editRecent(pending.file, { cloud: { modified: pending.copy.modified } });
  const info = await formats.openFile(pending.file);
  info.cloud = cloudInfo(cloud.bindingFor(pending.file));
  info.refreshed = pending.copy.label;
  launches.set(id, { app: launches.get(id)?.app || formats.appForFile(pending.file), file: info });
  dirty.delete(id);
  win.webContents.reload();
  return true;
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
    if (cloud.bindingFor(file)) {
      try {
        const label = await cloud.uploadBack(file);
        settings.addRecent(appName, file, { kind: appName === 'docs' ? (payload?.notes ? 'notes' : null) : null, cloud: recentCloud(cloud.bindingFor(file)) });
        return { ...saved, cloud: label };
      } catch (err) {
        dialog.showErrorBox('Couldn’t upload', `Your changes are saved on this computer, but uploading them failed: ${err.message || err}`);
        return null;
      }
    }
    settings.addRecent(appName, file, { kind: appName === 'docs' ? (payload?.notes ? 'notes' : null) : null });
    return saved;
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
ipcMain.handle('app:recent-edit', (e, file, patch) => settings.editRecent(String(file), patch === null ? null : { pinned: Boolean(patch?.pinned) }));
ipcMain.handle('app:use-fresh', (e) => useFresh(senderWin(e)));

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
  // Remembered with its cached copy, so Recent reopens it without the drive.
  settings.addRecent(appName, got.path, { kind: kindOf(info), cloud: recentCloud(cloud.bindingFor(got.path)) });
  const from = senderWin(e);
  openWindow(appName, info);
  if (from && launches.get(from.webContents.id)?.app === 'home') from.close();
  return { ok: true };
}));
ipcMain.handle('cloud:save-new', safe(async (e, { provider, folder, name, app: appName, payload }) => {
  const res = await cloud.saveNew(provider, { folder, name }, (local) => formats.saveFile(appName, local, payload));
  settings.addRecent(appName, res.path, { kind: appName === 'docs' && payload?.notes ? 'notes' : null, cloud: recentCloud(cloud.bindingFor(res.path)) });
  return res;
}));
ipcMain.handle('cloud:share', safe((e, local, op, args) => cloud.share(local, op, args)));
ipcMain.handle('accounts:list', () => profiles.list());
ipcMain.handle('accounts:add', safe((e, name) => profiles.add(name)));
ipcMain.handle('accounts:rename', safe((e, id, name) => profiles.rename(id, name)));
ipcMain.handle('accounts:remove', safe((e, id) => profiles.remove(id)));
ipcMain.handle('accounts:open', safe((e, id) => profiles.open(id)));
ipcMain.handle('cloud:sheet', safe((e, local, op, args) => cloud.sheet(local, op, args)));
ipcMain.handle('web:data', safe(async (e, kind, params) => ({ value: await require('./webdata').data(kind, params) })));
// Free photos from the web for Send to Present.
ipcMain.handle('web:photo', safe((e, query, skip) => require('./images').find(query, skip)));
// References for papers (the Cite dialog).
ipcMain.handle('cite:lookup', safe((e, req) => require('./cite').lookup(req)));
ipcMain.handle('cite:search', safe((e, text) => require('./cite').search(text)));
ipcMain.handle('cite:open-file', safe(async (e) => {
  const res = await dialog.showOpenDialog(senderWin(e), {
    title: 'Pick a paper to cite',
    properties: ['openFile'],
    filters: [{ name: 'Papers', extensions: ['pdf', 'docx', 'txt', 'md', 'html'] }, { name: 'All files', extensions: ['*'] }],
  });
  return res.canceled ? null : require('./cite').readFile(res.filePaths[0]);
}));
ipcMain.handle('cite:read-path', safe((e, file) => require('./cite').readFile(file)));
ipcMain.handle('library:list', safe(() => require('./library').list()));
ipcMain.handle('library:add', safe((e, item, tags) => require('./library').add(item, tags)));
ipcMain.handle('library:update', safe((e, id, patch) => require('./library').update(id, patch)));
ipcMain.handle('library:remove', safe((e, ids) => require('./library').remove(ids)));
ipcMain.handle('library:import', safe(async (e) => {
  const res = await dialog.showOpenDialog(senderWin(e), {
    title: 'Add references from a file',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'References', extensions: ['bib', 'ris', 'txt'] }, { name: 'All files', extensions: ['*'] }],
  });
  return res.canceled ? null : require('./library').importFiles(res.filePaths);
}));
ipcMain.handle('library:export', safe(async (e, ids, style) => {
  const lib = require('./library');
  const { ext, name } = lib.exportKind(style);
  const res = await dialog.showSaveDialog(senderWin(e), { title: 'Export references', defaultPath: `references.${ext}`, filters: [{ name, extensions: [ext] }] });
  return res.canceled ? null : lib.exportTo(res.filePath, ids, style);
}));

ipcMain.handle('settings:get', () => settings.publicSettings());
ipcMain.handle('settings:set', (e, patch) => {
  const out = settings.update(patch || {});
  if (typeof patch?.autoUpdate === 'boolean') updates.schedule();
  if (patch?.theme) applyTheme();
  return out;
});
ipcMain.handle('updates:status', () => updates.status());
ipcMain.handle('updates:check', () => updates.check());
ipcMain.handle('updates:install', () => updates.install());

ipcMain.on('claude:start', async (e, { id, payload }) => {
  if (payload?.project && payload.messages?.length) {
    try {
      payload = await withProject(payload);
    } catch (err) {
      e.sender.send('claude:event', { id, type: 'error', message: `Couldn’t read the project: ${err.message || err}` });
      return;
    }
  }
  claude.start(e.sender, id, payload);
});

// A project's files go at the start of the conversation, read fresh for every message.
async function withProject(payload) {
  const ctx = await projects.context(payload.project);
  const att = attachments.put(`project_${payload.project}`, ctx.name, ctx.blocks);
  const note = [
    `This conversation is in the user's project "${ctx.name.replace(/"/g, "'")}". The project's instructions, its list of files and the files' contents come at the start of the first message, in <project> and <project_file> tags (PDFs and pictures may come as documents and images).`,
    'Use them to understand what the user is working on and answer from them, naming the files you draw on. If a file you need is missing, not read yet or only included in part, say so.',
  ].join(' ');
  return {
    ...payload,
    system: payload.system ? `${payload.system}\n\n${note}` : note,
    messages: payload.messages.map((m, i) => (i === 0 ? { ...m, attachments: [att, ...(m.attachments || [])] } : m)),
    cacheFirst: true,
  };
}
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
  const custom = spec?.kind === 'deck' ? await templates.get(spec.theme) : null;
  const info = await generated.toFileInfo(custom ? { ...spec, themeData: custom } : spec);
  openWindow(info.app, info);
  return { ok: true };
}));
// Read: each window reads and saves only its own PDF.
ipcMain.handle('pdf:read', (e) => pdfFiles.read(e.sender.id));
ipcMain.handle('pdf:save', safe(async (e, req) => {
  const res = await pdfFiles.save(senderWin(e), e.sender.id, req || {});
  if (res && !req?.copy) {
    const info = launches.get(e.sender.id);
    if (info) info.file = { ...(info.file || {}), path: res.path, name: res.name };
    settings.addRecent('pdf', res.path);
  }
  return res;
}));
ipcMain.handle('pdf:pick', safe((e, opts) => pdfFiles.pickPdfs(senderWin(e), opts || {})));
ipcMain.handle('pdf:signatures', () => pdfFiles.signatures());
ipcMain.handle('pdf:set-signatures', safe((e, list) => pdfFiles.setSignatures(list)));
ipcMain.handle('pdf:user', () => pdfFiles.userName());
// Present templates the user uploaded.
// Projects: files grouped for Claude.
const projectPaths = (list) => (Array.isArray(list) ? list : []).filter((p) => typeof p === 'string' && p).slice(0, 200);
ipcMain.handle('projects:list', () => projects.list());
ipcMain.handle('projects:get', safe((e, id) => projects.get(id)));
ipcMain.handle('projects:create', safe(async (e, spec) => {
  const p = await projects.create(spec || {});
  if (spec?.paths?.length) await projects.addFiles(p.id, projectPaths(spec.paths), { copy: !!spec.copy });
  return p;
}));
ipcMain.handle('projects:update', safe((e, id, patch) => projects.update(id, patch || {})));
ipcMain.handle('projects:remove', safe((e, id) => projects.remove(id)));
ipcMain.handle('projects:add-dialog', safe(async (e, id, folder) => {
  const res = await dialog.showOpenDialog(senderWin(e), {
    title: folder ? 'Add a folder to the project' : 'Add files to the project',
    properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'],
  });
  return res.canceled ? { added: [], skipped: [] } : projects.addFiles(id, res.filePaths, { copy: !folder });
}));
ipcMain.handle('projects:add-paths', safe((e, id, paths, opts) => projects.addFiles(id, projectPaths(paths), { copy: !!opts?.copy })));
ipcMain.handle('projects:remove-item', safe((e, id, itemId) => projects.removeItem(id, itemId)));
ipcMain.handle('projects:pdf-bytes', safe((e, id, file) => projects.pdfBytes(id, file)));
ipcMain.handle('projects:save-text', safe((e, id, key, body) => projects.saveText(id, key, body)));
ipcMain.handle('projects:for-path', (e, file) => projects.forPath(file).catch(() => []));
ipcMain.handle('projects:reveal', safe(async (e, id, file) => {
  if (file) shell.showItemInFolder(file);
  else await shell.openPath(path.join(app.getPath('userData'), 'Projects', (await projects.readMeta(id)).id, 'files'));
  return { ok: true };
}));
// Opens a project file in Work when it can, otherwise in the system's app. Home stays open.
ipcMain.handle('projects:open-file', safe(async (e, file) => {
  if (formats.appForFile(file)) await openPath(file, null);
  else await shell.openPath(file);
  return { ok: true };
}));
ipcMain.handle('templates:list', () => templates.list());
ipcMain.handle('templates:upload', safe((e) => templates.upload(senderWin(e))));
ipcMain.handle('templates:remove', safe((e, id) => templates.remove(id)));
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
ipcMain.handle('latex:save-zip', safe(async (e, opts = {}) => {
  const root = latexRoot(e);
  const main = typeof opts.main === 'string' ? opts.main : await latex.mainFile(root);
  const res = await dialog.showSaveDialog(senderWin(e), {
    defaultPath: path.join(path.dirname(root), `${path.basename(root) || 'project'}.zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const overrides = opts.overrides && typeof opts.overrides === 'object' ? opts.overrides : {};
  const pdf = opts.pdf === false ? null : await latex.lastPdf(root, main);
  const pdfName = main ? main.replace(/\.[^./\\]+$/, '') + '.pdf' : null;
  const out = await latex.exportZip(root, res.filePath, { overrides, pdf, pdfName });
  return { ok: true, path: res.filePath, name: path.basename(res.filePath), files: out.files };
}));
ipcMain.handle('latex:open-pdf-external', safe(async (e, main) => {
  const pdf = await latex.lastPdf(latexRoot(e), main);
  if (!pdf) throw new Error('Compile the project first.');
  await shell.openPath(pdf);
  return { ok: true };
}));

// Review notes, version history and Git for LaTeX projects.
const latexHistory = require('./latex-history');
const latexGit = require('./latex-git');
ipcMain.handle('latex:review-get', safe((e) => latex.readReview(latexRoot(e))));
ipcMain.handle('latex:review-set', safe((e, data) => latex.writeReview(latexRoot(e), data || {})));
ipcMain.handle('latex:history-snapshot', safe((e, opts) => latexHistory.snapshot(latexRoot(e), opts || {})));
ipcMain.handle('latex:history-list', safe((e) => latexHistory.versions(latexRoot(e))));
ipcMain.handle('latex:history-compare', safe((e, id, against) => latexHistory.compare(latexRoot(e), String(id), against === 'current' ? 'current' : 'previous')));
ipcMain.handle('latex:history-file', safe((e, id, rel) => latexHistory.fileAt(latexRoot(e), String(id), String(rel))));
ipcMain.handle('latex:history-restore', safe((e, id, paths) => latexHistory.restore(latexRoot(e), String(id), Array.isArray(paths) ? paths.map(String) : null)));
ipcMain.handle('latex:history-rename', safe((e, id, label) => latexHistory.rename(latexRoot(e), String(id), label)));
ipcMain.handle('latex:history-export', safe(async (e, id, name) => {
  const root = latexRoot(e);
  const res = await dialog.showSaveDialog(senderWin(e), {
    defaultPath: path.join(path.dirname(root), `${path.basename(root)} (${String(name || 'version').replace(/[\\/:*?"<>|]+/g, '-')}).zip`),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const out = await latexHistory.exportVersion(root, String(id), res.filePath);
  return { ...out, name: path.basename(res.filePath) };
}));
ipcMain.handle('latex:git-status', safe((e) => latexGit.status(latexRoot(e))));
ipcMain.handle('latex:git-init', safe((e) => latexGit.init(latexRoot(e))));
ipcMain.handle('latex:git-commit', safe((e, msg) => latexGit.commit(latexRoot(e), msg)));
ipcMain.handle('latex:git-remote', safe((e, url) => latexGit.setRemote(latexRoot(e), url)));
ipcMain.handle('latex:git-sync', safe((e, msg) => latexGit.sync(latexRoot(e), msg)));
ipcMain.handle('latex:git-token', safe((e, url, auth) => latexGit.setToken(url, auth || {})));
ipcMain.handle('latex:git-identity', safe((e, who) => latexGit.setIdentity(who || {})));
ipcMain.handle('latex:git-clone', safe(async (e, url, auth) => {
  if (auth?.token) latexGit.setToken(url, auth);
  const res = await dialog.showOpenDialog(senderWin(e), { title: 'Choose an empty folder for the project', buttonLabel: 'Download here', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const name = (String(url).split('/').pop() || 'project').replace(/\.git$/i, '') || 'project';
  let dir = res.filePaths[0];
  if ((await require('fs/promises').readdir(dir).catch(() => [])).length) dir = path.join(dir, name);
  await latexGit.clone(url, dir);
  await latex.scaffold(dir);
  return openLatexProject(senderWin(e), dir);
}));

ipcMain.handle('notes:image', (e, prompt) => require('./ai').image(prompt));
ipcMain.handle('notes:fetch-link', (e, url) => require('./links').fetchLink(url));
ipcMain.handle('notes:transcribe', (e, audio) => require('./media').transcribe(audio || {}));
ipcMain.handle('notes:transcribe-file', (e) => require('./media').transcribeFile(senderWin(e), dialog));
ipcMain.handle('notes:mic', async () => (process.platform === 'darwin' ? require('electron').systemPreferences.askForMediaAccess('microphone') : true));
ipcMain.handle('notes:can-transcribe', () => Boolean(require('./media').transcriber()));
ipcMain.handle('notes:attach', (e) => require('./media').pickAttachments(senderWin(e), dialog));
ipcMain.handle('notes:open-attachment', (e, file) => require('./media').openAttachment(file || {}).catch((err) => ({ ok: false, message: err.message })));
ipcMain.handle('notes:save-attachment', (e, file) => require('./media').saveAttachment(senderWin(e), dialog, file || {}).catch((err) => ({ ok: false, message: err.message })));
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
  app.setUserTasks(['docs', 'sheets', 'slides', 'pdf'].map((x) => ({
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
    applyTheme();
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
