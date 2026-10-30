// Array functions: FILTER, SORT, UNIQUE, stacking and reshaping, LAMBDA helpers, database functions.

import {
  E, compare, criterion, err, fill, flat, isArr, isErr, toArr, toBool, toInt, toNum, toStr, transpose,
} from '../core.js';
import { SUBTOTALS } from './math.js';
import { R, V, call } from './util.js';

const keyOf = (v) => (v == null ? 'b' : isErr(v) ? `e${v.error}` : `${typeof v}:${v}`);
const rowKey = (row) => row.map(keyOf).join('\u0001');

function filter(range, ...conds) {
  const a = toArr(range);
  if (!conds.length) throw err('#N/A', 'FILTER needs at least one condition.');
  const cs = conds.map(toArr);
  const byRows = cs[0][0].length === 1 && cs[0].length === a.length && !(a.length === 1 && cs[0].length === 1 && a[0].length > 1);
  const len = byRows ? a.length : a[0].length;
  for (const c of cs) {
    const n = byRows ? c.length : c[0].length;
    if ((byRows ? c[0].length : c.length) !== 1 || n !== len) {
      throw err('#VALUE!', `FILTER has mismatched range sizes. Expected row count: ${a.length}. column count: 1. Actual row count: ${c.length}, column count: ${c[0].length}.`);
    }
  }
  const keep = [];
  for (let i = 0; i < len; i += 1) {
    let ok = true;
    for (const c of cs) {
      const v = byRows ? c[i][0] : c[0][i];
      if (isErr(v)) throw v;
      if (!(typeof v === 'string' ? toBool(v) : Boolean(v))) {
        ok = false;
        break;
      }
    }
    if (ok) keep.push(i);
  }
  if (!keep.length) throw err('#N/A', 'No matches are found in FILTER evaluation.');
  return byRows ? keep.map((i) => a[i]) : a.map((row) => keep.map((i) => row[i]));
}

// Sort keys come as (column index or range, ascending) pairs.
function sortKeys(a, args) {
  const keys = [];
  if (!args.length) args = [1, true];
  for (let i = 0; i < args.length; i += 2) {
    const col = args[i];
    const asc = args[i + 1];
    const up = asc === undefined || asc === null ? true : typeof asc === 'number' ? asc !== -1 && asc !== 0 : toBool(asc);
    if (isArr(col) && !(col.length === 1 && col[0].length === 1)) {
      const vals = flat(col);
      if (vals.length !== a.length) throw err('#VALUE!', 'SORT has mismatched range sizes.');
      keys.push({ get: (row, idx) => vals[idx], up });
    } else {
      const k = toInt(isArr(col) ? col[0][0] : col);
      if (k < 1 || k > a[0].length) throw err('#VALUE!', `SORT column ${k} is outside the range.`);
      keys.push({ get: (row) => row[k - 1], up });
    }
  }
  return keys;
}

function sortRows(a, keys) {
  return a.map((row, idx) => ({ row, idx })).sort((x, y) => {
    for (const k of keys) {
      const c = compare(k.get(x.row, x.idx), k.get(y.row, y.idx));
      if (c) return k.up ? c : -c;
    }
    return x.idx - y.idx;
  }).map((x) => x.row);
}

function sortn(range, n, ties, ...args) {
  const a = toArr(range);
  const count = n === undefined || n === null ? 1 : toInt(n);
  const mode = ties === undefined || ties === null ? 0 : toInt(ties);
  const keys = sortKeys(a, args);
  const rows = sortRows(a, keys);
  const sig = (row) => keys.map((k) => keyOf(k.get(row, a.indexOf(row)))).join('\u0001');
  if (mode === 0) return rows.slice(0, count);
  if (mode === 1) {
    if (!count) return [];
    const last = sig(rows[Math.min(count, rows.length) - 1]);
    let end = Math.min(count, rows.length);
    while (end < rows.length && sig(rows[end]) === last) end += 1;
    return rows.slice(0, end);
  }
  if (mode === 2) {
    const seen = new Set();
    const out = [];
    for (const row of rows) {
      const k = rowKey(row);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
      if (out.length === count) break;
    }
    return out;
  }
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const k = sig(row);
    if (!seen.has(k)) {
      if (seen.size === count) break;
      seen.add(k);
    }
    out.push(row);
  }
  return out;
}

function unique(range, byCol, once) {
  let a = toArr(range);
  const cols = byCol !== undefined && toBool(byCol);
  if (cols) a = transpose(a);
  const counts = new Map();
  for (const row of a) {
    const k = rowKey(row);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const seen = new Set();
  const out = [];
  for (const row of a) {
    const k = rowKey(row);
    if (seen.has(k)) continue;
    seen.add(k);
    if (once !== undefined && toBool(once) && counts.get(k) > 1) continue;
    out.push(row);
  }
  if (!out.length) throw err('#N/A', 'No unique values.');
  return cols ? transpose(out) : out;
}

const pad = (rows, w, v = E.NA) => rows.map((r) => (r.length < w ? [...r, ...Array(w - r.length).fill(v)] : r));

function hstack(...arrays) {
  const parts = arrays.map(toArr);
  const h = Math.max(...parts.map((p) => p.length));
  return Array.from({ length: h }, (_, i) => parts.flatMap((p) => p[i] || Array(p[0].length).fill(E.NA)));
}
function vstack(...arrays) {
  const parts = arrays.map(toArr);
  const w = Math.max(...parts.map((p) => p[0].length));
  return parts.flatMap((p) => pad(p, w));
}

const values = (a, ignore) => {
  const mode = ignore === undefined ? 0 : toInt(ignore);
  return (v) => !((mode === 1 || mode === 3) && v == null) && !((mode === 2 || mode === 3) && isErr(v));
};

function toCol(a, ignore, byCol) {
  const src = byCol !== undefined && toBool(byCol) ? transpose(toArr(a)) : toArr(a);
  const out = src.flat().filter(values(a, ignore));
  if (!out.length) throw E.NA;
  return out.map((v) => [v]);
}

function wrap(a, n, padWith, byCols) {
  const list = flat(a);
  const k = toInt(n);
  if (k < 1) throw E.VALUE;
  const rows = [];
  for (let i = 0; i < list.length; i += k) rows.push(list.slice(i, i + k));
  const out = pad(rows, k, padWith === undefined ? E.NA : padWith);
  return byCols ? transpose(out) : out;
}

function pick(a, idx, rows) {
  const src = toArr(a);
  const n = rows ? src.length : src[0].length;
  const picks = idx.flatMap(flat).map((v) => {
    const i = toInt(v);
    const j = i < 0 ? n + i : i - 1;
    if (i === 0 || j < 0 || j >= n) throw err('#VALUE!', `Index ${i} is out of range.`);
    return j;
  });
  return rows ? picks.map((j) => src[j]) : src.map((r) => picks.map((j) => r[j]));
}

function takeDrop(a, rows, cols, drop) {
  let src = toArr(a);
  const slice = (len, n) => {
    if (n === undefined || n === null) return [0, len];
    const k = toInt(n);
    if (drop) return k >= 0 ? [Math.min(k, len), len] : [0, Math.max(len + k, 0)];
    return k >= 0 ? [0, Math.min(k, len)] : [Math.max(len + k, 0), len];
  };
  const [r0, r1] = slice(src.length, rows);
  const [c0, c1] = slice(src[0].length, cols);
  src = src.slice(r0, r1).map((r) => r.slice(c0, c1));
  if (!src.length || !src[0].length) throw err('#VALUE!', 'The result is empty.');
  return src;
}

function byRow(ev, ctx, a, fn, cols) {
  const src = cols ? transpose(toArr(a)) : toArr(a);
  const out = src.map((r) => {
    const v = call(ev, fn, cols ? r.map((x) => [x]) : [r]);
    if (isArr(v) && (v.length > 1 || v[0].length > 1)) return err('#VALUE!', 'BYROW/BYCOL functions must return one value per row or column.');
    return isArr(v) ? v[0][0] : v;
  });
  return cols ? [out] : out.map((v) => [v]);
}

function mapArrays(ev, ctx, ...args) {
  const fn = args.pop();
  const arrays = args.map(toArr);
  const [h, w] = [arrays[0].length, arrays[0][0].length];
  if (arrays.some((x) => x.length !== h || x[0].length !== w)) throw err('#VALUE!', 'MAP arrays must be the same size.');
  return fill(h, w, null).map((row, i) => row.map((_, j) => {
    const v = call(ev, fn, ...arrays.map((x) => x[i][j]));
    return isArr(v) ? v[0][0] : v;
  }));
}

function reduce(ev, ctx, init, a, fn, scan) {
  let acc = init ?? null;
  const src = toArr(a);
  const out = src.map((row) => row.map((v) => {
    acc = call(ev, fn, acc, v);
    if (isArr(acc)) acc = acc[0][0];
    return acc;
  }));
  return scan ? out : acc;
}

function makeArray(ev, ctx, rows, cols, fn) {
  const r = toInt(rows);
  const c = toInt(cols);
  if (r < 1 || c < 1) throw E.VALUE;
  return fill(r, c, null).map((row, i) => row.map((_, j) => {
    const v = call(ev, fn, i + 1, j + 1);
    return isArr(v) ? v[0][0] : v;
  }));
}

// Database functions: a table with headers, a field, and a criteria table (rows OR, columns AND).
function dbValues(db, field, crit) {
  const a = toArr(db);
  const head = a[0].map((h) => toStr(h).toLowerCase());
  const f = typeof field === 'number' ? field - 1 : head.indexOf(toStr(field).toLowerCase());
  if (f < 0 || f >= head.length) throw err('#VALUE!', `"${field}" isn't a column of the database.`);
  const c = toArr(crit);
  const ch = c[0].map((h) => head.indexOf(toStr(h).toLowerCase()));
  const tests = c.slice(1).map((row) => row.map((v, i) => (v == null || v === '' || ch[i] < 0 ? null : [ch[i], criterion(v)])).filter(Boolean));
  return a.slice(1).filter((row) => !tests.length || tests.some((t) => t.every(([i, test]) => test(row[i])))).map((row) => row[f]);
}

const db = (k, post) => R((d, f, c) => {
  const vals = dbValues(d, f, c);
  return post ? post(vals) : SUBTOTALS[k]([vals.map((v) => [v])]);
}, { min: 3, max: 3 });

export default {
  FILTER: R(filter, { min: 2 }),
  SORT: R((range, ...args) => sortRows(toArr(range), sortKeys(toArr(range), args)), { min: 1 }),
  SORTN: R(sortn, { min: 1 }),
  UNIQUE: R(unique, { min: 1, max: 3 }),
  FLATTEN: R((...a) => a.flatMap((x) => flat(x)).map((v) => [v]), { min: 1 }),
  ARRAY_CONSTRAIN: R((a, r, c) => toArr(a).slice(0, toInt(r)).map((row) => row.slice(0, toInt(c))), { min: 3, max: 3 }),
  CHOOSECOLS: R((a, ...idx) => pick(a, idx, false), { min: 2 }),
  CHOOSEROWS: R((a, ...idx) => pick(a, idx, true), { min: 2 }),
  HSTACK: R(hstack, { min: 1 }),
  VSTACK: R(vstack, { min: 1 }),
  TOCOL: R((a, i, b) => toCol(a, i, b), { min: 1, max: 3 }),
  TOROW: R((a, i, b) => [toCol(a, i, b).map((r) => r[0])], { min: 1, max: 3 }),
  WRAPROWS: R((a, n, p) => wrap(a, n, p, false), { min: 2, max: 3 }),
  WRAPCOLS: R((a, n, p) => wrap(a, n, p, true), { min: 2, max: 3 }),
  TAKE: R((a, r, c) => takeDrop(a, r, c, false), { min: 2, max: 3 }),
  DROP: R((a, r, c) => takeDrop(a, r, c, true), { min: 2, max: 3 }),
  EXPAND: R((a, r, c, p) => {
    const src = toArr(a);
    const h = r === undefined || r === null ? src.length : toInt(r);
    const w = c === undefined || c === null ? src[0].length : toInt(c);
    if (h < src.length || w < src[0].length) throw E.VALUE;
    const v = p === undefined ? E.NA : p;
    return [...pad(src, w, v), ...fill(h - src.length, w, v)];
  }, { min: 2, max: 4 }),
  BYROW: V((ev, ctx, a, fn) => byRow(ev, ctx, a, fn, false), { min: 2, max: 2 }),
  BYCOL: V((ev, ctx, a, fn) => byRow(ev, ctx, a, fn, true), { min: 2, max: 2 }),
  MAP: V(mapArrays, { min: 2 }),
  REDUCE: V((ev, ctx, init, a, fn) => reduce(ev, ctx, init, a, fn, false), { min: 3, max: 3 }),
  SCAN: V((ev, ctx, init, a, fn) => reduce(ev, ctx, init, a, fn, true), { min: 3, max: 3 }),
  MAKEARRAY: V(makeArray, { min: 3, max: 3 }),

  DAVERAGE: db(1),
  DCOUNT: db(2),
  DCOUNTA: db(3),
  DMAX: db(4),
  DMIN: db(5),
  DPRODUCT: db(6),
  DSTDEV: db(7),
  DSTDEVP: db(8),
  DSUM: db(9),
  DVAR: db(10),
  DVARP: db(11),
  DGET: db(0, (vals) => {
    if (!vals.length) throw E.VALUE;
    if (vals.length > 1) throw E.NUM;
    return vals[0];
  }),
};

export { toNum };
