'use strict';

const fs = require('fs/promises');
const path = require('path');
const docx = require('./docx');
const xlsx = require('./xlsx');
const { exportPptx } = require('./pptx');

// Which app opens which extension, and what each app can save to.
const APPS = {
  docs: {
    open: ['docx', 'html', 'htm', 'md', 'txt'],
    save: [
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Web page', extensions: ['html'] },
      { name: 'Plain text', extensions: ['txt'] },
    ],
  },
  sheets: {
    open: ['xlsx', 'csv'],
    save: [
      { name: 'Excel workbook', extensions: ['xlsx'] },
      { name: 'CSV (current sheet)', extensions: ['csv'] },
    ],
  },
  slides: {
    open: ['reaslides'],
    save: [
      { name: 'Rea Present presentation', extensions: ['reaslides'] },
      { name: 'PowerPoint presentation (export)', extensions: ['pptx'] },
    ],
  },
};

function extOf(file) {
  return path.extname(file).slice(1).toLowerCase();
}

function appForFile(file) {
  const ext = extOf(file);
  return Object.keys(APPS).find((k) => APPS[k].open.includes(ext)) || null;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function openFile(file) {
  const ext = extOf(file);
  const app = appForFile(file);
  const name = path.basename(file);
  let data;
  switch (ext) {
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
  return { app, path: file, name, ext, data };
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
  } else if (appName === 'slides') {
    const { export: resolved, ...native } = payload;
    if (ext === 'reaslides') out = JSON.stringify(native);
    else if (ext === 'pptx') out = await exportPptx({ ...(resolved || native), title });
  }
  if (out === undefined) throw new Error(`Can't save ${appName} as .${ext}`);
  await fs.writeFile(file, out);
  return { path: file, name: path.basename(file), ext };
}

module.exports = { APPS, appForFile, openFile, saveFile, extOf };
