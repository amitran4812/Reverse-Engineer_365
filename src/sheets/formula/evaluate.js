// Evaluates a workbook's formulas with Google Sheets semantics: values flow
// through operators and functions as arrays, array results spill into the
// cells below and to the right, and LET/LAMBDA bind names.

import cellref from '../../../common/cellref.js';
import { parse, SyntaxError } from './parse.js';
import {
  E, Lambda, Ref, attempt, broadcast, cmp, err, isArr, isErr, literal, toNum, toStr,
} from './core.js';
import { FUNCTIONS } from './fns/index.js';

const { colName } = cellref;

const MAX_CELLS = 2_000_000;
const key = (r, c) => `${colName(c)}${r + 1}`;

const ARITH = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => {
    if (b === 0) throw E.DIV0;
    return a / b;
  },
  '^': (a, b) => {
    if (a === 0 && b < 0) throw E.DIV0;
    const v = a ** b;
    if (Number.isNaN(v)) throw E.NUM;
    return v;
  },
};
const COMPARE = {
  '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '>=': (c) => c >= 0,
};

const finite = (n) => {
  if (!Number.isFinite(n)) throw E.NUM;
  return n === 0 ? 0 : n;
};

export function binaryOp(op, a, b) {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  return attempt(() => {
    if (op === '&') return toStr(a) + toStr(b);
    if (COMPARE[op]) return COMPARE[op](cmp(a, b));
    return finite(ARITH[op](toNum(a), toNum(b)));
  });
}

const trees = new Map();
function treeOf(src) {
  let t = trees.get(src);
  if (!t) {
    try {
      t = parse(src);
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e;
      t = { k: 'err', v: '#ERROR!', msg: e.message };
    }
    if (trees.size > 20000) trees.clear();
    trees.set(src, t);
  }
  return t;
}

export class Evaluator {
  constructor(book, env = {}) {
    this.book = book;
    this.env = env;
    this.bySheet = new Map(book.sheets.map((s) => [s.name.toLowerCase(), s]));
    this.memo = new Map(book.sheets.map((s) => [s, new Map()]));
    this.spills = new Map(book.sheets.map((s) => [s, new Map()]));
    this.formats = new Map(book.sheets.map((s) => [s, new Map()]));
    this.extent = new Map();
    this.visiting = new Set();
    this.seed = env.seed || new Map();
    this.blankReads = new Map(book.sheets.map((s) => [s, new Set()]));
  }

  sheet(name) {
    return this.bySheet.get(String(name).toLowerCase());
  }

  // Rows and columns in use, for open-ended ranges like A2:A and A:A.
  size(sheet) {
    let s = this.extent.get(sheet);
    if (!s) {
      let rows = 0;
      let cols = 0;
      for (const ref of Object.keys(sheet.cells)) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        if (!m) continue;
        rows = Math.max(rows, Number(m[2]));
        cols = Math.max(cols, cellref.colIndex(m[1]) + 1);
      }
      for (const [, r] of this.seed.get(sheet.name) || []) {
        rows = Math.max(rows, r.r1 + 1);
        cols = Math.max(cols, r.c1 + 1);
      }
      s = { rows: Math.max(rows, 1), cols: Math.max(cols, 1) };
      this.extent.set(sheet, s);
    }
    return s;
  }

  // The value shown in a cell, computing its formula (or the spill covering it) first.
  value(sheet, r, c) {
    const ref = key(r, c);
    const memo = this.memo.get(sheet);
    if (memo.has(ref)) return memo.get(ref);
    const cell = sheet.cells[ref];
    const raw = cell?.v;
    if (typeof raw === 'string' && raw.length > 1 && raw[0] === '=') return this.formula(sheet, r, c, cell);
    const spilled = this.spilledAt(sheet, r, c);
    if (spilled !== undefined) return spilled;
    let v = raw == null || raw === '' ? null : literal(raw);
    if (v == null) {
      // Blank, or filled by an array result whose formula hasn't run yet: the file's saved value stands in.
      this.blankReads.get(sheet).add(ref);
      const saved = sheet.spillCache?.[ref];
      if (saved !== undefined) v = literal(saved);
    }
    memo.set(ref, v);
    return v;
  }

  spilledAt(sheet, r, c) {
    const ref = key(r, c);
    const spills = this.spills.get(sheet);
    if (spills.has(ref)) return spills.get(ref);
    for (const [anchor, rect] of this.seed.get(sheet.name) || []) {
      if (r < rect.r0 || r > rect.r1 || c < rect.c0 || c > rect.c1 || anchor === ref) continue;
      const m = /^([A-Z]+)(\d+)$/.exec(anchor);
      this.value(sheet, Number(m[2]) - 1, cellref.colIndex(m[1]));
      if (spills.has(ref)) return spills.get(ref);
    }
    return undefined;
  }

  formula(sheet, r, c, cell) {
    const ref = key(r, c);
    const memo = this.memo.get(sheet);
    const id = `${sheet.name}!${ref}`;
    if (this.visiting.has(id)) return err('#REF!', 'Circular dependency detected.');
    this.visiting.add(id);
    let v;
    try {
      v = this.run(cell.v.slice(1), { sheet, row: r, col: c, scope: null });
    } catch (e) {
      if (e instanceof RangeError) {
        this.tooDeep = true;
        v = err('#ERROR!', 'The formula is nested too deeply.');
      }
      else throw e;
    } finally {
      this.visiting.delete(id);
    }
    if (isArr(v)) v = this.spill(sheet, r, c, v, cell);
    else if (isErr(v) && v.pending && cell.r !== undefined && cell.r !== '') v = literal(cell.r);
    if (v === undefined) v = null;
    memo.set(ref, v);
    return v;
  }

  spill(sheet, r, c, arr, cell) {
    if (!arr.length || !arr[0].length) return E.NA;
    if (arr.length === 1 && arr[0].length === 1) return this.scalarResult(arr[0][0], cell);
    const spills = this.spills.get(sheet);
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = 0; j < arr[i].length; j += 1) {
        if (!i && !j) continue;
        const ref = key(r + i, c + j);
        const other = sheet.cells[ref];
        if ((other && other.v !== '' && other.v != null) || spills.has(ref)) {
          return err('#REF!', `Array result was not expanded because it would overwrite data in ${ref}.`);
        }
      }
    }
    const fmts = arr.colFmt;
    const f = this.formats.get(sheet);
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = 0; j < arr[i].length; j += 1) {
        let v = arr[i][j] === undefined ? null : arr[i][j];
        const ref = key(r + i, c + j);
        if (isErr(v) && v.pending) {
          const saved = !i && !j ? cell.r : sheet.spillCache?.[ref];
          if (saved !== undefined && saved !== '') v = literal(saved);
        }
        if (fmts?.[j] && typeof v === 'number') f.set(ref, fmts[j]);
        if (!i && !j) continue;
        spills.set(ref, v);
        this.memo.get(sheet).set(ref, v);
      }
    }
    this.spillRects.push([sheet, key(r, c), { r0: r, c0: c, r1: r + arr.length - 1, c1: c + arr[0].length - 1 }]);
    const top = arr[0][0] ?? null;
    return this.scalarResult(top, cell);
  }

  scalarResult(v, cell) {
    if (isErr(v) && v.pending && cell.r !== undefined && cell.r !== '') return literal(cell.r);
    return v;
  }

  run(src, ctx) {
    const tree = treeOf(src);
    if (tree.k === 'err' && tree.msg) return err('#ERROR!', tree.msg);
    let v = this.deref(this.eval(tree, ctx));
    if (v instanceof Lambda) v = err('#N/A', 'A LAMBDA has to be called with values.');
    if (isArr(v) && v.length === 1 && v[0].length === 1) v = v[0][0];
    return v;
  }

  // A range's values; single cells come back as a plain value.
  deref(v) {
    if (!(v instanceof Ref)) return v;
    if (v.rows === 1 && v.cols === 1) return this.value(v.sheet, v.r0, v.c0);
    return this.grid(v);
  }

  grid(ref) {
    if (ref.rows * ref.cols > MAX_CELLS) throw err('#REF!', 'The range is too large.');
    const out = new Array(ref.rows);
    for (let r = 0; r < ref.rows; r += 1) {
      const row = new Array(ref.cols);
      for (let c = 0; c < ref.cols; c += 1) row[c] = this.value(ref.sheet, ref.r0 + r, ref.c0 + c);
      out[r] = row;
    }
    return out;
  }

  refOf(node, ctx) {
    const { ref } = node;
    const sheet = ref.sheet ? this.sheet(ref.sheet) : ctx.sheet;
    if (!sheet) throw err('#REF!', `Unresolved sheet name '${ref.sheet}'.`);
    const size = (ref.r1 == null || ref.c1 == null) ? this.size(sheet) : null;
    const r1 = ref.r1 ?? Math.max(ref.r0, size.rows - 1);
    const c1 = ref.c1 ?? Math.max(ref.c0, size.cols - 1);
    return new Ref(sheet, ref.r0, ref.c0, r1, c1);
  }

  eval(node, ctx) {
    switch (node.k) {
      case 'num':
      case 'str':
      case 'bool':
        return node.v;
      case 'err':
        return err(node.v, node.msg);
      case 'omit':
        return null;
      case 'paren':
        return this.eval(node.x, ctx);
      case 'ref':
        return attempt(() => this.refOf(node, ctx));
      case 'name':
        return this.name(node.name, ctx);
      case 'array':
        return this.arrayLit(node, ctx);
      case 'neg':
      case 'pos':
      case 'pct':
        return this.unary(node, ctx);
      case 'range':
        return this.range(node, ctx);
      case 'bin':
        return this.binary(node, ctx);
      case 'call':
        return this.call(node, ctx);
      case 'apply': {
        const fn = this.deref(this.eval(node.fn, ctx));
        if (isErr(fn)) return fn;
        if (!(fn instanceof Lambda)) return err('#ERROR!', 'Only a LAMBDA can be called with values.');
        return this.invoke(fn, node.args.map((a) => this.eval(a, ctx)));
      }
      default:
        return E.ERROR;
    }
  }

  name(name, ctx) {
    const up = name.toUpperCase();
    for (let s = ctx.scope; s; s = s.parent) if (s.vars.has(up)) return s.vars.get(up);
    const named = this.book.names?.[name] ?? this.book.names?.[up];
    if (named) return this.eval(treeOf(String(named).replace(/^=/, '')), ctx);
    return err('#NAME?', `Unknown range name: '${name}'.`);
  }

  // {a, b; c, d}: commas join side by side, semicolons stack; parts may be arrays.
  arrayLit(node, ctx) {
    const MISSING = 'In ARRAY_LITERAL, an Array Literal was missing values for one or more rows.';
    const out = [];
    for (const r of node.rows) {
      let block = null;
      for (const x of r) {
        const v = this.deref(this.eval(x, ctx));
        const part = isArr(v) ? v : [[v]];
        if (!block) block = part.map((row) => [...row]);
        else {
          if (part.length !== block.length) return err('#VALUE!', MISSING);
          part.forEach((row, i) => block[i].push(...row));
        }
      }
      if (!block) continue;
      if (out.length && block[0].length !== out[0].length) return err('#VALUE!', MISSING.replace('rows', 'columns'));
      out.push(...block);
    }
    return out;
  }

  unary(node, ctx) {
    const v = this.deref(this.eval(node.x, ctx));
    const f = (x) => {
      if (isErr(x)) return x;
      return attempt(() => {
        if (node.k === 'pos') return x;
        const n = toNum(x);
        return node.k === 'neg' ? -n : n / 100;
      });
    };
    return isArr(v) ? broadcast([v], f) : f(v);
  }

  range(node, ctx) {
    const a = this.eval(node.a, ctx);
    const b = this.eval(node.b, ctx);
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (!(a instanceof Ref) || !(b instanceof Ref) || a.sheet !== b.sheet) return err('#VALUE!', 'Both sides of ":" must be ranges on the same sheet.');
    return new Ref(a.sheet, Math.min(a.r0, b.r0), Math.min(a.c0, b.c0), Math.max(a.r1, b.r1), Math.max(a.c1, b.c1));
  }

  binary(node, ctx) {
    const a = this.deref(this.eval(node.a, ctx));
    const b = this.deref(this.eval(node.b, ctx));
    if (isArr(a) || isArr(b)) return broadcast([a, b], (x, y) => binaryOp(node.op, x, y));
    return binaryOp(node.op, a, b);
  }

  call(node, ctx) {
    const fn = FUNCTIONS[node.name];
    if (!fn) {
      const v = this.name(node.name, ctx);
      if (v instanceof Lambda) return this.invoke(v, node.args.map((a) => this.eval(a, ctx)));
      return err('#NAME?', `Unknown function: '${node.name}'.`);
    }
    return attempt(() => fn(this, ctx, node.args, node.name));
  }

  invoke(lambda, values) {
    if (values.length !== lambda.params.length) return err('#N/A', `Wrong number of arguments to LAMBDA. Expected ${lambda.params.length} arguments, but got ${values.length}.`);
    const vars = new Map(lambda.params.map((p, i) => [p, values[i]]));
    const v = this.eval(lambda.body, { ...lambda.scope.ctx, scope: { vars, parent: lambda.scope.scope } });
    return v;
  }
}

// Computes every cell of every sheet. Returns { [sheetName]: Map(ref -> value) } with
// non-enumerable `formats` (number formats results imply, like dates) and `spills` (array anchors and areas).
export function evaluateBook(book, env = {}) {
  let seed = new Map();
  let ev;
  let backwards = false;
  for (let pass = 0; pass < 5; pass += 1) {
    ev = new Evaluator(book, { ...env, seed });
    ev.spillRects = [];
    for (const sheet of book.sheets) {
      const refs = Object.keys(sheet.cells).map((ref) => [ref, /^([A-Z]+)(\d+)$/.exec(ref)]).filter(([, m]) => m);
      refs.sort((x, y) => Number(x[1][2]) - Number(y[1][2]) || x[1][1].length - y[1][1].length || (x[1][1] < y[1][1] ? -1 : 1));
      if (backwards) refs.reverse();
      for (const [, m] of refs) ev.value(sheet, Number(m[2]) - 1, cellref.colIndex(m[1]));
    }
    // Long chains that point down the sheet resolve when evaluated from the bottom up.
    if (ev.tooDeep && !backwards) {
      backwards = true;
      continue;
    }
    // A cell read as blank before a spill landed on it means the order was wrong: run again knowing the spills.
    const next = new Map();
    let stale = false;
    for (const [sheet, anchor, rect] of ev.spillRects) {
      if (!next.has(sheet.name)) next.set(sheet.name, []);
      next.get(sheet.name).push([anchor, rect]);
      const known = (seed.get(sheet.name) || []).some(([a, r]) => a === anchor && r.r1 >= rect.r1 && r.c1 >= rect.c1);
      if (known) continue;
      for (const ref of ev.blankReads.get(sheet)) {
        const m = /^([A-Z]+)(\d+)$/.exec(ref);
        const r = Number(m[2]) - 1;
        const c = cellref.colIndex(m[1]);
        if (r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1 && ref !== anchor) stale = true;
      }
    }
    if (!stale) break;
    seed = next;
  }
  const out = {};
  const formats = {};
  for (const sheet of book.sheets) {
    out[sheet.name] = ev.memo.get(sheet);
    formats[sheet.name] = ev.formats.get(sheet);
  }
  const spills = {};
  for (const [sheet, anchor, rect] of ev.spillRects) (spills[sheet.name] ||= []).push([anchor, rect]);
  Object.defineProperty(out, 'formats', { value: formats, enumerable: false });
  Object.defineProperty(out, 'spills', { value: spills, enumerable: false });
  return out;
}

export { literal };
