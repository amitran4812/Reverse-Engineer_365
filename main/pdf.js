'use strict';

// Read (the PDF app): file access for each window's PDF, saving, picking PDFs
// to insert, and the saved signatures (encrypted, per account).

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { app, dialog, safeStorage } = require('electron');

const files = new Map(); // webContents id -> path of the PDF that window has open

function setFile(id, file) {
  if (file) files.set(id, file);
  else files.delete(id);
}

async function read(id) {
  const file = files.get(id);
  if (!file) return null;
  return fs.readFile(file);
}

function lockedMessage(err, file) {
  // Windows locks a PDF that's open in another viewer.
  if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) return `Couldn’t save ${path.basename(file)}. If it’s open in another PDF reader, close it and try again, or use Save As.`;
  return `Couldn’t save the PDF: ${err.message || err}`;
}

// Saves bytes to the window's file, or asks where. copy: don't switch the window to it.
async function save(win, id, { bytes, saveAs = false, copy = false, suggestedName }) {
  let file = saveAs || copy ? null : files.get(id);
  if (!file) {
    const res = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName || (files.get(id) ? files.get(id) : 'Untitled.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return null;
    file = res.filePath;
    if (!path.extname(file)) file += '.pdf';
  }
  try {
    // Write next to the file, then swap, so a failed save never leaves half a PDF.
    const tmp = `${file}.saving`;
    await fs.writeFile(tmp, Buffer.from(bytes));
    await fs.rename(tmp, file).catch(async (err) => {
      await fs.rm(tmp, { force: true });
      throw err;
    });
  } catch (err) {
    throw new Error(lockedMessage(err, file));
  }
  if (!copy) setFile(id, file);
  return { path: file, name: path.basename(file) };
}

async function pickPdfs(win, { multi = true } = {}) {
  const res = await dialog.showOpenDialog(win, {
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled) return [];
  return Promise.all(res.filePaths.map(async (f) => ({ name: path.basename(f), bytes: await fs.readFile(f) })));
}

function signaturesFile() {
  return path.join(app.getPath('userData'), 'signatures.dat');
}

async function signatures() {
  try {
    const raw = await fs.readFile(signaturesFile());
    const text = safeStorage.isEncryptionAvailable() && raw[0] !== 0x5b ? safeStorage.decryptString(raw) : raw.toString('utf8');
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function setSignatures(list) {
  const clean = (Array.isArray(list) ? list : [])
    .filter((s) => s && /^data:image\/png;base64,/.test(s.src) && s.src.length < 4_000_000)
    .slice(0, 12)
    .map((s) => ({ id: String(s.id || Date.now()), kind: s.kind === 'initials' ? 'initials' : 'signature', src: s.src, w: Number(s.w) || 300, h: Number(s.h) || 100 }));
  const text = JSON.stringify(clean);
  await fs.mkdir(path.dirname(signaturesFile()), { recursive: true });
  await fs.writeFile(signaturesFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text, { mode: 0o600 });
  return clean;
}

function userName() {
  try {
    return os.userInfo().username || '';
  } catch {
    return '';
  }
}

module.exports = { setFile, read, save, pickPdfs, signatures, setSignatures, userName };
