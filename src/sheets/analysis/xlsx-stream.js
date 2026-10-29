// Streaming .xlsx reader. Reads the zip directory, then inflates the sheet
// XML piece by piece and picks out cells as they arrive, so a workbook with
// a million rows never has to exist as one string or as a cell grid.

import { Inflate } from 'fflate';
import { ColumnBuilder, pushValue, uniqueNames } from './columns.js';

const CHUNK = 4 * 1024 * 1024;
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;

export async function zipEntries(reader) {
  const tailLen = Math.min(reader.size, 65557);
  const tail = await reader.read(reader.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 5 && tail[i + 3] === 6) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx workbook');
  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && u32(tail, loc) === 0x07064b50) {
      const recOff = u64(tail, loc + 8);
      const rec = await reader.read(recOff, 56);
      count = u64(rec, 32);
      cdSize = u64(rec, 40);
      cdOffset = u64(rec, 48);
    }
  }
  const cd = await reader.read(cdOffset, cdSize);
  const decoder = new TextDecoder();
  const entries = new Map();
  let p = 0;
  for (let k = 0; k < count && p + 46 <= cd.length; k += 1) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10);
    let comp = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLen = u16(cd, p + 28);
    const extraLen = u16(cd, p + 30);
    const commentLen = u16(cd, p + 32);
    let local = u32(cd, p + 42);
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    while (e + 4 <= end) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (comp === 0xffffffff) { comp = u64(cd, q); q += 8; }
        if (local === 0xffffffff) local = u64(cd, q);
      }
      e += 4 + len;
    }
    entries.set(name.replace(/^\//, ''), { name, method, comp, size, local });
    p = end + commentLen;
  }
  return entries;
}

// Streams an entry's text to onText(chunk); returns when done.
async function streamEntry(reader, entry, onText) {
  const head = await reader.read(entry.local, 30);
  const start = entry.local + 30 + u16(head, 26) + u16(head, 28);
  const decoder = new TextDecoder();
  if (entry.method === 0) {
    for (let off = 0; off < entry.comp; off += CHUNK) {
      onText(decoder.decode(await reader.read(start + off, Math.min(CHUNK, entry.comp - off)), { stream: true }));
    }
    onText(decoder.decode());
    return;
  }
  if (entry.method !== 8) throw new Error('This workbook uses an unsupported compression method');
  const inflate = new Inflate((data) => onText(decoder.decode(data, { stream: true })));
  for (let off = 0; off < entry.comp; off += CHUNK) {
    const len = Math.min(CHUNK, entry.comp - off);
    inflate.push(await reader.read(start + off, len), off + len >= entry.comp);
  }
  onText(decoder.decode());
}

async function entryText(reader, entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  let s = '';
  await streamEntry(reader, e, (t) => {
    s += t;
  });
  return s;
}

const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const named = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  if (named) return named;
  return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const ATTR = new Map();
const attr = (s, name) => {
  let re = ATTR.get(name);
  if (!re) ATTR.set(name, (re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`)));
  const m = re.exec(s);
  return m ? (m[1].includes('&') ? unescapeXml(m[1]) : m[1]) : null;
};

function resolveTarget(target) {
  const t = target.replace(/^\//, '');
  return t.startsWith('xl/') ? t : `xl/${t.replace(/^\.\//, '')}`;
}

export async function xlsxSheets(reader, entries = null) {
  entries ||= await zipEntries(reader);
  const wb = await entryText(reader, entries, 'xl/workbook.xml');
  if (!wb) throw new Error('This file is not a valid .xlsx workbook');
  const rels = (await entryText(reader, entries, 'xl/_rels/workbook.xml.rels')) || '';
  const targets = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) targets[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const id = attr(m[0], 'r:id') || attr(m[0], 'id');
    if (targets[id]) sheets.push({ name: attr(m[0], 'name'), path: resolveTarget(targets[id]) });
  }
  return sheets;
}

const BUILTIN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function dateStyles(styles) {
  const out = [];
  if (!styles) return out;
  const custom = {};
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom[Number(attr(m[0], 'numFmtId'))] = attr(m[0], 'formatCode') || '';
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
  if (!xfs) return out;
  for (const m of xfs[1].matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId') || 0);
    const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    out.push(BUILTIN_DATES.has(id) || (custom[id] != null && /[dmyhs]/i.test(code) && !/^general$/i.test(code)));
  }
  return out;
}

async function sharedStrings(reader, entries) {
  const e = entries.get('xl/sharedStrings.xml');
  const out = [];
  if (!e) return out;
  let buf = '';
  await streamEntry(reader, e, (t) => {
    buf += t;
    let end = buf.lastIndexOf('</si>');
    if (end < 0) return;
    end += 5;
    const part = buf.slice(0, end);
    buf = buf.slice(end);
    for (const m of part.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) {
      const body = (m[1] || '').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
      let s = '';
      for (const t2 of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += t2[1];
      out.push(unescapeXml(s));
    }
  });
  return out;
}

const colOf = (ref) => {
  let n = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

export async function parseXlsx(reader, { sheet = 0, onProgress } = {}) {
  const entries = await zipEntries(reader);
  const sheets = await xlsxSheets(reader, entries);
  const pick = typeof sheet === 'string' ? sheets.find((s) => s.name === sheet) : sheets[sheet];
  if (!pick) throw new Error('That sheet is not in the workbook');
  const strings = await sharedStrings(reader, entries);
  const isDate = dateStyles(await entryText(reader, entries, 'xl/styles.xml'));
  const entry = entries.get(pick.path);
  if (!entry) throw new Error(`The workbook is missing ${pick.path}`);

  let header = null;
  let dataStart = 0;
  const builders = [];
  let rows = 0;
  let rowNum = -1;
  let colNext = 0;
  let cells = [];
  let buf = '';
  let seen = 0;
  const re = /<row\b([^>]*?)\/?>|<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  const value = (attrs, body) => {
    const t = attr(attrs, 't');
    if (body == null) return null;
    if (t === 'inlineStr') {
      let s = '';
      for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) s += m[1];
      return unescapeXml(s);
    }
    const v = /<v>([\s\S]*?)<\/v>/.exec(body);
    if (!v) return null;
    if (t === 's') return strings[Number(v[1])] ?? '';
    if (t === 'str') return unescapeXml(v[1]);
    if (t === 'b') return v[1] === '1';
    if (t === 'e') return null;
    if (t === 'd') return new Date(v[1]);
    const num = Number(v[1]);
    const s = attr(attrs, 's');
    if (s != null && isDate[Number(s)]) return new Date(Math.round((num - 25569) * 86400000));
    return num;
  };

  const ensure = (c) => {
    while (builders.length <= c) builders.push(new ColumnBuilder(header?.[builders.length] ?? `Column ${builders.length + 1}`, rows));
    return builders[c];
  };

  // The first row with values decides whether there is a header.
  const commitRow = () => {
    if (!cells.length) return;
    const row = cells;
    cells = [];
    if (header === null) {
      if (row.some(([, v]) => typeof v === 'string' && v.trim())) {
        const names = [];
        for (const [c, v] of row) names[c] = String(v ?? '');
        header = uniqueNames(Array.from({ length: names.length }, (_, i) => names[i] ?? ''));
        header.forEach((_, i) => ensure(i));
        dataStart = rowNum + 1;
        return;
      }
      header = [];
      dataStart = rowNum;
    }
    const idx = rowNum - dataStart;
    for (const [c, v] of row) {
      const b = ensure(c);
      b.padTo(idx);
      if (b.length === idx) pushValue(b, v);
    }
    rows = idx + 1;
  };

  const scan = () => {
    re.lastIndex = 0;
    let m;
    let last = 0;
    while ((m = re.exec(buf))) {
      last = re.lastIndex;
      if (m[0].startsWith('<row')) {
        commitRow();
        const r = attr(m[1], 'r');
        rowNum = r ? Number(r) - 1 : rowNum + 1;
        colNext = 0;
        continue;
      }
      const ref = attr(m[2], 'r');
      const c = ref ? colOf(ref) : colNext;
      colNext = c + 1;
      const v = value(m[2], m[3]);
      if (v !== null && v !== '') cells.push([c, v]);
    }
    buf = buf.slice(last);
  };

  await streamEntry(reader, entry, (t) => {
    buf += t;
    seen += t.length;
    if (buf.length > 1024 * 1024) scan();
    if (entry.size) onProgress?.(Math.min(0.99, seen / entry.size), rows);
  });
  scan();
  commitRow();
  const names = uniqueNames(builders.map((b, i) => header?.[i] ?? b.name));
  return { columns: builders.map((b, i) => ({ ...b.finish(rows), name: names[i] })), rows, sheets: sheets.map((s) => s.name), sheet: pick.name };
}
