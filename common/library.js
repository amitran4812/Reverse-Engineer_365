'use strict';

// My Library: the references a user has cited or saved, kept as CSL-JSON items with
// tags. Plain helpers shared by the main process (storage, files) and the Cite dialog.

const cite = require('./cite');

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const yearOf = (item) => item.issued?.[0] || '';

// Two records are the same paper when their DOI, arXiv id or ISBN match, or title and year do.
function sameKey(item) {
  if (item.DOI) return `doi:${String(item.DOI).toLowerCase()}`;
  if (item.arxiv) return `arxiv:${String(item.arxiv).toLowerCase().replace(/v\d+$/, '')}`;
  if (item.ISBN) return `isbn:${String(item.ISBN).replace(/[^0-9xX]/g, '')}`;
  return `t:${norm(item.title)}:${yearOf(item)}`;
}

const cleanTags = (tags) => [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(',')).map((t) => String(t).trim()).filter(Boolean))];

// Adds or updates an item; returns the new list and the stored entry.
function addItem(list, item, { tags = [], now = new Date().toISOString() } = {}) {
  const key = sameKey(item);
  const at = list.findIndex((x) => sameKey(x) === key);
  const { id: _i, added: _a, tags: _t, ...data } = item;
  if (at >= 0) {
    const old = list[at];
    const entry = { ...old, ...data, id: old.id, added: old.added, used: now, tags: cleanTags([...(old.tags || []), ...cleanTags(tags)]) };
    const next = list.slice();
    next[at] = entry;
    return { list: next, entry };
  }
  const entry = { ...data, id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, added: now, used: now, tags: cleanTags(tags) };
  return { list: [entry, ...list], entry };
}

function matches(item, q) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = norm([item.title, ...(item.author || []).map((p) => p.literal || `${p.family} ${p.given}`), item['container-title'], yearOf(item), item.DOI, ...(item.tags || [])].join(' '));
  return words.every((w) => hay.includes(w));
}

function allTags(list) {
  const out = new Map();
  for (const it of list) for (const t of it.tags || []) out.set(t, (out.get(t) || 0) + 1);
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

const authorSort = (item) => norm((item.author?.[0] && (item.author[0].family || item.author[0].literal)) || item.title);

// A whole bibliography in one style: sorted by author (numbered styles keep the given order).
function bibliography(items, style) {
  if (style === 'bibtex') return { text: items.map(cite.bibtex).join('\n\n'), code: true };
  if (style === 'ris') return { text: items.map(cite.ris).join('\r\n\r\n'), code: true };
  const numbered = style === 'ieee' || style === 'vancouver';
  const list = numbered ? items : [...items].sort((a, b) => authorSort(a).localeCompare(authorSort(b)) || String(yearOf(a)).localeCompare(String(yearOf(b))));
  const refs = list.map((it) => cite.format(it, style));
  const label = (i) => (style === 'ieee' ? `[${i + 1}] ` : style === 'vancouver' ? `${i + 1}. ` : '');
  return {
    text: refs.map((r, i) => label(i) + r.text).join('\n\n'),
    html: refs.map((r, i) => `<p>${label(i)}${r.html}</p>`).join('\n'),
  };
}

// ---------- reading .bib and .ris files ----------

function unbrace(s) {
  return String(s || '')
    .replace(/\\(?:textbackslash)\{\}/g, '\\')
    .replace(/\\([&%$#_{}])/g, '$1')
    .replace(/\\["'`^~=.]\{?([A-Za-z])\}?/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function bibFields(body) {
  const out = {};
  let i = 0;
  while (i < body.length) {
    const m = /\s*,?\s*([A-Za-z][\w-]*)\s*=\s*/y;
    m.lastIndex = i;
    const k = m.exec(body);
    if (!k) break;
    i = m.lastIndex;
    let v = '';
    if (body[i] === '{') {
      let depth = 0;
      const start = i;
      for (; i < body.length; i += 1) {
        if (body[i] === '{') depth += 1;
        else if (body[i] === '}' && --depth === 0) break;
      }
      v = body.slice(start + 1, i);
      i += 1;
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      v = body.slice(i + 1, end < 0 ? body.length : end);
      i = end < 0 ? body.length : end + 1;
    } else {
      const w = /[^,\s}]+/y;
      w.lastIndex = i;
      v = w.exec(body)?.[0] || '';
      i = w.lastIndex || body.length;
    }
    out[k[1].toLowerCase()] = v;
  }
  return out;
}

const BIB_TYPES = { article: 'article-journal', inproceedings: 'paper-conference', conference: 'paper-conference', incollection: 'chapter', inbook: 'chapter', book: 'book', phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report', online: 'webpage', misc: 'article' };
const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseBibtex(text) {
  const items = [];
  const re = /@(\w+)\s*\{\s*([^,\s]*)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    const f = bibFields(text.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
    const people = (s) => (s ? unbrace(s).split(/\s+and\s+/i).map((n) => cite.splitName(n)).filter(Boolean) : []);
    const yr = Number(/\d{4}/.exec(f.year || f.date || '')?.[0]);
    const mo = MONTH[String(f.month || '').toLowerCase().slice(0, 3)] || Number(f.month) || 0;
    items.push({
      type: BIB_TYPES[type] || 'article',
      title: unbrace(f.title),
      author: people(f.author),
      editor: people(f.editor),
      'container-title': unbrace(f.journal || f.journaltitle || f.booktitle),
      publisher: unbrace(f.publisher || f.institution || f.school || (f.archiveprefix ? f.archiveprefix : '')),
      'publisher-place': unbrace(f.address || f.location),
      volume: unbrace(f.volume),
      issue: unbrace(f.number || f.issue),
      page: unbrace(f.pages).replace(/-+/g, '–'),
      edition: unbrace(f.edition),
      issued: yr ? (mo ? [yr, mo] : [yr]) : null,
      DOI: cite.cleanDoi(unbrace(f.doi)) || '',
      URL: unbrace(f.url),
      ISBN: unbrace(f.isbn),
      ISSN: unbrace(f.issn),
      arxiv: /arxiv/i.test(f.archiveprefix || f.eprinttype || '') ? unbrace(f.eprint) : '',
      tags: cleanTags(unbrace(f.keywords)),
      bibKey: m[2],
    });
  }
  return items.filter((it) => it.title);
}

const RIS_TYPES = { JOUR: 'article-journal', CPAPER: 'paper-conference', CONF: 'paper-conference', CHAP: 'chapter', BOOK: 'book', THES: 'thesis', RPRT: 'report', UNPB: 'article', ELEC: 'webpage' };

function parseRis(text) {
  const items = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, v] = m;
    if (tag === 'TY') cur = { type: RIS_TYPES[v.trim()] || 'article', author: [], editor: [], tags: [] };
    if (!cur) continue;
    const val = v.trim();
    switch (tag) {
      case 'TI': case 'T1': cur.title = val; break;
      case 'AU': case 'A1': cur.author.push(cite.splitName(val)); break;
      case 'ED': case 'A2': cur.editor.push(cite.splitName(val)); break;
      case 'T2': case 'JO': case 'JF': case 'BT': cur['container-title'] ||= val; break;
      case 'J2': cur['container-title-short'] = val; break;
      case 'PY': case 'Y1': { const y = Number(/\d{4}/.exec(val)?.[0]); if (y) cur.issued = [y]; break; }
      case 'VL': cur.volume = val; break;
      case 'IS': cur.issue = val; break;
      case 'SP': cur.page = val; break;
      case 'EP': cur.page = cur.page ? `${cur.page}–${val}` : val; break;
      case 'PB': cur.publisher = val; break;
      case 'CY': cur['publisher-place'] = val; break;
      case 'SN': if (/^[\dXx-]{10,17}$/.test(val.replace(/\s/g, '')) && val.replace(/[^\dXx]/g, '').length >= 10) cur.ISBN = val; else cur.ISSN = val; break;
      case 'DO': cur.DOI = cite.cleanDoi(val) || val; break;
      case 'UR': cur.URL = val; break;
      case 'KW': cur.tags.push(val); break;
      case 'ER':
        cur.author = cur.author.filter(Boolean);
        cur.editor = cur.editor.filter(Boolean);
        cur.tags = cleanTags(cur.tags);
        if (cur.title) items.push(cur);
        cur = null;
        break;
      default:
    }
  }
  return items;
}

function parseReferences(text, name = '') {
  if (/\.ris$/i.test(name) || /^TY {2}- /m.test(text)) return parseRis(text);
  return parseBibtex(text);
}

module.exports = { sameKey, addItem, matches, allTags, bibliography, parseBibtex, parseRis, parseReferences, cleanTags };
