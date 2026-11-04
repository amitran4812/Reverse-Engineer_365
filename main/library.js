'use strict';

// My Library on disk: userData/Library/references.json, one list per account.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const lib = require('../common/library');

const file = () => path.join(app.getPath('userData'), 'Library', 'references.json');

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

function write(items) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 1));
  fs.renameSync(tmp, file());
  return items;
}

const clean = (item) => JSON.parse(JSON.stringify(item || {}));

function list() {
  return { items: read() };
}

function add(item, tags) {
  if (!item?.title) return { error: 'This reference has no title.' };
  const { list: items, entry } = lib.addItem(read(), clean(item), { tags });
  write(items);
  return { items, entry };
}

function update(id, patch) {
  const items = read().map((x) => (x.id === id ? { ...x, ...clean(patch), id: x.id, ...(patch?.tags ? { tags: lib.cleanTags(patch.tags) } : {}) } : x));
  return { items: write(items) };
}

function remove(ids) {
  const drop = new Set(ids || []);
  return { items: write(read().filter((x) => !drop.has(x.id))) };
}

function importFiles(paths) {
  let items = read();
  let added = 0;
  for (const p of paths || []) {
    const text = fs.readFileSync(p, 'utf8');
    for (const it of lib.parseReferences(text, p)) {
      const before = items.length;
      ({ list: items } = lib.addItem(items, it, { tags: it.tags }));
      if (items.length > before) added += 1;
    }
  }
  write(items);
  return { items, added };
}

const KINDS = { bibtex: { ext: 'bib', name: 'BibTeX' }, ris: { ext: 'ris', name: 'RIS' } };
const exportKind = (style) => KINDS[style] || { ext: 'txt', name: 'Text' };

function exportTo(target, ids, style) {
  const want = new Set(ids || []);
  const items = read().filter((x) => !want.size || want.has(x.id));
  const out = lib.bibliography(items, style);
  fs.writeFileSync(target, out.text);
  return { path: target, count: items.length };
}

module.exports = { list, add, update, remove, importFiles, exportKind, exportTo };
