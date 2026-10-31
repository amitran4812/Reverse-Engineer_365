'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const docx = require('./docx');
const xlsx = require('./xlsx');
const { exportPptx } = require('./pptx');
const imports = require('./imports');

// Which app opens which extension, and what each app can save to.
const APPS = {
  docs: {
    open: ['docx', 'odt', 'html', 'htm', 'md', 'txt', 'tex'],
    save: [
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Web page', extensions: ['html'] },
      { name: 'Plain text', extensions: ['txt'] },
    ],
  },
  sheets: {
    open: ['xlsx', 'xlsm', 'xltx', 'xls', 'ods', 'csv', 'tsv', 'tab', 'parquet', 'workplot'],
    save: [
      { name: 'Excel workbook', extensions: ['xlsx'] },
      { name: 'CSV (current sheet)', extensions: ['csv'] },
      { name: 'OpenDocument spreadsheet', extensions: ['ods'] },
    ],
  },
  pdf: {
    open: ['pdf'],
    save: [{ name: 'PDF', extensions: ['pdf'] }],
  },
  slides: {
    open: ['reaslides', 'pptx', 'odp'],
    save: [
      { name: 'Present presentation', extensions: ['reaslides'] },
      { name: 'PowerPoint presentation (export)', extensions: ['pptx'] },
    ],
  },
};

// Formats Work reads but can't write back: they open as an unsaved copy.
const IMPORT_ONLY = ['odt', 'xlsm', 'xltx', 'xls', 'pptx', 'odp'];

const BLANK = {
  docs: () => ({ html: '' }),
  sheets: () => ({ sheets: [{ name: 'Sheet1', cells: {}, cols: {} }] }),
  slides: () => ({ deckSpec: { slides: [] }, theme: 'paper' }),
};

function extOf(file) {
  return path.extname(file).slice(1).toLowerCase();
}

function appForFile(file) {
  const ext = extOf(file);
  return Object.keys(APPS).find((k) => APPS[k].open.includes(ext)) || null;
}

// Files bigger than a sheet should hold open in Plot's analysis workspace,
// which streams them into columns instead of building a cell grid.
const ANALYSIS_ALWAYS = ['tsv', 'tab', 'parquet'];
const ANALYSIS_OVER = { csv: 8 * 1024 * 1024, xlsx: 12 * 1024 * 1024, xlsm: 12 * 1024 * 1024 };

// A saved analysis points at its data file; look next to the project too.
function resolveSource(projectPath, source) {
  if (!source?.path) return null;
  if (fsSync.existsSync(source.path)) return source.path;
  const near = path.join(path.dirname(projectPath), path.basename(source.path));
  return fsSync.existsSync(near) ? near : null;
}

async function analysisLaunch(file, ext, name, size) {
  if (ext === 'workplot') {
    const project = JSON.parse(await fs.readFile(file, 'utf8'));
    const source = resolveSource(file, project.source);
    const steps = (project.steps || []).map((st) => resolveSource(file, st.source));
    return { app: 'sheets', path: null, name, ext, data: BLANK.sheets(), analysis: { project, projectPath: file, path: source, steps } };
  }
  if (ANALYSIS_ALWAYS.includes(ext) || size > (ANALYSIS_OVER[ext] ?? Infinity)) {
    return { app: 'sheets', path: null, name: name.replace(/\.[^.]+$/, ''), ext, data: BLANK.sheets(), analysis: { path: file } };
  }
  return null;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function openFile(file) {
  const ext = extOf(file);
  const app = appForFile(file);
  const name = path.basename(file);
  if (ext === 'tex') return latexProject(file);
  // Read loads the bytes itself, through its own IPC.
  if (ext === 'pdf') return { app: 'pdf', path: file, name, ext };
  // Right-click > New makes an empty file; open it as a blank document.
  const { size } = await fs.stat(file);
  if (app && size === 0) return { app, path: file, name, ext, data: BLANK[app]() };
  if (app === 'sheets') {
    const big = await analysisLaunch(file, ext, name, size);
    if (big) return big;
  }
  let data;
  switch (ext) {
    case 'odt':
      data = await imports.importOdt(await fs.readFile(file));
      break;
    case 'xlsm':
    case 'xltx': {
      const buf = await fs.readFile(file);
      data = await xlsx.importXlsx(buf).catch(() => imports.importSheetJs(buf));
      break;
    }
    case 'xls':
    case 'ods':
      data = imports.importSheetJs(await fs.readFile(file));
      break;
    case 'pptx':
      data = { deckSpec: await imports.importPptx(await fs.readFile(file)), theme: 'paper' };
      break;
    case 'odp':
      data = { deckSpec: await imports.importOdp(await fs.readFile(file)), theme: 'paper' };
      break;
    case 'docx':
      data = await docx.importDocx(await fs.readFile(file));
      break;
    case 'html':
    case 'htm': {
      const html = await fs.readFile(file, 'utf8');
      const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
      data = { html: body ? body[1] : html };
      break;
    }
    case 'md': {
      const { marked } = await import('marked'); // ESM-only package
      data = { html: await marked.parse(await fs.readFile(file, 'utf8')) };
      break;
    }
    case 'txt': {
      const text = await fs.readFile(file, 'utf8');
      data = { html: text.split(/\r?\n/).map((l) => `<p>${escapeHtml(l)}</p>`).join('') };
      break;
    }
    case 'xlsx':
      data = await xlsx.importXlsx(await fs.readFile(file));
      break;
    case 'csv':
      data = xlsx.importCsv(await fs.readFile(file, 'utf8'));
      break;
    case 'reaslides':
      data = JSON.parse(await fs.readFile(file, 'utf8'));
      break;
    default:
      throw new Error(`Unsupported file type: .${ext}`);
  }
  if (IMPORT_ONLY.includes(ext)) return { app, path: null, name, ext, data, generated: true, importedFrom: file };
  return { app, path: file, name, ext, data };
}

// Reads a spreadsheet file into the sheet model without opening it, for
// combining it with the open workbook. Big files belong in the analysis workspace.
const TABLE_EXTS = ['xlsx', 'xlsm', 'xltx', 'xls', 'ods', 'csv', 'tsv', 'tab', 'txt'];
const TABLE_MAX = 40 * 1024 * 1024;

async function readTable(file) {
  const ext = extOf(file);
  if (!TABLE_EXTS.includes(ext)) throw new Error(`Work can't read .${ext} files as a table`);
  const { size } = await fs.stat(file);
  if (size > TABLE_MAX) throw new Error(`${path.basename(file)} is too big for a sheet. Open it on the Analysis tab and use Add rows or Add columns there.`);
  let data;
  if (ext === 'csv') data = xlsx.importCsv(await fs.readFile(file, 'utf8'));
  else if (ext === 'tsv' || ext === 'tab' || ext === 'txt') data = xlsx.importCsv(await fs.readFile(file, 'utf8'), '\t');
  else if (ext === 'xls' || ext === 'ods') data = imports.importSheetJs(await fs.readFile(file));
  else {
    const buf = await fs.readFile(file);
    data = await xlsx.importXlsx(buf).catch(() => imports.importSheetJs(buf));
  }
  return { name: path.basename(file), data };
}

// A .tex file opens its folder as a LaTeX project in Write. A "% !TEX root"
// comment points at the main file when the opened file is a chapter.
async function latexProject(file) {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const rootComment = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im.exec(text.slice(0, 2000));
  const mainPath = rootComment ? path.resolve(path.dirname(file), rootComment[1]) : file;
  const root = path.dirname(mainPath);
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const isMain = rootComment || /^[^%\n]*\\documentclass/m.test(text);
  return { app: 'docs', path: file, name: path.basename(root), ext: 'tex', latex: { root, main: isMain ? rel(mainPath) : null, open: rel(file) } };
}

function htmlPage(title, body) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:Calibri,Carlito,"Segoe UI",system-ui,sans-serif;max-width:8.5in;margin:1in auto;line-height:1.5;color:#1f2328}
table{border-collapse:collapse}td,th{border:1px solid #b0b7c3;padding:4px 8px}img{max-width:100%}blockquote{border-left:3px solid #b0b7c3;margin-left:0;padding-left:12px;color:#555}</style>
</head><body>
${body}
</body></html>`;
}

// payload is what the app hands over: docs {json, html, text, page}; sheets/slides their model.
async function saveFile(appName, file, payload) {
  const ext = extOf(file);
  const title = path.basename(file, path.extname(file));
  let out;
  if (appName === 'docs') {
    if (ext === 'docx') out = await docx.exportDocx({ ...payload, title });
    else if (ext === 'html' || ext === 'htm') out = htmlPage(title, payload.html);
    else if (ext === 'txt' || ext === 'md') out = payload.text;
  } else if (appName === 'sheets') {
    if (ext === 'xlsx') out = await xlsx.exportXlsx(payload);
    else if (ext === 'csv') out = `﻿${xlsx.exportCsv(payload, payload.active || 0)}`;
    else if (ext === 'ods') out = xlsx.exportOds(payload);
  } else if (appName === 'slides') {
    const { export: resolved, ...native } = payload;
    if (ext === 'reaslides') out = JSON.stringify(native);
    else if (ext === 'pptx') out = await exportPptx({ ...(resolved || native), title });
  }
  if (out === undefined) throw new Error(`Can't save ${appName} as .${ext}`);
  await fs.writeFile(file, out);
  return { path: file, name: path.basename(file), ext };
}

module.exports = { APPS, IMPORT_ONLY, TABLE_EXTS, appForFile, openFile, readTable, saveFile, extOf };
