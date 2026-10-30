// Lookup and reference functions.

import cellref from '../../../../common/cellref.js';
import {
  E, Ref, cmp, err, flat, isArr, isErr, toArr, toBool, toInt, toNum, toStr, transpose, wildcard,
} from '../core.js';
import { tokenize } from '../parse.js';
import { F, R, S, isRef } from './util.js';

const { colName, colIndex } = cellref;

const sameType = (a, b) => (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string') || (typeof a === 'boolean' && typeof b === 'boolean');

// Exact match (text is case-insensitive and may use * ? ~ wildcards).
function exactIndex(list, key, { wild = true, reverse = false } = {}) {
  const re = wild && typeof key === 'string' && /[*?~]/.test(key) ? wildcard(key) : null;
  const test = re ? (v) => typeof v === 'string' && re.test(v) : (v) => v != null && sameType(v, key) && cmp(v, key) === 0;
  if (key === '' || key == null) {
    const i = list.findIndex((v) => v == null || v === '');
    return i;
  }
  if (!reverse) return list.findIndex(test);
  for (let i = list.length - 1; i >= 0; i -= 1) if (test(list[i])) return i;
  return -1;
}

// Sorted lookup: the last position whose value is <= key (or >= for descending).
function sortedIndex(list, key, descending = false) {
  let best = -1;
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i];
    if (v == null || isErr(v) || !sameType(v, key)) continue;
    const c = cmp(v, key);
    if (descending ? c >= 0 : c <= 0) best = i;
    else if (!descending) break;
  }
  return best;
}

const notFound = (key) => err('#N/A', `Did not find value '${toStr(key)}' in the lookup.`);

function vlookup(key, range, index, sorted, horizontal) {
  const a = horizontal ? transpose(toArr(range)) : toArr(range);
  const i = toInt(index);
  if (i < 1) throw err('#VALUE!', 'The column index must be at least 1.');
  if (i > a[0].length) throw err('#REF!', `The index ${i} is out of range.`);
  const keys = a.map((r) => r[0]);
  const approx = sorted === undefined || toBool(sorted);
  const k = approx ? sortedIndex(keys, key) : exactIndex(keys, key);
  if (k < 0) throw notFound(key);
  return a[k][i - 1];
}

function match(key, range, type) {
  const list = flat(range);
  const t = type === undefined ? 1 : toNum(type);
  const k = t === 0 ? exactIndex(list, key) : sortedIndex(list, key, t < 0);
  if (k < 0) throw notFound(key);
  return k + 1;
}

function xmatchIndex(list, key, mode = 0, search = 1) {
  const m = toInt(mode);
  const s = toInt(search);
  const reverse = s === -1 || s === -2;
  if (m === 0 || m === 2) return exactIndex(list, key, { wild: m === 2, reverse });
  const exact = exactIndex(list, key, { wild: false, reverse });
  if (exact >= 0) return exact;
  let best = -1;
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i];
    if (v == null || !sameType(v, key)) continue;
    const c = cmp(v, key);
    if (m === -1 && c < 0 && (best < 0 || cmp(v, list[best]) > 0)) best = i;
    if (m === 1 && c > 0 && (best < 0 || cmp(v, list[best]) < 0)) best = i;
  }
  return best;
}

function xlookup(ev, ctx, keyRef, lookupRef, resultRef, missing, mode, search) {
  const key = ev.deref(keyRef);
  const look = toArr(ev.deref(lookupRef));
  const result = toArr(ev.deref(resultRef));
  const vertical = look[0].length === 1;
  const list = vertical ? look.map((r) => r[0]) : look[0];
  const one = (k) => {
    if (isErr(k)) return k;
    const i = xmatchIndex(list, k, mode === undefined ? 0 : ev.deref(mode), search === undefined ? 1 : ev.deref(search));
    if (i < 0) {
      if (missing !== undefined) return ev.deref(missing);
      return notFound(k);
    }
    if (vertical) {
      if (result.length !== list.length) throw err('#VALUE!', 'XLOOKUP ranges must be the same size.');
      return result[0].length === 1 ? result[i][0] : [result[i]];
    }
    if (result[0].length !== list.length) throw err('#VALUE!', 'XLOOKUP ranges must be the same size.');
    return result.length === 1 ? result[0][i] : result.map((r) => [r[i]]);
  };
  if (isArr(key)) return key.map((row) => row.map((k) => first2(one(k))));
  return one(key);
}
const first2 = (v) => (isArr(v) ? v[0][0] : v);

function index(ev, ctx, ref, row, col) {
  const r = row === undefined ? 0 : toInt(ev.deref(row));
  const c = col === undefined ? 0 : toInt(ev.deref(col));
  if (r < 0 || c < 0) throw E.VALUE;
  if (isRef(ref)) {
    const single = ref.rows === 1 && col === undefined;
    const rr = single ? 1 : r;
    const cc = single ? r : c;
    if (rr > ref.rows || cc > ref.cols) throw err('#REF!', 'INDEX is out of range.');
    return new Ref(ref.sheet, rr ? ref.r0 + rr - 1 : ref.r0, cc ? ref.c0 + cc - 1 : ref.c0, rr ? ref.r0 + rr - 1 : ref.r1, cc ? ref.c0 + cc - 1 : ref.c1);
  }
  const a = toArr(ev.deref(ref));
  const single = a.length === 1 && col === undefined;
  const rr = single ? 1 : r;
  const cc = single ? r : c;
  if (rr > a.length || cc > a[0].length) throw err('#REF!', 'INDEX is out of range.');
  if (rr && cc) return a[rr - 1][cc - 1];
  if (rr) return [a[rr - 1]];
  if (cc) return a.map((x) => [x[cc - 1]]);
  return a;
}

function offset(ev, ctx, ref, rows, cols, h, w) {
  if (!isRef(ref)) throw err('#VALUE!', 'OFFSET needs a range.');
  const r0 = ref.r0 + toInt(ev.deref(rows));
  const c0 = ref.c0 + toInt(ev.deref(cols));
  const hh = h === undefined ? ref.rows : toInt(ev.deref(h));
  const ww = w === undefined ? ref.cols : toInt(ev.deref(w));
  if (r0 < 0 || c0 < 0 || hh < 1 || ww < 1) throw err('#REF!', 'OFFSET moves outside the sheet.');
  return new Ref(ref.sheet, r0, c0, r0 + hh - 1, c0 + ww - 1);
}

function indirect(ev, ctx, text, a1) {
  let t = toStr(ev.deref(text)).trim();
  const useA1 = a1 === undefined || toBool(ev.deref(a1));
  if (!useA1) {
    const m = /^(?:(.+)!)?R(\[?-?\d*\]?)C(\[?-?\d*\]?)(?::R(\[?-?\d*\]?)C(\[?-?\d*\]?))?$/i.exec(t);
    if (!m) throw err('#REF!', `"${t}" isn't a valid R1C1 reference.`);
    const part = (s, base) => (s === '' ? base : s.startsWith('[') ? base + Number(s.slice(1, -1)) : Number(s) - 1);
    const a = `${colName(part(m[3], ctx.col))}${part(m[2], ctx.row) + 1}`;
    const b = m[4] != null ? `:${colName(part(m[5], ctx.col))}${part(m[4], ctx.row) + 1}` : '';
    t = `${m[1] ? `${m[1]}!` : ''}${a}${b}`;
  }
  let toks;
  try {
    toks = tokenize(t);
  } catch {
    toks = [];
  }
  if (toks.length !== 1 || toks[0].t !== 'ref') {
    const named = ev.book.names?.[t];
    if (named) return ev.eval({ k: 'ref', ref: tokenize(String(named).replace(/^=/, ''))[0].v }, ctx);
    throw err('#REF!', `"${t}" isn't a valid cell reference.`);
  }
  return ev.refOf({ ref: toks[0].v }, ctx);
}

function address(row, col, abs, a1, sheet) {
  const r = toInt(row);
  const c = toInt(col);
  if (r < 1 || c < 1) throw E.VALUE;
  const mode = abs === undefined ? 1 : toInt(abs);
  const useA1 = a1 === undefined || toBool(a1);
  let s;
  if (useA1) {
    const dc = mode === 1 || mode === 3 ? '$' : '';
    const dr = mode === 1 || mode === 2 ? '$' : '';
    s = `${dc}${colName(c - 1)}${dr}${r}`;
  } else {
    s = `R${mode === 1 || mode === 2 ? r : `[${r}]`}C${mode === 1 || mode === 3 ? c : `[${c}]`}`;
  }
  if (sheet !== undefined && sheet !== null && toStr(sheet) !== '') {
    const n = toStr(sheet);
    s = `${/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`}!${s}`;
  }
  return s;
}

export default {
  VLOOKUP: S((k, r, i, s) => vlookup(k, r, i, s, false), { arrays: [1], min: 3, max: 4 }),
  HLOOKUP: S((k, r, i, s) => vlookup(k, r, i, s, true), { arrays: [1], min: 3, max: 4 }),
  MATCH: S(match, { arrays: [1], min: 2, max: 3 }),
  XMATCH: S((k, r, m, s) => {
    const i = xmatchIndex(flat(r), k, m ?? 0, s ?? 1);
    if (i < 0) throw notFound(k);
    return i + 1;
  }, { arrays: [1], min: 2, max: 4 }),
  XLOOKUP: F(xlookup, { min: 3, max: 6 }),
  LOOKUP: S((key, search, result) => {
    const s = toArr(search);
    const vertical = s.length >= s[0].length;
    const keys = vertical ? s.map((r) => r[0]) : s[0];
    const i = sortedIndex(keys, key);
    if (i < 0) throw notFound(key);
    if (result === undefined) return vertical ? s[i][s[0].length - 1] : s[s.length - 1][i];
    const out = flat(result);
    if (i >= out.length) throw E.NA;
    return out[i];
  }, { arrays: [1, 2], min: 2, max: 3 }),
  INDEX: F(index, { min: 1, max: 3 }),
  OFFSET: F(offset, { min: 3, max: 5 }),
  INDIRECT: F(indirect, { min: 1, max: 2 }),
  ROW: F((ev, ctx, ref) => {
    if (ref === undefined) return ctx.row + 1;
    if (!isRef(ref)) throw err('#N/A', 'ROW needs a range.');
    return ref.rows === 1 ? ref.r0 + 1 : Array.from({ length: ref.rows }, (_, i) => [ref.r0 + i + 1]);
  }, { max: 1 }),
  COLUMN: F((ev, ctx, ref) => {
    if (ref === undefined) return ctx.col + 1;
    if (!isRef(ref)) throw err('#N/A', 'COLUMN needs a range.');
    return ref.cols === 1 ? ref.c0 + 1 : [Array.from({ length: ref.cols }, (_, i) => ref.c0 + i + 1)];
  }, { max: 1 }),
  ROWS: F((ev, ctx, ref) => (isRef(ref) ? ref.rows : toArr(ev.deref(ref)).length), { min: 1, max: 1 }),
  COLUMNS: F((ev, ctx, ref) => (isRef(ref) ? ref.cols : toArr(ev.deref(ref))[0].length), { min: 1, max: 1 }),
  AREAS: F(() => 1, { min: 1, max: 1 }),
  ADDRESS: S(address, { min: 2, max: 5 }),
  TRANSPOSE: R((a) => transpose(toArr(a)), { min: 1, max: 1 }),
  GETPIVOTDATA: R(() => err('#N/A', 'GETPIVOTDATA needs a pivot table, which Plot doesn\'t have yet.')),
};

export { exactIndex, colIndex };
