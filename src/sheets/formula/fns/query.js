// QUERY: Google's visualization query language over a range.
// select, where, group by, pivot, order by, limit, offset, label, format.

import cellref from '../../../../common/cellref.js';
import {
  compare, dateSerial, err, isErr, nowSerial, serialDate, toArr, toNum, toStr,
} from '../core.js';
import { F, isRef } from './util.js';

const { colName } = cellref;
const AGG = new Set(['avg', 'count', 'max', 'min', 'sum']);
const KEYWORDS = ['select', 'where', 'group', 'pivot', 'order', 'limit', 'offset', 'label', 'format', 'options'];

const qerr = (msg) => err('#VALUE!', `Unable to parse query string for Function QUERY parameter 2: ${msg}`);

function lex(q) {
  const out = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const j = q.indexOf(ch, i + 1);
      if (j < 0) throw qerr('a quoted value is not closed.');
      out.push({ t: 'str', v: q.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      const j = q.indexOf('`', i + 1);
      out.push({ t: 'id', v: q.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(q.slice(i));
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][\w]*/.exec(q.slice(i));
    if (word) {
      out.push({ t: 'word', v: word[0], low: word[0].toLowerCase() });
      i += word[0].length;
      continue;
    }
    const op = ['<=', '>=', '!=', '<>', '=', '<', '>', '+', '-', '*', '/', '(', ')', ','].find((o) => q.startsWith(o, i));
    if (!op) throw qerr(`unexpected "${ch}".`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

function parseQuery(q) {
  const toks = lex(q);
  let i = 0;
  const peek = () => toks[i];
  const isWord = (w, k = 0) => toks[i + k]?.t === 'word' && toks[i + k].low === w;
  const isOp = (o) => toks[i]?.t === 'op' && toks[i].v === o;
  const expectOp = (o) => {
    if (!isOp(o)) throw qerr(`expected "${o}".`);
    i += 1;
  };
  const atClause = () => peek()?.t === 'word' && KEYWORDS.includes(peek().low) && (peek().low !== 'group' || isWord('by', 1)) && (peek().low !== 'order' || isWord('by', 1));

  function primary() {
    const t = peek();
    if (!t) throw qerr('the query ended early.');
    if (isOp('(')) {
      i += 1;
      const e = expr();
      expectOp(')');
      return e;
    }
    if (isOp('-')) {
      i += 1;
      return { k: 'neg', x: primary() };
    }
    i += 1;
    if (t.t === 'num') return { k: 'lit', v: t.v };
    if (t.t === 'str') return { k: 'lit', v: t.v };
    if (t.t === 'id') return { k: 'col', id: t.v };
    const w = t.low;
    if (w === 'true' || w === 'false') return { k: 'lit', v: w === 'true' };
    if (w === 'null') return { k: 'lit', v: null };
    if ((w === 'date' || w === 'datetime' || w === 'timeofday' || w === 'timestamp') && peek()?.t === 'str') {
      const s = toks[i].v;
      i += 1;
      const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s.trim());
      const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
      if (w === 'timeofday' && tm) return { k: 'lit', v: (Number(tm[1]) * 3600 + Number(tm[2]) * 60 + Number(tm[3] || 0)) / 86400 };
      if (!m) throw qerr(`"${s}" isn't a valid ${w}.`);
      return { k: 'lit', v: dateSerial(Number(m[1]), Number(m[2]), Number(m[3])) + (m[4] ? (Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] || 0)) / 86400 : 0) };
    }
    if (isOp('(')) {
      i += 1;
      const args = [];
      if (!isOp(')')) {
        for (;;) {
          if (isOp('*')) {
            i += 1;
            args.push({ k: 'star' });
          } else args.push(expr());
          if (isOp(',')) {
            i += 1;
            continue;
          }
          break;
        }
      }
      expectOp(')');
      return AGG.has(w) ? { k: 'agg', fn: w, x: args[0] } : { k: 'fn', fn: w, args };
    }
    return { k: 'col', id: t.v };
  }

  function mul() {
    let a = primary();
    while (isOp('*') || isOp('/')) {
      const op = peek().v;
      i += 1;
      a = { k: 'bin', op, a, b: primary() };
    }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      const op = peek().v;
      i += 1;
      a = { k: 'bin', op, a, b: mul() };
    }
    return a;
  }
  function comparison() {
    const a = add();
    const t = peek();
    if (t?.t === 'op' && ['=', '!=', '<>', '<', '>', '<=', '>='].includes(t.v)) {
      i += 1;
      return { k: 'bin', op: t.v === '<>' ? '!=' : t.v, a, b: add() };
    }
    if (isWord('is')) {
      i += 1;
      const not = isWord('not');
      if (not) i += 1;
      if (!isWord('null')) throw qerr('expected "null" after "is".');
      i += 1;
      return { k: 'isnull', x: a, not };
    }
    let neg = false;
    if (isWord('not') && ['contains', 'like', 'matches', 'starts', 'ends'].some((w) => isWord(w, 1))) {
      neg = true;
      i += 1;
    }
    for (const w of ['contains', 'like', 'matches']) {
      if (isWord(w)) {
        i += 1;
        const e = { k: 'text', op: w, a, b: add() };
        return neg ? { k: 'not', x: e } : e;
      }
    }
    if (isWord('starts') || isWord('ends')) {
      const op = peek().low;
      i += 1;
      if (isWord('with')) i += 1;
      const e = { k: 'text', op, a, b: add() };
      return neg ? { k: 'not', x: e } : e;
    }
    return a;
  }
  function not() {
    if (isWord('not')) {
      i += 1;
      return { k: 'not', x: not() };
    }
    return comparison();
  }
  function and() {
    let a = not();
    while (isWord('and')) {
      i += 1;
      a = { k: 'and', a, b: not() };
    }
    return a;
  }
  function expr() {
    let a = and();
    while (isWord('or')) {
      i += 1;
      a = { k: 'or', a, b: and() };
    }
    return a;
  }
  const list = () => {
    const out = [expr()];
    while (isOp(',')) {
      i += 1;
      out.push(expr());
    }
    return out;
  };

  const q2 = {};
  while (i < toks.length) {
    const t = peek();
    if (t.t !== 'word') throw qerr(`unexpected "${t.v}".`);
    i += 1;
    switch (t.low) {
      case 'select':
        if (isOp('*')) {
          i += 1;
          q2.select = '*';
        } else q2.select = list();
        break;
      case 'where': q2.where = expr(); break;
      case 'group': i += 1; q2.group = list(); break;
      case 'pivot': q2.pivot = list(); break;
      case 'order': {
        i += 1;
        q2.order = [];
        do {
          if (isOp(',')) i += 1;
          const e = expr();
          let desc = false;
          if (isWord('desc')) {
            desc = true;
            i += 1;
          } else if (isWord('asc')) i += 1;
          q2.order.push({ e, desc });
        } while (isOp(','));
        break;
      }
      case 'limit': q2.limit = toks[i++].v; break;
      case 'offset': q2.offset = toks[i++].v; break;
      case 'label':
      case 'format': {
        const out = [];
        do {
          if (isOp(',')) i += 1;
          const e = expr();
          const s = toks[i++];
          if (s?.t !== 'str') throw qerr(`${t.low} needs a quoted value.`);
          out.push({ e, text: s.v });
        } while (isOp(','));
        q2[t.low] = out;
        break;
      }
      case 'options': while (i < toks.length && !atClause()) i += 1; break;
      default: throw qerr(`unknown clause "${t.v}".`);
    }
  }
  return q2;
}

const text = (v) => (v == null ? '' : toStr(v));
const like = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\*?]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`, 's');

function evalExpr(e, row, cols, groupRows) {
  switch (e.k) {
    case 'lit': return e.v;
    case 'col': {
      const i = cols(e.id);
      return row ? row[i] : null;
    }
    case 'neg': return -toNum(evalExpr(e.x, row, cols, groupRows));
    case 'bin': {
      const a = evalExpr(e.a, row, cols, groupRows);
      const b = evalExpr(e.b, row, cols, groupRows);
      if ('+-*/'.includes(e.op)) {
        if (a == null || b == null) return null;
        const x = toNum(a);
        const y = toNum(b);
        return e.op === '+' ? x + y : e.op === '-' ? x - y : e.op === '*' ? x * y : y === 0 ? null : x / y;
      }
      if (a == null || b == null) return e.op === '!=' ? a !== b : e.op === '=' ? a === b : false;
      const c = typeof a === typeof b ? compare(a, b) : compare(text(a), text(b));
      return { '=': c === 0, '!=': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[e.op];
    }
    case 'isnull': {
      const v = evalExpr(e.x, row, cols, groupRows);
      return e.not ? !(v == null || v === '') : v == null || v === '';
    }
    case 'text': {
      const a = text(evalExpr(e.a, row, cols, groupRows));
      const b = text(evalExpr(e.b, row, cols, groupRows));
      if (e.op === 'contains') return a.includes(b);
      if (e.op === 'starts') return a.startsWith(b);
      if (e.op === 'ends') return a.endsWith(b);
      if (e.op === 'like') return like(b).test(a);
      try {
        return new RegExp(`^(?:${b})$`, 's').test(a);
      } catch {
        throw qerr(`"${b}" isn't a valid regular expression.`);
      }
    }
    case 'not': return !evalExpr(e.x, row, cols, groupRows);
    case 'and': return Boolean(evalExpr(e.a, row, cols, groupRows)) && Boolean(evalExpr(e.b, row, cols, groupRows));
    case 'or': return Boolean(evalExpr(e.a, row, cols, groupRows)) || Boolean(evalExpr(e.b, row, cols, groupRows));
    case 'agg': {
      if (!groupRows) throw qerr(`${e.fn} needs grouped rows.`);
      const vals = e.x.k === 'star' ? groupRows.map(() => 1) : groupRows.map((r) => evalExpr(e.x, r, cols)).filter((v) => v != null && v !== '');
      if (e.fn === 'count') return vals.length;
      if (!vals.length) return null;
      if (e.fn === 'max') return vals.reduce((a, b) => (compare(a, b) >= 0 ? a : b));
      if (e.fn === 'min') return vals.reduce((a, b) => (compare(a, b) <= 0 ? a : b));
      const ns = vals.filter((v) => typeof v === 'number');
      const s = ns.reduce((a, b) => a + b, 0);
      return e.fn === 'sum' ? s : ns.length ? s / ns.length : null;
    }
    case 'fn': {
      const a = e.args.map((x) => evalExpr(x, row, cols, groupRows));
      const d = () => (a[0] == null ? null : serialDate(toNum(a[0])));
      switch (e.fn) {
        case 'year': return d()?.getUTCFullYear() ?? null;
        case 'month': return d()?.getUTCMonth() ?? null;
        case 'day': return d()?.getUTCDate() ?? null;
        case 'hour': return d()?.getUTCHours() ?? null;
        case 'minute': return d()?.getUTCMinutes() ?? null;
        case 'second': return d()?.getUTCSeconds() ?? null;
        case 'millisecond': return d()?.getUTCMilliseconds() ?? null;
        case 'quarter': return d() ? Math.floor(d().getUTCMonth() / 3) + 1 : null;
        case 'dayofweek': return d() ? d().getUTCDay() + 1 : null;
        case 'now': return nowSerial();
        case 'todate': return a[0] == null ? null : Math.floor(toNum(a[0]));
        case 'datediff': return a[0] == null || a[1] == null ? null : Math.floor(toNum(a[0])) - Math.floor(toNum(a[1]));
        case 'upper': return text(a[0]).toUpperCase();
        case 'lower': return text(a[0]).toLowerCase();
        default: throw qerr(`unknown function "${e.fn}".`);
      }
    }
    default: throw qerr('unsupported expression.');
  }
}

const hasAgg = (e) => !!e && (e.k === 'agg' || ['a', 'b', 'x'].some((k) => e[k] && hasAgg(e[k])) || (e.args || []).some(hasAgg));
const sig = (e) => JSON.stringify(e);

function guessHeaders(a) {
  if (a.length < 2) return 0;
  const head = a[0];
  if (!head.every((v) => typeof v === 'string' && v !== '')) return 0;
  return head.some((_, c) => a.slice(1).some((r) => r[c] != null && typeof r[c] !== 'string')) ? 1 : 0;
}

function query(ev, ctx, dataArg, qArg, headersArg) {
  const a = toArr(ev.deref(dataArg));
  const q = toStr(ev.deref(qArg));
  let h = headersArg === undefined ? -1 : Math.trunc(toNum(ev.deref(headersArg)));
  if (h < 0) h = guessHeaders(a);
  const width = a[0]?.length ?? 0;
  const startCol = isRef(dataArg) ? dataArg.c0 : null;
  const names = new Map();
  for (let c = 0; c < width; c += 1) {
    names.set(`col${c + 1}`, c);
    if (startCol != null) names.set(colName(startCol + c).toLowerCase(), c);
  }
  const cols = (id) => {
    const i = names.get(String(id).toLowerCase());
    if (i === undefined) throw qerr(`NO_COLUMN: ${id}`);
    return i;
  };
  const headLabel = (c) => a.slice(0, h).map((r) => text(r[c])).filter(Boolean).join(' ');
  let rows = a.slice(h).map((r) => r.map((v) => (isErr(v) ? null : v)));
  const p = q.trim() ? parseQuery(q) : {};
  if (p.where) rows = rows.filter((r) => evalExpr(p.where, r, cols));

  const select = p.select && p.select !== '*' ? p.select : Array.from({ length: width }, (_, c) => ({ k: 'col', id: `Col${c + 1}` }));
  const labelFor = (e) => {
    const l = p.label?.find((x) => sig(x.e) === sig(e));
    if (l) return l.text;
    if (e.k === 'col') return headLabel(cols(e.id));
    if (e.k === 'agg') return `${e.fn} ${e.x.k === 'col' ? (headLabel(cols(e.x.id)) || e.x.id) : ''}`.trim();
    return '';
  };

  const grouped = p.group || p.pivot || select.some(hasAgg);
  let out;
  let header;
  if (!grouped) {
    out = rows.map((r) => ({ cells: select.map((e) => evalExpr(e, r, cols)), row: r }));
    header = select.map(labelFor);
  } else {
    const groups = new Map();
    const keyExprs = p.group || [];
    for (const r of rows) {
      const k = JSON.stringify(keyExprs.map((e) => evalExpr(e, r, cols)));
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    if (!keyExprs.length && !groups.size) groups.set('[]', []);
    if (p.pivot) {
      const pivotVals = [...new Set(rows.map((r) => JSON.stringify(p.pivot.map((e) => evalExpr(e, r, cols)))))].sort((x, y) => compare(JSON.parse(x)[0], JSON.parse(y)[0]));
      const aggs = select.filter(hasAgg);
      const plain = select.filter((e) => !hasAgg(e));
      header = [...plain.map(labelFor), ...pivotVals.flatMap((pv) => aggs.map((e) => [JSON.parse(pv).map(text).join(', '), aggs.length > 1 ? labelFor(e) : ''].filter(Boolean).join(' ')))];
      out = [...groups.values()].map((g) => ({
        cells: [...plain.map((e) => evalExpr(e, g[0], cols)), ...pivotVals.flatMap((pv) => {
          const sub = g.filter((r) => JSON.stringify(p.pivot.map((e) => evalExpr(e, r, cols))) === pv);
          return aggs.map((e) => (sub.length ? evalExpr(e, sub[0], cols, sub) : null));
        })],
        row: g[0],
        group: g,
      }));
    } else {
      header = select.map(labelFor);
      out = [...groups.values()].map((g) => ({ cells: select.map((e) => evalExpr(e, g[0], cols, g)), row: g[0], group: g }));
    }
    if (!p.order && keyExprs.length) out.sort((x, y) => {
      for (const e of keyExprs) {
        const c = compare(evalExpr(e, x.row, cols), evalExpr(e, y.row, cols));
        if (c) return c;
      }
      return 0;
    });
  }
  if (p.order) {
    out.sort((x, y) => {
      for (const { e, desc } of p.order) {
        const idx = select.findIndex((s) => sig(s) === sig(e));
        const vx = idx >= 0 ? x.cells[idx] : evalExpr(e, x.row, cols, x.group);
        const vy = idx >= 0 ? y.cells[idx] : evalExpr(e, y.row, cols, y.group);
        const c = compare(vx, vy);
        if (c) return desc ? -c : c;
      }
      return 0;
    });
  }
  let result = out.map((o) => o.cells);
  if (p.offset) result = result.slice(p.offset);
  if (p.limit !== undefined) result = result.slice(0, p.limit);
  const showHeader = h > 0 || p.label || grouped;
  if (showHeader && header.some(Boolean)) result.unshift(header);
  if (!result.length) return [[null]];
  return result;
}

export default {
  QUERY: F(query, { min: 1, max: 3 }),
};
