'use strict';

// Version history for LaTeX projects. Every save keeps a snapshot of the
// project's files under the app's data folder (never in the project), so any
// earlier version can be compared and restored. Files are stored once per
// content (by hash, gzipped), so snapshots are cheap.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { app } = require('electron');
const latex = require('./latex');
const tex = require('../common/latex');

const MAX_FILE = 25 * 1024 * 1024;
const KEEP_AUTO = 400;
const MERGE_MS = 5 * 60 * 1000;
const locks = new Map();

function storeDir(root) {
  const id = crypto.createHash('sha1').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'latex-history', id);
}

async function readVersions(dir) {
  try {
    const list = JSON.parse(await fsp.readFile(path.join(dir, 'versions.json'), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeVersions(dir, list) {
  const file = path.join(dir, 'versions.json');
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(list));
  await fsp.rename(`${file}.tmp`, file);
}

// One change at a time per project.
function locked(root, fn) {
  const key = path.resolve(root).toLowerCase();
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  return next;
}

async function putBlob(dir, buf) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex');
  const file = path.join(dir, 'blobs', hash.slice(0, 2), `${hash}.gz`);
  if (!fs.existsSync(file)) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, zlib.gzipSync(buf));
  }
  return hash;
}

async function getBlob(dir, hash) {
  if (!/^[0-9a-f]{40}$/.test(hash)) throw new Error('That version is damaged.');
  return zlib.gunzipSync(await fsp.readFile(path.join(dir, 'blobs', hash.slice(0, 2), `${hash}.gz`)));
}

async function currentFiles(root, dir) {
  const files = {};
  for (const f of await latex.list(root)) {
    if (f.dir) continue;
    try {
      const full = latex.inside(root, f.path);
      if ((await fsp.stat(full)).size > MAX_FILE) continue;
      files[f.path] = await putBlob(dir, await fsp.readFile(full));
    } catch {
      // unreadable file: leave it out of this snapshot
    }
  }
  return files;
}

const same = (a, b) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

// What changed from one file map to the next.
function changes(prev, next) {
  const out = { added: [], removed: [], changed: [] };
  for (const [p, h] of Object.entries(next)) {
    if (!(p in prev)) out.added.push(p);
    else if (prev[p] !== h) out.changed.push(p);
  }
  for (const p of Object.keys(prev)) if (!(p in next)) out.removed.push(p);
  return out;
}

// Keeps a snapshot of the project as it is on disk now. Saves close together
// fold into one version unless it has a name.
function snapshot(root, { label = '', reason = 'save' } = {}) {
  return locked(root, async () => {
    const dir = storeDir(root);
    await fsp.mkdir(dir, { recursive: true });
    const list = await readVersions(dir);
    const files = await currentFiles(root, dir);
    const last = list[list.length - 1];
    const now = Date.now();
    label = String(label || '').trim().slice(0, 120);
    if (last && same(last.files, files)) {
      if (label && !last.label) {
        last.label = label;
        await writeVersions(dir, list);
      }
      return { ok: true, id: last.id, unchanged: true };
    }
    const prev = list[list.length - 2];
    if (last && !label && !last.label && last.reason === 'save' && reason === 'save' && now - last.time < MERGE_MS && prev) {
      last.files = files;
      last.time = now;
      last.summary = changes(prev.files, files);
    } else {
      list.push({ id: `${now.toString(36)}${crypto.randomBytes(3).toString('hex')}`, time: now, label, reason, files, summary: changes(last?.files || {}, files) });
    }
    prune(list);
    await writeVersions(dir, list);
    await sweep(dir, list);
    return { ok: true, id: list[list.length - 1].id };
  });
}

function prune(list) {
  let autos = list.filter((v) => !v.label).length;
  for (let i = 0; i < list.length - 1 && autos > KEEP_AUTO; i++) {
    if (!list[i].label) {
      list.splice(i, 1);
      i -= 1;
      autos -= 1;
    }
  }
}

// Removes stored files no version uses any more.
async function sweep(dir, list) {
  const used = new Set(list.flatMap((v) => Object.values(v.files)));
  const base = path.join(dir, 'blobs');
  for (const sub of await fsp.readdir(base).catch(() => [])) {
    for (const name of await fsp.readdir(path.join(base, sub)).catch(() => [])) {
      if (!used.has(name.replace(/\.gz$/, ''))) await fsp.rm(path.join(base, sub, name), { force: true });
    }
  }
}

async function versions(root) {
  const list = await readVersions(storeDir(root));
  return list.map((v) => ({ id: v.id, time: v.time, label: v.label || '', reason: v.reason, files: Object.keys(v.files), summary: v.summary || { added: [], removed: [], changed: [] } })).reverse();
}

async function find(root, id) {
  const dir = storeDir(root);
  const list = await readVersions(dir);
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) throw new Error('That version is no longer kept.');
  return { dir, list, v: list[i], prev: list[i - 1] || null };
}

const isText = (p) => ['tex', 'bib', 'text'].includes(tex.fileKind(p)) || /\.(sty|cls|bst|bbx|cbx|txt|md|csv|dat|tikz|lua|py|r|json|ya?ml)$/i.test(p);

// A file as it was in a version: { text } for text files, { size } for others,
// or { missing: true }.
async function fileAt(root, id, rel) {
  const { dir, v } = await find(root, id);
  const hash = v.files[rel];
  if (!hash) return { missing: true };
  const buf = await getBlob(dir, hash);
  if (!isText(rel) || buf.subarray(0, 8000).includes(0)) return { binary: true, size: buf.length };
  return { text: buf.toString('utf8') };
}

// The two sides of every file a version changed, for showing the difference.
async function compare(root, id, against = 'previous') {
  const { dir, v, prev } = await find(root, id);
  let other = {};
  if (against === 'current') {
    other = {};
    for (const f of await latex.list(root)) {
      if (!f.dir) other[f.path] = null;
    }
  } else if (prev) other = prev.files;
  const paths = [...new Set([...Object.keys(v.files), ...Object.keys(other)])].sort();
  const out = [];
  for (const p of paths) {
    const here = v.files[p] || null;
    let there = other[p] || null;
    let thereText = null;
    if (against === 'current' && p in other) {
      try {
        const full = latex.inside(root, p);
        const buf = await fsp.readFile(full);
        there = crypto.createHash('sha1').update(buf).digest('hex');
        thereText = isText(p) && !buf.subarray(0, 8000).includes(0) ? buf.toString('utf8') : null;
      } catch {
        there = null;
      }
    }
    if (here === there) continue;
    const text = async (hash) => {
      if (!hash) return '';
      const buf = await getBlob(dir, hash);
      return isText(p) && !buf.subarray(0, 8000).includes(0) ? buf.toString('utf8') : null;
    };
    const versionText = await text(here);
    // For "previous", a is the older side; for "current", a is this version.
    const a = against === 'current' ? versionText : await text(there);
    const b = against === 'current' ? (there ? thereText : '') : versionText;
    out.push({ path: p, status: !there ? (against === 'current' ? 'deleted since' : 'added') : !here ? (against === 'current' ? 'added since' : 'deleted') : 'changed', a, b, binary: a === null || b === null });
  }
  return out;
}

// Puts files from a version back into the project. A snapshot of the project
// as it is now is kept first, so restoring can itself be undone.
async function restore(root, id, paths = null) {
  await snapshot(root, { reason: 'before-restore', label: '' });
  const { dir, v } = await find(root, id);
  const pick = paths?.length ? paths.filter((p) => p in v.files) : Object.keys(v.files);
  for (const p of pick) {
    const full = latex.inside(root, p);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, await getBlob(dir, v.files[p]));
  }
  await snapshot(root, { reason: 'restore', label: '' });
  return { ok: true, restored: pick };
}

async function rename(root, id, label) {
  return locked(root, async () => {
    const dir = storeDir(root);
    const list = await readVersions(dir);
    const v = list.find((x) => x.id === id);
    if (!v) throw new Error('That version is no longer kept.');
    v.label = String(label || '').trim().slice(0, 120);
    await writeVersions(dir, list);
    return { ok: true };
  });
}

// Writes a version's files into a .zip.
async function exportVersion(root, id, outPath) {
  const JSZip = require('jszip');
  const { dir, v } = await find(root, id);
  const zip = new JSZip();
  for (const [p, hash] of Object.entries(v.files)) zip.file(p, await getBlob(dir, hash));
  await fsp.writeFile(outPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { ok: true, files: Object.keys(v.files).length };
}

module.exports = { snapshot, versions, fileAt, compare, restore, rename, exportVersion, changes };
