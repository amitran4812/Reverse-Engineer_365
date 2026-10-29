// Expressions for calculated columns, filters and custom fit equations.
// Columns are written [Column name], col(A) / col("name"), or a bare name
// without spaces. Evaluation is vectorised: a column is a whole typed array,
// so a formula over ten million rows is a handful of tight loops.
//
// Values: number (scalar), string (scalar), Float64Array (numeric column),
// { codes, dict } (text column).

const OPS = ['<=', '>=', '==', '!=', '<>', '&&', '||', '**', '<', '>', '=', '+', '-', '*', '/', '%', '^', '(', ')', ',', '?', ':', '!'];

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
    if (isOp('<=', '>=', '==', '!=', '<>', '<', '>', '=')) {
      const op = { '=': '==', '<>': '!=' }[toks[p].v] || toks[p].v;
      p += 1;
      return { k: 'bin', op, l, r: add() };
    }
    return l;
  };
  const add = () => {
    let l = mul();
    while (isOp('+', '-')) {
      const op = toks[p++].v;
      l = { k: 'bin', op, l, r: mul() };
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
        return { k: 'call', fn: t.v.toLowerCase(), args };
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
  for (const a of ast.args || []) references(a, out);
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

function columnStat(v, kind) {
  const a = numeric(v, 0);
  if (typeof a === 'number') return a;
  let n = 0;
  let sum = 0;
  let sq = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    if (Number.isNaN(x)) continue;
    n += 1;
    sum += x;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  const mean = sum / n;
  if (kind === 'std') {
    for (let i = 0; i < a.length; i += 1) if (!Number.isNaN(a[i])) sq += (a[i] - mean) ** 2;
    return n > 1 ? Math.sqrt(sq / (n - 1)) : NaN;
  }
  if (kind === 'median') {
    const s = Float64Array.from(a.filter((x) => !Number.isNaN(x))).sort();
    return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
  }
  return { sum, mean, count: n, min: n ? lo : NaN, max: n ? hi : NaN }[kind];
}

const MATH1 = {
  abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, floor: Math.floor, ceil: Math.ceil, sign: Math.sign, trunc: Math.trunc,
};

export const FUNCTIONS = [
  ...Object.keys(MATH1), 'round(x, digits)', 'pow(x, y)', 'mod(x, y)', 'atan2(y, x)', 'hypot(x, y)', 'min(...)', 'max(...)',
  'if(cond, a, b)', 'isnull(x)', 'ifnull(x, value)', 'contains(text, part)', 'startswith(text, part)', 'len(text)',
  'mean(col)', 'sum(col)', 'count(col)', 'std(col)', 'median(col)', 'cumsum(col)', 'diff(col)', 'lag(col, k)', 'movavg(col, k)', 'rownum()',
];

function call(fn, args, n, ctx) {
  const a = args;
  if (MATH1[fn] && a.length === 1) return map1(a[0], n, MATH1[fn]);
  switch (fn) {
    case 'round': {
      const d = a.length > 1 ? numeric(a[1], n) : 0;
      return map2(a[0], d, n, (x, k) => {
        const m = 10 ** k;
        return Math.round(x * m) / m;
      });
    }
    case 'pow': return map2(a[0], a[1], n, (x, y) => x ** y);
    case 'mod': return map2(a[0], a[1], n, (x, y) => ((x % y) + y) % y);
    case 'atan2': return map2(a[0], a[1], n, Math.atan2);
    case 'hypot': return map2(a[0], a[1], n, Math.hypot);
    case 'min':
    case 'max': {
      if (a.length === 1) return columnStat(a[0], fn);
      const f = fn === 'min' ? (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y)) : (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.max(x, y));
      return a.slice(1).reduce((acc, v) => map2(acc, v, n, f), a[0]);
    }
    case 'mean':
    case 'avg':
    case 'average': return columnStat(a[0], 'mean');
    case 'sum':
    case 'count':
    case 'std':
    case 'median': return isCat(a[0]) && fn === 'count' ? a[0].codes.reduce((s, c) => s + (c >= 0 ? 1 : 0), 0) : columnStat(a[0], fn);
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
    case 'ifnull': {
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
    case 'startswith': {
      const part = String(a[1] ?? '').toLowerCase();
      const test = fn === 'contains' ? (s) => s.toLowerCase().includes(part) : (s) => s.toLowerCase().startsWith(part);
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
      case 'call': return call(node.fn, node.args.map(ev), n, ctx);
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
