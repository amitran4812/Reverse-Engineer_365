// Turns the open PDF into a Write document, notes, a Plot workbook or a
// Present deck. Text keeps its headings, paragraphs and lists; tables are
// guessed from where text lines up; slides show each page as a picture.

import { toast } from '../shared/shell.js';
import { MARKUPS, linesToTable, marksToMarkdown, pagesToMarkdown, textLines, textUnder } from './annot-data.js';

const MAX_TEXT_PAGES = 400;
const MAX_SLIDES = 80;

async function pageLines(reader, onProgress) {
  const out = [];
  const n = Math.min(reader.pageCount, MAX_TEXT_PAGES);
  for (let i = 0; i < n; i++) {
    onProgress?.(i + 1, n);
    out.push(textLines((await reader.text(i)).items));
  }
  return out;
}

const baseName = (name) => String(name || 'Document').replace(/\.pdf$/i, '');

async function open(spec) {
  const res = await window.office.newWith(spec);
  if (res?.error) toast(res.error, 'error');
}

export async function toWrite(reader, name, { notes = false, onProgress } = {}) {
  const pages = await pageLines(reader, onProgress);
  if (!pages.some((p) => p.length)) {
    toast('This PDF has no text to copy. It may be a scan.', 'error');
    return;
  }
  const markdown = pagesToMarkdown(pages);
  await open({ kind: 'document', title: baseName(name), markdown, style: notes ? 'notes' : undefined });
}

// Highlights, underlines and comments as notes in Write: each quote with your note under it.
export async function marksToNotes(reader, annots, name) {
  const marks = [];
  for (const a of annots) {
    if (MARKUPS.includes(a.type)) {
      const text = a.page < reader.pageCount ? textUnder((await reader.text(a.page)).items, a.rects) : '';
      if (text || a.note) marks.push({ page: a.page, type: a.type, text, note: a.note || '', y: -(a.rects?.[0]?.[1] || 0) });
    } else if (a.note || (a.type === 'text' && a.text)) {
      marks.push({ page: a.page, type: a.type, text: '', note: a.note || a.text, y: -((a.at || a.rect || [])[1] || 0) });
    }
  }
  if (!marks.length) {
    toast('Highlight or comment on the PDF first, then send them to Notes.', 'error');
    return;
  }
  marks.sort((x, y) => x.page - y.page || x.y - y.y);
  await open({ kind: 'document', title: `Notes on ${baseName(name)}`, markdown: marksToMarkdown(baseName(name), marks), style: 'notes' });
}

export async function toPlot(reader, name, { onProgress } = {}) {
  const pages = await pageLines(reader, onProgress);
  const sheets = pages.map((lines, i) => {
    const grid = linesToTable(lines);
    return { name: `Page ${i + 1}`, columns: grid[0] || [], rows: grid.slice(1) };
  }).filter((s) => s.columns.length || s.rows.length);
  if (!sheets.length) {
    toast('No text or tables found in this PDF.', 'error');
    return;
  }
  await open({ kind: 'spreadsheet', title: baseName(name), sheets: sheets.slice(0, 200) });
}

// pictures: a Reader with the saved look (comments drawn in), if not the same.
export async function toPresent(reader, name, { onProgress, pictures = reader } = {}) {
  const W = 960;
  const H = 540;
  const slides = [];
  const n = Math.min(reader.pageCount, MAX_SLIDES);
  for (let i = 0; i < n; i++) {
    onProgress?.(i + 1, n);
    const p = pictures.pages[i];
    const scale = Math.min(2, 1600 / p.w);
    const canvas = await pictures.render(i, scale);
    const fit = Math.min(W / p.w, H / p.hgt);
    const w = Math.round(p.w * fit);
    const hh = Math.round(p.hgt * fit);
    slides.push({
      id: `s${i}`,
      layout: 'blank',
      notes: (await reader.text(i)).str.replace(/\s+/g, ' ').trim().slice(0, 4000),
      elements: [{ id: `p${i}`, type: 'image', src: canvas.toDataURL('image/jpeg', 0.86), x: Math.round((W - w) / 2), y: Math.round((H - hh) / 2), w, h: hh }],
    });
  }
  if (reader.pageCount > MAX_SLIDES) toast(`Made slides for the first ${MAX_SLIDES} pages`);
  await open({ kind: 'deck', title: baseName(name), theme: 'paper', slides });
}
