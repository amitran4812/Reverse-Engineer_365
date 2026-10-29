'use strict';

// File access for Plot's analysis workspace. The renderer never gets paths
// to read; it gets handles to files the user picked, opened or dropped, and
// reads them in chunks so multi-gigabyte files stream into the data worker.

const fsp = require('fs/promises');
const path = require('path');
const { BrowserWindow, dialog, shell } = require('electron');

const DATA_EXTS = ['csv', 'tsv', 'tab', 'txt', 'dat', 'parquet', 'xlsx', 'xlsm'];
const MAX_CHUNK = 64 * 1024 * 1024;

const handles = new Map(); // id -> { owner, path, size, fd }
const writers = new Map(); // id -> { owner, path, fd }
let seq = 0;

async function register(owner, file) {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a file`);
  const id = `h${++seq}`;
  handles.set(id, { owner, path: file, size: stat.size, fd: null });
  return { handle: id, name: path.basename(file), size: stat.size, ext: path.extname(file).slice(1).toLowerCase(), path: file };
}

async function read(owner, id, offset, length) {
  const h = handles.get(id);
  if (!h || h.owner !== owner) throw new Error('That file is no longer open');
  h.fd ??= await fsp.open(h.path, 'r');
  const len = Math.max(0, Math.min(MAX_CHUNK, length, h.size - offset));
  const buf = Buffer.allocUnsafe(len);
  let done = 0;
  while (done < len) {
    const { bytesRead } = await h.fd.read(buf, done, len - done, offset + done);
    if (!bytesRead) break;
    done += bytesRead;
  }
  return done === len ? buf : buf.subarray(0, done);
}

async function closeOwner(owner) {
  for (const [id, h] of handles) {
    if (h.owner !== owner) continue;
    handles.delete(id);
    await h.fd?.close().catch(() => {});
  }
  for (const [id, w] of writers) {
    if (w.owner !== owner) continue;
    writers.delete(id);
    await w.fd.close().catch(() => {});
  }
}

async function openDialog(win, owner) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open data for analysis',
    properties: ['openFile'],
    filters: [
      { name: 'Data files', extensions: DATA_EXTS },
      { name: 'CSV or text', extensions: ['csv', 'tsv', 'tab', 'txt', 'dat'] },
      { name: 'Parquet', extensions: ['parquet'] },
      { name: 'Excel workbook', extensions: ['xlsx', 'xlsm'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return register(owner, res.filePaths[0]);
}

async function saveTarget(win, { name, filters }) {
  const res = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  if (res.canceled || !res.filePath) return null;
  let file = res.filePath;
  if (!path.extname(file) && filters?.[0]?.extensions?.[0]) file += `.${filters[0].extensions[0]}`;
  return file;
}

// One-shot save: PNG/SVG images, analysis projects.
async function saveBytes(win, { name, filters, data, path: known }) {
  const file = known || (await saveTarget(win, { name, filters }));
  if (!file) return null;
  await fsp.writeFile(file, typeof data === 'string' ? data : Buffer.from(data));
  return { path: file, name: path.basename(file) };
}

// Chunked save for exporting millions of rows as CSV.
async function beginWrite(win, owner, opts) {
  const file = await saveTarget(win, opts);
  if (!file) return null;
  const id = `w${++seq}`;
  writers.set(id, { owner, path: file, fd: await fsp.open(file, 'w') });
  return { writer: id, name: path.basename(file) };
}

async function write(owner, id, text) {
  const w = writers.get(id);
  if (!w || w.owner !== owner) throw new Error('That export is no longer open');
  await w.fd.write(text);
}

async function endWrite(owner, id) {
  const w = writers.get(id);
  if (!w || w.owner !== owner) return null;
  writers.delete(id);
  await w.fd.close();
  return { path: w.path, name: path.basename(w.path) };
}

// Vector PDF of one plot: the SVG printed in a hidden window at its own size.
async function savePdf(win, { svg, width, height, name }) {
  const file = await saveTarget(win, { name, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (!file) return null;
  const page = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, offscreen: false } });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`;
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await page.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: 'none' },
    });
    await fsp.writeFile(file, pdf);
  } finally {
    page.destroy();
  }
  shell.openPath(file);
  return { path: file, name: path.basename(file) };
}

module.exports = { DATA_EXTS, register, read, closeOwner, openDialog, saveBytes, beginWrite, write, endWrite, savePdf };
