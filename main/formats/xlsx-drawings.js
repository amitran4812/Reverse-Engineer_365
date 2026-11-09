'use strict';

// Reads what a workbook draws on top of its cells: pictures, charts (drawn as
// SVG from their data), shapes with a picture fill, and pictures placed in a
// cell (the in-cell pictures newer spreadsheet apps save as rich values, and
// WPS's DISPIMG cell pictures). Also reads row heights, which ExcelJS drops
// for rows without cells and which pictures need to line up with their rows.
//
// Result: { media: { m1: dataUrl }, sheets: { [sheetName]: { images, cellImages, heights } } }
//   images:     [{ id, media, row, col, dx, dy, w, h, name, chart }]  (pixels, 0-based cell)
//   cellImages: { A1: mediaKey }
//   heights:    { 5: px }  (row number as in the file)

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { chartSvg } = require('./pptx-chart');
const { sniff, MIME } = require('./odf');
const { colIndex, colName, parseRef } = require('../../common/cellref');

const EMU_PX = 9525;
const DEFAULT_COL = 64;
const DEFAULT_ROW = 20;
const parseXml = (text) => new DOMParser({ onError: () => {} }).parseFromString(text, 'application/xml');
const local = (n) => n.localName || n.nodeName.replace(/^.*:/, '');
const kids = (node, name) => (node ? Array.from(node.childNodes || []).filter((n) => n.nodeType === 1 && (!name || local(n) === name)) : []);
const kid = (node, ...names) => names.reduce((n, name) => kids(n, name)[0], node);
const desc = (node, name) => (node ? Array.from(node.getElementsByTagName('*')).filter((n) => local(n) === name) : []);
const num = (v, d = 0) => (v == null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const relId = (n) => n && (n.getAttribute('r:embed') || n.getAttribute('r:id') || Array.from(n.attributes || []).find((a) => /:(embed|id)$/.test(a.name))?.value);

class Pkg {
  constructor(zip) {
    this.zip = zip;
    this.cache = new Map();
    this.media = {};
    this.mediaKeys = new Map();
  }
  async xml(file) {
    if (!file) return null;
    if (!this.cache.has(file)) {
      const f = this.zip.file(file);
      this.cache.set(file, f ? parseXml(await f.async('string')) : null);
    }
    return this.cache.get(file);
  }
  async text(file) {
    const f = file && this.zip.file(file);
    return f ? f.async('string') : '';
  }
  async rels(file) {
    const key = `rels:${file}`;
    if (!this.cache.has(key)) {
      const doc = await this.xml(file.replace(/([^/]+)$/, '_rels/$1.rels'));
      const out = {};
      for (const r of desc(doc, 'Relationship')) {
        const t = r.getAttribute('Target') || '';
        const external = r.getAttribute('TargetMode') === 'External';
        out[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', external, path: external ? t : t.startsWith('/') ? t.slice(1) : new URL(t, `http://x/${file}`).pathname.slice(1) };
      }
      this.cache.set(key, out);
    }
    return this.cache.get(key);
  }
  // A picture part as a key into `media`, read once however often it's used.
  async picture(file) {
    if (!file) return null;
    if (this.mediaKeys.has(file)) return this.mediaKeys.get(file);
    const f = this.zip.file(file);
    const data = f ? await f.async('nodebuffer') : null;
    const ext = file.split('.').pop().toLowerCase();
    const type = data && (sniff(data) || MIME[ext]);
    let key = null;
    if (type) {
      key = `m${Object.keys(this.media).length + 1}`;
      this.media[key] = `data:${type};base64,${data.toString('base64')}`;
    }
    this.mediaKeys.set(file, key);
    return key;
  }
  addSvg(svg) {
    const key = `m${Object.keys(this.media).length + 1}`;
    this.media[key] = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    return key;
  }
}

// Theme colours, so charts and shapes use the workbook's own accents.
async function readTheme(pkg, wbPath) {
  const rels = await pkg.rels(wbPath);
  const themeRel = Object.values(rels).find((r) => /theme$/.test(r.type));
  const doc = await pkg.xml(themeRel?.path);
  const scheme = {};
  for (const c of kids(desc(doc, 'clrScheme')[0])) {
    const v = kids(c)[0];
    if (v) scheme[local(c)] = local(v) === 'sysClr' ? v.getAttribute('lastClr') || '000000' : v.getAttribute('val');
  }
  const minor = kid(desc(doc, 'minorFont')[0], 'latin')?.getAttribute('typeface') || 'Calibri';
  return { scheme, minor };
}

function colorHex(node, scheme) {
  const c = kids(node).find((n) => /Clr$/.test(local(n)));
  if (!c) return undefined;
  const name = local(c);
  let hex;
  if (name === 'srgbClr') hex = c.getAttribute('val');
  else if (name === 'sysClr') hex = c.getAttribute('lastClr');
  else if (name === 'schemeClr') {
    const v = c.getAttribute('val');
    hex = scheme[{ tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[v] || v];
    const lum = kid(c, 'lumMod');
    const off = kid(c, 'lumOff');
    if (hex && (lum || off)) {
      const m = num(lum?.getAttribute('val'), 100000) / 100000;
      const o = num(off?.getAttribute('val'), 0) / 100000;
      hex = [0, 2, 4].map((i) => Math.round(Math.min(255, parseInt(hex.slice(i, i + 2), 16) * m + 255 * o)).toString(16).padStart(2, '0')).join('');
    }
  }
  return hex ? `#${hex}` : undefined;
}

// Sheet names to their parts, in workbook order.
async function sheetParts(pkg) {
  const top = desc(await pkg.xml('_rels/.rels'), 'Relationship').find((r) => /officeDocument$/.test(r.getAttribute('Type') || ''));
  const wbPath = (top?.getAttribute('Target') || 'xl/workbook.xml').replace(/^\//, '');
  const wb = await pkg.xml(wbPath);
  const rels = await pkg.rels(wbPath);
  const sheets = desc(wb, 'sheet').map((s) => ({ name: s.getAttribute('name'), path: rels[relId(s)]?.path })).filter((s) => s.path);
  return { wbPath, sheets };
}

// Column widths and row heights in pixels, as the file gives them.
function sheetMetrics(doc) {
  const fmt = desc(doc, 'sheetFormatPr')[0];
  const baseCol = fmt?.getAttribute('defaultColWidth') ? num(fmt.getAttribute('defaultColWidth')) * 7 + 5 : fmt?.getAttribute('baseColWidth') ? num(fmt.getAttribute('baseColWidth')) * 7 + 12 : DEFAULT_COL;
  const defRow = fmt?.getAttribute('defaultRowHeight') ? num(fmt.getAttribute('defaultRowHeight')) * 4 / 3 : DEFAULT_ROW;
  const cols = [];
  for (const c of desc(doc, 'col')) {
    const w = num(c.getAttribute('width'), 0);
    const px = c.getAttribute('hidden') === '1' ? 0 : Math.round(w * 7 + 5);
    for (let i = num(c.getAttribute('min'), 1); i <= Math.min(num(c.getAttribute('max'), 1), 16384); i += 1) cols[i - 1] = px;
  }
  const heights = {};
  for (const r of desc(doc, 'row')) {
    const ht = r.getAttribute('ht');
    if (ht && (r.getAttribute('customHeight') === '1' || r.getAttribute('customHeight') === 'true' || Math.abs(num(ht) * 4 / 3 - defRow) > 1)) {
      heights[num(r.getAttribute('r'))] = Math.max(4, Math.round(num(ht) * 4 / 3));
    }
  }
  if (Math.abs(defRow - DEFAULT_ROW) > 4) heights.default = Math.round(defRow);
  const colW = (c) => cols[c] ?? Math.round(baseCol);
  const rowH = (r) => heights[r + 1] ?? defRow;
  return { colW, rowH, heights };
}

// Cell values the charts point at, for charts saved without cached values.
function rangeReader(model) {
  const byName = new Map(model.sheets.map((s) => [s.name.toLowerCase(), s]));
  return (formula, fallbackSheet) => {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))?!?\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i.exec(String(formula || '').trim());
    if (!m) return null;
    const name = (m[1] ? m[1].replace(/''/g, "'") : m[2]) || fallbackSheet;
    const sheet = byName.get(String(name || '').toLowerCase());
    if (!sheet) return null;
    const c0 = colIndex(m[3].toUpperCase());
    const r0 = Number(m[4]) - 1;
    const c1 = m[5] ? colIndex(m[5].toUpperCase()) : c0;
    const r1 = m[6] ? Number(m[6]) - 1 : r0;
    const out = [];
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r += 1) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c += 1) {
        const cell = sheet.cells[`${colName(c)}${r + 1}`];
        const v = cell ? (String(cell.v).startsWith('=') ? cell.r : cell.v) : '';
        out.push(v ?? '');
      }
    }
    return out;
  };
}

// Where an anchor starts, and how big the thing is, in pixels.
function placement(anchor, m) {
  const kind = local(anchor);
  const pos = (node) => ({
    col: num(kid(node, 'col')?.textContent),
    row: num(kid(node, 'row')?.textContent),
    dx: num(kid(node, 'colOff')?.textContent) / EMU_PX,
    dy: num(kid(node, 'rowOff')?.textContent) / EMU_PX,
  });
  const absX = (col, dx) => { let x = 0; for (let c = 0; c < col; c += 1) x += m.colW(c); return x + dx; };
  const absY = (row, dy) => { let y = 0; for (let r = 0; r < row; r += 1) y += m.rowH(r); return y + dy; };
  if (kind === 'absoluteAnchor') {
    const p = kid(anchor, 'pos');
    const ext = kid(anchor, 'ext');
    let x = num(p?.getAttribute('x')) / EMU_PX;
    let y = num(p?.getAttribute('y')) / EMU_PX;
    let col = 0;
    let row = 0;
    while (col < 16383 && x >= m.colW(col)) { x -= m.colW(col); col += 1; }
    while (row < 1048575 && y >= m.rowH(row) && row < 100000) { y -= m.rowH(row); row += 1; }
    return { col, row, dx: x, dy: y, w: num(ext?.getAttribute('cx')) / EMU_PX, h: num(ext?.getAttribute('cy')) / EMU_PX };
  }
  const from = pos(kid(anchor, 'from'));
  if (kind === 'oneCellAnchor') {
    const ext = kid(anchor, 'ext');
    return { ...from, w: num(ext?.getAttribute('cx')) / EMU_PX, h: num(ext?.getAttribute('cy')) / EMU_PX };
  }
  const to = pos(kid(anchor, 'to'));
  return { ...from, w: absX(to.col, to.dx) - absX(from.col, from.dx), h: absY(to.row, to.dy) - absY(from.row, from.dy) };
}

// The size the shape itself records, when the anchor doesn't give a usable one.
function xfrmSize(node) {
  const ext = desc(node, 'xfrm').map((x) => kid(x, 'ext'))[0];
  return ext ? { w: num(ext.getAttribute('cx')) / EMU_PX, h: num(ext.getAttribute('cy')) / EMU_PX } : null;
}

// mc:AlternateContent: take the first branch that has something we can draw.
function contentOf(node) {
  if (local(node) !== 'AlternateContent') return [node];
  const branches = [...kids(node, 'Choice'), ...kids(node, 'Fallback')];
  for (const b of branches) {
    const inner = kids(b).filter((n) => ['pic', 'graphicFrame', 'sp', 'grpSp'].includes(local(n)));
    if (inner.some((n) => local(n) !== 'graphicFrame' || /chart"?$/.test(desc(n, 'graphicData')[0]?.getAttribute('uri') || ''))) return inner;
  }
  return [];
}

async function drawThing(node, place, ctx, out) {
  const kind = local(node);
  const name = desc(node, 'cNvPr')[0]?.getAttribute('name') || desc(node, 'cNvPr')[0]?.getAttribute('descr') || '';
  const hidden = desc(node, 'cNvPr')[0]?.getAttribute('hidden') === '1';
  if (hidden) return;
  // The shape's own frame is exact; the anchor's cells only approximate column widths.
  const own = kind === 'grpSp' ? null : xfrmSize(node);
  const size = own && own.w > 1 && own.h > 1 && !place.nested ? { ...place, ...own } : place;
  if (!(size.w > 1 && size.h > 1)) return;
  const push = (media, more = {}) => out.push({ id: `p${ctx.next()}`, media, row: size.row, col: size.col, dx: Math.round(size.dx), dy: Math.round(size.dy), w: Math.round(size.w), h: Math.round(size.h), ...(name ? { name } : {}), ...more });
  if (kind === 'pic' || (kind === 'sp' && desc(node, 'blipFill')[0])) {
    const blip = desc(node, 'blip')[0];
    const rel = ctx.rels[relId(blip)];
    if (!rel) return;
    if (rel.external) {
      if (/^https?:/i.test(rel.path)) push(null, { url: rel.path });
      return;
    }
    const media = await ctx.pkg.picture(rel.path);
    if (media) push(media);
    return;
  }
  if (kind === 'graphicFrame') {
    const data = desc(node, 'graphicData')[0];
    if (!/chart$/.test(data?.getAttribute('uri') || '')) return;
    const rel = ctx.rels[relId(desc(data, 'chart')[0])];
    const doc = rel && (await ctx.pkg.xml(rel.path));
    if (!doc) return;
    const svg = chartSvg(doc, size.w, size.h, {
      color: (n) => colorHex(n, ctx.theme.scheme),
      accents: [1, 2, 3, 4, 5, 6].map((i) => `#${ctx.theme.scheme[`accent${i}`] || ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'][i - 1]}`),
      font: ctx.theme.minor,
      text: '#404040',
      pt: 4 / 3,
      range: (f) => ctx.range(f, ctx.sheetName),
      background: '#ffffff',
    });
    if (svg) push(ctx.pkg.addSvg(svg), { chart: true });
    return;
  }
  if (kind === 'grpSp') {
    // A group: draw each member where the group's own frame puts it.
    const xfrm = kid(kid(node, 'grpSpPr'), 'xfrm');
    const ext = kid(xfrm, 'ext');
    const chOff = kid(xfrm, 'chOff');
    const chExt = kid(xfrm, 'chExt');
    const sx = num(ext?.getAttribute('cx'), 1) / (num(chExt?.getAttribute('cx'), 0) || num(ext?.getAttribute('cx'), 1));
    const sy = num(ext?.getAttribute('cy'), 1) / (num(chExt?.getAttribute('cy'), 0) || num(ext?.getAttribute('cy'), 1));
    const gw = num(ext?.getAttribute('cx'), 0) / EMU_PX;
    const scale = gw > 0 ? size.w / gw : 1;
    for (const child of kids(node).flatMap(contentOf)) {
      if (!['pic', 'graphicFrame', 'sp', 'grpSp'].includes(local(child))) continue;
      const cx = desc(child, 'xfrm')[0];
      const co = kid(cx, 'off');
      const ce = kid(cx, 'ext');
      if (!co || !ce) continue;
      const x = ((num(co.getAttribute('x')) - num(chOff?.getAttribute('x'))) * sx) / EMU_PX * scale;
      const y = ((num(co.getAttribute('y')) - num(chOff?.getAttribute('y'))) * sy) / EMU_PX * scale;
      await drawThing(child, { ...size, nested: true, dx: size.dx + x, dy: size.dy + y, w: num(ce.getAttribute('cx')) * sx / EMU_PX * scale, h: num(ce.getAttribute('cy')) * sy / EMU_PX * scale }, ctx, out);
    }
  }
}

// Pictures placed inside cells: rich values (newer files) and WPS cell images.
async function richPictures(pkg, wbPath) {
  const dir = wbPath.replace(/[^/]+$/, '');
  const meta = await pkg.xml(`${dir}metadata.xml`);
  const rv = await pkg.xml(`${dir}richData/rdrichvalue.xml`);
  if (!meta || !rv) return [];
  const structs = desc(await pkg.xml(`${dir}richData/rdrichvaluestructure.xml`), 's').map((s) => kids(s, 'k').map((k) => k.getAttribute('n')));
  const relDoc = await pkg.xml(`${dir}richData/richValueRel.xml`);
  const relRels = await pkg.rels(`${dir}richData/richValueRel.xml`);
  const relList = kids(relDoc?.documentElement).map((n) => relRels[relId(n)]);
  const values = await Promise.all(kids(rv.documentElement, 'rv').map(async (node) => {
    const keys = structs[num(node.getAttribute('s'))] || [];
    const vs = kids(node, 'v').map((v) => v.textContent);
    const at = keys.findIndex((k) => /LocalImageIdentifier$/i.test(k || ''));
    const rel = relList[num(vs[at >= 0 ? at : 0], -1)];
    return rel && !rel.external ? pkg.picture(rel.path) : null;
  }));
  const future = desc(meta, 'futureMetadata').find((f) => f.getAttribute('name') === 'XLRICHVALUE');
  const rvbs = future ? kids(future, 'bk').map((bk) => num(desc(bk, 'rvb')[0]?.getAttribute('i'), -1)) : [];
  const types = desc(kid(meta.documentElement, 'metadataTypes'), 'metadataType').map((t) => t.getAttribute('name'));
  const vm = kids(kid(meta.documentElement, 'valueMetadata'), 'bk').map((bk) => {
    const rc = kid(bk, 'rc');
    if (!rc || types[num(rc.getAttribute('t')) - 1] !== 'XLRICHVALUE') return null;
    return values[rvbs[num(rc.getAttribute('v'))]] || null;
  });
  return vm;
}

async function wpsCellImages(pkg, wbPath) {
  const file = `${wbPath.replace(/[^/]+$/, '')}cellimages.xml`;
  const doc = await pkg.xml(file);
  if (!doc) return {};
  const rels = await pkg.rels(file);
  const out = {};
  for (const pic of desc(doc, 'pic')) {
    const name = desc(pic, 'cNvPr')[0]?.getAttribute('name');
    const rel = rels[relId(desc(pic, 'blip')[0])];
    if (name && rel && !rel.external) out[name] = await pkg.picture(rel.path);
  }
  return out;
}

// model: the sheets ExcelJS read, used for chart values and cell pictures.
async function readDrawings(buffer, model) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const pkg = new Pkg(zip);
  const { wbPath, sheets } = await sheetParts(pkg);
  const theme = await readTheme(pkg, wbPath);
  const range = rangeReader(model);
  const rich = await richPictures(pkg, wbPath).catch(() => []);
  const wps = await wpsCellImages(pkg, wbPath).catch(() => ({}));
  let n = 0;
  const next = () => (n += 1);
  const out = {};
  for (const s of sheets) {
    const doc = await pkg.xml(s.path);
    if (!doc) continue;
    const metrics = sheetMetrics(doc);
    const rels = await pkg.rels(s.path);
    const images = [];
    for (const d of desc(doc, 'drawing')) {
      const rel = rels[relId(d)];
      const dr = rel && (await pkg.xml(rel.path));
      if (!dr) continue;
      const ctx = { pkg, rels: await pkg.rels(rel.path), theme, range, sheetName: s.name, next };
      for (const anchor of kids(dr.documentElement)) {
        if (!/Anchor$/.test(local(anchor))) continue;
        const place = placement(anchor, metrics);
        for (const node of kids(anchor).flatMap(contentOf)) {
          if (['pic', 'graphicFrame', 'sp', 'grpSp'].includes(local(node))) await drawThing(node, place, ctx, images).catch(() => {});
        }
      }
    }
    const cellImages = {};
    if (rich.some(Boolean) || Object.keys(wps).length) {
      const xml = await pkg.text(s.path);
      if (rich.some(Boolean)) {
        for (const m of xml.matchAll(/<(?:\w+:)?c\b([^>]*)>/g)) {
          const ref = /\br="([A-Z]+\d+)"/.exec(m[1])?.[1];
          const vm = /\bvm="(\d+)"/.exec(m[1])?.[1];
          const media = vm && rich[Number(vm) - 1];
          if (ref && media) cellImages[ref] = media;
        }
      }
      const sheet = model.sheets.find((x) => x.name === s.name);
      for (const [ref, cell] of Object.entries(sheet?.cells || {})) {
        const id = /DISPIMG\(\s*"([^"]+)"/i.exec(String(cell.v || ''))?.[1];
        if (id && wps[id]) cellImages[ref] = wps[id];
      }
    }
    const heights = { ...metrics.heights };
    if (images.length || Object.keys(cellImages).length || Object.keys(heights).length) out[s.name] = { images, cellImages, heights };
  }
  return { media: pkg.media, sheets: out };
}

// Adds what readDrawings found to the sheet model.
function mergeDrawings(model, drawings) {
  if (!drawings) return model;
  const used = new Set();
  for (const sheet of model.sheets) {
    const d = drawings.sheets[sheet.name];
    if (!d) continue;
    if (d.images.length) {
      sheet.images = d.images;
      d.images.forEach((im) => im.media && used.add(im.media));
    }
    const heights = {};
    for (const [k, v] of Object.entries(d.heights)) if (k !== 'default') heights[k] = v;
    if (d.heights.default) sheet.rowH = d.heights.default;
    if (Object.keys(heights).length) sheet.heights = heights;
    for (const [ref, media] of Object.entries(d.cellImages)) {
      if (!parseRef(ref)) continue;
      const cell = sheet.cells[ref] || {};
      const v = /DISPIMG\(/i.test(String(cell.v || '')) || /^#VALUE!?$/.test(String(cell.v || '')) ? '' : cell.v ?? '';
      sheet.cells[ref] = { ...cell, v, img: media };
      delete sheet.cells[ref].r;
      used.add(media);
    }
  }
  const media = {};
  for (const k of used) media[k] = drawings.media[k];
  if (used.size) model.media = media;
  return model;
}

module.exports = { readDrawings, mergeDrawings };
