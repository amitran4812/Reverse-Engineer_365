// Building blocks for the formula language in expr.js: per-group reducers
// for statistics, ranking, and date parts. Values handed to a reducer are a
// Float64Array of the non-missing values of one group, in row order.

const sorted = (v) => Float64Array.from(v).sort();

// Linear interpolation between closest ranks (the usual spreadsheet
// PERCENTILE.INC). p is 0..1.
export function quantile(v, p, isSorted = false) {
  if (!v.length || Number.isNaN(p)) return NaN;
  const s = isSorted ? v : sorted(v);
  const h = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}

function sum(v) {
  let s = 0;
  for (let i = 0; i < v.length; i += 1) s += v[i];
  return s;
}

function mean(v) {
  return v.length ? sum(v) / v.length : NaN;
}

function variance(v) {
  if (v.length < 2) return NaN;
  const m = mean(v);
  let q = 0;
  for (let i = 0; i < v.length; i += 1) q += (v[i] - m) ** 2;
  return q / (v.length - 1);
}

function fences(v) {
  const s = sorted(v);
  const q1 = quantile(s, 0.25, true);
  const q3 = quantile(s, 0.75, true);
  return { s, q1, q3, iqr: q3 - q1 };
}

function mode(v) {
  const seen = new Map();
  let best = NaN;
  let top = 0;
  for (let i = 0; i < v.length; i += 1) {
    const c = (seen.get(v[i]) || 0) + 1;
    seen.set(v[i], c);
    if (c > top) {
      top = c;
      best = v[i];
    }
  }
  return best;
}

const Z95 = 1.959963984540054;

// kind -> (values, param) -> number. Every one of these can be used per
// group with OVER.
export const REDUCERS = {
  count: (v) => v.length,
  uniquecount: (v) => new Set(v).size,
  sum,
  mean,
  min: (v) => (v.length ? v.reduce((a, b) => (b < a ? b : a), Infinity) : NaN),
  max: (v) => (v.length ? v.reduce((a, b) => (b > a ? b : a), -Infinity) : NaN),
  range: (v) => (v.length ? REDUCERS.max(v) - REDUCERS.min(v) : NaN),
  product: (v) => (v.length ? v.reduce((a, b) => a * b, 1) : NaN),
  geometricmean: (v) => (v.length ? Math.exp(sum(v.map(Math.log)) / v.length) : NaN),
  var: variance,
  std: (v) => Math.sqrt(variance(v)),
  stderr: (v) => Math.sqrt(variance(v) / v.length),
  cv: (v) => Math.sqrt(variance(v)) / mean(v),
  l95: (v) => mean(v) - Z95 * Math.sqrt(variance(v) / v.length),
  u95: (v) => mean(v) + Z95 * Math.sqrt(variance(v) / v.length),
  meandeviation: (v) => {
    const m = mean(v);
    return v.length ? sum(v.map((x) => Math.abs(x - m))) / v.length : NaN;
  },
  median: (v) => quantile(v, 0.5),
  medianabsolutedeviation: (v) => {
    const m = quantile(v, 0.5);
    return quantile(v.map((x) => Math.abs(x - m)), 0.5);
  },
  percentile: (v, p) => quantile(v, p > 1 ? p / 100 : p),
  p10: (v) => quantile(v, 0.1),
  p90: (v) => quantile(v, 0.9),
  q1: (v) => quantile(v, 0.25),
  q3: (v) => quantile(v, 0.75),
  iqr: (v) => fences(v).iqr,
  lif: (v) => { const f = fences(v); return f.q1 - 1.5 * f.iqr; },
  uif: (v) => { const f = fences(v); return f.q3 + 1.5 * f.iqr; },
  lof: (v) => { const f = fences(v); return f.q1 - 3 * f.iqr; },
  uof: (v) => { const f = fences(v); return f.q3 + 3 * f.iqr; },
  // Adjacent values: the most extreme values still inside the inner fences.
  lav: (v) => { const f = fences(v); const lim = f.q1 - 1.5 * f.iqr; return f.s.find((x) => x >= lim) ?? NaN; },
  uav: (v) => { const f = fences(v); const lim = f.q3 + 1.5 * f.iqr; return f.s.findLast((x) => x <= lim) ?? NaN; },
  first: (v) => (v.length ? v[0] : NaN),
  last: (v) => (v.length ? v[v.length - 1] : NaN),
  mode,
};

// Reducers that can run cumulatively (OVER AllPrevious / AllNext) from a
// running count, sum, sum of squares, product, min and max.
export const RUNNING = new Set(['count', 'sum', 'mean', 'min', 'max', 'range', 'product', 'var', 'std', 'stderr', 'cv', 'l95', 'u95']);

export function newAcc() {
  return { n: 0, s: 0, q: 0, p: 1, lo: Infinity, hi: -Infinity };
}

export function addAcc(acc, x) {
  acc.n += 1;
  acc.s += x;
  acc.q += x * x;
  acc.p *= x;
  if (x < acc.lo) acc.lo = x;
  if (x > acc.hi) acc.hi = x;
}

export function readAcc(acc, kind) {
  const { n, s, q } = acc;
  const m = n ? s / n : NaN;
  const vr = n > 1 ? Math.max(0, (q - (s * s) / n) / (n - 1)) : NaN;
  switch (kind) {
    case 'count': return n;
    case 'sum': return s;
    case 'mean': return m;
    case 'min': return n ? acc.lo : NaN;
    case 'max': return n ? acc.hi : NaN;
    case 'range': return n ? acc.hi - acc.lo : NaN;
    case 'product': return n ? acc.p : NaN;
    case 'var': return vr;
    case 'std': return Math.sqrt(vr);
    case 'stderr': return Math.sqrt(vr / n);
    case 'cv': return Math.sqrt(vr) / m;
    case 'l95': return m - Z95 * Math.sqrt(vr / n);
    case 'u95': return m + Z95 * Math.sqrt(vr / n);
    default: return NaN;
  }
}

// ---------- dates (milliseconds since 1970, UTC, like the rest of Plot) ----------

const DAY = 86400000;
const UNITS = { millisecond: 1, second: 1000, minute: 60000, hour: 3600000, day: DAY, week: 7 * DAY };
const PART_ALIASES = {
  y: 'year', yy: 'year', yyyy: 'year', year: 'year', years: 'year',
  q: 'quarter', qq: 'quarter', quarter: 'quarter', quarters: 'quarter',
  m: 'month', mm: 'month', month: 'month', months: 'month',
  w: 'week', ww: 'week', wk: 'week', week: 'week', weeks: 'week',
  d: 'day', dd: 'day', day: 'day', days: 'day',
  dy: 'dayofyear', dayofyear: 'dayofyear', dw: 'dayofweek', weekday: 'dayofweek', dayofweek: 'dayofweek',
  h: 'hour', hh: 'hour', hour: 'hour', hours: 'hour',
  n: 'minute', mi: 'minute', minute: 'minute', minutes: 'minute',
  s: 'second', ss: 'second', second: 'second', seconds: 'second',
  ms: 'millisecond', millisecond: 'millisecond', milliseconds: 'millisecond',
};

export function datePartName(p) {
  const k = PART_ALIASES[String(p).trim().toLowerCase()];
  if (!k) throw new Error(`Unknown date part "${p}". Use year, quarter, month, week, day, hour, minute or second.`);
  return k;
}

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}

export function datePart(part, ms) {
  if (!Number.isFinite(ms)) return NaN;
  const d = new Date(ms);
  switch (part) {
    case 'year': return d.getUTCFullYear();
    case 'quarter': return Math.floor(d.getUTCMonth() / 3) + 1;
    case 'month': return d.getUTCMonth() + 1;
    case 'week': return isoWeek(d);
    case 'day': return d.getUTCDate();
    case 'dayofyear': return Math.floor((ms - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
    case 'dayofweek': return d.getUTCDay();
    case 'hour': return d.getUTCHours();
    case 'minute': return d.getUTCMinutes();
    case 'second': return d.getUTCSeconds();
    case 'millisecond': return d.getUTCMilliseconds();
    default: return NaN;
  }
}

export function dateAdd(part, k, ms) {
  if (!Number.isFinite(ms) || !Number.isFinite(k)) return NaN;
  if (UNITS[part]) return ms + k * UNITS[part];
  const d = new Date(ms);
  const months = part === 'year' ? 12 * k : part === 'quarter' ? 3 * k : k;
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Math.trunc(months));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

// Whole units from a to b (negative when b is earlier).
export function dateDiff(part, a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (UNITS[part]) return Math.trunc((b - a) / UNITS[part]);
  const da = new Date(a);
  const db = new Date(b);
  let months = (db.getUTCFullYear() - da.getUTCFullYear()) * 12 + db.getUTCMonth() - da.getUTCMonth();
  if (months > 0 && dateAdd('month', months, a) > b) months -= 1;
  if (months < 0 && dateAdd('month', months, a) < b) months += 1;
  return part === 'year' ? Math.trunc(months / 12) : part === 'quarter' ? Math.trunc(months / 3) : months;
}

export function parseDate(s) {
  const t = String(s).trim();
  if (!t) return NaN;
  // Date-only and zone-less times are read as UTC so they match imported dates.
  const iso = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(t) ? `${t.replace(' ', 'T')}${t.length > 10 ? 'Z' : ''}` : t;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? NaN : ms;
}

export const startOfDay = (ms) => (Number.isFinite(ms) ? Math.floor(ms / DAY) * DAY : NaN);
