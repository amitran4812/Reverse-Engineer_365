'use strict';

// Updates from the GitHub Releases of the Work repository (electron-updater).
// Work checks shortly after it starts and every few hours, downloads a newer
// version in the background, and installs it when you choose Restart, or the
// next time you quit when only one account is open. Turn automatic checks
// off in File > Options; Check for updates still works.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const settings = require('./settings');
const profiles = require('./profiles');

const RELEASES = 'https://github.com/amitran4812/Reverse-Engineer_365/releases/latest';
const EVERY = 4 * 60 * 60 * 1000;

let updater = null;
let state = { status: 'idle' };
let timer = null;

// Installing in place only works for the Windows installer and the AppImage;
// elsewhere Work points to the download page.
const canInstall = () => app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && Boolean(process.env.APPIMAGE)));

function set(next) {
  state = { ...next, version: next.version || state.version };
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('updates:event', status());
}

const status = () => ({ ...state, current: app.getVersion(), auto: settings.readRaw().autoUpdate !== false, canInstall: canInstall(), releases: RELEASES });

// Several accounts run as separate processes; only one of them downloads at a time.
const lockDir = () => path.join(app.getPath('temp'), 'work-updater.lock');
function lock() {
  try {
    fs.mkdirSync(lockDir());
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(lockDir()).mtimeMs > 30 * 60 * 1000) {
        fs.rmSync(lockDir(), { recursive: true, force: true });
        fs.mkdirSync(lockDir());
        return true;
      }
    } catch {}
    return false;
  }
}
const unlock = () => fs.rmSync(lockDir(), { recursive: true, force: true });

function load() {
  if (updater) return updater;
  updater = require('electron-updater').autoUpdater;
  if (process.env.REA_UPDATE_URL) updater.setFeedURL({ provider: 'generic', url: process.env.REA_UPDATE_URL });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => set({ status: 'latest' }));
  updater.on('update-available', (info) => {
    if (!canInstall()) return set({ status: 'available', version: info.version });
    if (!lock()) return set({ status: 'available', version: info.version, note: 'Another account is downloading this update.' });
    set({ status: 'downloading', version: info.version, percent: 0 });
    updater.downloadUpdate().catch(() => {});
  });
  updater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent) }));
  updater.on('update-downloaded', (info) => {
    unlock();
    // Quitting one account mustn't close the others mid-edit, so install on quit only when one account is open.
    updater.autoInstallOnAppQuit = profiles.active().count === 1;
    set({ status: 'ready', version: info.version });
  });
  updater.on('error', (err) => {
    unlock();
    set({ status: 'error', message: friendly(err) });
  });
  return updater;
}

function friendly(err) {
  const m = String(err?.message || err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::|getaddrinfo/i.test(m)) return 'Couldn’t reach GitHub. Check your internet connection.';
  if (/404|latest\.yml|Cannot find/i.test(m)) return 'This release has no update information yet. Download it from the releases page.';
  return m.split('\n')[0].slice(0, 200);
}

async function check() {
  if (!app.isPackaged) {
    set({ status: 'error', message: 'Updates work in the installed app, not in a development build.' });
    return status();
  }
  if (['checking', 'downloading', 'ready'].includes(state.status)) return status();
  try {
    await load().checkForUpdates();
  } catch (err) {
    set({ status: 'error', message: friendly(err) });
  }
  return status();
}

function install() {
  if (state.status !== 'ready') return false;
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
}

function schedule() {
  clearInterval(timer);
  timer = null;
  if (!app.isPackaged || settings.readRaw().autoUpdate === false) return;
  setTimeout(() => settings.readRaw().autoUpdate !== false && check(), 15000);
  timer = setInterval(() => settings.readRaw().autoUpdate !== false && check(), EVERY);
}

module.exports = { status, check, install, schedule };
