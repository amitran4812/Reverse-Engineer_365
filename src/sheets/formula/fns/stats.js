// Statistics: averages, spread, ranks, percentiles, regression, tests and distributions.

import {
  E, err, flat, isArr, isErr, nums, numsA, toArr, toBool, toInt, toNum,
} from '../core.js';
import { L, libCall } from './lib.js';
import { SUBTOTALS, combin } from './math.js';
import { R, S } from './util.js';

const need = (v, n = 1, e = E.DIV0) => {
  if (v.length < n) throw err(e.error, 'Not enough numbers.');
  return v;
};
const mean = (v) => need(v).reduce((a, b) => a + b, 0) / v.length;
const sq = (v) => {
  const m = mean(v);
  return v.reduce((a, b) => a + (b - m) ** 2, 0);
};
const variance = (v, sample) => sq(need(v, sample ? 2 : 1)) / (v.length - (sample ? 1 : 0));
const sorted = (v) => [...v].sort((a, b) => a - b);
const median = (v) => {
  const s = sorted(need(v, 1, E.NUM));
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function modes(v) {
  const counts = new Map();
  for (const n of v) counts.set(n, (counts.get(n) || 0) + 1);
  const best = Math.max(...counts.values());
  if (!(best > 1)) throw err('#N/A', 'No value repeats.');
  return [...counts].filter(([, c]) => c === best).map(([n]) => n);
}

function percentileInc(v, k) {
  const s = sorted(need(v, 1, E.NUM));
  if (k < 0 || k > 1) throw E.NUM;
  const h = (s.length - 1) * k;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}
function percentileExc(v, k) {
  const s = sorted(need(v, 1, E.NUM));
  const h = (s.length + 1) * k - 1;
  if (k <= 0 || k >= 1 || h < 0 || h > s.length - 1) throw E.NUM;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}
function percentRank(v, x, digits, exc) {
  const s = sorted(need(v, 1, E.NUM));
  const d = digits === undefined ? 3 : toInt(digits);
  if (x < s[0] || x > s[s.length - 1]) throw E.NA;
  let i = 0;
  while (i < s.length - 1 && s[i + 1] <= x) i += 1;
  let pos = s.indexOf(x) >= 0 ? s.filter((y) => y < x).length : i + (x - s[i]) / (s[i + 1] - s[i]);
  pos = exc ? (pos + 1) / (s.length + 1) : pos / (s.length - 1 || 1);
  const p = 10 ** d;
  return Math.floor(Number((pos * p).toPrecision(15))) / p;
}

function rank(x, ref, order, avg) {
  const v = nums([ref]);
  const n = toNum(x);
  if (!v.includes(n)) throw err('#N/A', `${n} isn't in the range.`);
  const asc = order !== undefined && toNum(order) !== 0;
  const better = v.filter((y) => (asc ? y < n : y > n)).length;
  if (!avg) return better + 1;
  const ties = v.filter((y) => y === n).length;
  return better + (ties + 1) / 2;
}

function pairs(a, b) {
  const x = flat(a);
  const y = flat(b);
  if (x.length !== y.length) throw err('#N/A', 'The ranges have different numbers of values.');
  const px = [];
  const py = [];
  for (let i = 0; i < x.length; i += 1) {
    if (isErr(x[i])) throw x[i];
    if (isErr(y[i])) throw y[i];
    if (typeof x[i] === 'number' && typeof y[i] === 'number') {
      px.push(x[i]);
      py.push(y[i]);
    }
  }
  return [px, py];
}
const cov = (x, y, sample) => {
  need(x, sample ? 2 : 1);
  const mx = mean(x);
  const my = mean(y);
  return x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (x.length - (sample ? 1 : 0));
};
const correl = (ys, xs) => {
  const [y, x] = pairs(ys, xs);
  const d = Math.sqrt(sq(x) * sq(y));
  if (!d) throw E.DIV0;
  return cov(x, y, false) * x.length / d;
};
function line(ys, xs) {
  const [y, x] = pairs(ys, xs);
  const sx = sq(x);
  if (!sx) throw E.DIV0;
  const slope = cov(x, y, false) * x.length / sx;
  return { slope, intercept: mean(y) - slope * mean(x), x, y };
}

// Least squares with several x columns: [coefficients in reverse order..., intercept].
function regress(ys, xs, withConst, stats) {
  const y = flat(ys).map(toNum);
  let X;
  if (xs === undefined) X = y.map((_, i) => [i + 1]);
  else {
    const a = toArr(xs);
    X = a.length === y.length ? a.map((r) => r.map(toNum)) : a[0].map((_, i) => a.map((r) => toNum(r[i])));
    if (a.length !== y.length && a[0].length !== y.length) throw err('#REF!', 'known_x and known_y have different sizes.');
  }
  const k = X[0].length;
  const c = withConst === undefined || toBool(withConst);
  const A = X.map((r) => (c ? [...r, 1] : [...r]));
  const p = A[0].length;
  const AtA = Array.from({ length: p }, (_, i) => Array.from({ length: p }, (__, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
  const Aty = Array.from({ length: p }, (_, i) => A.reduce((s, r, n) => s + r[i] * y[n], 0));
  const M = AtA.map((r, i) => [...r, Aty[i]]);
  for (let col = 0; col < p; col += 1) {
    let piv = col;
    for (let r = col + 1; r < p; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw err('#NUM!', 'The regression has no unique solution.');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < p; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let j = col; j <= p; j += 1) M[r][j] -= f * M[col][j];
    }
  }
  const beta = M.map((r, i) => r[p] / r[i]);
  const coef = beta.slice(0, k);
  const b = c ? beta[k] : 0;
  const row = [...coef.reverse(), b];
  if (!stats || !toBool(stats)) return [row];
  const fit = A.map((r) => r.reduce((s, v, i) => s + v * beta[i], 0));
  const ssr = y.reduce((s, v, i) => s + (v - fit[i]) ** 2, 0);
  const my = mean(y);
  const sst = c ? y.reduce((s, v) => s + (v - my) ** 2, 0) : y.reduce((s, v) => s + v * v, 0);
  const df = y.length - p;
  const se2 = ssr / df;
  const inv = (() => {
    const n = p;
    const aug = AtA.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let col = 0; col < n; col += 1) {
      let piv = col;
      for (let r = col + 1; r < n; r += 1) if (Math.abs(aug[r][col]) > Math.abs(aug[piv][col])) piv = r;
      [aug[col], aug[piv]] = [aug[piv], aug[col]];
      const d = aug[col][col];
      for (let j = 0; j < 2 * n; j += 1) aug[col][j] /= d;
      for (let r = 0; r < n; r += 1) {
        if (r === col) continue;
        const f = aug[r][col];
        for (let j = 0; j < 2 * n; j += 1) aug[r][j] -= f * aug[col][j];
      }
    }
    return aug.map((r) => r.slice(n));
  })();
  const se = beta.map((_, i) => Math.sqrt(se2 * inv[i][i]));
  const seRow = [...se.slice(0, k).reverse(), c ? se[k] : E.NA];
  const r2 = 1 - ssr / sst;
  const pad = (a) => [...a, ...Array(row.length - a.length).fill(E.NA)];
  return [row, seRow, pad([r2, Math.sqrt(se2)]), pad([(sst - ssr) / (p - (c ? 1 : 0)) / se2, df]), pad([sst - ssr, ssr])];
}

function trend(ys, xs, newXs, c) {
  const coefRow = regress(ys, xs, c)[0];
  const b = coefRow[coefRow.length - 1];
  const m = coefRow.slice(0, -1).reverse();
  const nx = newXs === undefined ? (xs === undefined ? flat(ys).map((_, i) => [i + 1]) : toArr(xs)) : toArr(newXs);
  const rowsAreObs = m.length === 1 || nx[0].length === m.length;
  if (m.length === 1) return nx.map((r) => r.map((v) => m[0] * toNum(v) + b));
  return (rowsAreObs ? nx : nx[0].map((_, i) => nx.map((r) => r[i]))).map((r) => [r.reduce((s, v, i) => s + toNum(v) * m[i], b)]);
}

function ttest(a, b, tails, type) {
  const x = nums([a]);
  const y = nums([b]);
  const t = toInt(tails);
  const k = toInt(type);
  if (![1, 2].includes(t) || ![1, 2, 3].includes(k)) throw E.NUM;
  let stat;
  let df;
  if (k === 1) {
    if (x.length !== y.length) throw E.NA;
    const d = x.map((v, i) => v - y[i]);
    stat = mean(d) / Math.sqrt(variance(d, true) / d.length);
    df = d.length - 1;
  } else if (k === 2) {
    df = x.length + y.length - 2;
    const sp = ((x.length - 1) * variance(x, true) + (y.length - 1) * variance(y, true)) / df;
    stat = (mean(x) - mean(y)) / Math.sqrt(sp * (1 / x.length + 1 / y.length));
  } else {
    const vx = variance(x, true) / x.length;
    const vy = variance(y, true) / y.length;
    stat = (mean(x) - mean(y)) / Math.sqrt(vx + vy);
    df = (vx + vy) ** 2 / (vx ** 2 / (x.length - 1) + vy ** 2 / (y.length - 1));
  }
  const p = libCall('T.DIST.RT', Math.abs(stat), df);
  return t * p;
}

function ztest(a, x, sigma) {
  const v = nums([a]);
  const s = sigma === undefined ? Math.sqrt(variance(v, true)) : toNum(sigma);
  return 1 - libCall('NORM.S.DIST', (mean(v) - toNum(x)) / (s / Math.sqrt(v.length)), true);
}

const agg = (f, a = nums) => R((...args) => f(a(args)), { min: 1 });

const PRESETS = {
  AVERAGE: (v) => mean(v),
  MAX: (v) => (v.length ? Math.max(...v) : 0),
  MIN: (v) => (v.length ? Math.min(...v) : 0),
};

function percentileFn(f, k) {
  return S((data, p) => f(nums([data]), toNum(p) * k), { arrays: [0], min: 2, max: 2 });
}
function quartileFn(f) {
  return S((data, q) => {
    const k = toInt(q);
    if (k < 0 || k > 4) throw E.NUM;
    return f(nums([data]), k / 4);
  }, { arrays: [0], min: 2, max: 2 });
}

const STATS = {
  AVERAGE: agg(PRESETS.AVERAGE),
  AVERAGEA: R((...a) => mean(numsA(a)), { min: 1 }),
  'AVERAGE.WEIGHTED': R((...a) => {
    let s = 0;
    let w = 0;
    for (let i = 0; i + 1 < a.length; i += 2) {
      const v = flat(a[i]).map(toNum);
      const ws = flat(a[i + 1]).map(toNum);
      if (v.length !== ws.length) throw err('#VALUE!', 'Values and weights must be the same size.');
      v.forEach((x, k) => {
        s += x * ws[k];
        w += ws[k];
      });
    }
    if (!w) throw E.DIV0;
    return s / w;
  }, { min: 2 }),
  MAX: agg(PRESETS.MAX),
  MIN: agg(PRESETS.MIN),
  MAXA: R((...a) => {
    const v = numsA(a);
    return v.length ? Math.max(...v) : 0;
  }, { min: 1 }),
  MINA: R((...a) => {
    const v = numsA(a);
    return v.length ? Math.min(...v) : 0;
  }, { min: 1 }),
  MEDIAN: agg(median),
  MODE: agg((v) => modes(v)[0]),
  'MODE.SNGL': agg((v) => modes(v)[0]),
  'MODE.MULT': agg((v) => modes(v).map((x) => [x])),
  STDEV: agg((v) => Math.sqrt(variance(v, true))),
  'STDEV.S': agg((v) => Math.sqrt(variance(v, true))),
  STDEVP: agg((v) => Math.sqrt(variance(v, false))),
  'STDEV.P': agg((v) => Math.sqrt(variance(v, false))),
  STDEVA: R((...a) => Math.sqrt(variance(numsA(a), true)), { min: 1 }),
  STDEVPA: R((...a) => Math.sqrt(variance(numsA(a), false)), { min: 1 }),
  VAR: agg((v) => variance(v, true)),
  'VAR.S': agg((v) => variance(v, true)),
  VARP: agg((v) => variance(v, false)),
  'VAR.P': agg((v) => variance(v, false)),
  VARA: R((...a) => variance(numsA(a), true), { min: 1 }),
  VARPA: R((...a) => variance(numsA(a), false), { min: 1 }),
  AVEDEV: agg((v) => {
    const m = mean(v);
    return v.reduce((s, x) => s + Math.abs(x - m), 0) / v.length;
  }),
  DEVSQ: agg((v) => sq(v)),
  GEOMEAN: agg((v) => {
    if (need(v, 1, E.NUM).some((x) => x <= 0)) throw E.NUM;
    return Math.exp(v.reduce((s, x) => s + Math.log(x), 0) / v.length);
  }),
  HARMEAN: agg((v) => {
    if (need(v, 1, E.NUM).some((x) => x <= 0)) throw E.NUM;
    return v.length / v.reduce((s, x) => s + 1 / x, 0);
  }),
  KURT: agg((v) => {
    const n = need(v, 4).length;
    const m = mean(v);
    const s = Math.sqrt(variance(v, true));
    const k = v.reduce((a, x) => a + ((x - m) / s) ** 4, 0);
    return (n * (n + 1) * k) / ((n - 1) * (n - 2) * (n - 3)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  }),
  SKEW: agg((v) => {
    const n = need(v, 3).length;
    const m = mean(v);
    const s = Math.sqrt(variance(v, true));
    return (n / ((n - 1) * (n - 2))) * v.reduce((a, x) => a + ((x - m) / s) ** 3, 0);
  }),
  'SKEW.P': agg((v) => {
    const m = mean(v);
    const s = Math.sqrt(variance(v, false));
    return v.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / v.length;
  }),
  TRIMMEAN: S((data, pct) => {
    const s = sorted(nums([data]));
    const p = toNum(pct);
    if (p < 0 || p >= 1) throw E.NUM;
    const cut = Math.floor((s.length * p) / 2);
    return mean(s.slice(cut, s.length - cut));
  }, { arrays: [0], min: 2, max: 2 }),
  LARGE: S((data, k) => {
    const s = sorted(nums([data])).reverse();
    const i = Math.ceil(toNum(k));
    if (i < 1 || i > s.length) throw err('#NUM!', `LARGE position ${i} is out of range.`);
    return s[i - 1];
  }, { arrays: [0], min: 2, max: 2 }),
  SMALL: S((data, k) => {
    const s = sorted(nums([data]));
    const i = Math.ceil(toNum(k));
    if (i < 1 || i > s.length) throw err('#NUM!', `SMALL position ${i} is out of range.`);
    return s[i - 1];
  }, { arrays: [0], min: 2, max: 2 }),
  RANK: S((x, ref, o) => rank(x, ref, o, false), { arrays: [1], min: 2, max: 3 }),
  'RANK.EQ': S((x, ref, o) => rank(x, ref, o, false), { arrays: [1], min: 2, max: 3 }),
  'RANK.AVG': S((x, ref, o) => rank(x, ref, o, true), { arrays: [1], min: 2, max: 3 }),
  PERCENTILE: percentileFn(percentileInc, 1),
  'PERCENTILE.INC': percentileFn(percentileInc, 1),
  'PERCENTILE.EXC': percentileFn(percentileExc, 1),
  QUARTILE: quartileFn(percentileInc),
  'QUARTILE.INC': quartileFn(percentileInc),
  'QUARTILE.EXC': quartileFn(percentileExc),
  PERCENTRANK: S((d, x, s) => percentRank(nums([d]), toNum(x), s, false), { arrays: [0], min: 2, max: 3 }),
  'PERCENTRANK.INC': S((d, x, s) => percentRank(nums([d]), toNum(x), s, false), { arrays: [0], min: 2, max: 3 }),
  'PERCENTRANK.EXC': S((d, x, s) => percentRank(nums([d]), toNum(x), s, true), { arrays: [0], min: 2, max: 3 }),
  CORREL: R(correl, { min: 2, max: 2 }),
  PEARSON: R(correl, { min: 2, max: 2 }),
  RSQ: R((y, x) => correl(y, x) ** 2, { min: 2, max: 2 }),
  SLOPE: R((y, x) => line(y, x).slope, { min: 2, max: 2 }),
  INTERCEPT: R((y, x) => line(y, x).intercept, { min: 2, max: 2 }),
  STEYX: R((ys, xs) => {
    const { slope, intercept, x, y } = line(ys, xs);
    need(x, 3);
    return Math.sqrt(y.reduce((s, v, i) => s + (v - (intercept + slope * x[i])) ** 2, 0) / (x.length - 2));
  }, { min: 2, max: 2 }),
  COVAR: R((a, b) => cov(...pairs(a, b), false), { min: 2, max: 2 }),
  'COVARIANCE.P': R((a, b) => cov(...pairs(a, b), false), { min: 2, max: 2 }),
  'COVARIANCE.S': R((a, b) => cov(...pairs(a, b), true), { min: 2, max: 2 }),
  FORECAST: S((x, ys, xs) => {
    const { slope, intercept } = line(ys, xs);
    return intercept + slope * toNum(x);
  }, { arrays: [1, 2], min: 3, max: 3 }),
  TREND: R(trend, { min: 1, max: 4 }),
  GROWTH: R((ys, xs, nx, c) => {
    const y = flat(ys).map(toNum);
    if (y.some((v) => v <= 0)) throw E.NUM;
    return trend(y.map((v) => [Math.log(v)]), xs, nx, c).map((r) => r.map(Math.exp));
  }, { min: 1, max: 4 }),
  LINEST: R((ys, xs, c, st) => regress(ys, xs, c, st), { min: 1, max: 4 }),
  LOGEST: R((ys, xs, c, st) => {
    const y = flat(ys).map(toNum);
    if (y.some((v) => v <= 0)) throw E.NUM;
    const out = regress(y.map((v) => [Math.log(v)]), xs, c, st);
    out[0] = out[0].map(Math.exp);
    return out;
  }, { min: 1, max: 4 }),
  FREQUENCY: R((data, bins) => {
    const v = nums([data]);
    const b = nums([bins]);
    const order = b.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const counts = Array(b.length + 1).fill(0);
    for (const x of v) {
      const k = order.findIndex(([edge]) => x <= edge);
      counts[k < 0 ? b.length : order[k][1]] += 1;
    }
    return counts.map((c) => [c]);
  }, { min: 2, max: 2 }),
  STANDARDIZE: S((x, m, s) => {
    const sd = toNum(s);
    if (sd <= 0) throw E.NUM;
    return (toNum(x) - toNum(m)) / sd;
  }, { min: 3, max: 3 }),
  FISHER: S((x) => {
    const v = toNum(x);
    if (v <= -1 || v >= 1) throw E.NUM;
    return 0.5 * Math.log((1 + v) / (1 - v));
  }, { min: 1, max: 1 }),
  FISHERINV: S((y) => Math.tanh(toNum(y)), { min: 1, max: 1 }),
  PERMUT: S((n, k) => {
    const a = toInt(n);
    const b = toInt(k);
    if (a < 0 || b < 0 || b > a) throw E.NUM;
    let r = 1;
    for (let i = 0; i < b; i += 1) r *= a - i;
    return r;
  }, { min: 2, max: 2 }),
  PERMUTATIONA: S((n, k) => toInt(n) ** toInt(k), { min: 2, max: 2 }),
  PROB: S((xs, ps, lo, hi) => {
    const x = flat(xs).map(toNum);
    const p = flat(ps).map(toNum);
    if (x.length !== p.length) throw E.NA;
    const total = p.reduce((s, v) => s + v, 0);
    if (Math.abs(total - 1) > 1e-9 || p.some((v) => v < 0 || v > 1)) throw E.NUM;
    const a = toNum(lo);
    const b = hi === undefined ? a : toNum(hi);
    return x.reduce((s, v, i) => s + (v >= a && v <= b ? p[i] : 0), 0);
  }, { arrays: [0, 1], min: 3, max: 4 }),
  MARGINOFERROR: S((range, conf) => {
    const v = nums([range]);
    const c = toNum(conf);
    if (c <= 0 || c >= 1) throw E.NUM;
    return libCall('T.INV.2T', 1 - c, v.length - 1) * Math.sqrt(variance(v, true) / v.length);
  }, { arrays: [0], min: 2, max: 2 }),
  'T.TEST': R(ttest, { min: 4, max: 4 }),
  TTEST: R(ttest, { min: 4, max: 4 }),
  'Z.TEST': S(ztest, { arrays: [0], min: 2, max: 3 }),
  ZTEST: S(ztest, { arrays: [0], min: 2, max: 3 }),
  'CHISQ.TEST': L('CHISQ.TEST', { arrays: [0, 1], min: 2, max: 2 }),
  CHITEST: L('CHISQ.TEST', { arrays: [0, 1], min: 2, max: 2 }),
  'F.TEST': L('F.TEST', { arrays: [0, 1], min: 2, max: 2 }),
  FTEST: L('F.TEST', { arrays: [0, 1], min: 2, max: 2 }),
  'BINOM.DIST.RANGE': L('BINOM.DIST.RANGE', { min: 3, max: 4 }),
};

// Distributions: [name, lib name, min args, max args, argument mapper]
const DIST = [
  ['NORM.DIST', 4, 4], ['NORM.INV', 3, 3], ['NORM.S.DIST', 1, 2, (z, c) => [z, c === undefined ? true : c]], ['NORM.S.INV', 1, 1],
  ['T.DIST', 3, 3], ['T.DIST.2T', 2, 2], ['T.DIST.RT', 2, 2], ['T.INV', 2, 2], ['T.INV.2T', 2, 2],
  ['CHISQ.DIST', 3, 3], ['CHISQ.DIST.RT', 2, 2], ['CHISQ.INV', 2, 2], ['CHISQ.INV.RT', 2, 2],
  ['F.DIST', 4, 4], ['F.DIST.RT', 3, 3], ['F.INV', 3, 3], ['F.INV.RT', 3, 3],
  ['BETA.DIST', 4, 6], ['BETA.INV', 3, 5], ['BINOM.DIST', 4, 4], ['BINOM.INV', 3, 3],
  ['GAMMA.DIST', 4, 4], ['GAMMA.INV', 3, 3], ['GAMMA', 1, 1], ['GAMMALN', 1, 1], ['GAMMALN.PRECISE', 1, 1],
  ['LOGNORM.DIST', 4, 4], ['LOGNORM.INV', 3, 3], ['POISSON.DIST', 3, 3], ['WEIBULL.DIST', 4, 4],
  ['HYPGEOM.DIST', 5, 5], ['NEGBINOM.DIST', 4, 4], ['EXPON.DIST', 3, 3],
  ['CONFIDENCE.NORM', 3, 3], ['CONFIDENCE.T', 3, 3], ['PHI', 1, 1], ['GAUSS', 1, 1],
  ['NORMDIST', 4, 4, null, 'NORM.DIST'], ['NORMINV', 3, 3, null, 'NORM.INV'], ['NORMSDIST', 1, 1, (z) => [z, true], 'NORM.S.DIST'], ['NORMSINV', 1, 1, null, 'NORM.S.INV'],
  ['TDIST', 3, 3, (x, df, t) => [x, df], (x, df, t) => (toInt(t) === 1 ? 'T.DIST.RT' : 'T.DIST.2T')], ['TINV', 2, 2, null, 'T.INV.2T'],
  ['CHIDIST', 2, 2, null, 'CHISQ.DIST.RT'], ['CHIINV', 2, 2, null, 'CHISQ.INV.RT'], ['FDIST', 3, 3, null, 'F.DIST.RT'], ['FINV', 3, 3, null, 'F.INV.RT'],
  ['BETADIST', 3, 5, (x, a, b, lo, hi) => [x, a, b, true, lo, hi], 'BETA.DIST'], ['BETAINV', 3, 5, null, 'BETA.INV'],
  ['BINOMDIST', 4, 4, null, 'BINOM.DIST'], ['CRITBINOM', 3, 3, null, 'BINOM.INV'], ['EXPONDIST', 3, 3, null, 'EXPON.DIST'],
  ['GAMMADIST', 4, 4, null, 'GAMMA.DIST'], ['GAMMAINV', 3, 3, null, 'GAMMA.INV'],
  ['HYPGEOMDIST', 4, 4, (s, n, m, N) => [s, n, m, N, false], 'HYPGEOM.DIST'], ['LOGINV', 3, 3, null, 'LOGNORM.INV'],
  ['LOGNORMDIST', 3, 3, (x, m, s) => [x, m, s, true], 'LOGNORM.DIST'], ['NEGBINOMDIST', 3, 3, (f, s, p) => [f, s, p, false], 'NEGBINOM.DIST'],
  ['POISSON', 3, 3, null, 'POISSON.DIST'], ['WEIBULL', 4, 4, null, 'WEIBULL.DIST'], ['CONFIDENCE', 3, 3, null, 'CONFIDENCE.NORM'],
];

const coerce = (v) => (typeof v === 'string' ? (/^(true|false)$/i.test(v) ? v.toUpperCase() === 'TRUE' : toNum(v)) : v);

for (const [name, min, max, mapper, target] of DIST) {
  STATS[name] = S((...a) => {
    const args = (mapper ? mapper(...a) : a).map((v) => (v === undefined ? undefined : coerce(v)));
    const lib = typeof target === 'function' ? target(...a) : target || name;
    return libCall(lib, ...args);
  }, { min, max });
}

Object.assign(SUBTOTALS, {
  1: (v) => mean(nums(v)),
  2: (v) => v.flatMap(flat).filter((x) => typeof x === 'number').length,
  3: (v) => v.flatMap(flat).filter((x) => x != null && x !== '').length,
  4: (v) => PRESETS.MAX(nums(v)),
  5: (v) => PRESETS.MIN(nums(v)),
  6: (v) => nums(v).reduce((a, b) => a * b, 1),
  7: (v) => Math.sqrt(variance(nums(v), true)),
  8: (v) => Math.sqrt(variance(nums(v), false)),
  9: (v) => nums(v).reduce((a, b) => a + b, 0),
  10: (v) => variance(nums(v), true),
  11: (v) => variance(nums(v), false),
});

export { mean, variance, median, combin, isArr };
export default STATS;
