// Combining tables: Add Rows stacks another table under this one, matching
// columns by name or by a mapping; Add Columns joins another table on key
// columns. Both return plain columns for a new Dataset.

import { cellText, uniqueNames } from './columns.js';

const lower = (s) => String(s).toLowerCase();

function stringColumn(name, n, textAt) {
  const dict = [];
  const index = new Map();
  const data = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = textAt(i);
    if (s == null || s === '') {
      data[i] = -1;
      continue;
    }
    let code = index.get(s);
    if (code === undefined) {
      code = dict.length;
      dict.push(s);
      index.set(s, code);
    }
    data[i] = code;
  }
  return { name, type: 'string', data, dict };
}

// Takes rows of a column by index; -1 gives a missing value.
function gather(col, idx, name = col.name) {
  const n = idx.length;
  if (col.type === 'string') {
    const data = new Int32Array(n);
    for (let k = 0; k < n; k += 1) data[k] = idx[k] < 0 ? -1 : col.data[idx[k]];
    return { name, type: 'string', data, dict: col.dict };
  }
  const data = new Float64Array(n);
  for (let k = 0; k < n; k += 1) data[k] = idx[k] < 0 ? NaN : col.data[idx[k]];
  return { name, type: col.type, data };
}

// One column made of a part from each table; either part may be absent.
function stack(name, a, nA, b, nB) {
  const n = nA + nB;
  const type = a && b ? (a.type === b.type ? a.type : 'string') : (a || b).type;
  if (type !== 'string') {
    const data = new Float64Array(n).fill(NaN);
    if (a) data.set(a.data, 0);
    if (b) data.set(b.data, nA);
    return { name, type, data };
  }
  return stringColumn(name, n, (i) => (i < nA ? (a ? cellText(a, i) : null) : b ? cellText(b, i - nA) : null));
}

// Pairs each column of `add` with a column of `base` by name (ignoring case).
export function matchColumns(base, add) {
  return add.map((c) => {
    const hit = base.find((b) => lower(b.name) === lower(c.name));
    return { from: c.name, to: hit ? hit.name : null };
  });
}

// mapping: [{ from: column in `add`, to: column in `base` | null (new column) | '' (skip) }]
// source: { name, base: label for existing rows, add: label for new rows } or null
export function appendRows(base, nA, add, nB, { mapping = matchColumns(base, add), source = null } = {}) {
  const addBy = new Map(add.map((c) => [c.name, c]));
  const into = new Map();
  const extra = [];
  for (const m of mapping) {
    const c = addBy.get(m.from);
    if (!c || m.to === '') continue;
    if (m.to && base.some((b) => b.name === m.to) && !into.has(m.to)) into.set(m.to, c);
    else extra.push(c);
  }
  const out = base.map((b) => stack(b.name, b, nA, into.get(b.name) || null, nB));
  const names = uniqueNames([...out.map((c) => c.name), ...extra.map((c) => c.name)]);
  extra.forEach((c, k) => out.push(stack(names[out.length], null, nA, c, nB)));
  if (source) {
    const sname = uniqueNames([...out.map((c) => c.name), source.name || 'Source']).pop();
    const data = new Int32Array(nA + nB);
    data.fill(1, nA);
    out.push({ name: sname, type: 'string', data, dict: [String(source.base), String(source.add)] });
  }
  return { columns: out, rows: nA + nB };
}

function keyText(cols, i) {
  let s = '';
  for (let k = 0; k < cols.length; k += 1) {
    const c = cols[k];
    const v = c.type === 'string' ? (c.data[i] < 0 ? null : c.dict[c.data[i]]) : Number.isNaN(c.data[i]) ? null : c.type === 'date' ? cellText(c, i) : String(c.data[i]);
    if (v == null) return null;
    s += k ? `\u0001${v}` : v;
  }
  return s;
}

export const JOINS = {
  left: 'Keep all rows here (left outer)',
  inner: 'Only rows that match (inner)',
  right: 'Keep all rows of the new data (right outer)',
  full: 'Keep all rows of both (full outer)',
};

// keys: [{ base, add }] column names; include: columns of `add` to bring in.
export function joinColumns(base, nA, add, nB, { keys, how = 'left', include = null }) {
  if (!keys?.length) throw new Error('Choose at least one pair of key columns to match rows on');
  const find = (cols, name) => {
    const c = cols.find((x) => x.name === name);
    if (!c) throw new Error(`No column named "${name}"`);
    return c;
  };
  const ka = keys.map((k) => find(base, k.base));
  const kb = keys.map((k) => find(add, k.add));
  const lookup = new Map();
  for (let j = 0; j < nB; j += 1) {
    const t = keyText(kb, j);
    if (t == null) continue;
    const list = lookup.get(t);
    if (list) list.push(j);
    else lookup.set(t, [j]);
  }
  const ia = [];
  const ib = [];
  const usedB = how === 'right' || how === 'full' ? new Uint8Array(nB) : null;
  for (let i = 0; i < nA; i += 1) {
    const t = keyText(ka, i);
    const hits = t == null ? null : lookup.get(t);
    if (hits) {
      for (const j of hits) {
        ia.push(i);
        ib.push(j);
        if (usedB) usedB[j] = 1;
      }
    } else if (how === 'left' || how === 'full') {
      ia.push(i);
      ib.push(-1);
    }
  }
  if (usedB) for (let j = 0; j < nB; j += 1) if (!usedB[j]) {
    ia.push(-1);
    ib.push(j);
  }
  const A = Int32Array.from(ia);
  const B = Int32Array.from(ib);
  const n = A.length;
  const keyOf = new Map(keys.map((k, i) => [k.base, kb[i]]));
  const out = base.map((c) => {
    const g = gather(c, A);
    const other = keyOf.get(c.name);
    if (!other || !usedB) return g;
    // Rows that only exist in the new data take their key from it.
    if (g.type === other.type && g.type !== 'string') {
      for (let k = 0; k < n; k += 1) if (A[k] < 0) g.data[k] = other.data[B[k]];
      return g;
    }
    return stringColumn(c.name, n, (k) => (A[k] < 0 ? cellText(other, B[k]) : cellText(c, A[k])));
  });
  const skip = new Set(keys.map((k) => k.add));
  const bring = add.filter((c) => !skip.has(c.name) && (!include || include.includes(c.name)));
  const names = uniqueNames([...out.map((c) => c.name), ...bring.map((c) => c.name)]);
  bring.forEach((c, k) => out.push(gather(c, B, names[base.length + k])));
  return { columns: out, rows: n };
}
