'use strict';

// Projects: a named set of files Claude reads together. Files added on the
// project page are copied into the project's own folder; a saved file or a
// folder added from elsewhere (an app's File screen, Recent, a LaTeX project)
// stays where it is and is read fresh each time, so Claude sees the latest save.
// Each project is a folder under userData/Projects with a project.json.

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const text = require('../common/project-text');

const MAX_FOLDER_FILES = 400;
const MAX_PDF = 30 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_IMAGES = 12;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', '.venv', 'venv', '.idea', '.vscode']);

// A file's text for Claude, or null when it isn't a kind Claude can read as text.
async function extract(buf, ext) {
  const kind = text.kindOf(ext);
  if (kind === 'text' || kind === 'latex') {
    if (ext === 'ipynb') {
      try {
        const nb = JSON.parse(buf.toString('utf8'));
        return (nb.cells || []).map((c) => `# [${c.cell_type}]\n${[].concat(c.source || []).join('')}`).join('\n\n');
      } catch {}
    }
    return buf.toString('utf8');
  }
  if (ext === 'docx') return (await require('mammoth').extractRawText({ buffer: buf })).value;
  if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) {
    const XLSX = require('@e965/xlsx');
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true });
    return wb.SheetNames.map((n) => `## Sheet "${n}"\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`).join('\n\n');
  }
  if (['pptx', 'odp', 'odt'].includes(ext)) {
    const zip = await require('jszip').loadAsync(buf);
    if (ext === 'pptx') {
      const names = Object.keys(zip.files).filter((n) => /^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/.test(n));
      const num = (n) => Number(/(\d+)\.xml$/.exec(n)[1]);
      const slides = names.filter((n) => n.includes('/slides/')).sort((a, b) => num(a) - num(b));
      const out = [];
      for (const n of slides) {
        const notes = zip.file(`ppt/notesSlides/notesSlide${num(n)}.xml`);
        out.push(`## Slide ${num(n)}\n${text.xmlText(await zip.file(n).async('string'))}${notes ? `\nNotes: ${text.xmlText(await notes.async('string'))}` : ''}`);
      }
      return out.join('\n\n');
    }
    const content = zip.file('content.xml');
    return content ? text.xmlText(await content.async('string')) : '';
  }
  if (ext === 'reaslides' || ext === 'workplot') return text.jsonStrings(JSON.parse(buf.toString('utf8'))).join('\n');
  return null;
}

const dir = () => path.join(app.getPath('userData'), 'Projects');
const validId = (id) => typeof id === 'string' && /^p[0-9a-f]{12}$/.test(id);
const projectDir = (id) => {
  if (!validId(id)) throw new Error('Unknown project.');
  return path.join(dir(), id);
};
const metaFile = (id) => path.join(projectDir(id), 'project.json');
const newId = (p) => `${p}${crypto.randomBytes(6).toString('hex')}`;

async function readMeta(id) {
  const p = JSON.parse(await fs.readFile(metaFile(id), 'utf8'));
  p.items ||= [];
  return p;
}

async function writeMeta(p) {
  p.updated = Date.now();
  const file = metaFile(p.id);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(p, null, 1));
  await fs.rename(`${file}.tmp`, file);
  return p;
}

async function list() {
  let names = [];
  try {
    names = await fs.readdir(dir());
  } catch {
    return [];
  }
  const out = [];
  for (const n of names.filter(validId)) {
    try {
      const p = await readMeta(n);
      out.push({ id: p.id, name: p.name, instructions: p.instructions || '', items: p.items.length, updated: p.updated, created: p.created });
    } catch {}
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

async function create({ name, instructions } = {}) {
  const id = newId('p');
  await fs.mkdir(path.join(dir(), id, 'files'), { recursive: true });
  const now = Date.now();
  return writeMeta({ id, name: String(name || '').trim().slice(0, 120) || 'Untitled project', instructions: String(instructions || '').slice(0, 20000), more: false, created: now, items: [] });
}

async function update(id, patch = {}) {
  const p = await readMeta(id);
  if (typeof patch.name === 'string' && patch.name.trim()) p.name = patch.name.trim().slice(0, 120);
  if (typeof patch.instructions === 'string') p.instructions = patch.instructions.slice(0, 20000);
  if (typeof patch.more === 'boolean') p.more = patch.more;
  return writeMeta(p);
}

async function remove(id) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
  return { ok: true };
}

// A copy that doesn't overwrite another file of the same name.
async function freeName(folder, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let i = 1; ; i++) {
    const n = i === 1 ? name : `${base} (${i})${ext}`;
    if (!fsSync.existsSync(path.join(folder, n))) return n;
  }
}

// Adds files. copy: true puts a copy inside the project; otherwise the file is linked.
async function addFiles(id, files, { copy = false } = {}) {
  const p = await readMeta(id);
  const added = [];
  const skipped = [];
  for (const file of files) {
    if (typeof file !== 'string' || !file) continue;
    let st;
    try {
      st = await fs.stat(file);
    } catch {
      skipped.push({ name: path.basename(file), error: 'File not found.' });
      continue;
    }
    const abs = path.resolve(file);
    if (st.isDirectory()) {
      if (p.items.some((it) => it.type === 'folder' && it.path === abs)) continue;
      const it = { id: newId('i'), type: 'folder', name: path.basename(abs), path: abs, added: Date.now() };
      p.items.push(it);
      added.push(it);
      continue;
    }
    if (!copy && p.items.some((it) => it.type === 'link' && it.path === abs)) {
      skipped.push({ name: path.basename(abs), error: 'Already in this project.' });
      continue;
    }
    let it;
    if (copy) {
      const folder = path.join(projectDir(id), 'files');
      await fs.mkdir(folder, { recursive: true });
      const name = await freeName(folder, path.basename(abs));
      await fs.copyFile(abs, path.join(folder, name));
      it = { id: newId('i'), type: 'file', name, stored: name, added: Date.now() };
    } else {
      it = { id: newId('i'), type: 'link', name: path.basename(abs), path: abs, added: Date.now() };
    }
    p.items.push(it);
    added.push(it);
  }
  await writeMeta(p);
  return { added, skipped };
}

async function removeItem(id, itemId) {
  const p = await readMeta(id);
  const it = p.items.find((x) => x.id === itemId);
  if (!it) return { ok: true };
  p.items = p.items.filter((x) => x !== it);
  if (it.type === 'file') await fs.rm(path.join(projectDir(id), 'files', it.stored), { force: true });
  await writeMeta(p);
  return { ok: true };
}

function itemPath(id, it) {
  return it.type === 'file' ? path.join(projectDir(id), 'files', it.stored) : it.path;
}

// Every file in a linked folder, skipping hidden files, build output and big trees.
async function walk(root) {
  const out = [];
  const queue = [[root, 0]];
  while (queue.length && out.length < MAX_FOLDER_FILES) {
    const [d, depth] = queue.shift();
    let entries = [];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && depth < 6) queue.push([full, depth + 1]);
      } else if (e.isFile() && !text.isBuildOutput(e.name)) {
        out.push(full);
        if (out.length >= MAX_FOLDER_FILES) break;
      }
    }
  }
  return out;
}

const cacheKey = (file, st) => crypto.createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex');
const cacheFile = (id, key) => path.join(projectDir(id), 'text', `${key}.txt`);

// The project's files as a flat list: { item, path, rel, name, ext, size, missing, kind, key, hasText }.
async function files(id, p = null) {
  p ||= await readMeta(id);
  const out = [];
  const add = async (item, file, rel) => {
    const ext = path.extname(file).slice(1).toLowerCase();
    let st = null;
    try {
      st = await fs.stat(file);
    } catch {}
    const kind = text.kindOf(ext);
    const key = st ? cacheKey(file, st) : null;
    out.push({ item: item.id, path: file, rel, name: path.basename(file), ext, size: st?.size || 0, modified: st?.mtimeMs || 0, missing: !st, kind, key, hasText: kind === 'pdf' && key ? fsSync.existsSync(cacheFile(id, key)) : undefined });
  };
  for (const it of p.items) {
    if (it.type === 'folder') {
      if (!fsSync.existsSync(it.path)) {
        out.push({ item: it.id, path: it.path, rel: it.name, name: it.name, ext: '', size: 0, missing: true, kind: 'folder' });
        continue;
      }
      for (const f of await walk(it.path)) await add(it, f, `${it.name}/${path.relative(it.path, f).split(path.sep).join('/')}`);
    } else {
      await add(it, itemPath(id, it), it.name);
    }
  }
  return out;
}

async function get(id) {
  const p = await readMeta(id);
  return { ...p, folder: projectDir(id), files: await files(id, p) };
}

// PDFs are read to text by pdf.js in the renderer once and kept here.
async function pdfBytes(id, file) {
  const f = (await files(id)).find((x) => x.path === file && x.kind === 'pdf' && !x.missing);
  if (!f) throw new Error('Not a PDF in this project.');
  if (f.size > 200 * 1024 * 1024) throw new Error('This PDF is too large to read.');
  return { key: f.key, data: new Uint8Array(await fs.readFile(f.path)) };
}

async function saveText(id, key, body) {
  if (!/^[0-9a-f]{40}$/.test(key || '')) throw new Error('Bad key.');
  await fs.mkdir(path.join(projectDir(id), 'text'), { recursive: true });
  await fs.writeFile(cacheFile(id, key), String(body || ''), 'utf8');
  return { ok: true };
}

// Projects a file belongs to (a copy inside the project, a link, or a file in a linked folder).
async function forPath(file) {
  if (typeof file !== 'string' || !file) return [];
  const abs = path.resolve(file);
  const inside = (root) => abs === root || abs.startsWith(root + path.sep);
  const out = [];
  for (const s of await list()) {
    try {
      const p = await readMeta(s.id);
      if (inside(path.join(projectDir(s.id), 'files')) || p.items.some((it) => (it.type === 'link' && it.path === abs) || (it.type === 'folder' && inside(it.path)))) out.push({ id: p.id, name: p.name });
    } catch {}
  }
  return out;
}

// Reads every file for Claude. Text goes in up to the project's budget, shared
// fairly so one long file can't crowd out the rest.
async function context(id) {
  const p = await readMeta(id);
  const all = await files(id, p);
  const entries = [];
  const images = [];
  const pdfs = [];
  for (const f of all) {
    if (f.missing) {
      entries.push({ f, note: 'missing (moved or deleted)' });
      continue;
    }
    try {
      if (f.kind === 'image') {
        if (f.size <= MAX_IMAGE && images.length < MAX_IMAGES) images.push(f);
        else entries.push({ f, note: 'picture not sent (too many or too large)' });
        continue;
      }
      if (f.kind === 'pdf') {
        const cached = fsSync.existsSync(cacheFile(id, f.key)) ? await fs.readFile(cacheFile(id, f.key), 'utf8') : null;
        if (cached != null && cached.trim()) entries.push({ f, body: cached });
        else if (cached == null && f.size <= MAX_PDF && pdfs.length < 3) pdfs.push(f);
        else entries.push({ f, note: cached == null ? 'PDF not read yet' : 'scanned PDF with no text layer' });
        continue;
      }
      const body = await extract(await fs.readFile(f.path), f.ext);
      if (body == null) entries.push({ f, note: `.${f.ext || 'file'} can't be read as text` });
      else entries.push({ f, body });
    } catch (err) {
      entries.push({ f, note: `couldn't be read: ${String(err.message || err).slice(0, 120)}` });
    }
  }
  const budget = p.more ? text.BUDGET_LARGE : text.BUDGET;
  const parts = text.share(entries.filter((e) => e.body != null).map((e) => e.body.length), budget);
  let k = 0;
  for (const e of entries) if (e.body != null) e.keep = parts[k++];

  const blocks = [];
  const index = all.map((f) => {
    const e = entries.find((x) => x.f === f);
    const status = f.missing ? 'missing' : e?.note || (e && e.keep < e.body.length ? `included in part (${Math.round((100 * e.keep) / e.body.length)}%)` : 'included');
    return `- ${f.rel} (${f.kind}${f.size ? `, ${text.size(f.size)}` : ''}${f.modified ? `, modified ${new Date(f.modified).toISOString().slice(0, 10)}` : ''}): ${pdfs.includes(f) || images.includes(f) ? 'included' : status}`;
  });
  blocks.push({ type: 'text', text: `<project name="${text.attr(p.name)}">\n${p.instructions ? `<instructions>\n${p.instructions}\n</instructions>\n` : ''}<files>\n${index.join('\n') || '(no files yet)'}\n</files>\n</project>` });
  for (const e of entries) {
    if (e.body == null) continue;
    const body = e.keep < e.body.length ? `${e.body.slice(0, e.keep)}\n…(rest of this file left out to fit the project in)` : e.body;
    blocks.push({ type: 'text', text: `<project_file name="${text.attr(e.f.rel)}" kind="${e.f.kind}">\n${body}\n</project_file>` });
  }
  for (const f of pdfs) blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: (await fs.readFile(f.path)).toString('base64') }, title: f.rel });
  for (const f of images) blocks.push({ type: 'text', text: `Picture: ${f.rel}` }, { type: 'image', source: { type: 'base64', media_type: text.IMAGE[f.ext], data: (await fs.readFile(f.path)).toString('base64') } });
  return { name: p.name, blocks };
}

module.exports = { extract, list, create, update, remove, addFiles, removeItem, get, files, pdfBytes, saveText, forPath, context, itemPath, readMeta };
