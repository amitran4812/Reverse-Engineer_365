'use strict';

// LaTeX projects for Write: a folder on disk with .tex, .bib and image files.
// Compiles run in a mirror of the project under the app's data folder, so
// auxiliary files never clutter the user's folder and unsaved edits can be
// compiled without saving. Engines: the bundled Tectonic, or a TeX
// distribution already installed (MiKTeX, TeX Live, MacTeX).

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { app } = require('electron');
const tex = require('../common/latex');

const SKIP_DIRS = new Set(['node_modules', '__MACOSX', '.git', '.svn', '.hg', '.vscode', '.idea']);
const MAX_ENTRIES = 3000;
const MAX_TEXT = 8 * 1024 * 1024;
const running = new Map(); // project root -> child process

// Resolves a project-relative path, refusing anything outside the project.
function inside(root, rel = '') {
  const full = path.resolve(root, String(rel || '').replace(/^[\\/]+/, ''));
  const back = path.relative(root, full);
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('That file is outside the project folder.');
  return full;
}

const toRel = (root, full) => path.relative(root, full).split(path.sep).join('/');

async function list(root) {
  const out = [];
  async function walk(dir, depth) {
    if (out.length >= MAX_ENTRIES || depth > 8) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.isDirectory() ? -1 : 1));
    for (const e of entries) {
      if (out.length >= MAX_ENTRIES) return;
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push({ path: toRel(root, full), dir: true });
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        if (/\.(aux|log|out|toc|lof|lot|fls|fdb_latexmk|synctex\.gz|synctex|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv)$/i.test(e.name)) continue;
        out.push({ path: toRel(root, full), kind: tex.fileKind(e.name) });
      }
    }
  }
  await walk(root, 0);
  return out;
}

// Text files come back as { text }; images and PDFs as { base64, mime }.
async function read(root, rel) {
  const full = inside(root, rel);
  const stat = await fsp.stat(full);
  const kind = tex.fileKind(full);
  if (kind === 'image') {
    if (stat.size > 40 * 1024 * 1024) return { tooBig: true, size: stat.size };
    const ext = tex.extOf(full);
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf', bmp: 'image/bmp', webp: 'image/webp' }[ext];
    if (!mime) return { binary: true, size: stat.size };
    return { base64: (await fsp.readFile(full)).toString('base64'), mime };
  }
  if (stat.size > MAX_TEXT) return { tooBig: true, size: stat.size };
  const buf = await fsp.readFile(full);
  if (kind === 'other' && buf.subarray(0, 8000).includes(0)) return { binary: true, size: stat.size };
  return { text: buf.toString('utf8') };
}

// All .tex and .bib text in the project, for labels, citations and the main file.
async function sources(root) {
  const files = (await list(root)).filter((f) => f.kind === 'tex' || f.kind === 'bib');
  const out = [];
  for (const f of files.slice(0, 400)) {
    try {
      const full = inside(root, f.path);
      if ((await fsp.stat(full)).size > 2 * 1024 * 1024) continue;
      out.push({ path: f.path, text: await fsp.readFile(full, 'utf8') });
    } catch {
      // unreadable file: skip
    }
  }
  return out;
}

async function write(root, rel, text) {
  const full = inside(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, String(text), 'utf8');
  return { ok: true };
}

async function create(root, rel, { folder = false, text = '' } = {}) {
  const full = inside(root, rel);
  if (fs.existsSync(full)) throw new Error(`${path.basename(full)} already exists.`);
  if (folder) await fsp.mkdir(full, { recursive: true });
  else {
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, text, 'utf8');
  }
  return { ok: true, path: toRel(root, full) };
}

async function rename(root, from, to) {
  const a = inside(root, from);
  const b = inside(root, to);
  if (a === root) throw new Error('Can’t rename the project folder here.');
  if (fs.existsSync(b) && a.toLowerCase() !== b.toLowerCase()) throw new Error(`${path.basename(b)} already exists.`);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  return { ok: true, path: toRel(root, b) };
}

// Copies files from elsewhere on the computer into a project folder.
async function importPaths(root, paths, dir = '') {
  const target = inside(root, dir);
  await fsp.mkdir(target, { recursive: true });
  const added = [];
  for (const src of paths) {
    const stat = await fsp.stat(src).catch(() => null);
    if (!stat?.isFile()) continue;
    let name = path.basename(src);
    let dest = path.join(target, name);
    for (let n = 2; fs.existsSync(dest) && path.resolve(dest) !== path.resolve(src); n++) {
      const ext = path.extname(name);
      dest = path.join(target, `${path.basename(name, ext)}-${n}${ext}`);
    }
    if (path.resolve(dest) !== path.resolve(src)) await fsp.copyFile(src, dest);
    added.push(toRel(root, dest));
  }
  return { ok: true, added };
}

// Unpacks a project .zip (the kind online LaTeX editors export) into dest. A
// single top-level folder is dropped, Mac and Windows clutter is skipped, and
// every path must stay inside dest. Existing files are kept: clashes get -2.
const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
async function importZip(zipPath, dest, dir = '') {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(await fsp.readFile(zipPath)).catch(() => {
    throw new Error('That file isn’t a .zip archive Work can read.');
  });
  const clutter = (seg) => seg === '__MACOSX' || seg === '.DS_Store' || seg === 'Thumbs.db' || seg.startsWith('._');
  let entries = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => ({ f, parts: f.name.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.') }))
    .filter((e) => e.parts.length && !e.parts.some(clutter));
  if (!entries.length) throw new Error('The .zip is empty.');
  if (entries.length > MAX_ENTRIES) throw new Error(`The .zip has more than ${MAX_ENTRIES} files.`);
  while (entries.every((e) => e.parts.length > 1 && e.parts[0] === entries[0].parts[0])) entries = entries.map((e) => ({ ...e, parts: e.parts.slice(1) }));
  const target = inside(dest, dir);
  const added = [];
  let total = 0;
  for (const { f, parts } of entries) {
    let full = inside(target, parts.join('/'));
    const data = await f.async('nodebuffer');
    total += data.length;
    if (total > MAX_ZIP_BYTES) throw new Error('The .zip unpacks to more than 1 GB.');
    await fsp.mkdir(path.dirname(full), { recursive: true });
    for (let n = 2; fs.existsSync(full); n++) {
      const ext = path.extname(parts[parts.length - 1]);
      full = path.join(path.dirname(full), `${path.basename(parts[parts.length - 1], ext)}-${n}${ext}`);
    }
    await fsp.writeFile(full, data);
    added.push(toRel(dest, full));
  }
  return { ok: true, added };
}

// Folder for a project unpacked from a .zip: next to the .zip, named after it.
function zipFolder(zipPath) {
  const base = path.join(path.dirname(zipPath), path.basename(zipPath, path.extname(zipPath)).trim() || 'project');
  let dest = base;
  for (let n = 2; fs.existsSync(dest); n++) dest = `${base}-${n}`;
  return dest;
}

// New project from the template, or nothing if the folder already has .tex files.
async function scaffold(root) {
  const existing = (await list(root)).filter((f) => f.kind === 'tex');
  if (existing.length) return false;
  for (const [name, text] of Object.entries(tex.NEW_PROJECT)) {
    const full = path.join(root, name);
    if (!fs.existsSync(full)) await fsp.writeFile(full, text, 'utf8');
  }
  await fsp.mkdir(path.join(root, 'figures'), { recursive: true });
  return true;
}

async function mainFile(root) {
  return tex.findMain(await sources(root));
}

// ---- Engines ----

const isWin = process.platform === 'win32';
const exe = (name) => (isWin ? `${name}.exe` : name);

function extraTexDirs() {
  const dirs = [];
  if (isWin) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    for (const base of [path.join(local, 'Programs', 'MiKTeX'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MiKTeX'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'MiKTeX')]) {
      dirs.push(path.join(base, 'miktex', 'bin', 'x64'), path.join(base, 'miktex', 'bin'));
    }
    for (const base of ['C:\\texlive', path.join(os.homedir(), 'texlive')]) {
      try {
        for (const year of fs.readdirSync(base).sort().reverse()) {
          for (const sub of ['windows', 'win64', 'win32']) dirs.push(path.join(base, year, 'bin', sub));
        }
      } catch {
        // not installed
      }
    }
  } else {
    dirs.push('/Library/TeX/texbin', '/usr/local/texlive/bin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
    for (const base of ['/usr/local/texlive', path.join(os.homedir(), 'texlive')]) {
      try {
        for (const year of fs.readdirSync(base).sort().reverse()) {
          const bin = path.join(base, year, 'bin');
          for (const arch of fs.readdirSync(bin)) dirs.push(path.join(bin, arch));
        }
      } catch {
        // not installed
      }
    }
  }
  return dirs;
}

let searchDirs = null;
function which(name) {
  searchDirs ||= [...new Set([...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...extraTexDirs()])];
  for (const dir of searchDirs) {
    const full = path.join(dir, exe(name));
    try {
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // keep looking
    }
  }
  return null;
}

function bundledTectonic() {
  const dirs = app.isPackaged
    ? [path.join(process.resourcesPath, 'tectonic')]
    : [path.join(__dirname, '..', 'build', 'tectonic')];
  for (const d of dirs) {
    const full = path.join(d, exe('tectonic'));
    if (fs.existsSync(full)) return { bin: full, seed: path.join(d, 'cache') };
  }
  return null;
}

const ENGINES = [
  { id: 'tectonic', label: 'Tectonic (built in)', detail: 'Downloads missing packages once, then works offline' },
  { id: 'latexmk', label: 'latexmk (pdfLaTeX)', detail: 'Uses your MiKTeX or TeX Live' },
  { id: 'pdflatex', label: 'pdfLaTeX', detail: 'Uses your MiKTeX or TeX Live' },
  { id: 'xelatex', label: 'XeLaTeX', detail: 'System fonts and Unicode' },
  { id: 'lualatex', label: 'LuaLaTeX', detail: 'System fonts and Lua scripting' },
];

function engines() {
  const found = {
    tectonic: bundledTectonic()?.bin || which('tectonic'),
    latexmk: which('latexmk'),
    pdflatex: which('pdflatex'),
    xelatex: which('xelatex'),
    lualatex: which('lualatex'),
  };
  return ENGINES.map((e) => ({ ...e, available: !!found[e.id], path: found[e.id] || null }));
}

function pickEngine(choice) {
  const list = engines();
  const want = list.find((e) => e.id === choice && e.available);
  if (want) return want;
  return list.find((e) => e.available) || null;
}

// Tectonic keeps downloaded packages in a cache. The installer ships one
// pre-filled with common packages, copied here on first use so the first
// compile works without a connection.
async function tectonicCache() {
  const dir = path.join(app.getPath('userData'), 'tectonic-cache');
  const seed = bundledTectonic()?.seed;
  if (!fs.existsSync(dir) && seed && fs.existsSync(seed)) {
    await fsp.cp(seed, dir, { recursive: true }).catch(() => {});
  }
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function run(root, cmd, args, { cwd, env, timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true });
    running.set(root, child);
    const add = (d) => {
      if (out.length < 2 * 1024 * 1024) out += d.toString();
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      out += `\nerror: Stopped after ${Math.round(timeout / 1000)} seconds.\n`;
      child.kill();
    }, timeout);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, out: `${out}\nerror: ${err.message}\n` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (running.get(root) === child) running.delete(root);
      resolve({ code: signal ? -1 : code, out, killed: !!signal, stopped: !!child.stoppedByUser });
    });
  });
}

function stop(root) {
  const child = running.get(root);
  if (child) {
    child.stoppedByUser = true;
    child.kill();
  }
  running.delete(root);
}

// Mirrors the project into the build folder, copying only changed files,
// then writes unsaved editor buffers over the copies.
async function mirror(root, dest, overrides) {
  await fsp.mkdir(dest, { recursive: true });
  const files = (await list(root)).filter((f) => !f.dir);
  for (const f of files) {
    const src = path.join(root, f.path);
    const dst = path.join(dest, f.path);
    const [a, b] = await Promise.all([fsp.stat(src).catch(() => null), fsp.stat(dst).catch(() => null)]);
    if (!a) continue;
    if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
  }
  for (const [rel, text] of Object.entries(overrides || {})) {
    const dst = inside(dest, rel);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    const current = await fsp.readFile(dst, 'utf8').catch(() => null);
    if (current !== text) await fsp.writeFile(dst, text, 'utf8');
  }
}

function buildDir(root) {
  const id = crypto.createHash('sha1').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'latex-builds', id);
}

const readMaybe = (file, enc) => fsp.readFile(file, enc).catch(() => null);
const NETWORK_TROUBLE = /(dns|resolve|connect|network|timed? ?out|unreachable|failed to (?:download|fetch|open)|http|ssl|tls|certificate)/i;

async function runTectonic(root, eng, dir, main) {
  const cache = await tectonicCache();
  const args = ['-X', 'compile', '--synctex', '--keep-logs', '--keep-intermediates', main];
  const env = { TECTONIC_CACHE_DIR: cache };
  let res = await run(root, eng.path, args, { cwd: dir, env, timeout: 300000 });
  // Offline: try again with only the packages already downloaded.
  if (res.code !== 0 && !res.killed && NETWORK_TROUBLE.test(res.out)) {
    const again = await run(root, eng.path, ['-X', 'compile', '--only-cached', ...args.slice(2)], { cwd: dir, env, timeout: 300000 });
    if (!again.killed) res = { ...again, out: `${again.out}\n(Offline: compiled with the packages already on this computer.)\n` };
  }
  return res;
}

async function runLatex(root, eng, dir, main) {
  const base = main.replace(/\.[^.]+$/, '');
  const common = ['-interaction=nonstopmode', '-file-line-error', '-synctex=1'];
  if (eng.id === 'latexmk') {
    const res = await run(root, eng.path, ['-pdf', '-f', ...common, main], { cwd: dir });
    return res;
  }
  let out = '';
  let res;
  for (let pass = 0; pass < 4; pass++) {
    res = await run(root, eng.path, [...common, main], { cwd: dir });
    out += res.out;
    if (res.killed) break;
    const log = (await readMaybe(path.join(dir, `${base}.log`), 'utf8')) || '';
    const aux = (await readMaybe(path.join(dir, `${base}.aux`), 'utf8')) || '';
    if (pass === 0 && fs.existsSync(path.join(dir, `${base}.bcf`)) && which('biber')) {
      out += (await run(root, which('biber'), [base], { cwd: dir })).out;
      continue;
    }
    if (pass === 0 && /\\bibdata\{/.test(aux) && which('bibtex')) {
      out += (await run(root, which('bibtex'), [base], { cwd: dir })).out;
      continue;
    }
    if (!/Rerun to get|Label\(s\) may have changed|Please rerun|rerunfilecheck|There were undefined references/.test(log) || pass >= 2) break;
  }
  return { ...res, out };
}

// Compiles the project. Returns the PDF bytes, the log, parsed issues and
// the SyncTeX data for jumping between source and preview.
async function compile(root, { main, overrides, engine } = {}) {
  main = main || (await mainFile(root));
  if (!main) return { ok: false, issues: [{ level: 'error', file: null, line: null, message: 'This project has no .tex file with \\documentclass to compile.' }], log: '' };
  inside(root, main);
  const eng = pickEngine(engine);
  if (!eng) return { ok: false, noEngine: true, issues: [{ level: 'error', file: null, line: null, message: 'No LaTeX engine was found. Reinstall Work to get the built-in one, or install MiKTeX or TeX Live.' }], log: '' };
  stop(root);
  const started = Date.now();
  const dir = path.join(buildDir(root), 'src');
  await mirror(root, dir, overrides);
  const base = main.replace(/\.[^.]+$/, '');
  const mainDir = path.dirname(path.join(dir, main));
  const mainName = path.basename(main);
  const pdfFile = path.join(dir, `${base}.pdf`);
  const before = (await fsp.stat(pdfFile).catch(() => null))?.mtimeMs || 0;
  const res = eng.id === 'tectonic' ? await runTectonic(root, eng, mainDir, mainName) : await runLatex(root, eng, mainDir, mainName);
  if (res.stopped) return { ok: false, stopped: true, issues: [], log: res.out };
  const stem = path.join(dir, base);
  const [log, blg, pdfStat, syncGz, sync] = await Promise.all([
    readMaybe(`${stem}.log`, 'utf8'),
    readMaybe(`${stem}.blg`, 'utf8'),
    fsp.stat(pdfFile).catch(() => null),
    readMaybe(`${stem}.synctex.gz`),
    readMaybe(`${stem}.synctex`, 'utf8'),
  ]);
  const fresh = pdfStat && pdfStat.mtimeMs > before - 1;
  const fullLog = [log || '', blg ? `\n---- BibTeX ----\n${blg}` : '', `\n---- ${eng.label} ----\n${res.out}`].join('');
  // The final .log holds the last pass; earlier passes' warnings (undefined
  // references before BibTeX ran) only appear in the console output.
  const consoleErrors = log ? res.out.split('\n').filter((l) => /^error: /.test(l)).join('\n') : res.out;
  const issues = tex.parseLog(`${log || ''}\n${blg || ''}\n${consoleErrors}`, mainName).map((i) => ({ ...i, file: i.file ? sourcePath(dir, mainDir, i.file) : i.file }));
  let synctex = null;
  try {
    synctex = syncGz ? zlib.gunzipSync(syncGz).toString('utf8') : sync;
    synctex = synctex?.replace(/^Input:(\d+):(.*)$/gm, (m, id, file) => `Input:${id}:${sourcePath(dir, mainDir, file)}`) || null;
  } catch {
    synctex = null;
  }
  if (res.code !== 0 && !issues.some((i) => i.level === 'error')) {
    issues.unshift({ level: 'error', file: null, line: null, message: fresh ? 'The compiler reported a problem. See the full log.' : 'The compile failed. See the full log for details.' });
  }
  return {
    ok: res.code === 0 && !!fresh,
    pdf: pdfStat ? new Uint8Array(await fsp.readFile(pdfFile)) : null,
    fresh: !!fresh,
    log: fullLog,
    issues,
    synctex,
    engine: eng.label,
    ms: Date.now() - started,
  };
}

// Paths in logs and SyncTeX are relative to the build folder or absolute;
// map them back to project-relative paths.
function sourcePath(buildRoot, mainDir, file) {
  const full = path.isAbsolute(file) ? path.normalize(file) : path.resolve(mainDir, file);
  const rel = path.relative(buildRoot, full);
  return rel.startsWith('..') ? file : rel.split(path.sep).join('/');
}

async function lastPdf(root, main) {
  const base = (main || (await mainFile(root)) || 'main.tex').replace(/\.[^.]+$/, '');
  const file = path.join(buildDir(root), 'src', `${base}.pdf`);
  return fs.existsSync(file) ? file : null;
}

module.exports = { inside, list, read, sources, write, create, rename, importPaths, importZip, zipFolder, scaffold, mainFile, engines, compile, stop, lastPdf, sourcePath };
