// Logical, information and operator functions.

import cellref from '../../../../common/cellref.js';
import {
  E, Lambda, Ref, attempt, broadcast, cmp, err, flat, isArr, isErr, parseDate, toBool, toNum, toStr,
} from '../core.js';
import { binaryOp } from '../evaluate.js';
import { F, R, S, X, isRef } from './util.js';

const { colName } = cellref;

const val = (ev, ctx, node) => (node.k === 'omit' ? null : ev.deref(ev.eval(node, ctx)));

function logicals(args) {
  const out = [];
  for (const a of args) {
    if (a === undefined) continue;
    if (isArr(a)) {
      for (const v of flat(a)) {
        if (isErr(v)) throw v;
        if (typeof v === 'boolean' || typeof v === 'number') out.push(Boolean(v));
      }
    } else out.push(toBool(a));
  }
  if (!out.length) throw err('#VALUE!', 'No logical values were given.');
  return out;
}

const ERROR_TYPES = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];

// IF and friends evaluate only the branch they need, unless the condition is an array.
function iff(ev, ctx, nodes) {
  const cond = val(ev, ctx, nodes[0]);
  const pick = (c, yes, no) => {
    if (isErr(c)) return c;
    const b = attempt(() => toBool(c));
    if (isErr(b)) return b;
    return b ? yes() : no();
  };
  const yesNode = () => (nodes[1] ? val(ev, ctx, nodes[1]) : true);
  const noNode = () => (nodes.length > 2 ? val(ev, ctx, nodes[2]) : false);
  if (!isArr(cond)) return pick(cond, yesNode, noNode);
  const yes = yesNode();
  const no = noNode();
  return broadcast([cond, yes, no], (c, y, n) => pick(c, () => y, () => n));
}

function onError(test) {
  return (ev, ctx, nodes) => {
    const v = val(ev, ctx, nodes[0]);
    const alt = () => (nodes.length > 1 ? val(ev, ctx, nodes[1]) : null);
    if (!isArr(v)) return test(v) ? alt() : v;
    if (!v.some((row) => row.some(test))) return v;
    const a = alt();
    return broadcast([v, a], (x, y) => (test(x) ? y : x));
  };
}

function ifs(ev, ctx, nodes) {
  if (nodes.length < 2 || nodes.length % 2) throw err('#N/A', 'IFS needs condition and value pairs.');
  for (let i = 0; i < nodes.length; i += 2) {
    const c = val(ev, ctx, nodes[i]);
    if (isArr(c)) {
      const conds = [];
      const vals = [];
      for (let j = 0; j < nodes.length; j += 2) {
        conds.push(val(ev, ctx, nodes[j]));
        vals.push(val(ev, ctx, nodes[j + 1]));
      }
      return broadcast([...conds, ...vals], (...xs) => {
        const n = conds.length;
        for (let k = 0; k < n; k += 1) {
          if (isErr(xs[k])) return xs[k];
          if (toBool(xs[k])) return xs[n + k];
        }
        return err('#N/A', 'No match.');
      });
    }
    if (isErr(c)) return c;
    if (toBool(c)) return val(ev, ctx, nodes[i + 1]);
  }
  return err('#N/A', 'IFS has no matching condition.');
}

function sw(ev, ctx, nodes) {
  const x = val(ev, ctx, nodes[0]);
  const run = (v) => {
    if (isErr(v)) return v;
    for (let i = 1; i + 1 < nodes.length; i += 2) {
      const c = val(ev, ctx, nodes[i]);
      if (cmp(v, c) === 0) return val(ev, ctx, nodes[i + 1]);
    }
    if (nodes.length % 2 === 0) return val(ev, ctx, nodes[nodes.length - 1]);
    return err('#N/A', 'SWITCH has no match.');
  };
  return isArr(x) ? broadcast([x], run) : run(x);
}

function choose(ev, ctx, nodes) {
  const i = val(ev, ctx, nodes[0]);
  const pick = (n) => {
    if (isErr(n)) return n;
    const k = Math.trunc(toNum(n));
    if (k < 1 || k >= nodes.length) throw err('#NUM!', `CHOOSE index ${k} is out of range.`);
    return val(ev, ctx, nodes[k]);
  };
  return isArr(i) ? broadcast([i], (n) => attempt(() => pick(n))) : pick(i);
}

function let_(ev, ctx, nodes) {
  if (nodes.length < 3 || nodes.length % 2 === 0) throw err('#N/A', 'LET needs name and value pairs followed by a formula.');
  const vars = new Map();
  const scope = { vars, parent: ctx.scope };
  const inner = { ...ctx, scope };
  for (let i = 0; i + 1 < nodes.length; i += 2) {
    if (nodes[i].k !== 'name') throw err('#N/A', 'LET names must be plain names.');
    vars.set(nodes[i].name.toUpperCase(), ev.eval(nodes[i + 1], inner));
  }
  return ev.eval(nodes[nodes.length - 1], inner);
}

function lambda(ev, ctx, nodes) {
  if (!nodes.length) throw err('#N/A', 'LAMBDA needs a formula.');
  const params = nodes.slice(0, -1).map((n) => {
    if (n.k !== 'name') throw err('#N/A', 'LAMBDA parameters must be plain names.');
    return n.name.toUpperCase();
  });
  return new Lambda(params, nodes[nodes.length - 1], { ctx, scope: ctx.scope });
}

const typeOf = (v) => (isArr(v) ? 64 : isErr(v) ? 16 : typeof v === 'boolean' ? 4 : typeof v === 'string' ? 2 : 1);

const op = (o) => S((a, b) => binaryOp(o, a, b), { errors: true, min: 2, max: 2 });

function cellInfo(ev, ctx, type, ref) {
  const t = toStr(ev.deref(type)).toLowerCase();
  const r = ref ?? new Ref(ctx.sheet, ctx.row, ctx.col);
  if (!isRef(r)) throw err('#N/A', 'CELL needs a cell reference.');
  const v = ev.value(r.sheet, r.r0, r.c0);
  const raw = r.sheet.cells[`${colName(r.c0)}${r.r0 + 1}`];
  switch (t) {
    case 'address': return `$${colName(r.c0)}$${r.r0 + 1}`;
    case 'col': return r.c0 + 1;
    case 'row': return r.r0 + 1;
    case 'contents': return v;
    case 'type': return v == null ? 'b' : typeof v === 'string' ? 'l' : 'v';
    case 'width': return Math.round((r.sheet.cols?.[colName(r.c0)] || 100) / 7);
    case 'prefix': return raw?.s?.align === 'right' ? '"' : raw?.s?.align === 'center' ? '^' : typeof v === 'string' ? "'" : '';
    case 'format': return raw?.s?.fmt === 'percent' ? 'P2' : raw?.s?.fmt === 'currency' ? 'C2' : raw?.s?.fmt === 'date' ? 'D1' : 'G';
    case 'filename': return '';
    default: throw err('#VALUE!', `CELL doesn't know "${t}".`);
  }
}

export default {
  IF: X(iff, { min: 2, max: 3 }),
  IFERROR: X(onError(isErr), { min: 1, max: 2 }),
  IFNA: X(onError((v) => isErr(v) && v.error === '#N/A'), { min: 2, max: 2 }),
  IFS: X(ifs),
  SWITCH: X(sw, { min: 3 }),
  CHOOSE: X(choose, { min: 2 }),
  LET: X(let_),
  LAMBDA: X(lambda),
  AND: R((...a) => logicals(a).every(Boolean), { min: 1 }),
  OR: R((...a) => logicals(a).some(Boolean), { min: 1 }),
  XOR: R((...a) => logicals(a).filter(Boolean).length % 2 === 1, { min: 1 }),
  NOT: S((v) => !toBool(v), { min: 1, max: 1 }),
  TRUE: R(() => true, { max: 0 }),
  FALSE: R(() => false, { max: 0 }),
  ARRAYFORMULA: R((v) => v, { min: 1, max: 1 }),

  ISBLANK: S((v) => v == null, { errors: true, min: 1, max: 1 }),
  ISERROR: S((v) => isErr(v), { errors: true, min: 1, max: 1 }),
  ISERR: S((v) => isErr(v) && v.error !== '#N/A', { errors: true, min: 1, max: 1 }),
  ISNA: S((v) => isErr(v) && v.error === '#N/A', { errors: true, min: 1, max: 1 }),
  ISTEXT: S((v) => typeof v === 'string', { errors: true, min: 1, max: 1 }),
  ISNONTEXT: S((v) => typeof v !== 'string', { errors: true, min: 1, max: 1 }),
  ISNUMBER: S((v) => typeof v === 'number', { errors: true, min: 1, max: 1 }),
  ISLOGICAL: S((v) => typeof v === 'boolean', { errors: true, min: 1, max: 1 }),
  ISDATE: S((v) => typeof v === 'string' && /[-/.:a-z]/i.test(v) && parseDate(v) != null, { errors: true, min: 1, max: 1 }),
  ISEMAIL: S((v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim()), { errors: true, min: 1, max: 1 }),
  ISURL: S((v) => typeof v === 'string' && /^(https?:\/\/|ftp:\/\/)?([\w-]+\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(v.trim()), { errors: true, min: 1, max: 1 }),
  ISBETWEEN: S((v, lo, hi, li, hi2) => {
    const a = cmp(v, lo);
    const b = cmp(v, hi);
    return (li === undefined || toBool(li) ? a >= 0 : a > 0) && (hi2 === undefined || toBool(hi2) ? b <= 0 : b < 0);
  }, { min: 3, max: 5 }),
  ISREF: F((ev, ctx, v) => isRef(v), { min: 1, max: 1 }),
  ISFORMULA: F((ev, ctx, r) => {
    if (!isRef(r)) throw err('#N/A', 'ISFORMULA needs a cell reference.');
    return String(r.sheet.cells[`${colName(r.c0)}${r.r0 + 1}`]?.v ?? '').startsWith('=');
  }, { min: 1, max: 1 }),
  FORMULATEXT: F((ev, ctx, r) => {
    if (!isRef(r)) throw err('#N/A', 'FORMULATEXT needs a cell reference.');
    const v = String(r.sheet.cells[`${colName(r.c0)}${r.r0 + 1}`]?.v ?? '');
    if (!v.startsWith('=')) throw err('#N/A', 'The cell has no formula.');
    return v;
  }, { min: 1, max: 1 }),
  CELL: F(cellInfo, { min: 1, max: 2 }),
  N: S((v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0), { min: 1, max: 1 }),
  NA: R(() => E.NA, { max: 0 }),
  TYPE: R((v) => typeOf(v), { min: 1, max: 1 }),
  'ERROR.TYPE': S((v) => {
    if (!isErr(v)) throw E.NA;
    const i = ERROR_TYPES.indexOf(v.error);
    return i < 0 ? 8 : i + 1;
  }, { errors: true, min: 1, max: 1 }),

  ADD: op('+'),
  MINUS: op('-'),
  MULTIPLY: op('*'),
  DIVIDE: op('/'),
  POW: op('^'),
  EQ: op('='),
  NE: op('<>'),
  GT: op('>'),
  GTE: op('>='),
  LT: op('<'),
  LTE: op('<='),
  UMINUS: S((v) => -toNum(v), { min: 1, max: 1 }),
  UPLUS: S((v) => v, { min: 1, max: 1 }),
  UNARY_PERCENT: S((v) => toNum(v) / 100, { min: 1, max: 1 }),
};
