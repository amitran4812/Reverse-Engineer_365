// Formula text -> syntax tree. Handles the Google Sheets and Excel grammar:
// A1 refs (relative/absolute, whole and open-ended columns and rows,
// 'Quoted sheet'!refs), array literals, operators, LAMBDA calls.

import cellref from '../../../common/cellref.js';

const { colIndex } = cellref;

export class SyntaxError extends Error {}

const ERRORS = ['#N/A', '#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#NUM!', '#NULL!', '#ERROR!', '#GETTING_DATA'];
const SHEET = /(?:'((?:[^']|'')+)'|([A-Za-z_À-￿][\w.À-￿]*))!/y;
const CELL = /\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})(?:\$?(\d+))?)?/y;
const ONE = /\$?([A-Za-z]{1,3})\$?(\d+)/y;
const COLS = /\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?:\$?(\d+))?/y;
const ROWS = /\$?(\d+):\$?(\d+)/y;
const NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const NAME = /[A-Za-z_\\À-￿][\w.À-￿]*/y;
const OPS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', ':'];

function match(re, s, i) {
  re.lastIndex = i;
  return re.exec(s);
}

// A ref must not run on into a name or a call ("LOG10(" is a function, not cell LOG10).
const boundary = (s, i) => !/[\w.(À-￿]/.test(s[i] || '');

function refAt(s, i, sheet) {
  let m = match(CELL, s, i);
  if (m && boundary(s, CELL.lastIndex)) {
    const r0 = Number(m[2]) - 1;
    const c0 = colIndex(m[1]);
    if (!m[3]) return { end: CELL.lastIndex, ref: { sheet, r0, c0, r1: r0, c1: c0 } };
    const c1 = colIndex(m[3]);
    const r1 = m[4] ? Number(m[4]) - 1 : null;
    return { end: CELL.lastIndex, ref: { sheet, r0: r1 == null ? r0 : Math.min(r0, r1), c0: Math.min(c0, c1), r1: r1 == null ? null : Math.max(r0, r1), c1: Math.max(c0, c1) } };
  }
  m = match(ONE, s, i);
  if (m && boundary(s, ONE.lastIndex)) {
    const r0 = Number(m[2]) - 1;
    const c0 = colIndex(m[1]);
    return { end: ONE.lastIndex, ref: { sheet, r0, c0, r1: r0, c1: c0 } };
  }
  m = match(COLS, s, i);
  if (m && boundary(s, COLS.lastIndex)) {
    const a = colIndex(m[1]);
    const b = colIndex(m[2]);
    return { end: COLS.lastIndex, ref: { sheet, r0: m[3] ? Number(m[3]) - 1 : 0, c0: Math.min(a, b), r1: null, c1: Math.max(a, b), open: !m[3] } };
  }
  m = match(ROWS, s, i);
  if (m && boundary(s, ROWS.lastIndex)) {
    const a = Number(m[1]) - 1;
    const b = Number(m[2]) - 1;
    return { end: ROWS.lastIndex, ref: { sheet, r0: Math.min(a, b), c0: 0, r1: Math.max(a, b), c1: null } };
  }
  return null;
}

export function tokenize(src) {
  const out = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= s.length) throw new SyntaxError('A text value is missing its closing quote.');
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          break;
        }
        text += s[j];
        j += 1;
      }
      out.push({ t: 'str', v: text });
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      const e = ERRORS.find((x) => s.slice(i, i + x.length).toUpperCase() === x);
      if (!e) throw new SyntaxError(`Unknown error value at "${s.slice(i, i + 8)}".`);
      out.push({ t: 'err', v: e });
      i += e.length;
      continue;
    }
    if ("'".includes(ch) || /[A-Za-z_À-￿$\d]/.test(ch)) {
      const sh = match(SHEET, s, i);
      if (sh) {
        const sheet = sh[1] != null ? sh[1].replace(/''/g, "'") : sh[2];
        const r = refAt(s, SHEET.lastIndex, sheet);
        if (!r) throw new SyntaxError(`"${s.slice(i, SHEET.lastIndex + 6)}" isn't a valid reference.`);
        out.push({ t: 'ref', v: r.ref });
        i = r.end;
        continue;
      }
      const r = refAt(s, i, null);
      if (r) {
        out.push({ t: 'ref', v: r.ref });
        i = r.end;
        continue;
      }
    }
    if (/[\d.]/.test(ch)) {
      const m = match(NUM, s, i);
      if (m) {
        out.push({ t: 'num', v: Number(m[0]) });
        i = NUM.lastIndex;
        continue;
      }
    }
    const nm = match(NAME, s, i);
    if (nm) {
      const name = nm[0];
      if (/^(TRUE|FALSE)$/i.test(name) && s[NAME.lastIndex] !== '(') out.push({ t: 'bool', v: name.toUpperCase() === 'TRUE' });
      else out.push({ t: 'name', v: name });
      i = NAME.lastIndex;
      continue;
    }
    const op = OPS.find((o) => s.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    if ('(),;{}'.includes(ch)) {
      out.push({ t: ch });
      i += 1;
      continue;
    }
    throw new SyntaxError(`Unexpected "${ch}" in the formula.`);
  }
  return out;
}

const CMP = new Set(['=', '<>', '<', '>', '<=', '>=']);

export function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i]?.t === 'op' && toks[i].v === v;
  const expect = (t) => {
    if (toks[i]?.t !== t) throw new SyntaxError(toks[i] ? `Expected "${t}" but found "${toks[i].v ?? toks[i].t}".` : `The formula ended early; expected "${t}".`);
    i += 1;
  };

  function binary(next, ops) {
    return () => {
      let left = next();
      while (toks[i]?.t === 'op' && ops.has(toks[i].v)) {
        const op = toks[i].v;
        i += 1;
        left = { k: 'bin', op, a: left, b: next() };
      }
      return left;
    };
  }

  function args() {
    const list = [];
    if (peek()?.t === ')') {
      i += 1;
      return list;
    }
    for (;;) {
      const t = peek();
      if (t?.t === ',' || t?.t === ';') list.push({ k: 'omit' });
      else if (t?.t === ')') list.push({ k: 'omit' });
      else list.push(expr());
      if (peek()?.t === ',' || peek()?.t === ';') {
        i += 1;
        continue;
      }
      expect(')');
      return list;
    }
  }

  function arrayLit() {
    const rows = [[]];
    if (peek()?.t === '}') {
      i += 1;
      return { k: 'array', rows: [] };
    }
    for (;;) {
      rows[rows.length - 1].push(expr());
      const t = peek();
      if (t?.t === ',' || (t?.t === 'name' && t.v === '\\')) i += 1;
      else if (t?.t === ';') {
        i += 1;
        rows.push([]);
      } else {
        expect('}');
        return { k: 'array', rows };
      }
    }
  }

  function primary() {
    const t = peek();
    if (!t) throw new SyntaxError('The formula ended early.');
    i += 1;
    let node;
    switch (t.t) {
      case 'num': node = { k: 'num', v: t.v }; break;
      case 'str': node = { k: 'str', v: t.v }; break;
      case 'bool': node = { k: 'bool', v: t.v }; break;
      case 'err': node = { k: 'err', v: t.v }; break;
      case 'ref': node = { k: 'ref', ref: t.v }; break;
      case '(': {
        node = expr();
        expect(')');
        node = { k: 'paren', x: node };
        break;
      }
      case '{': node = arrayLit(); break;
      case 'name': {
        if (peek()?.t === '(') {
          i += 1;
          node = { k: 'call', name: t.v.toUpperCase().replace(/^_XL(FN|WS)\./, ''), args: args() };
        } else node = { k: 'name', name: t.v };
        break;
      }
      default:
        throw new SyntaxError(`Unexpected "${t.v ?? t.t}" in the formula.`);
    }
    while (peek()?.t === '(') {
      i += 1;
      node = { k: 'apply', fn: node, args: args() };
    }
    return node;
  }

  function range() {
    let left = primary();
    while (isOp(':')) {
      i += 1;
      left = { k: 'range', a: left, b: primary() };
    }
    return left;
  }

  function postfix() {
    let x = range();
    while (isOp('%')) {
      i += 1;
      x = { k: 'pct', x };
    }
    return x;
  }

  function unary() {
    if (isOp('-') || isOp('+')) {
      const op = peek().v;
      i += 1;
      const x = unary();
      return op === '-' ? { k: 'neg', x } : { k: 'pos', x };
    }
    return postfix();
  }

  const power = binary(unary, new Set(['^']));
  const mult = binary(power, new Set(['*', '/']));
  const add = binary(mult, new Set(['+', '-']));
  const concat = binary(add, new Set(['&']));
  const expr = binary(concat, CMP);

  const tree = expr();
  if (i < toks.length) throw new SyntaxError(`Unexpected "${toks[i].v ?? toks[i].t}" in the formula.`);
  return tree;
}
