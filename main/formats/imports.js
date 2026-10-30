'use strict';

// Opens formats Work reads but doesn't write: PowerPoint (.pptx) and
// OpenDocument presentations (.odp) become a deck outline for Present,
// OpenDocument text (.odt) becomes HTML for Write, and legacy or
// OpenDocument spreadsheets (.xls, .ods, .xlsm, .xltx) become Plot sheets.
// Text, structure, formulas and speaker notes come across; images, charts
// and detailed formatting don't.

const JSZip = require('jszip');
const { unwrapFormula } = require('../../common/gsheets');
const { DOMParser } = require('@xmldom/xmldom');
const { colName } = require('../../common/cellref');

const parseXml = (text) => new DOMParser({ onError: () => {} }).parseFromString(text, 'application/xml');
const list = (l) => Array.from({ length: l?.length || 0 }, (_, i) => l[i]);
const kids = (node, name) => list(node?.childNodes).filter((n) => n.nodeType === 1 && (!name || n.nodeName === name));
const all = (node, name) => (node ? list(node.getElementsByTagName(name)) : []);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s) => s.replace(/\s+/g, ' ').trim();

async function zipXml(zip, file) {
  const f = zip.file(file);
  return f ? parseXml(await f.async('string')) : null;
}

// ---------- PowerPoint (.pptx)

const drawingText = (p) => all(p, 'a:t').map((t) => t.textContent).join('');

function shapesOf(doc) {
  return all(doc, 'p:sp').map((sp) => {
    const ph = all(sp, 'p:ph')[0];
    const paras = all(sp, 'a:p').map(drawingText).map(clean).filter(Boolean);
    return { type: ph ? ph.getAttribute('type') || 'body' : 'text', idx: ph?.getAttribute('idx') || '', paras };
  }).filter((s) => s.paras.length);
}

function relTargets(rels, base) {
  const out = {};
  for (const r of all(rels, 'Relationship')) {
    const t = r.getAttribute('Target');
    out[r.getAttribute('Id')] = { type: r.getAttribute('Type'), path: t.startsWith('/') ? t.slice(1) : new URL(t, `http://x/${base}`).pathname.slice(1) };
  }
  return out;
}

function toSpec(shapes, index, notes) {
  const title = shapes.find((s) => s.type === 'title' || s.type === 'ctrTitle');
  const subtitle = shapes.find((s) => s.type === 'subTitle');
  const bodies = shapes.filter((s) => !['title', 'ctrTitle', 'subTitle', 'dt', 'ftr', 'sldNum', 'hdr'].includes(s.type));
  const base = { title: title ? title.paras.join(' ') : '', subtitle: '', bullets: [], right_bullets: [], notes };
  if (title?.type === 'ctrTitle' || (subtitle && !bodies.length)) return { ...base, layout: 'title', subtitle: subtitle ? subtitle.paras.join('\n') : bodies.flatMap((b) => b.paras).join('\n') };
  if (bodies.length >= 2 && bodies.filter((b) => b.type !== 'text').length >= 2) return { ...base, layout: 'two', bullets: bodies[0].paras, right_bullets: bodies.slice(1).flatMap((b) => b.paras) };
  if (!bodies.length) return { ...base, layout: index === 0 ? 'title' : 'section' };
  return { ...base, layout: 'content', bullets: bodies.flatMap((b) => b.paras) };
}

async function importPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const pres = await zipXml(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('This doesn’t look like a PowerPoint file.');
  const rels = relTargets(await zipXml(zip, 'ppt/_rels/presentation.xml.rels'), 'ppt/presentation.xml');
  const slides = [];
  for (const [i, id] of all(pres, 'p:sldId').entries()) {
    const file = rels[id.getAttribute('r:id')]?.path;
    const doc = file && (await zipXml(zip, file));
    if (!doc) continue;
    const srels = relTargets(await zipXml(zip, file.replace(/([^/]+)$/, '_rels/$1.rels')), file);
    const notesFile = Object.values(srels).find((r) => /notesSlide$/.test(r.type))?.path;
    const notesDoc = notesFile && (await zipXml(zip, notesFile));
    const notes = notesDoc ? shapesOf(notesDoc).filter((s) => s.type === 'body').flatMap((s) => s.paras).join('\n') : '';
    slides.push(toSpec(shapesOf(doc), i, notes));
  }
  return { slides };
}

// ---------- OpenDocument presentation (.odp)

// Paragraphs inside a frame, including list items, as plain strings.
function odfParas(node) {
  return all(node, 'text:p').concat(all(node, 'text:h')).map((p) => clean(inlineText(p))).filter(Boolean);
}

function inlineText(node) {
  let s = '';
  for (const n of list(node.childNodes)) {
    if (n.nodeType === 3) s += n.nodeValue;
    else if (n.nodeName === 'text:s') s += ' '.repeat(Number(n.getAttribute('text:c') || 1));
    else if (n.nodeName === 'text:tab') s += '\t';
    else if (n.nodeName === 'text:line-break') s += '\n';
    else if (n.nodeType === 1 && n.nodeName !== 'text:note') s += inlineText(n);
  }
  return s;
}

async function importOdp(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = await zipXml(zip, 'content.xml');
  if (!doc || !all(doc, 'office:presentation').length) throw new Error('This doesn’t look like an OpenDocument presentation.');
  const slides = all(doc, 'draw:page').map((page, i) => {
    const notesEl = all(page, 'presentation:notes')[0];
    const frames = all(page, 'draw:frame').filter((f) => !notesEl || !isInside(f, notesEl));
    const shapes = frames.map((f) => {
      const cls = f.getAttribute('presentation:class');
      const type = cls === 'title' ? 'title' : cls === 'subtitle' ? 'subTitle' : cls === 'outline' ? 'body' : cls ? 'other' : 'text';
      return { type, paras: odfParas(f) };
    }).filter((s) => s.paras.length && s.type !== 'other');
    const notes = notesEl ? all(notesEl, 'draw:frame').filter((f) => f.getAttribute('presentation:class') === 'notes').flatMap(odfParas).join('\n') : '';
    return toSpec(shapes, i, notes);
  });
  return { slides };
}

function isInside(node, parent) {
  for (let n = node.parentNode; n; n = n.parentNode) if (n === parent) return true;
  return false;
}

// ---------- OpenDocument text (.odt)

function odtInline(node) {
  let s = '';
  for (const n of list(node.childNodes)) {
    if (n.nodeType === 3) s += esc(n.nodeValue);
    else if (n.nodeName === 'text:s') s += ' '.repeat(Number(n.getAttribute('text:c') || 1));
    else if (n.nodeName === 'text:tab') s += '\t';
    else if (n.nodeName === 'text:line-break') s += '<br>';
    else if (n.nodeName === 'text:a') {
      const href = n.getAttribute('xlink:href') || '';
      s += /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}">${odtInline(n)}</a>` : odtInline(n);
    } else if (n.nodeType === 1 && !['text:note', 'office:annotation', 'text:bookmark-start', 'text:bookmark-end'].includes(n.nodeName)) s += odtInline(n);
  }
  return s;
}

function odtBlocks(node) {
  let html = '';
  for (const n of kids(node)) {
    if (n.nodeName === 'text:h') {
      const level = Math.min(6, Math.max(1, Number(n.getAttribute('text:outline-level') || 1)));
      html += `<h${level}>${odtInline(n)}</h${level}>`;
    } else if (n.nodeName === 'text:p') html += `<p>${odtInline(n)}</p>`;
    else if (n.nodeName === 'text:list') html += `<ul>${kids(n, 'text:list-item').map((li) => `<li>${odtBlocks(li)}</li>`).join('')}</ul>`;
    else if (n.nodeName === 'table:table') {
      const rows = all(n, 'table:table-row').map((r) => `<tr>${kids(r, 'table:table-cell').map((c) => `<td>${odtBlocks(c) || '<p></p>'}</td>`).join('')}</tr>`);
      html += `<table>${rows.join('')}</table>`;
    } else if (n.nodeName === 'text:section' || n.nodeName === 'text:soft-page-break') html += odtBlocks(n);
  }
  return html;
}

async function importOdt(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = await zipXml(zip, 'content.xml');
  const body = all(doc, 'office:text')[0];
  if (!body) throw new Error('This doesn’t look like an OpenDocument text file.');
  return { html: odtBlocks(body) || '<p></p>' };
}

// ---------- Spreadsheets through SheetJS (.xls, .ods, and .xlsm/.xltx as a fallback)

function plainValue(c) {
  if (c.t === 'b') return c.v ? 'TRUE' : 'FALSE';
  if (c.t === 'd' && c.v instanceof Date) return c.v.toISOString().slice(0, 10);
  if (c.t === 'e') return c.w || '';
  return c.v == null ? '' : String(c.v);
}

function importSheetJs(buffer) {
  const XLSX = require('@e965/xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: true, cellStyles: false });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const cells = {};
    const spillCache = {};
    for (const [ref, c] of Object.entries(ws)) {
      if (ref.startsWith('!')) continue;
      if (c.f) {
        // Formulas keep their saved result as a fallback; Google's wrapped ones are unwrapped.
        const g = unwrapFormula(c.f);
        const r = c.v instanceof Date ? c.v.toISOString().slice(0, 10) : c.t === 'e' ? c.w : c.v;
        if (g.computed) {
          if (r !== undefined) spillCache[ref] = r ?? g.cached;
        } else cells[ref] = r === undefined && g.cached === undefined ? { v: `=${g.formula}` } : { v: `=${g.formula}`, r: r ?? g.cached };
        continue;
      }
      const v = plainValue(c);
      if (v !== '') cells[ref] = { v };
    }
    const cols = {};
    (ws['!cols'] || []).forEach((col, i) => {
      if (col?.wpx) cols[colName(i)] = Math.round(col.wpx);
    });
    return Object.keys(spillCache).length ? { name: name.slice(0, 31), cells, cols, spillCache } : { name: name.slice(0, 31), cells, cols };
  });
  return { sheets: sheets.length ? sheets : [{ name: 'Sheet1', cells: {}, cols: {} }] };
}

module.exports = { importPptx, importOdp, importOdt, importSheetJs };
