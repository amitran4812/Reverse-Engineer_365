'use strict';

// Files the user attaches to a Claude message. PDFs and images go to Claude
// as they are; Office files and text are converted to text first. Attachments
// are kept in memory for the session and referenced from messages by id.

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const store = new Map(); // id -> { name, kind, size, blocks }

const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const TEXT = ['txt', 'md', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'js', 'py', 'log'];
const MAX_PDF = 30 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_TEXT = 400000; // characters

const EXTENSIONS = ['pdf', ...Object.keys(IMAGE), 'docx', 'xlsx', ...TEXT];

const clip = (s) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n…(truncated)` : s);
const textBlock = (name, body) => ({ type: 'text', text: `<attachment name="${name.replace(/"/g, "'")}">\n${clip(body)}\n</attachment>` });

async function xlsxText(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const parts = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const v = cell.value;
        let t = v == null ? '' : typeof v === 'object' ? (v.formula ? `=${v.formula} → ${v.result ?? ''}` : v.text ?? v.result ?? (v instanceof Date ? v.toISOString().slice(0, 10) : JSON.stringify(v))) : String(v);
        vals[col - 1] = String(t).includes(',') ? `"${String(t).replace(/"/g, '""')}"` : t;
      });
      rows.push(`${row.number}: ${vals.map((x) => x ?? '').join(',')}`);
    });
    parts.push(`## Sheet "${ws.name}" (row: values)\n${rows.join('\n')}`);
  });
  return parts.join('\n\n');
}

async function load(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const name = path.basename(file);
  const buf = await fs.readFile(file);
  let kind;
  let blocks;
  if (ext === 'pdf') {
    if (buf.length > MAX_PDF) throw new Error(`${name} is larger than 30 MB.`);
    kind = 'pdf';
    blocks = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: name }];
  } else if (IMAGE[ext]) {
    if (buf.length > MAX_IMAGE) throw new Error(`${name} is larger than 5 MB.`);
    kind = 'image';
    blocks = [{ type: 'text', text: `Image: ${name}` }, { type: 'image', source: { type: 'base64', media_type: IMAGE[ext], data: buf.toString('base64') } }];
  } else if (ext === 'docx') {
    kind = 'document';
    const { value } = await require('mammoth').extractRawText({ buffer: buf });
    blocks = [textBlock(name, value)];
  } else if (ext === 'xlsx') {
    kind = 'spreadsheet';
    blocks = [textBlock(name, await xlsxText(buf))];
  } else if (TEXT.includes(ext)) {
    kind = 'text';
    blocks = [textBlock(name, buf.toString('utf8'))];
  } else {
    throw new Error(`Claude can't read .${ext} files yet. Try PDF, an image, .docx, .xlsx, .csv or text.`);
  }
  const id = `att_${crypto.randomBytes(8).toString('hex')}`;
  store.set(id, { name, kind, size: buf.length, blocks });
  return { id, name, kind, size: buf.length };
}

// Loads several files; failures come back as { name, error } entries.
async function loadAll(files) {
  const out = [];
  for (const f of files) {
    try {
      out.push(await load(f));
    } catch (err) {
      out.push({ name: path.basename(f), error: String(err.message || err) });
    }
  }
  return out;
}

function blocks(ids) {
  return (ids || []).flatMap((id) => store.get(id)?.blocks || []);
}

module.exports = { EXTENSIONS, loadAll, blocks };
