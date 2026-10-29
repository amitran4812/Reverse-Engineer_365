'use strict';

// Turns what Claude made in the Claude app into the file info a Write, Plot
// or Present window opens with (an unsaved new file).

const { refName, colName } = require('../common/cellref');

const THEMES = ['paper', 'slate', 'midnight', 'sunrise', 'forest', 'berry'];
const safeName = (t, fallback) => String(t || fallback).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;

function sheetFrom(s, i) {
  const cells = {};
  const cols = {};
  const rows = [s.columns || [], ...(s.rows || [])];
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === '' || v == null) return;
    cells[refName(r, c)] = r === 0 ? { v: String(v), s: { b: true, bg: '#e8f3ec' } } : { v: String(v) };
  }));
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let c = 0; c < width; c += 1) {
    const longest = Math.max(...rows.map((r) => String(r[c] ?? '').length));
    if (longest > 10) cols[colName(c)] = Math.min(320, 24 + longest * 7);
  }
  return { name: safeName(s.name, `Sheet${i + 1}`).slice(0, 31), cells, cols };
}

async function toFileInfo(spec) {
  const title = safeName(spec.title, 'Untitled');
  if (spec.kind === 'document') {
    const { marked } = await import('marked'); // ESM-only package
    return { app: 'docs', path: null, name: title, generated: true, data: { html: await marked.parse(spec.markdown || '') } };
  }
  if (spec.kind === 'spreadsheet') {
    const sheets = (spec.sheets || []).map(sheetFrom);
    if (!sheets.length) sheets.push({ name: 'Sheet1', cells: {}, cols: {} });
    return { app: 'sheets', path: null, name: title, generated: true, data: { sheets, active: 0 } };
  }
  if (spec.kind === 'presentation') {
    return { app: 'slides', path: null, name: title, generated: true, data: { deckSpec: { title, slides: spec.slides || [] }, theme: THEMES.includes(spec.theme) ? spec.theme : 'paper' } };
  }
  throw new Error('Nothing to open: Claude answered in the chat.');
}

module.exports = { toFileInfo };
