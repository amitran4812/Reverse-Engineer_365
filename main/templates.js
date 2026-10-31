'use strict';

// Templates the user uploads for Present. Each one is read from a PowerPoint
// file once and kept as JSON in the account's Templates folder, so Present,
// Write and Plot all offer it next to the built-in templates.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, nativeImage } = require('electron');
const { readTemplate } = require('./formats/template');

const EXTENSIONS = ['pptx', 'potx', 'pptm', 'potm'];
const MAX_FILE = 80 * 1024 * 1024;
const BIG_PICTURE = 400 * 1024; // pictures over this are scaled down and stored as JPEG or PNG
const MAX_SIDE = 1920;

const dir = () => path.join(app.getPath('userData'), 'Templates');
const fileOf = (id) => path.join(dir(), `${id}.json`);
const validId = (id) => typeof id === 'string' && /^u[0-9a-f]{12}$/.test(id);

function shrink(src) {
  const m = /^data:(image\/(png|jpeg|gif|bmp|webp));base64,/.exec(src || '');
  if (!m || src.length < BIG_PICTURE * 1.37) return src;
  const img = nativeImage.createFromDataURL(src);
  if (img.isEmpty()) return src;
  const { width, height } = img.getSize();
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  const out = k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'best' }) : img;
  const url = m[2] === 'png' ? out.toDataURL() : `data:image/jpeg;base64,${out.toJPEG(86).toString('base64')}`;
  return url.length < src.length ? url : src;
}

async function list() {
  let names = [];
  try {
    names = (await fs.readdir(dir())).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    try {
      const t = JSON.parse(await fs.readFile(path.join(dir(), n), 'utf8'));
      if (validId(t.id)) out.push(t);
    } catch {}
  }
  return out.sort((a, b) => (a.added || 0) - (b.added || 0));
}

async function get(id) {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await fs.readFile(fileOf(id), 'utf8'));
  } catch {
    return null;
  }
}

async function addFile(file) {
  const { size } = await fs.stat(file);
  if (size > MAX_FILE) throw new Error(`${path.basename(file)} is larger than 80 MB.`);
  const t = await readTemplate(await fs.readFile(file), path.basename(file));
  const id = `u${crypto.randomBytes(6).toString('hex')}`;
  const saved = {
    id,
    custom: true,
    added: Date.now(),
    source: path.basename(file),
    ...t,
    bgImage: t.bgImage ? shrink(t.bgImage) : null,
    decor: t.decor.map((d) => (d.src ? { ...d, src: shrink(d.src) } : d)),
  };
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(fileOf(id), JSON.stringify(saved));
  return saved;
}

// Asks for one or more PowerPoint files. Returns { added, failed }.
async function upload(win) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Upload a PowerPoint template',
    buttonLabel: 'Upload',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PowerPoint templates and presentations', extensions: EXTENSIONS }],
  });
  if (res.canceled) return { added: [], failed: [] };
  return addPaths(res.filePaths);
}

async function addPaths(paths) {
  const added = [];
  const failed = [];
  for (const p of paths.slice(0, 20)) {
    try {
      added.push(await addFile(p));
    } catch (err) {
      failed.push({ name: path.basename(p), error: String(err.message || err) });
    }
  }
  return { added, failed };
}

async function remove(id) {
  if (!validId(id)) throw new Error('Unknown template.');
  await fs.rm(fileOf(id), { force: true });
  return { ok: true };
}

module.exports = { EXTENSIONS, list, get, upload, addPaths, remove };
