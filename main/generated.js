'use strict';

// Turns what Claude made in the Claude app, or a slide Plot made, into the
// file info a Write, Plot or Present window opens with (an unsaved new file).

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

// Markdown "- [ ]" lists become Write checklists.
function taskLists(html) {
  return html
    .replace(/<ul>(\s*<li><input)/g, '<ul data-type="taskList">$1')
    .replace(/<li><input (checked="" )?disabled="" type="checkbox">\s?/g, (m, checked) => `<li data-type="taskItem" data-checked="${checked ? 'true' : 'false'}">`);
}

async function toFileInfo(spec) {
  const title = safeName(spec.title, 'Untitled');
  if (spec.kind === 'document') {
    const { marked } = await import('marked'); // ESM-only package
    const notes = spec.style === 'notes';
    return { app: 'docs', path: null, name: title, generated: true, notes, data: { html: taskLists(await marked.parse(spec.markdown || '')), notes } };
  }
  if (spec.kind === 'spreadsheet') {
    const sheets = (spec.sheets || []).map(sheetFrom);
    if (!sheets.length) sheets.push({ name: 'Sheet1', cells: {}, cols: {} });
    return { app: 'sheets', path: null, name: title, generated: true, data: { sheets, active: 0 } };
  }
  if (spec.kind === 'presentation') {
    return { app: 'slides', path: null, name: title, generated: true, data: { deckSpec: { title, slides: spec.slides || [] }, theme: THEMES.includes(spec.theme) ? spec.theme : 'paper' } };
  }
  if (spec.kind === 'deck') {
    const slides = (spec.slides || []).map((sl, i) => ({
      id: String(sl.id || `s${i}`),
      layout: sl.layout || 'blank',
      notes: String(sl.notes || ''),
      elements: (sl.elements || []).filter((el) => ['text', 'image', 'table'].includes(el?.type) && el.id),
    }));
    const custom = spec.themeData?.custom && spec.themeData.id === spec.theme ? spec.themeData : null;
    return { app: 'slides', path: null, name: title, generated: true, data: { slides, theme: custom ? custom.id : THEMES.includes(spec.theme) ? spec.theme : 'paper', ...(custom ? { themeData: custom } : {}) } };
  }
  throw new Error('Nothing to open: Claude answered in the chat.');
}

module.exports = { toFileInfo, taskLists };
