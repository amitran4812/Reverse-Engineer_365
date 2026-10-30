// Expressions for calculated columns, filters and custom fit equations.
// Columns are written [Column name], col(A) / col("name"), or a bare name
// without spaces. Evaluation is vectorised: a column is a whole typed array,
// so a formula over ten million rows is a handful of tight loops.
//
// Values: number (scalar), string (scalar), Float64Array (numeric column),
// { codes, dict } (text column).

import {
  REDUCERS, RUNNING, newAcc, addAcc, readAcc, datePartName, datePart, dateAdd, dateDiff, parseDate, startOfDay,
} from './expr-fns.js';

const OPS = ['<=', '>=', '==', '!=', '<>', '&&', '||', '**', '&', '<', '>', '=', '+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':', '!'];

export function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '[') {
      const j = src.indexOf(']', i);
      if (j < 0) throw new Error('Missing ] after a column name');
      out.push({ t: 'col', v: src.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== ch) s += src[j++];
      if (j >= src.length) throw new Error('Missing closing quote');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][\w.]*/.exec(src.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected "${ch}"`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

export function parse(src) {
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...v) => peek()?.t === 'op' && v.includes(peek().v);
  const isWord = (...v) => peek()?.t === 'id' && v.includes(peek().v.toLowerCase());
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`Expected "${v}"`);
    p += 1;
  };
  const ternary = () => {
    const c = or();
    if (isOp('?')) {
      p += 1;
      const a = ternary();
      expect(':');
      return { k: 'call', fn: 'if', args: [c, a, ternary()] };
    }
    return c;
  };
  const or = () => {
    let l = and();
    while (isOp('||') || isWord('or')) {
      p += 1;
      l = { k: 'bin', op: '||', l, r: and() };
    }
    return l;
  };
  const and = () => {
    let l = cmp();
    while (isOp('&&') || isWord('and')) {
      p += 1;
      l = { k: 'bin', op: '&&', l, r: cmp() };
    }
    return l;
  };
  const cmp = () => {
    const l = add();
    // [x] in ("a", "b")
    if (isWord('in')) {
      p += 1;
      expect('(');
      const opts = [];
      do {
        if (opts.length) p += 1;
        opts.push(ternary());
      } while (isOp(','));
      expect(')');
      return opts.map((r) => ({ k: 'bin', op: '==', l, r })).reduce((x, y) => ({ k: 'bin', op: '||', l: x, r: y }));
    }
    // [x] is null / [x] is not null
    if (isWord('is')) {
      p += 1;
      const neg = isWord('not');
      if (neg) p += 1;
      if (!isWord('null')) throw new Error('Expected "null" after "is"');
      p += 1;
      const test = { k: 'call', fn: 'isnull', args: [l] };
      return neg ? { k: 'not', a: test } : test;
    }
    if (isOp('<=', '>=', '==', '!=', '<>', '<', '>', '=')) {
      const op = { '=': '==', '<>': '!=' }[toks[p].v] || toks[p].v;
      p += 1;
      return { k: 'bin', op, l, r: add() };
    }
    return l;
  };
  const add = () => {
    let l = mul();
    while (isOp('+', '-', '&')) {
      const op = toks[p++].v;
      const r = mul();
      l = op === '&' ? { k: 'call', fn: 'concat', args: [l, r] } : { k: 'bin', op, l, r };
    }
    return l;
  };
  const mul = () => {
    let l = unary();
    while (isOp('*', '/', '%')) {
      const op = toks[p++].v;
      l = { k: 'bin', op, l, r: unary() };
    }
    return l;
  };
  const unary = () => {
    if (isOp('-')) {
      p += 1;
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p += 1;
      return unary();
    }
    if (isOp('!') || isWord('not')) {
      p += 1;
      return { k: 'not', a: unary() };
    }
    return pow();
  };
  const pow = () => {
    const base = primary();
    if (isOp('^', '**')) {
      p += 1;
      return { k: 'bin', op: '^', l: base, r: unary() };
    }
    return base;
  };
  const primary = () => {
    const t = toks[p];
    if (!t) throw new Error('The formula ends too early');
    p += 1;
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'col') return { k: 'col', name: t.v };
    if (t.t === 'op' && t.v === '(') {
      const e = ternary();
      expect(')');
      return e;
    }
    if (t.t === 'id' && t.v.toLowerCase() === 'case' && !isOp('(')) {
      // case when c1 then a when c2 then b else z end, or case [x] when 1 then a ... end
      const subject = isWord('when') ? null : ternary();
      const arms = [];
      while (isWord('when')) {
        p += 1;
        const c = ternary();
        if (!isWord('then')) throw new Error('Expected "then" in case');
        p += 1;
        arms.push([subject ? { k: 'bin', op: '==', l: subject, r: c } : c, ternary()]);
      }
      if (!arms.length) throw new Error('A case needs at least one "when"');
      let other = { k: 'num', v: NaN };
      if (isWord('else')) {
        p += 1;
        other = ternary();
      }
      if (!isWord('end')) throw new Error('Expected "end" to close the case');
      p += 1;
      return arms.reduceRight((acc, [c, v]) => ({ k: 'call', fn: 'casewhen', args: [c, v, acc] }), other);
    }
    if (t.t === 'id') {
      if (isOp('(')) {
        p += 1;
        const args = [];
        if (!isOp(')')) {
          do {
            if (args.length) p += 1;
            if (t.v.toLowerCase() === 'col' && peek()?.t === 'id') args.push({ k: 'str', v: toks[p++].v });
            else args.push(ternary());
          } while (isOp(','));
        }
        expect(')');
        if (t.v.toLowerCase() === 'col') {
          if (args.length !== 1 || args[0].k !== 'str') throw new Error('col() takes a column letter or name');
          return { k: 'col', name: args[0].v, letter: true };
        }
        const node = { k: 'call', fn: t.v.toLowerCase(), args };
        // Spotfire style grouping: StdDev([x]) OVER [Lot] or OVER ([Lot], [Wafer]).
        if (isWord('over')) {
          p += 1;
          const over = [];
          if (isOp('(')) {
            p += 1;
            do {
              if (over.length) p += 1;
              over.push(ternary());
            } while (isOp(','));
            expect(')');
          } else over.push(primary());
          node.over = over;
        }
        return node;
      }
      return { k: 'id', name: t.v };
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const ast = ternary();
  if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return ast;
}

// Column and variable names an expression refers to.
export function references(ast, out = { cols: new Set(), ids: new Set() }) {
  if (!ast) return out;
  if (ast.k === 'col') out.cols.add(ast.name);
  if (ast.k === 'id') out.ids.add(ast.name);
  for (const key of ['l', 'r', 'a']) if (ast[key]) references(ast[key], out);
  for (const a of [...(ast.args || []), ...(ast.over || [])]) references(a, out);
  return out;
}

const isVec = (v) => v instanceof Float64Array;
const isCat = (v) => v && typeof v === 'object' && !isVec(v) && v.codes;

function numeric(v, n) {
  if (typeof v === 'number') return v;
  if (isVec(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const x = Number(v);
    if (v.trim() && !Number.isNaN(x)) return x;
    throw new Error(`"${v}" is text; only numbers can be used here`);
  }
  if (isCat(v)) throw new Error('A text column can only be compared (==, !=) or used in text functions');
  return n ? new Float64Array(n).fill(NaN) : NaN;
}

function map1(a, n, f) {
  a = numeric(a, n);
  if (typeof a === 'number') return f(a);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = f(a[i]);
  return out;
}

function map2(a, b, n, f) {
  a = numeric(a, n);
  b = numeric(b, n);
  if (typeof a === 'number' && typeof b === 'number') return f(a, b);
  const out = new Float64Array(n);
  if (typeof a === 'number') for (let i = 0; i < n; i += 1) out[i] = f(a, b[i]);
  else if (typeof b === 'number') for (let i = 0; i < n; i += 1) out[i] = f(a[i], b);
  else for (let i = 0; i < n; i += 1) out[i] = f(a[i], b[i]);
  return out;
}

// Per-row string access for text comparisons and if(..., "a", "b").
function strAt(v) {
  if (typeof v === 'string') return () => v;
  if (typeof v === 'number') return () => (Number.isNaN(v) ? null : String(v));
  if (isCat(v)) return (i) => (v.codes[i] < 0 ? null : v.dict[v.codes[i]]);
  if (isVec(v)) return (i) => (Number.isNaN(v[i]) ? null : String(v[i]));
  return () => null;
}

const isTextish = (v) => typeof v === 'string' || isCat(v);

function compare(op, a, b, n) {
  if (isTextish(a) || isTextish(b)) {
    // Fast path: text column against a literal compares dictionary codes.
    if (isCat(a) && typeof b === 'string' && (op === '==' || op === '!=')) {
      const code = a.dict.indexOf(b);
      const out = new Float64Array(n);
      const eq = op === '==' ? 1 : 0;
      for (let i = 0; i < n; i += 1) out[i] = a.codes[i] < 0 ? NaN : a.codes[i] === code ? eq : 1 - eq;
      return out;
    }
    if (isCat(b) && typeof a === 'string') return compare(op, b, a, n);
    const fa = strAt(a);
    const fb = strAt(b);
    const test = {
      '==': (x, y) => x === y, '!=': (x, y) => x !== y, '<': (x, y) => x < y, '>': (x, y) => x > y, '<=': (x, y) => x <= y, '>=': (x, y) => x >= y,
    }[op];
    if (typeof a === 'string' && typeof b === 'string') return test(a, b) ? 1 : 0;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const x = fa(i);
      const y = fb(i);
      out[i] = x == null || y == null ? NaN : test(x, y) ? 1 : 0;
    }
    return out;
  }
  const f = {
    '==': (x, y) => (x === y ? 1 : 0), '!=': (x, y) => (x !== y ? 1 : 0), '<': (x, y) => (x < y ? 1 : 0), '>': (x, y) => (x > y ? 1 : 0), '<=': (x, y) => (x <= y ? 1 : 0), '>=': (x, y) => (x >= y ? 1 : 0),
  }[op];
  return map2(a, b, n, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : f(x, y)));
}

const truthy = (x) => !Number.isNaN(x) && x !== 0;

// Results that are dates (ms since 1970) so a calculated column keeps the
// date type.
const DATES = new WeakSet();
export const markDate = (v) => {
  if (isVec(v)) DATES.add(v);
  return v;
};
export const isDateValue = (v) => isVec(v) && DATES.has(v);
const dateOut = (v, n) => markDate(typeof v === 'number' ? new Float64Array(n).fill(v) : v);

// Per-row group ids from one or more columns, for stat(...) OVER [group].
function groupIds(groups, n) {
  const ids = new Int32Array(n);
  const index = new Map();
  const keys = groups.map((g) => (isCat(g) ? (i) => g.codes[i] : isVec(g) ? (i) => g[i] : () => g));
  for (let i = 0; i < n; i += 1) {
    const key = keys.length === 1 ? keys[0](i) : keys.map((k) => k(i)).join('\u0001');
    let id = index.get(key);
    if (id === undefined) {
      id = index.size;
      index.set(key, id);
    }
    ids[i] = id;
  }
  return { ids, count: index.size };
}

// The non-missing values of each group, packed group after group in row order.
function packGroups(a, ids, count) {
  const off = new Int32Array(count + 1);
  for (let i = 0; i < a.length; i += 1) if (!Number.isNaN(a[i])) off[ids[i] + 1] += 1;
  for (let g = 0; g < count; g += 1) off[g + 1] += off[g];
  const at = off.slice(0, count);
  const vals = new Float64Array(off[count]);
  for (let i = 0; i < a.length; i += 1) if (!Number.isNaN(a[i])) vals[at[ids[i]]++] = a[i];
  return (g) => vals.subarray(off[g], off[g + 1]);
}

// Sort position of each dictionary entry, so text sorts alphabetically.
function dictOrder(dict) {
  const order = dict.map((_, i) => i).sort((x, y) => dict[x].localeCompare(dict[y], undefined, { numeric: true }));
  const rank = new Float64Array(dict.length);
  order.forEach((c, r) => { rank[c] = r; });
  return rank;
}

function sortKey(v, n) {
  if (isCat(v)) {
    const ord = dictOrder(v.dict);
    return Float64Array.from(v.codes, (c) => (c < 0 ? NaN : ord[c]));
  }
  const a = numeric(v, n);
  return typeof a === 'number' ? new Float64Array(n).fill(a) : a;
}

const TEXT_OK = new Set(['count', 'uniquecount', 'first', 'last', 'mode']);
const TEXT_OUT = new Set(['first', 'last', 'mode']);
const NAV = new Set(['allprevious', 'allnext', 'previous', 'next']);

// A column statistic over the whole column, or per group with OVER (the
// result is broadcast back to every row of its group). over is
// { groups: [values], nav: { kind, v } | null }.
function stat(v, kind, over, n, param) {
  const reduce = REDUCERS[kind];
  const text = isCat(v);
  if (text && !TEXT_OK.has(kind)) numeric(v, n);
  let a;
  if (v === undefined) a = new Float64Array(n).fill(1);
  else if (text) a = Float64Array.from(v.codes, (c) => (c < 0 ? NaN : c));
  else {
    a = numeric(v, n);
    if (typeof a === 'number') a = new Float64Array(n).fill(a);
  }
  const textOut = text && TEXT_OUT.has(kind);
  const groups = over?.groups || [];
  const nav = over?.nav;
  if (!groups.length && !nav) {
    const r = reduce(a.filter((x) => !Number.isNaN(x)), param);
    return textOut ? (Number.isNaN(r) ? NaN : v.dict[r]) : r;
  }
  const out = new Float64Array(n);
  if (!nav) {
    const { ids, count } = groupIds(groups, n);
    const slice = packGroups(a, ids, count);
    const res = Float64Array.from({ length: count }, (_, g) => reduce(slice(g), param));
    for (let i = 0; i < n; i += 1) out[i] = res[ids[i]];
  } else {
    // Navigation OVER: nodes are (group, value of the nav column), walked in
    // the nav column's sort order within each group.
    if (nav.kind.startsWith('all') && !RUNNING.has(kind)) throw new Error(`${kind}() can't be used with ${nav.kind === 'allprevious' ? 'AllPrevious' : 'AllNext'}; try sum, avg, count, min, max or sigma`);
    const gid = groups.length ? Float64Array.from(groupIds(groups, n).ids) : new Float64Array(n);
    const key = sortKey(nav.v, n);
    const { ids, count } = groupIds([gid, key], n);
    const nodeG = new Float64Array(count);
    const nodeK = new Float64Array(count);
    for (let i = 0; i < n; i += 1) {
      nodeG[ids[i]] = gid[i];
      nodeK[ids[i]] = key[i];
    }
    const order = Array.from({ length: count }, (_, k) => k).filter((k) => !Number.isNaN(nodeK[k])).sort((x, y) => nodeG[x] - nodeG[y] || nodeK[x] - nodeK[y]);
    const slice = packGroups(a, ids, count);
    const res = new Float64Array(count).fill(NaN);
    const walk = nav.kind === 'allnext' || nav.kind === 'next' ? order.reverse() : order;
    let acc = newAcc();
    for (let j = 0; j < walk.length; j += 1) {
      const k = walk[j];
      const fresh = j === 0 || nodeG[walk[j - 1]] !== nodeG[k];
      if (nav.kind.startsWith('all')) {
        if (fresh) acc = newAcc();
        for (const x of slice(k)) addAcc(acc, x);
        res[k] = readAcc(acc, kind);
      } else if (!fresh) res[k] = reduce(slice(walk[j - 1]), param);
    }
    for (let i = 0; i < n; i += 1) out[i] = res[ids[i]];
  }
  if (!textOut) return out;
  return { codes: Int32Array.from(out, (c) => (Number.isNaN(c) ? -1 : c)), dict: v.dict };
}

// Rank within the whole column or within groups. method: 'minimum' (ties
// share the lowest rank), 'average' or 'dense'.
function rank(v, desc, method, groups, n) {
  const key = sortKey(v, n);
  const gid = groups.length ? groupIds(groups, n).ids : new Int32Array(n);
  const idx = [];
  for (let i = 0; i < n; i += 1) if (!Number.isNaN(key[i])) idx.push(i);
  const dir = desc ? -1 : 1;
  idx.sort((x, y) => gid[x] - gid[y] || dir * (key[x] - key[y]));
  const out = new Float64Array(n).fill(NaN);
  let pos = 0;
  let dense = 0;
  for (let j = 0; j < idx.length;) {
    if (j === 0 || gid[idx[j]] !== gid[idx[j - 1]]) {
      pos = 0;
      dense = 0;
    }
    let k = j;
    while (k + 1 < idx.length && gid[idx[k + 1]] === gid[idx[j]] && key[idx[k + 1]] === key[idx[j]]) k += 1;
    dense += 1;
    const r = method === 'dense' ? dense : method === 'average' ? pos + 1 + (k - j) / 2 : pos + 1;
    for (let m = j; m <= k; m += 1) out[idx[m]] = r;
    pos += k - j + 1;
    j = k + 1;
  }
  return out;
}

// Applies a string function to every row of a text value. Text columns only
// touch their dictionary, so this stays fast on millions of rows.
function textMap(v, n, f) {
  if (typeof v === 'string') return f(v) ?? NaN;
  if (typeof v === 'number') return Number.isNaN(v) ? NaN : f(String(v)) ?? NaN;
  const dict = [];
  const index = new Map();
  const intern = (s) => {
    if (s == null) return -1;
    let code = index.get(s);
    if (code === undefined) {
      code = dict.length;
      dict.push(s);
      index.set(s, code);
    }
    return code;
  };
  if (isCat(v)) {
    const remap = v.dict.map((s) => intern(f(s)));
    const codes = new Int32Array(v.codes.length);
    for (let i = 0; i < codes.length; i += 1) codes[i] = v.codes[i] < 0 ? -1 : remap[v.codes[i]];
    return { codes, dict };
  }
  const get = strAt(v);
  const codes = new Int32Array(n);
  for (let i = 0; i < n; i += 1) {
    const s = get(i);
    codes[i] = s == null ? -1 : intern(f(s));
  }
  return { codes, dict };
}

// Splits text on a separator and keeps one part. index counts from 1;
// negative counts from the end (-1 is the last part).
export function splitPart(s, sep, index) {
  const parts = sep === '' ? [...s] : s.split(sep);
  const k = index < 0 ? parts.length + index : index - 1;
  return k >= 0 && k < parts.length ? parts[k] : null;
}

// Standard normal CDF, accurate to double precision (Hart's algorithm as
// given by West, 2005).
export function normCdf(x) {
  const z = Math.abs(x);
  let c = 0;
  if (Number.isNaN(x)) return NaN;
  if (z <= 37) {
    const e = Math.exp(-(z * z) / 2);
    if (z < 7.07106781186547) {
      let b = 3.52624965998911e-2 * z + 0.700383064443688;
      b = b * z + 6.37396220353165;
      b = b * z + 33.912866078383;
      b = b * z + 112.079291497871;
      b = b * z + 221.213596169931;
      b = b * z + 220.206867912376;
      c = e * b;
      b = 8.83883476483184e-2 * z + 1.75566716318264;
      b = b * z + 16.064177579207;
      b = b * z + 86.7807322029461;
      b = b * z + 296.564248779674;
      b = b * z + 637.333633378831;
      b = b * z + 793.826512519948;
      b = b * z + 440.413735824752;
      c /= b;
    } else {
      let b = z + 0.65;
      b = z + 4 / b;
      b = z + 3 / b;
      b = z + 2 / b;
      b = z + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

// Inverse standard normal CDF (Acklam's rational approximation plus one
// Halley step), accurate to about 1e-15. Same as NORMSINV in a spreadsheet.
export function normInv(p) {
  if (Number.isNaN(p) || p < 0 || p > 1) return NaN;
  if (p === 0) return -Infinity;
  if (p === 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// Applies a number-valued function to every row of a text value.
function textToNumber(v, n, f) {
  if (typeof v === 'string') return f(v);
  if (isCat(v)) {
    const r = v.dict.map(f);
    return Float64Array.from(v.codes, (c) => (c < 0 ? NaN : r[c]));
  }
  const get = strAt(v);
  return Float64Array.from({ length: n }, (_, i) => {
    const s = get(i);
    return s == null ? NaN : f(s);
  });
}

function regex(v, flags) {
  const src = textArg(v, 'pattern');
  try {
    return new RegExp(src, flags);
  } catch {
    throw new Error(`"${src}" is not a valid pattern`);
  }
}

// Dates are numbers already; text is parsed (2024-03-01, 2024-03-01 08:30…).
function asDate(v, n) {
  if (typeof v === 'string') return parseDate(v);
  if (isCat(v)) return textToNumber(v, n, parseDate);
  return numeric(v, n);
}

function isoText(ms) {
  if (!Number.isFinite(ms)) return null;
  const s = new Date(ms).toISOString();
  return s.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : s.replace('.000Z', 'Z').replace('T', ' ').replace('Z', '');
}

const MATH1 = {
  abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log10: Math.log10, log2: Math.log2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, cot: (x) => 1 / Math.tan(x),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, floor: Math.floor, ceil: Math.ceil, ceiling: Math.ceil, sign: Math.sign, trunc: Math.trunc,
  degrees: (x) => (x * 180) / Math.PI, radians: (x) => (x * Math.PI) / 180,
};

// Aggregations, by every name they answer to. All of them work per group
// with OVER.
const STATS = {
  avg: 'mean', mean: 'mean', average: 'mean', sum: 'sum', count: 'count', uniquecount: 'uniquecount', countdistinct: 'uniquecount',
  median: 'median', std: 'std', stdev: 'std', stddev: 'std', sigma: 'std', var: 'var', variance: 'var', stderr: 'stderr', cv: 'cv',
  l95: 'l95', u95: 'u95', product: 'product', geometricmean: 'geometricmean', range: 'range', meandeviation: 'meandeviation',
  medianabsolutedeviation: 'medianabsolutedeviation', mad: 'medianabsolutedeviation', percentile: 'percentile',
  p10: 'p10', p90: 'p90', q1: 'q1', q3: 'q3', iqr: 'iqr', lif: 'lif', uif: 'uif', lof: 'lof', uof: 'uof', lav: 'lav', uav: 'uav',
  first: 'first', last: 'last', mode: 'mode',
};

// Shown as chips in the calculated column dialog, by category.
export const FUNCTION_GROUPS = {
  Statistics: [
    'avg(col)', 'sum(col)', 'count(col)', 'uniquecount(col)', 'min(col)', 'max(col)', 'median(col)', 'sigma(col)', 'var(col)', 'stderr(col)',
    'zscore(col)', 'ucl(col, k)', 'lcl(col, k)', 'percentile(col, p)', 'p10(col)', 'p90(col)', 'q1(col)', 'q3(col)', 'iqr(col)',
    'lif(col)', 'uif(col)', 'lav(col)', 'uav(col)', 'lof(col)', 'uof(col)', 'l95(col)', 'u95(col)', 'cv(col)', 'range(col)', 'product(col)',
    'geometricmean(col)', 'meandeviation(col)', 'mad(col)', 'mode(col)', 'first(col)', 'last(col)',
  ],
  'Grouping (OVER)': ['avg([x]) OVER [Lot]', 'OVER ([Lot], [Wafer])', 'OVER AllPrevious([Date])', 'OVER AllNext([Date])', 'OVER Previous([Date])', 'OVER Next([Date])', 'OVER Intersect([Lot], AllPrevious([Date]))'],
  Ranking: ['rank(col, "desc", groups…)', 'denserank(col, "desc")', 'rankreal(col)', 'cumsum(col)', 'diff(col)', 'lag(col, k)', 'movavg(col, k)', 'rownum()'],
  Distribution: ['normsinv(p)', 'norminv(p, mean, sd)', 'normsdist(z)', 'normdist(x, mean, sd)'],
  Math: [
    ...Object.keys(MATH1), 'log(x, base)', 'round(x, digits)', 'power(x, y)', 'mod(x, y)', 'divint(x, y)', 'atan2(y, x)', 'hypot(x, y)',
    'min(a, b, …)', 'max(a, b, …)', 'pi()', 'rand()', 'randbetween(lo, hi)',
  ],
  Text: [
    'split(text, separator, index)', 'concatenate(a, b, …)', 'a & b', 'left(text, n)', 'right(text, n)', 'mid(text, start, n)', 'len(text)',
    'find(part, text)', 'substitute(text, old, new)', 'replace(text, start, n, new)', 'rxreplace(text, pattern, new)', 'rxextract(text, pattern, group)',
    'upper(text)', 'lower(text)', 'trim(text)', 'repeat(text, n)', 'contains(text, part)', 'startswith(text, part)', 'endswith(text, part)',
  ],
  Logic: ['if(cond, a, b)', 'case when … then … else … end', '[x] in ("a", "b")', '[x] is null', 'isnull(x)', 'sn(x, value)', 'ifnull(x, value)'],
  'Date and time': [
    'year(date)', 'quarter(date)', 'month(date)', 'week(date)', 'day(date)', 'dayofweek(date)', 'dayofyear(date)', 'hour(date)', 'minute(date)', 'second(date)',
    'datepart("month", date)', 'dateadd("day", n, date)', 'datediff("day", from, to)', 'date(text)', 'date(y, m, d)', 'datetime(y, m, d, h, mi, s)', 'today()', 'datetimenow()',
  ],
  Conversion: ['integer(x)', 'real(x)', 'string(x)'],
};
export const FUNCTIONS = Object.values(FUNCTION_GROUPS).flat();

// A text argument that must be the same for every row (a separator, pattern…).
function textArg(v, what) {
  if (v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  throw new Error(`The ${what} has to be fixed text in quotes, not a column`);
}

// Spotfire style rank arguments: rank([x], "desc", "ties.method=average", [Group], …)
function rankArgs(fn, a) {
  let desc = false;
  let method = fn === 'denserank' ? 'dense' : fn === 'rankreal' ? 'average' : 'minimum';
  const groups = [];
  for (const v of a.slice(1)) {
    if (typeof v === 'string' && /^(asc|desc)$/i.test(v.trim())) desc = /desc/i.test(v);
    else if (typeof v === 'string' && /^ties\.method\s*=/i.test(v)) method = v.split('=')[1].trim().toLowerCase() === 'average' ? 'average' : method;
    else groups.push(v);
  }
  return { desc, method, groups };
}

function call(fn, args, n, ctx, over) {
  const a = args;
  if (MATH1[fn] && a.length === 1) return map1(a[0], n, MATH1[fn]);
  if (STATS[fn] && !((fn === 'min' || fn === 'max') && a.length > 1)) {
    const kind = STATS[fn];
    return stat(a[0], kind, over, n, kind === 'percentile' ? numeric(a[1] ?? 50, 0) : undefined);
  }
  switch (fn) {
    case 'round': {
      const d = a.length > 1 ? numeric(a[1], n) : 0;
      return map2(a[0], d, n, (x, k) => {
        const m = 10 ** k;
        return Math.round(x * m) / m;
      });
    }
    case 'log': return a.length > 1 ? map2(a[0], a[1], n, (x, b) => Math.log(x) / Math.log(b)) : map1(a[0], n, Math.log);
    case 'pow':
    case 'power': return map2(a[0], a[1], n, (x, y) => x ** y);
    case 'mod': return map2(a[0], a[1], n, (x, y) => ((x % y) + y) % y);
    case 'divint': return map2(a[0], a[1], n, (x, y) => Math.trunc(x / y));
    case 'atan2': return map2(a[0], a[1], n, Math.atan2);
    case 'hypot': return map2(a[0], a[1], n, Math.hypot);
    case 'pi': return Math.PI;
    case 'rand': return Float64Array.from({ length: n }, () => Math.random());
    case 'randbetween': {
      const lo = Math.ceil(numeric(a[0], 0));
      const hi = Math.floor(numeric(a[1], 0));
      return Float64Array.from({ length: n }, () => lo + Math.floor(Math.random() * (hi - lo + 1)));
    }
    case 'min':
    case 'max': {
      if (a.length === 1) return stat(a[0], fn, over, n);
      const f = fn === 'min' ? (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y)) : (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.max(x, y));
      return a.slice(1).reduce((acc, v) => map2(acc, v, n, f), a[0]);
    }
    case 'zscore':
    case 'ucl':
    case 'lcl': {
      // zscore: how many sigmas each row is from the mean. ucl/lcl: the
      // mean plus or minus k sigma (k defaults to 3).
      const mean = stat(a[0], 'mean', over, n);
      const sd = stat(a[0], 'std', over, n);
      if (fn === 'zscore') return map2(map2(a[0], mean, n, (x, m) => x - m), sd, n, (d, s) => d / s);
      const k = a.length > 1 ? numeric(a[1], n) : 3;
      const ks = map2(sd, k, n, (s, kk) => s * kk);
      return map2(mean, ks, n, fn === 'ucl' ? (m, d) => m + d : (m, d) => m - d);
    }
    case 'rank':
    case 'denserank':
    case 'rankreal': {
      const r = rankArgs(fn, a);
      return rank(a[0], r.desc, r.method, [...r.groups, ...(over?.groups || [])], n);
    }
    case 'normsinv':
    case 'norminv':
    case 'qnorm': {
      // Probability to sigma: normsinv(0.99865) is about 3.
      const z = map1(a[0], n, normInv);
      if (a.length < 2) return z;
      return map2(map2(z, a[2] ?? 1, n, (x, sd) => x * sd), a[1], n, (x, m) => x + m);
    }
    case 'normsdist':
    case 'normdist':
    case 'pnorm': {
      const z = a.length < 2 ? numeric(a[0], n) : map2(map2(a[0], a[1], n, (x, m) => x - m), a[2] ?? 1, n, (x, sd) => x / sd);
      return map1(z, n, normCdf);
    }
    case 'string':
    case 'text': {
      const v = a[0];
      if (isCat(v) || typeof v === 'string') return v;
      if (isDateValue(v)) return textMap(v, n, (x) => isoText(Number(x)));
      return textMap(v, n, (x) => x);
    }
    case 'find': {
      // Position (from 1) of part inside text, 0 when it isn't there. Case-sensitive.
      const part = textArg(a[0], 'text to find');
      const from = Math.max(1, Math.trunc(numeric(a[2] ?? 1, 0)));
      return textToNumber(a[1], n, (s) => s.indexOf(part, from - 1) + 1);
    }
    case 'substitute': {
      const old = textArg(a[1], 'text to replace');
      const by = textArg(a[2], 'replacement');
      return textMap(a[0], n, (s) => (old ? s.split(old).join(by) : s));
    }
    case 'replace': {
      const start = Math.max(1, Math.trunc(numeric(a[1], 0)));
      const k = Math.max(0, Math.trunc(numeric(a[2], 0)));
      const by = textArg(a[3], 'replacement');
      return textMap(a[0], n, (s) => s.slice(0, start - 1) + by + s.slice(start - 1 + k));
    }
    case 'repeat': {
      const k = Math.max(0, Math.trunc(numeric(a[1], 0)));
      return textMap(a[0], n, (s) => s.repeat(k));
    }
    case 'rxreplace': {
      const re = regex(a[1], `g${textArg(a[3], 'flags').replace(/[^imsu]/g, '')}`);
      const by = textArg(a[2], 'replacement');
      return textMap(a[0], n, (s) => s.replace(re, by));
    }
    case 'rxextract': {
      const re = regex(a[1], textArg(a[3], 'flags').replace(/[^imsu]/g, ''));
      const group = Math.trunc(numeric(a[2] ?? 0, 0));
      return textMap(a[0], n, (s) => re.exec(s)?.[group] ?? null);
    }
    case 'ltrim': return textMap(a[0], n, (s) => s.trimStart());
    case 'rtrim': return textMap(a[0], n, (s) => s.trimEnd());
    case 'year':
    case 'quarter':
    case 'month':
    case 'week':
    case 'day':
    case 'dayofweek':
    case 'dayofyear':
    case 'hour':
    case 'minute':
    case 'second':
    case 'millisecond': return map1(asDate(a[0], n), n, (ms) => datePart(fn, ms));
    case 'datepart': {
      const part = datePartName(textArg(a[0], 'date part'));
      return map1(asDate(a[1], n), n, (ms) => datePart(part, ms));
    }
    case 'dateadd': {
      const part = datePartName(textArg(a[0], 'date part'));
      return dateOut(map2(a[1], asDate(a[2], n), n, (k, ms) => dateAdd(part, k, ms)), n);
    }
    case 'datediff': {
      const part = datePartName(textArg(a[0], 'date part'));
      return map2(asDate(a[1], n), asDate(a[2], n), n, (x, y) => dateDiff(part, x, y));
    }
    case 'date':
    case 'datetime': {
      if (a.length >= 3) {
        const parts = a.map((v) => numeric(v, n));
        const at = (v, i) => (typeof v === 'number' ? v : v[i]);
        const one = (i) => Date.UTC(at(parts[0], i), at(parts[1], i) - 1, at(parts[2], i), at(parts[3] ?? 0, i), at(parts[4] ?? 0, i), at(parts[5] ?? 0, i));
        const ms = parts.some(isVec) ? Float64Array.from({ length: n }, (_, i) => one(i)) : one(0);
        return dateOut(ms, n);
      }
      const ms = asDate(a[0], n);
      return dateOut(fn === 'date' ? map1(ms, n, startOfDay) : ms, n);
    }
    case 'today': return dateOut(startOfDay(Date.now()), n);
    case 'now':
    case 'datetimenow': return dateOut(Date.now(), n);
    case 'split': {
      const sep = String(a[1] ?? ',');
      const idx = Math.trunc(numeric(a[2] ?? 1, 0));
      if (Number.isNaN(idx) || idx === 0) throw new Error('split() index counts from 1 (or -1 for the last part)');
      return textMap(a[0], n, (s) => splitPart(s, sep, idx));
    }
    case 'left':
    case 'right': {
      const k = Math.max(0, Math.trunc(numeric(a[1] ?? 1, 0)));
      return textMap(a[0], n, fn === 'left' ? (s) => s.slice(0, k) : (s) => (k ? s.slice(-k) : ''));
    }
    case 'mid':
    case 'substring': {
      const start = Math.max(1, Math.trunc(numeric(a[1] ?? 1, 0)));
      const k = a.length > 2 ? Math.max(0, Math.trunc(numeric(a[2], 0))) : Infinity;
      return textMap(a[0], n, (s) => s.slice(start - 1, start - 1 + k));
    }
    case 'upper': return textMap(a[0], n, (s) => s.toUpperCase());
    case 'lower': return textMap(a[0], n, (s) => s.toLowerCase());
    case 'trim': return textMap(a[0], n, (s) => s.trim());
    case 'concat':
    case 'concatenate': {
      const parts = a.map(strAt);
      if (a.every((v) => typeof v === 'string' || typeof v === 'number')) return parts.map((f) => f(0) ?? '').join('');
      return textMap(Float64Array.from({ length: n }, (_, i) => i), n, (i) => parts.map((f) => f(Number(i)) ?? '').join(''));
    }
    case 'integer':
    case 'int': return map1(call('real', a, n, ctx), n, Math.trunc);
    case 'number':
    case 'real':
    case 'value': {
      const parse = (s) => {
        const x = Number(String(s).trim());
        return String(s).trim() && !Number.isNaN(x) ? x : NaN;
      };
      if (typeof a[0] === 'string') return parse(a[0]);
      if (isCat(a[0])) {
        const nums = a[0].dict.map(parse);
        return Float64Array.from(a[0].codes, (c) => (c < 0 ? NaN : nums[c]));
      }
      return numeric(a[0], n);
    }
    // A case arm: a missing comparison counts as false, so it falls through.
    case 'casewhen': return call('if', [map1(a[0], n, (x) => (Number.isNaN(x) ? 0 : x)), a[1], a[2]], n, ctx);
    case 'if': {
      const c = numeric(a[0], n);
      if (isTextish(a[1]) || isTextish(a[2])) {
        const fa = strAt(a[1]);
        const fb = strAt(a[2] ?? '');
        const dict = [];
        const index = new Map();
        const codes = new Int32Array(n);
        for (let i = 0; i < n; i += 1) {
          const cv = typeof c === 'number' ? c : c[i];
          const s = Number.isNaN(cv) ? null : truthy(cv) ? fa(i) : fb(i);
          if (s == null) {
            codes[i] = -1;
            continue;
          }
          let code = index.get(s);
          if (code === undefined) {
            code = dict.length;
            dict.push(s);
            index.set(s, code);
          }
          codes[i] = code;
        }
        return { codes, dict };
      }
      const x = numeric(a[1], n);
      const y = a.length > 2 ? numeric(a[2], n) : NaN;
      if (typeof c === 'number') return truthy(c) ? x : y;
      const out = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        const cv = c[i];
        out[i] = Number.isNaN(cv) ? NaN : truthy(cv) ? (typeof x === 'number' ? x : x[i]) : typeof y === 'number' ? y : y[i];
      }
      return out;
    }
    case 'isnull':
    case 'ismissing': {
      const v = a[0];
      if (isCat(v)) return Float64Array.from(v.codes, (c) => (c < 0 ? 1 : 0));
      return map1(v, n, (x) => (Number.isNaN(x) ? 1 : 0));
    }
    case 'ifnull':
    case 'sn': {
      if (isCat(a[0])) {
        const fill = String(a[1]);
        let code = a[0].dict.indexOf(fill);
        const dict = [...a[0].dict];
        if (code < 0) code = dict.push(fill) - 1;
        return { codes: a[0].codes.map((c) => (c < 0 ? code : c)), dict };
      }
      return map2(a[0], a[1], n, (x, y) => (Number.isNaN(x) ? y : x));
    }
    case 'contains':
    case 'startswith':
    case 'endswith': {
      const part = String(a[1] ?? '').toLowerCase();
      const test = { contains: (s) => s.toLowerCase().includes(part), startswith: (s) => s.toLowerCase().startsWith(part), endswith: (s) => s.toLowerCase().endsWith(part) }[fn];
      if (isCat(a[0])) {
        const hit = a[0].dict.map(test);
        return Float64Array.from(a[0].codes, (c) => (c < 0 ? NaN : hit[c] ? 1 : 0));
      }
      const f = strAt(a[0]);
      if (typeof a[0] === 'string') return test(a[0]) ? 1 : 0;
      return Float64Array.from({ length: n }, (_, i) => {
        const s = f(i);
        return s == null ? NaN : test(s) ? 1 : 0;
      });
    }
    case 'len': {
      if (typeof a[0] === 'string') return a[0].length;
      if (isCat(a[0])) {
        const l = a[0].dict.map((s) => s.length);
        return Float64Array.from(a[0].codes, (c) => (c < 0 ? NaN : l[c]));
      }
      return map1(a[0], n, (x) => String(x).length);
    }
    case 'cumsum': {
      const v = numeric(a[0], n);
      const out = new Float64Array(n);
      let s = 0;
      for (let i = 0; i < n; i += 1) {
        const x = typeof v === 'number' ? v : v[i];
        if (!Number.isNaN(x)) s += x;
        out[i] = Number.isNaN(x) ? NaN : s;
      }
      return out;
    }
    case 'diff':
    case 'lag': {
      const v = numeric(a[0], n);
      const k = fn === 'lag' && a.length > 1 ? Math.round(numeric(a[1], 0)) : 1;
      if (typeof v === 'number') return fn === 'diff' ? 0 : v;
      const out = new Float64Array(n).fill(NaN);
      for (let i = Math.max(0, k); i < n && i - k < n; i += 1) out[i] = fn === 'diff' ? v[i] - v[i - k] : v[i - k];
      return out;
    }
    case 'movavg': {
      const v = numeric(a[0], n);
      const k = Math.max(1, Math.round(numeric(a[1] ?? 5, 0)));
      if (typeof v === 'number') return v;
      const out = new Float64Array(n).fill(NaN);
      let s = 0;
      let cnt = 0;
      for (let i = 0; i < n; i += 1) {
        if (!Number.isNaN(v[i])) {
          s += v[i];
          cnt += 1;
        }
        if (i >= k && !Number.isNaN(v[i - k])) {
          s -= v[i - k];
          cnt -= 1;
        }
        if (i >= k - 1 && cnt) out[i] = s / cnt;
      }
      return out;
    }
    case 'rownum':
    case 'row': return Float64Array.from({ length: n }, (_, i) => i + 1);
    default:
      if (ctx.functions?.[fn]) return ctx.functions[fn](...a);
      throw new Error(`Unknown function ${fn}()`);
  }
}

// ctx: { n, column(name, letter) -> value | undefined, vars: { name: value } }
export function evaluate(ast, ctx) {
  const n = ctx.n;
  // OVER [a], OVER ([a], [b]), OVER Intersect([a], AllPrevious([d])), OVER All([a])
  const overSpec = (list) => {
    const spec = { groups: [], nav: null };
    const walk = (node) => {
      const fn = node.k === 'call' ? node.fn : null;
      if (fn === 'intersect') node.args.forEach(walk);
      else if (fn === 'all') return;
      else if (NAV.has(fn)) {
        if (spec.nav) throw new Error('Use only one of AllPrevious, AllNext, Previous or Next in an OVER');
        if (node.args.length !== 1) throw new Error(`${fn}() takes one column`);
        spec.nav = { kind: fn, v: ev(node.args[0]) };
      } else spec.groups.push(ev(node));
    };
    list.forEach(walk);
    return spec;
  };
  const ev = (node) => {
    switch (node.k) {
      case 'num': return node.v;
      case 'str': return node.v;
      case 'col': {
        const v = ctx.column(node.name, node.letter);
        if (v === undefined) throw new Error(`No column named "${node.name}"`);
        return v;
      }
      case 'id': {
        const low = node.name.toLowerCase();
        if (ctx.vars && node.name in ctx.vars) return ctx.vars[node.name];
        if (low === 'pi') return Math.PI;
        if (low === 'e') return Math.E;
        if (low === 'true') return 1;
        if (low === 'false') return 0;
        if (low === 'null' || low === 'nan') return NaN;
        const v = ctx.column(node.name, false);
        if (v === undefined) throw new Error(`Unknown name "${node.name}". Put column names in [brackets].`);
        return v;
      }
      case 'neg': return map1(ev(node.a), n, (x) => -x);
      case 'not': return map1(ev(node.a), n, (x) => (Number.isNaN(x) ? NaN : x ? 0 : 1));
      case 'call': return call(node.fn, node.args.map(ev), n, ctx, node.over && overSpec(node.over));
      case 'bin': {
        const l = ev(node.l);
        const r = ev(node.r);
        switch (node.op) {
          case '+': return map2(l, r, n, (x, y) => x + y);
          case '-': return map2(l, r, n, (x, y) => x - y);
          case '*': return map2(l, r, n, (x, y) => x * y);
          case '/': return map2(l, r, n, (x, y) => x / y);
          case '%': return map2(l, r, n, (x, y) => x % y);
          case '^': return map2(l, r, n, (x, y) => x ** y);
          case '&&': return map2(l, r, n, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : truthy(x) && truthy(y) ? 1 : 0));
          case '||': return map2(l, r, n, (x, y) => (truthy(x) || truthy(y) ? 1 : Number.isNaN(x) || Number.isNaN(y) ? NaN : 0));
          default: return compare(node.op, l, r, n);
        }
      }
      default: throw new Error('Bad formula');
    }
  };
  return ev(ast);
}

// Evaluates to a full column of n rows (scalars are broadcast).
export function evaluateColumn(src, ctx) {
  const v = evaluate(typeof src === 'string' ? parse(src) : src, ctx);
  if (isVec(v) || isCat(v)) return v;
  if (typeof v === 'string') return { codes: new Int32Array(ctx.n), dict: [v] };
  return new Float64Array(ctx.n).fill(Number(v));
}
