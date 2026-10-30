// Combining tables on the sheet grid. A table is { header: [names], rows: [[values]] }
// with plain cell values (numbers, text, booleans, null). Add Rows stacks one
// table under another; Add Columns joins them on key columns. Same options as
// the analysis workspace, but values keep their text (no type guessing), so
// keys like "007" stay as they are.

import { JOINS, matchColumns } from './analysis/combine.js';
import { uniqueNames } from './analysis/columns.js';

export { JOINS };

const blank = (v) => v == null || v === '';

// Header names that are unique and never empty, so columns can be told apart by name.
export function tableOf(matrix) {
  const width = Math.max(0, ...matrix.map((r) => r.length));
  const header = uniqueNames(Array.from({ length: width }, (_, c) => matrix[0]?.[c]));
  const rows = matrix.slice(1).map((r) => Array.from({ length: width }, (_, c) => (blank(r[c]) ? null : r[c])));
  return { header, rows };
}

export function matchHeaders(base, add) {
  return matchColumns(base.header.map((name) => ({ name })), add.header.map((name) => ({ name })));
}

// mapping: [{ from: column in `add`, to: column in `base` | null (new column) | '' (skip) }]
// source: { name, base, add } labels a new column with where each row came from.
export function appendTable(base, add, { mapping = matchHeaders(base, add), source = null } = {}) {
  const width = base.header.length;
  const target = new Map();
  const extra = [];
  for (const m of mapping) {
    const from = add.header.indexOf(m.from);
    if (from < 0 || m.to === '') continue;
    const to = m.to ? base.header.indexOf(m.to) : -1;
    if (to >= 0 && ![...target.values()].includes(to)) target.set(from, to);
    else extra.push(from);
  }
  const names = [...base.header, ...extra.map((i) => add.header[i])];
  if (source) names.push(source.name || 'Source');
  const header = uniqueNames(names);
  const n = header.length;
  const rows = base.rows.map((r) => {
    const out = [...r, ...new Array(n - width).fill(null)];
    if (source) out[n - 1] = String(source.base);
    return out;
  });
  for (const r of add.rows) {
    const out = new Array(n).fill(null);
    for (const [from, to] of target) out[to] = r[from];
    extra.forEach((from, k) => {
      out[width + k] = r[from];
    });
    if (source) out[n - 1] = String(source.add);
    rows.push(out);
  }
  return { header, rows };
}

const keyText = (v) => (blank(v) ? null : String(typeof v === 'string' ? v.trim() : v));

// keys: [{ base, add }] column names; include: columns of `add` to bring in.
// `from` gives, per result row, the row of `base` it came from (-1 when it only exists in `add`).
export function joinTable(base, add, { keys, how = 'left', include = null }) {
  if (!keys?.length) throw new Error('Choose at least one pair of key columns to match rows on');
  const find = (t, name) => {
    const i = t.header.indexOf(name);
    if (i < 0) throw new Error(`No column named "${name}"`);
    return i;
  };
  const ka = keys.map((k) => find(base, k.base));
  const kb = keys.map((k) => find(add, k.add));
  const keyOf = (row, idx) => {
    const parts = idx.map((i) => keyText(row[i]));
    return parts.includes(null) ? null : parts.join('\u0001');
  };
  const lookup = new Map();
  add.rows.forEach((r, j) => {
    const t = keyOf(r, kb);
    if (t == null) return;
    if (lookup.has(t)) lookup.get(t).push(j);
    else lookup.set(t, [j]);
  });
  const pairs = [];
  const used = new Uint8Array(add.rows.length);
  base.rows.forEach((r, i) => {
    const t = keyOf(r, ka);
    const hits = t == null ? null : lookup.get(t);
    if (!hits) {
      if (how === 'left' || how === 'full') pairs.push([i, -1]);
      return;
    }
    for (const j of hits) {
      pairs.push([i, j]);
      used[j] = 1;
    }
  });
  if (how === 'right' || how === 'full') add.rows.forEach((r, j) => {
    if (!used[j]) pairs.push([-1, j]);
  });
  const skip = new Set(kb);
  const bring = add.header.map((_, j) => j).filter((j) => !skip.has(j) && (!include || include.includes(add.header[j])));
  const header = uniqueNames([...base.header, ...bring.map((j) => add.header[j])]);
  const width = base.header.length;
  const rows = pairs.map(([i, j]) => {
    const out = i < 0 ? new Array(width).fill(null) : [...base.rows[i]];
    // Rows that only exist in the new data take their key from it.
    if (i < 0) ka.forEach((c, k) => {
      out[c] = add.rows[j][kb[k]];
    });
    for (const c of bring) out.push(j < 0 ? null : add.rows[j][c]);
    return out;
  });
  return { header, rows, from: pairs.map(([i]) => i) };
}
