// Math, rounding, counting and conditional aggregates.

import cellref from '../../../../common/cellref.js';
import {
  E, Ref, criterion, err, fill, first, flat, isArr, isErr, nums, numsA, toArr, toBool, toInt, toNum,
} from '../core.js';
import { L } from './lib.js';
import { F, R, S, isRef } from './util.js';

const { colName } = cellref;

const n1 = (f) => S((x) => f(toNum(x)), { min: 1, max: 1 });
const domain = (ok, f) => (x) => {
  if (!ok(x)) throw err('#NUM!', 'The value is outside the function\'s domain.');
  return f(x);
};

function round(x, d, mode) {
  const p = 10 ** d;
  const v = x * p;
  const r = Number((Math.abs(v)).toPrecision(15));
  const m = mode === 'up' ? Math.ceil(r) : mode === 'down' ? Math.floor(r) : Math.round(r);
  return Math.sign(v) * m / p;
}

const factorial = (n) => {
  if (n < 0) throw E.NUM;
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
};
export const combin = (n, k) => {
  if (k < 0 || n < k) throw E.NUM;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
};
const gcd2 = (a, b) => (b ? gcd2(b, a % b) : a);

function multiple(x, sig, mode) {
  if (sig === 0) return 0;
  const q = x / sig;
  const r = Number(q.toPrecision(15));
  return (mode === 'up' ? Math.ceil(r) : Math.floor(r)) * sig;
}

// Pairs of (range, criterion) -> indexes of matching cells.
export function matching(pairs) {
  if (pairs.length % 2) throw err('#N/A', 'Ranges and criteria must come in pairs.');
  const ranges = [];
  const tests = [];
  for (let i = 0; i < pairs.length; i += 2) {
    ranges.push(flat(pairs[i]));
    tests.push(criterion(first(pairs[i + 1])));
  }
  const len = ranges[0].length;
  if (ranges.some((r) => r.length !== len)) throw err('#VALUE!', 'Array arguments have different sizes.');
  const out = [];
  for (let i = 0; i < len; i += 1) if (tests.every((t, k) => t(ranges[k][i]))) out.push(i);
  return out;
}

// sum_range/average_range take the criteria range's shape from their top-left cell.
export function sized(ev, target, like) {
  if (isRef(target) && isRef(like)) return ev.deref(new Ref(target.sheet, target.r0, target.c0, target.r0 + like.rows - 1, target.c0 + like.cols - 1));
  return ev.deref(target);
}

const condValues = (ev, range, crit, sumRange) => {
  const r = ev.deref(range);
  const c = ev.deref(crit);
  const vals = sumRange === undefined ? r : sized(ev, sumRange, range);
  return { r, c, vals: flat(vals) };
};

function condAgg(agg) {
  return F((ev, ctx, range, crit, sumRange) => {
    const { r, c, vals } = condValues(ev, range, crit, sumRange);
    const run = (cr) => {
      const t = criterion(cr);
      const picked = flat(r).map((v, i) => (t(v) ? vals[i] : undefined)).filter((v) => v !== undefined);
      return agg(picked);
    };
    return isArr(c) ? c.map((row) => row.map((cr) => {
      try {
        return run(cr);
      } catch (e) {
        if (isErr(e)) return e;
        throw e;
      }
    })) : run(c);
  }, { min: 2, max: 3 });
}

const sumOf = (vals) => vals.reduce((a, v) => (typeof v === 'number' ? a + v : isErr(v) ? (() => { throw v; })() : a), 0);
const avgOf = (vals) => {
  const v = vals.filter((x) => typeof x === 'number');
  if (!v.length) throw err('#DIV/0!', 'No values matched.');
  return v.reduce((a, b) => a + b, 0) / v.length;
};

function ifsAgg(agg) {
  return R((target, ...pairs) => {
    const vals = flat(target);
    const hits = matching(pairs).map((i) => vals[i]);
    return agg(hits);
  }, { min: 3 });
}

function sumproduct(...arrays) {
  if (!arrays.length) throw err('#N/A', 'SUMPRODUCT needs at least one array.');
  const a = arrays.map(toArr);
  const [rows, cols] = [a[0].length, a[0][0].length];
  if (a.some((x) => x.length !== rows || x[0].length !== cols)) throw err('#VALUE!', 'SUMPRODUCT has mismatched range sizes.');
  let s = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let p = 1;
      for (const x of a) {
        const v = x[r][c];
        if (isErr(v)) throw v;
        p *= typeof v === 'number' ? v : typeof v === 'boolean' && a.length === 1 ? Number(v) : 0;
      }
      s += p;
    }
  }
  return s;
}

function pairsSum(f) {
  return R((x, y) => {
    const a = flat(x);
    const b = flat(y);
    if (a.length !== b.length) throw err('#N/A', 'Arrays must be the same size.');
    let s = 0;
    for (let i = 0; i < a.length; i += 1) if (typeof a[i] === 'number' && typeof b[i] === 'number') s += f(a[i], b[i]);
    return s;
  }, { min: 2, max: 2 });
}

const uniqueCount = (vals) => new Set(vals.filter((v) => v != null && v !== '').map((v) => (typeof v === 'string' ? `s${v.toLowerCase()}` : `${typeof v}${v}`))).size;

export const SUBTOTALS = {};

function subtotal(ev, ctx, code, ...refs) {
  const k = toInt(ev.deref(code)) % 100;
  const fn = SUBTOTALS[k];
  if (!fn) throw err('#VALUE!', `SUBTOTAL code ${k} isn't valid.`);
  const vals = refs.map((r) => {
    if (!isRef(r)) return ev.deref(r);
    const out = [];
    for (let i = r.r0; i <= r.r1; i += 1) {
      const row = [];
      for (let j = r.c0; j <= r.c1; j += 1) {
        const raw = String(r.sheet.cells[`${colName(j)}${i + 1}`]?.v ?? '');
        row.push(/^=.*\b(SUBTOTAL|AGGREGATE)\(/i.test(raw) ? null : ev.value(r.sheet, i, j));
      }
      out.push(row);
    }
    return out;
  });
  return fn(vals);
}

function randArray(rows, cols, min, max, whole) {
  const r = rows === undefined ? 1 : toInt(rows);
  const c = cols === undefined ? 1 : toInt(cols);
  const lo = min === undefined ? 0 : toNum(min);
  const hi = max === undefined ? 1 : toNum(max);
  const w = whole !== undefined && toBool(whole);
  if (r < 1 || c < 1 || hi < lo) throw E.VALUE;
  return fill(r, c, 0).map((row) => row.map(() => (w ? Math.ceil(lo) + Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) : lo + Math.random() * (hi - lo))));
}

function sequence(rows, cols, start, step) {
  const r = toInt(rows);
  const c = cols === undefined ? 1 : toInt(cols);
  const s = start === undefined ? 1 : toNum(start);
  const st = step === undefined ? 1 : toNum(step);
  if (r < 1 || c < 1) throw err('#VALUE!', 'SEQUENCE needs at least one row and column.');
  if (r * c > 2_000_000) throw err('#NUM!', 'SEQUENCE is too large.');
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (__, j) => s + (i * c + j) * st));
}

function matrix(a) {
  const m = toArr(a).map((row) => row.map((v) => {
    if (typeof v !== 'number') throw err('#VALUE!', 'The matrix must hold only numbers.');
    return v;
  }));
  return m;
}

function mmult(a, b) {
  const x = matrix(a);
  const y = matrix(b);
  if (x[0].length !== y.length) throw err('#VALUE!', 'MMULT: the first matrix needs as many columns as the second has rows.');
  return x.map((row) => y[0].map((_, j) => row.reduce((s, v, k) => s + v * y[k][j], 0)));
}

function minverse(a) {
  const m = matrix(a);
  const n = m.length;
  if (m.some((r) => r.length !== n)) throw err('#VALUE!', 'MINVERSE needs a square matrix.');
  const aug = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(aug[r][c]) > Math.abs(aug[p][c])) p = r;
    if (Math.abs(aug[p][c]) < 1e-12) throw err('#NUM!', 'The matrix can\'t be inverted.');
    [aug[c], aug[p]] = [aug[p], aug[c]];
    const d = aug[c][c];
    for (let j = 0; j < 2 * n; j += 1) aug[c][j] /= d;
    for (let r = 0; r < n; r += 1) {
      if (r === c) continue;
      const f = aug[r][c];
      for (let j = 0; j < 2 * n; j += 1) aug[r][j] -= f * aug[c][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

function mdeterm(a) {
  const m = matrix(a).map((r) => [...r]);
  const n = m.length;
  if (m.some((r) => r.length !== n)) throw err('#VALUE!', 'MDETERM needs a square matrix.');
  let det = 1;
  for (let c = 0; c < n; c += 1) {
    let p = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (m[p][c] === 0) return 0;
    if (p !== c) {
      [m[c], m[p]] = [m[p], m[c]];
      det = -det;
    }
    det *= m[c][c];
    for (let r = c + 1; r < n; r += 1) {
      const f = m[r][c] / m[c][c];
      for (let j = c; j < n; j += 1) m[r][j] -= f * m[c][j];
    }
  }
  return Number(det.toPrecision(15));
}

export default {
  SUM: R((...a) => nums(a).reduce((s, v) => s + v, 0)),
  PRODUCT: R((...a) => nums(a).reduce((s, v) => s * v, 1), { min: 1 }),
  SUMSQ: R((...a) => nums(a).reduce((s, v) => s + v * v, 0), { min: 1 }),
  COUNT: R((...a) => a.reduce((n, x) => n + (isArr(x) ? flat(x).filter((v) => typeof v === 'number').length : (typeof x === 'number' || (typeof x === 'string' && x !== '' && !Number.isNaN(Number(x))) || typeof x === 'boolean') ? 1 : 0), 0)),
  COUNTA: R((...a) => a.reduce((n, x) => n + flat(x).filter((v) => v != null && x !== undefined).length, 0)),
  COUNTBLANK: R((...a) => a.reduce((n, x) => n + flat(x).filter((v) => v == null || v === '').length, 0), { min: 1 }),
  COUNTUNIQUE: R((...a) => uniqueCount(a.flatMap(flat)), { min: 1 }),
  COUNTUNIQUEIFS: R((range, ...pairs) => {
    const vals = flat(range);
    return uniqueCount(matching(pairs).map((i) => vals[i]));
  }, { min: 3 }),
  COUNTIF: F((ev, ctx, range, crit) => {
    const r = flat(ev.deref(range));
    const c = ev.deref(crit);
    const run = (x) => {
      const t = criterion(x);
      return r.filter((v) => t(v)).length;
    };
    return isArr(c) ? c.map((row) => row.map(run)) : run(c);
  }, { min: 2, max: 2 }),
  COUNTIFS: R((...pairs) => matching(pairs).length, { min: 2 }),
  SUMIF: condAgg(sumOf),
  SUMIFS: ifsAgg(sumOf),
  AVERAGEIF: condAgg(avgOf),
  AVERAGEIFS: ifsAgg(avgOf),
  MAXIFS: ifsAgg((v) => {
    const x = v.filter((y) => typeof y === 'number');
    return x.length ? Math.max(...x) : 0;
  }),
  MINIFS: ifsAgg((v) => {
    const x = v.filter((y) => typeof y === 'number');
    return x.length ? Math.min(...x) : 0;
  }),
  SUMPRODUCT: R(sumproduct, { min: 1 }),
  SUMX2MY2: pairsSum((a, b) => a * a - b * b),
  SUMX2PY2: pairsSum((a, b) => a * a + b * b),
  SUMXMY2: pairsSum((a, b) => (a - b) ** 2),
  SUBTOTAL: F(subtotal, { min: 2 }),

  ABS: n1(Math.abs),
  SIGN: n1(Math.sign),
  SQRT: n1(domain((x) => x >= 0, Math.sqrt)),
  SQRTPI: n1(domain((x) => x >= 0, (x) => Math.sqrt(x * Math.PI))),
  EXP: n1(Math.exp),
  LN: n1(domain((x) => x > 0, Math.log)),
  LOG10: n1(domain((x) => x > 0, Math.log10)),
  LOG: S((x, b) => {
    const v = toNum(x);
    const base = b === undefined ? 10 : toNum(b);
    if (v <= 0 || base <= 0 || base === 1) throw E.NUM;
    return Math.log(v) / Math.log(base);
  }, { min: 1, max: 2 }),
  POWER: S((a, b) => {
    const v = toNum(a) ** toNum(b);
    if (!Number.isFinite(v)) throw toNum(a) === 0 ? E.DIV0 : E.NUM;
    return v;
  }, { min: 2, max: 2 }),
  PI: R(() => Math.PI, { max: 0 }),
  INT: n1(Math.floor),
  TRUNC: S((x, d) => {
    const p = 10 ** (d === undefined ? 0 : toInt(d));
    return Math.trunc(Number((toNum(x) * p).toPrecision(15))) / p;
  }, { min: 1, max: 2 }),
  ROUND: S((x, d) => round(toNum(x), d === undefined ? 0 : toInt(d)), { min: 1, max: 2 }),
  ROUNDUP: S((x, d) => round(toNum(x), d === undefined ? 0 : toInt(d), 'up'), { min: 1, max: 2 }),
  ROUNDDOWN: S((x, d) => round(toNum(x), d === undefined ? 0 : toInt(d), 'down'), { min: 1, max: 2 }),
  MROUND: S((x, m) => {
    const v = toNum(x);
    const k = toNum(m);
    if (k === 0) return 0;
    if (Math.sign(v) * Math.sign(k) < 0) throw E.NUM;
    return Math.round(Number((v / k).toPrecision(15))) * k;
  }, { min: 2, max: 2 }),
  CEILING: S((x, s) => {
    const v = toNum(x);
    const sig = s === undefined ? 1 : toNum(s);
    if (v > 0 && sig < 0) throw E.NUM;
    return v < 0 && sig < 0 ? -multiple(-v, -sig, 'up') : multiple(v, Math.abs(sig) * (sig < 0 ? -1 : 1), 'up');
  }, { min: 1, max: 2 }),
  'CEILING.MATH': S((x, s, mode) => {
    const v = toNum(x);
    const sig = Math.abs(s === undefined ? 1 : toNum(s));
    if (v < 0 && mode !== undefined && toNum(mode) !== 0) return -multiple(-v, sig, 'up');
    return multiple(v, sig, 'up');
  }, { min: 1, max: 3 }),
  'CEILING.PRECISE': S((x, s) => multiple(toNum(x), Math.abs(s === undefined ? 1 : toNum(s)), 'up'), { min: 1, max: 2 }),
  'ISO.CEILING': S((x, s) => multiple(toNum(x), Math.abs(s === undefined ? 1 : toNum(s)), 'up'), { min: 1, max: 2 }),
  FLOOR: S((x, s) => {
    const v = toNum(x);
    const sig = s === undefined ? 1 : toNum(s);
    if (sig === 0) throw E.DIV0;
    if (v > 0 && sig < 0) throw E.NUM;
    return v < 0 && sig < 0 ? -multiple(-v, -sig, 'down') : multiple(v, Math.abs(sig), 'down');
  }, { min: 1, max: 2 }),
  'FLOOR.MATH': S((x, s, mode) => {
    const v = toNum(x);
    const sig = Math.abs(s === undefined ? 1 : toNum(s));
    if (v < 0 && mode !== undefined && toNum(mode) !== 0) return -multiple(-v, sig, 'down');
    return multiple(v, sig, 'down');
  }, { min: 1, max: 3 }),
  'FLOOR.PRECISE': S((x, s) => multiple(toNum(x), Math.abs(s === undefined ? 1 : toNum(s)), 'down'), { min: 1, max: 2 }),
  EVEN: n1((x) => {
    const v = Math.ceil(Math.abs(x) / 2) * 2;
    return x < 0 ? -v : v;
  }),
  ODD: n1((x) => {
    let v = Math.ceil(Math.abs(x));
    if (v % 2 === 0) v += 1;
    return x < 0 ? -v : v;
  }),
  ISEVEN: n1((x) => Math.trunc(x) % 2 === 0),
  ISODD: n1((x) => Math.abs(Math.trunc(x) % 2) === 1),
  MOD: S((a, b) => {
    const x = toNum(a);
    const y = toNum(b);
    if (y === 0) throw E.DIV0;
    const m = x - y * Math.floor(x / y);
    return Number(m.toPrecision(15));
  }, { min: 2, max: 2 }),
  QUOTIENT: S((a, b) => {
    const y = toNum(b);
    if (y === 0) throw E.DIV0;
    return Math.trunc(toNum(a) / y);
  }, { min: 2, max: 2 }),
  GCD: R((...a) => nums(a).map((v) => {
    if (v < 0) throw E.NUM;
    return Math.trunc(v);
  }).reduce(gcd2, 0), { min: 1 }),
  LCM: R((...a) => nums(a).map((v) => {
    if (v < 0) throw E.NUM;
    return Math.trunc(v);
  }).reduce((x, y) => (x === 0 || y === 0 ? 0 : (x * y) / gcd2(x, y)), 1), { min: 1 }),
  FACT: n1((x) => factorial(Math.trunc(x))),
  FACTDOUBLE: n1((x) => {
    let f = 1;
    for (let i = Math.trunc(x); i > 1; i -= 2) f *= i;
    if (x < -1) throw E.NUM;
    return f;
  }),
  COMBIN: S((n, k) => combin(toInt(n), toInt(k)), { min: 2, max: 2 }),
  COMBINA: S((n, k) => {
    const a = toInt(n);
    const b = toInt(k);
    return a === 0 && b === 0 ? 1 : combin(a + b - 1, b);
  }, { min: 2, max: 2 }),
  MULTINOMIAL: R((...a) => {
    const v = nums(a).map(Math.trunc);
    if (v.some((x) => x < 0)) throw E.NUM;
    return factorial(v.reduce((s, x) => s + x, 0)) / v.reduce((p, x) => p * factorial(x), 1);
  }, { min: 1 }),
  DEGREES: n1((x) => (x * 180) / Math.PI),
  RADIANS: n1((x) => (x * Math.PI) / 180),
  RAND: R(() => Math.random(), { max: 0 }),
  RANDBETWEEN: S((a, b) => {
    const lo = Math.ceil(toNum(a));
    const hi = Math.floor(toNum(b));
    if (hi < lo) throw E.NUM;
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }, { min: 2, max: 2 }),
  RANDARRAY: S(randArray, { max: 5 }),
  SEQUENCE: S(sequence, { min: 1, max: 4 }),
  MUNIT: S((n) => {
    const k = toInt(n);
    if (k < 1) throw E.VALUE;
    return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (__, j) => (i === j ? 1 : 0)));
  }, { min: 1, max: 1 }),
  MMULT: R(mmult, { min: 2, max: 2 }),
  MINVERSE: R(minverse, { min: 1, max: 1 }),
  MDETERM: R(mdeterm, { min: 1, max: 1 }),
  SERIESSUM: S((x, n, m, coeffs) => {
    const v = toNum(x);
    const a = toNum(n);
    const step = toNum(m);
    return nums([coeffs]).reduce((s, c, i) => s + c * v ** (a + i * step), 0);
  }, { arrays: [3], min: 4, max: 4 }),

  SIN: n1(Math.sin),
  COS: n1(Math.cos),
  TAN: n1(Math.tan),
  ASIN: n1(domain((x) => x >= -1 && x <= 1, Math.asin)),
  ACOS: n1(domain((x) => x >= -1 && x <= 1, Math.acos)),
  ATAN: n1(Math.atan),
  ATAN2: S((x, y) => {
    const a = toNum(x);
    const b = toNum(y);
    if (a === 0 && b === 0) throw E.DIV0;
    return Math.atan2(b, a);
  }, { min: 2, max: 2 }),
  SINH: n1(Math.sinh),
  COSH: n1(Math.cosh),
  TANH: n1(Math.tanh),
  ASINH: n1(Math.asinh),
  ACOSH: n1(domain((x) => x >= 1, Math.acosh)),
  ATANH: n1(domain((x) => x > -1 && x < 1, Math.atanh)),
  COT: n1(domain((x) => x !== 0, (x) => 1 / Math.tan(x))),
  COTH: n1(domain((x) => x !== 0, (x) => 1 / Math.tanh(x))),
  ACOT: n1((x) => Math.PI / 2 - Math.atan(x)),
  ACOTH: n1(domain((x) => Math.abs(x) > 1, (x) => 0.5 * Math.log((x + 1) / (x - 1)))),
  SEC: n1((x) => 1 / Math.cos(x)),
  SECH: n1((x) => 1 / Math.cosh(x)),
  CSC: n1(domain((x) => x !== 0, (x) => 1 / Math.sin(x))),
  CSCH: n1(domain((x) => x !== 0, (x) => 1 / Math.sinh(x))),

  BASE: L('BASE', { min: 2, max: 3 }),
  DECIMAL: L('DECIMAL', { min: 2, max: 2 }),
  ROMAN: L('ROMAN', { min: 1, max: 2 }),
  ARABIC: L('ARABIC', { min: 1, max: 1 }),
};

export { numsA };
