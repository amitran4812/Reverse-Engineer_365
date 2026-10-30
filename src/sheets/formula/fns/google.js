// Functions that read live data: GOOGLEFINANCE, IMPORTRANGE, IMPORTDATA,
// IMPORTHTML, IMPORTXML, IMPORTFEED, GOOGLETRANSLATE and DETECTLANGUAGE.
// They ask env.web for data; while it loads, or when it can't be fetched,
// they return a "pending" error and the cell shows the value saved in the file.

import cellref from '../../../../common/cellref.js';
import {
  err, literal, msSerial, toBool, toInt, toNum, toStr,
} from '../core.js';
import { S } from './util.js';

const { parseCsv } = cellref;

function pending(msg) {
  const e = err('#N/A', msg);
  e.pending = true;
  return e;
}

// Data from env.web, or a thrown pending error while it's on its way.
function fetchData(ev, kind, params) {
  const web = ev.env.web;
  if (!web) throw pending('Live data isn\'t available here.');
  const r = web.get(kind, params);
  if (!r) throw pending('Loading data…');
  if (r.error) throw pending(r.error);
  return r.value;
}

const QUOTE = {
  price: 'price', priceopen: 'open', high: 'high', low: 'low', volume: 'volume', marketcap: 'marketCap', tradetime: 'tradeTime',
  datadelay: 'dataDelay', volumeavg: 'volumeAvg', pe: 'pe', eps: 'eps', high52: 'high52', low52: 'low52', change: 'change',
  beta: 'beta', changepct: 'changePct', closeyest: 'closeYest', shares: 'shares', currency: 'currency', name: 'name', exchange: 'exchange',
  return1: 'return1', return4: 'return4', return13: 'return13', return52: 'return52', return156: 'return156', return260: 'return260',
};
const HISTORY = { open: 1, high: 2, low: 3, close: 4, volume: 5, price: 4 };

function googlefinance(ev, ticker, attribute, start, end, interval) {
  const symbol = toStr(ticker).trim();
  if (!symbol) throw err('#N/A', 'GOOGLEFINANCE needs a ticker symbol.');
  const attr = attribute === undefined || attribute === null ? 'price' : toStr(attribute).toLowerCase().trim();
  if (start === undefined || start === null) {
    const field = QUOTE[attr];
    if (!field) throw err('#N/A', `GOOGLEFINANCE doesn't know the attribute "${attr}".`);
    const q = fetchData(ev, 'quote', { symbol });
    const v = q[field];
    if (v === undefined || v === null) throw pending(`"${attr}" isn't available for ${symbol}.`);
    return v;
  }
  if (attr !== 'all' && !HISTORY[attr]) throw err('#N/A', `GOOGLEFINANCE historical data doesn't include "${attr}".`);
  const from = Math.floor(toNum(start));
  let to;
  if (end === undefined || end === null) to = from + 1;
  else {
    const e = toNum(end);
    to = e < 10000 ? from + e : Math.floor(e) + 1;
  }
  const iv = interval === undefined || interval === null ? 'daily' : String(typeof interval === 'number' ? (interval === 7 ? 'weekly' : 'daily') : interval).toLowerCase();
  if (!['daily', 'weekly'].includes(iv)) throw err('#N/A', 'The interval must be "DAILY" or "WEEKLY".');
  const rows = fetchData(ev, 'history', { symbol, from, to, interval: iv });
  if (!rows.length) throw err('#N/A', `No data for ${symbol} in that period.`);
  const out = attr === 'all'
    ? [['Date', 'Open', 'High', 'Low', 'Close', 'Volume'], ...rows]
    : [['Date', attr === 'price' ? 'Close' : attr[0].toUpperCase() + attr.slice(1)], ...rows.map((r) => [r[0], r[HISTORY[attr]]])];
  out.colFmt = ['date'];
  return out;
}

function sheetKey(url) {
  const s = toStr(url).trim();
  const m = /\/spreadsheets\/d\/([\w-]+)/.exec(s);
  return m ? m[1] : s;
}

function importrange(ev, url, range) {
  const key = sheetKey(url);
  const r = toStr(range).trim();
  if (!key || !r) throw err('#REF!', 'IMPORTRANGE needs a spreadsheet link and a range.');
  return fetchData(ev, 'range', { key, range: r });
}

function importdata(ev, url, delimiter) {
  const u = toStr(url).trim();
  const { text, type } = fetchData(ev, 'text', { url: u });
  const d = delimiter !== undefined && delimiter !== null ? toStr(delimiter) : /\.tsv(\?|$)/i.test(u) || /tab-separated/i.test(type || '') ? '\t' : ',';
  const rows = parseCsv(text.replace(/^﻿/, ''), d).filter((r) => r.length && !(r.length === 1 && r[0] === ''));
  if (!rows.length) throw err('#N/A', 'The imported data is empty.');
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r.map(literal), ...Array(w - r.length).fill(null)]);
}

function domOf(text, type) {
  if (typeof DOMParser === 'undefined') throw pending('Reading web pages isn\'t available here.');
  return new DOMParser().parseFromString(text, type);
}
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function importhtml(ev, url, query, index) {
  const { text } = fetchData(ev, 'text', { url: toStr(url).trim() });
  const doc = domOf(text, 'text/html');
  const kind = toStr(query).toLowerCase();
  const k = index === undefined || index === null ? 1 : toInt(index);
  if (kind !== 'table' && kind !== 'list') throw err('#N/A', 'The query must be "table" or "list".');
  const el = doc.querySelectorAll(kind === 'table' ? 'table' : 'ul, ol')[k - 1];
  if (!el) throw err('#N/A', `Could not find ${kind} ${k} on the page.`);
  if (kind === 'list') return [...el.querySelectorAll(':scope > li')].map((li) => [literal(clean(li.textContent))]);
  const out = [];
  [...el.rows].forEach((tr, r) => {
    const row = out[r] || (out[r] = []);
    let c = 0;
    for (const cell of tr.cells) {
      while (row[c] !== undefined) c += 1;
      const v = literal(clean(cell.textContent));
      const rs = Math.max(1, Number(cell.rowSpan) || 1);
      const cs = Math.max(1, Number(cell.colSpan) || 1);
      for (let i = 0; i < rs; i += 1) {
        const target = out[r + i] || (out[r + i] = []);
        for (let j = 0; j < cs; j += 1) target[c + j] = i === 0 && j === 0 ? v : null;
      }
      c += cs;
    }
  });
  const w = Math.max(...out.map((r) => r.length));
  return out.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? null));
}

function importxml(ev, url, xpath) {
  const { text, type } = fetchData(ev, 'text', { url: toStr(url).trim() });
  const doc = domOf(text, /xml/i.test(type || '') && !/html/i.test(type || '') ? 'application/xml' : 'text/html');
  let res;
  try {
    res = doc.evaluate(toStr(xpath), doc, null, 7, null);
  } catch {
    throw err('#N/A', `"${xpath}" isn't a valid XPath query.`);
  }
  const out = [];
  for (let i = 0; i < res.snapshotLength; i += 1) out.push([literal(clean(res.snapshotItem(i).textContent))]);
  if (!out.length) throw err('#N/A', 'Imported content is empty.');
  return out;
}

function importfeed(ev, url, query, headers, count) {
  const { text } = fetchData(ev, 'text', { url: toStr(url).trim() });
  const doc = domOf(text, 'application/xml');
  const q = (query === undefined || query === null ? 'items' : toStr(query)).toLowerCase().trim();
  const pick = (node, names) => {
    for (const n of names) {
      const el = node.getElementsByTagName(n)[0];
      if (el) return clean(el.getAttribute('href') && n === 'link' && !el.textContent ? el.getAttribute('href') : el.textContent);
    }
    return '';
  };
  const FIELDS = {
    title: ['title'], url: ['link'], summary: ['description', 'summary', 'content'], author: ['author', 'dc:creator', 'name'], created: ['pubDate', 'published', 'updated', 'dc:date'],
  };
  const root = doc.documentElement;
  if (q.startsWith('feed')) {
    const f = q.split(/\s+/)[1];
    const channel = root.getElementsByTagName('channel')[0] || root;
    const fields = f ? [f] : ['title', 'summary', 'url'];
    return [fields.map((x) => pick(channel, FIELDS[x] || [x]))];
  }
  const items = [...root.getElementsByTagName('item'), ...root.getElementsByTagName('entry')];
  const n = count === undefined || count === null ? items.length : Math.min(items.length, toInt(count));
  const f = q.split(/\s+/)[1];
  const fields = f ? [f] : ['title', 'author', 'url', 'created', 'summary'];
  const rows = items.slice(0, n).map((it) => fields.map((x) => {
    const v = pick(it, FIELDS[x] || [x]);
    if (x === 'created' && v) {
      const t = Date.parse(v);
      return Number.isNaN(t) ? v : msSerial(t);
    }
    return v;
  }));
  if (headers !== undefined && headers !== null && toBool(headers)) rows.unshift(fields.map((x) => x[0].toUpperCase() + x.slice(1)));
  if (!rows.length) throw err('#N/A', 'The feed has no items.');
  return rows;
}

const FNS = {
  GOOGLEFINANCE: S((t, a, s, e, i) => googlefinance(GOOGLE.ev, t, a, s, e, i), { min: 1, max: 5 }),
  IMPORTRANGE: S((u, r) => importrange(GOOGLE.ev, u, r), { min: 2, max: 2 }),
  IMPORTDATA: S((u, d) => importdata(GOOGLE.ev, u, d), { min: 1, max: 3 }),
  IMPORTHTML: S((u, q, i) => importhtml(GOOGLE.ev, u, q, i), { min: 2, max: 4 }),
  IMPORTXML: S((u, x) => importxml(GOOGLE.ev, u, x), { min: 2, max: 3 }),
  IMPORTFEED: S((u, q, h, n) => importfeed(GOOGLE.ev, u, q, h, n), { min: 1, max: 4 }),
  GOOGLETRANSLATE: S((t, from, to) => {
    const s = toStr(t);
    if (!s) return '';
    return fetchData(GOOGLE.ev, 'translate', { text: s, from: from === undefined ? 'auto' : toStr(from), to: to === undefined ? 'en' : toStr(to) }).text;
  }, { min: 1, max: 3 }),
  DETECTLANGUAGE: S((t) => fetchData(GOOGLE.ev, 'translate', { text: toStr(Array.isArray(t) ? t.flat().join(' ') : t), from: 'auto', to: 'en' }).lang, { arrays: [0], min: 1, max: 1 }),
};

// The evaluator running right now (S-style functions don't receive it).
const GOOGLE = { ev: null };

export default Object.fromEntries(Object.entries(FNS).map(([name, fn]) => [name, (ev, ...rest) => {
  GOOGLE.ev = ev;
  return fn(ev, ...rest);
}]));
