// Formula evaluation for the spreadsheet. Wraps fast-formula-parser and
// resolves cell references lazily with memoisation and cycle detection.

import FormulaParser from 'fast-formula-parser';
import cellref from '../../common/cellref.js';

const { FormulaError, FormulaHelpers, Types } = FormulaParser;
const { colName, parseRef } = cellref;

const num = (a) => FormulaHelpers.accept(a, Types.NUMBER);
const flat = (a) => (Array.isArray(a.value) ? a.value.flat() : [a.value]);

const str = (a) => (a?.value == null ? '' : String(Array.isArray(a.value) ? a.value[0]?.[0] ?? '' : a.value));
const numbers = (args) => args.flatMap(flat).filter((v) => typeof v === 'number');

// Excel-style criteria: ">5", "<=3", "<>x", "=x", "ab*" (wildcards).
function criterion(c) {
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(String(c ?? ''));
  const op = m[1] || '=';
  const raw = m[2];
  const n = raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : null;
  const re = /[*?]/.test(raw) ? new RegExp(`^${raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null;
  return (v) => {
    if (n != null && typeof v === 'number') {
      return { '=': v === n, '<>': v !== n, '<': v < n, '>': v > n, '<=': v <= n, '>=': v >= n }[op];
    }
    const sv = v == null ? '' : String(v).toLowerCase();
    const eq = re ? re.test(sv) : sv === raw.toLowerCase();
    if (op === '=') return eq;
    if (op === '<>') return !eq;
    return false;
  };
}

// Rows matching every (range, criteria) pair, as flat indexes.
function matching(pairs) {
  const ranges = [];
  const tests = [];
  for (let i = 0; i < pairs.length; i += 2) {
    ranges.push(flat(pairs[i]));
    tests.push(criterion(pairs[i + 1]?.value));
  }
  const len = Math.min(...ranges.map((r) => r.length));
  const out = [];
  for (let i = 0; i < len; i += 1) if (tests.every((t, k) => t(ranges[k][i]))) out.push(i);
  return out;
}

function stats(args) {
  const v = numbers(args);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
  return { v, mean, variance };
}

// The parser already reserves CHOOSE as a context function, so it goes here.
const EXTRA_WITH_CONTEXT = {
  CHOOSE: (context, index, ...options) => {
    const i = num(index);
    if (i < 1 || i > options.length) throw FormulaError.VALUE;
    return options[i - 1].value;
  },
};

// Functions the parser doesn't ship with.
const EXTRA = {
  UPPER: (t) => str(t).toUpperCase(),
  SUBSTITUTE: (t, from, to, nth) => {
    const s = str(t);
    const f = str(from);
    if (!f) return s;
    if (!nth) return s.split(f).join(str(to));
    let count = 0;
    return s.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (m) => (++count === num(nth) ? str(to) : m));
  },
  TEXTJOIN: (delim, ignoreEmpty, ...items) => items.flatMap(flat).filter((v) => !(ignoreEmpty.value && (v == null || v === ''))).map((v) => (v == null ? '' : v)).join(str(delim)),
  VALUE: (t) => {
    const v = literal(str(t));
    if (typeof v !== 'number') throw FormulaError.VALUE;
    return v;
  },
  SWITCH: (expr, ...rest) => {
    for (let i = 0; i + 1 < rest.length; i += 2) if (rest[i].value === expr.value) return rest[i + 1].value;
    if (rest.length % 2) return rest[rest.length - 1].value;
    throw FormulaError.NA;
  },
  COUNTIFS: (...pairs) => matching(pairs).length,
  SUMIFS: (sumRange, ...pairs) => {
    const vals = flat(sumRange);
    return matching(pairs).reduce((a, i) => a + (typeof vals[i] === 'number' ? vals[i] : 0), 0);
  },
  AVERAGEIFS: (avgRange, ...pairs) => {
    const vals = flat(avgRange);
    const hits = matching(pairs).map((i) => vals[i]).filter((v) => typeof v === 'number');
    if (!hits.length) throw FormulaError.DIV0;
    return hits.reduce((a, b) => a + b, 0) / hits.length;
  },
  MAXIFS: (range, ...pairs) => {
    const vals = flat(range);
    const hits = matching(pairs).map((i) => vals[i]).filter((v) => typeof v === 'number');
    return hits.length ? Math.max(...hits) : 0;
  },
  MINIFS: (range, ...pairs) => {
    const vals = flat(range);
    const hits = matching(pairs).map((i) => vals[i]).filter((v) => typeof v === 'number');
    return hits.length ? Math.min(...hits) : 0;
  },
  COUNTBLANK: (range) => flat(range).filter((v) => v == null || v === '').length,
  MEDIAN: (...args) => {
    const v = numbers(args).sort((a, b) => a - b);
    if (!v.length) throw FormulaError.NUM;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  },
  MODE: (...args) => {
    const counts = new Map();
    for (const n of numbers(args)) counts.set(n, (counts.get(n) || 0) + 1);
    let best = null;
    for (const [n, c] of counts) if (c > 1 && (best == null || c > counts.get(best))) best = n;
    if (best == null) throw FormulaError.NA;
    return best;
  },
  STDEV: (...args) => {
    const { v, variance } = stats(args);
    if (v.length < 2) throw FormulaError.DIV0;
    return Math.sqrt(variance);
  },
  VAR: (...args) => {
    const { v, variance } = stats(args);
    if (v.length < 2) throw FormulaError.DIV0;
    return variance;
  },
  LARGE: (range, k) => {
    const v = numbers([range]).sort((a, b) => b - a);
    const i = num(k);
    if (i < 1 || i > v.length) throw FormulaError.NUM;
    return v[i - 1];
  },
  SMALL: (range, k) => {
    const v = numbers([range]).sort((a, b) => a - b);
    const i = num(k);
    if (i < 1 || i > v.length) throw FormulaError.NUM;
    return v[i - 1];
  },
  RANK: (n, range, order) => {
    const x = num(n);
    const v = numbers([range]);
    if (!v.includes(x)) throw FormulaError.NA;
    const asc = order ? num(order) !== 0 : false;
    return v.filter((y) => (asc ? y < x : y > x)).length + 1;
  },
  FV: (rate, nper, pmt, pv, type) => {
    const r = num(rate);
    const n = num(nper);
    const p = num(pmt);
    const v = pv ? num(pv) : 0;
    const t = type ? num(type) : 0;
    if (r === 0) return -(v + p * n);
    const pow = (1 + r) ** n;
    return -(v * pow + (p * (1 + r * t) * (pow - 1)) / r);
  },
  PV: (rate, nper, pmt, fv, type) => {
    const r = num(rate);
    const n = num(nper);
    const p = num(pmt);
    const f = fv ? num(fv) : 0;
    const t = type ? num(type) : 0;
    if (r === 0) return -(f + p * n);
    const pow = (1 + r) ** n;
    return -(f + (p * (1 + r * t) * (pow - 1)) / r) / pow;
  },
  NPV: (rate, ...flows) => {
    const r = num(rate);
    return numbers(flows).reduce((acc, cf, i) => acc + cf / (1 + r) ** (i + 1), 0);
  },
  MATCH: (lookup, range, type) => {
    const needle = lookup.value;
    const t = type ? num(type) : 1;
    const list = flat(range);
    if (t === 0) {
      const i = list.findIndex((v) => (typeof v === 'string' && typeof needle === 'string' ? v.toLowerCase() === needle.toLowerCase() : v === needle));
      if (i < 0) throw FormulaError.NA;
      return i + 1;
    }
    let best = -1;
    list.forEach((v, i) => {
      if (v == null) return;
      if ((t > 0 && v <= needle) || (t < 0 && v >= needle)) best = i;
    });
    if (best < 0) throw FormulaError.NA;
    return best + 1;
  },
  XLOOKUP: (lookup, lookupRange, returnRange, notFound) => {
    const keys = flat(lookupRange);
    const vals = flat(returnRange);
    const needle = lookup.value;
    const i = keys.findIndex((v) => (typeof v === 'string' && typeof needle === 'string' ? v.toLowerCase() === needle.toLowerCase() : v === needle));
    if (i < 0) {
      if (notFound) return notFound.value;
      throw FormulaError.NA;
    }
    return vals[i] ?? null;
  },
  PMT: (rate, nper, pv, fv, type) => {
    const r = num(rate);
    const n = num(nper);
    const p = num(pv);
    const f = fv ? num(fv) : 0;
    const t = type ? num(type) : 0;
    if (r === 0) return -(p + f) / n;
    const pow = (1 + r) ** n;
    return -(r * (p * pow + f)) / ((1 + r * t) * (pow - 1));
  },
};

export function literal(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^-?\d+(\.\d+)?%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  if (/^-?\$\d[\d,]*(\.\d+)?$/.test(s)) return Number(s.replace(/[$,]/g, ''));
  if (/^(true|false)$/i.test(s)) return s.toUpperCase() === 'TRUE';
  return String(raw);
}

export const isError = (v) => v instanceof FormulaError || (typeof v === 'string' && /^#[A-Z/0!?]+[!?]?$/.test(v) && v.length < 9);
export const errorText = (v) => (v instanceof FormulaError ? v.error : String(v));

// Computes every cell of every sheet. Returns { [sheetName]: Map(ref -> value) }.
export function computeBook(book) {
  const bySheet = new Map(book.sheets.map((s) => [s.name.toLowerCase(), s]));
  const values = new Map(book.sheets.map((s) => [s, new Map()]));
  const visiting = new Set();
  const parsers = [];
  const current = [];

  function sheetFor(name, depth) {
    return name ? bySheet.get(String(name).toLowerCase()) : current[depth];
  }

  function parserAt(depth) {
    if (!parsers[depth]) {
      parsers[depth] = new FormulaParser({
        functions: EXTRA,
        functionsNeedContext: EXTRA_WITH_CONTEXT,
        onCell: ({ sheet, row, col }) => {
          const s = sheetFor(sheet, depth);
          if (!s) throw FormulaError.REF;
          return valueOf(s, `${colName(col - 1)}${row}`, depth + 1);
        },
        onRange: ({ sheet, from, to }) => {
          const s = sheetFor(sheet, depth);
          if (!s) throw FormulaError.REF;
          const out = [];
          const lastRow = Math.min(to.row, from.row + 5000);
          const lastCol = Math.min(to.col, from.col + 300);
          for (let r = from.row; r <= lastRow; r += 1) {
            const row = [];
            for (let c = from.col; c <= lastCol; c += 1) {
              row.push(valueOf(s, `${colName(c - 1)}${r}`, depth + 1));
            }
            out.push(row);
          }
          return out;
        },
      });
    }
    return parsers[depth];
  }

  function valueOf(sheet, ref, depth) {
    const memo = values.get(sheet);
    if (memo.has(ref)) return memo.get(ref);
    const raw = sheet.cells[ref]?.v;
    let v;
    if (typeof raw === 'string' && raw.startsWith('=') && raw.length > 1) {
      const key = `${sheet.name}!${ref}`;
      if (visiting.has(key) || depth > 120) return FormulaError.REF;
      visiting.add(key);
      current[depth] = sheet;
      const p = parseRef(ref);
      try {
        v = parserAt(depth).parse(raw.slice(1), { sheet: sheet.name, row: p.row + 1, col: p.col + 1 });
        if (Array.isArray(v)) v = Array.isArray(v[0]) ? v[0][0] : v[0];
        if (v && typeof v === 'object' && !(v instanceof FormulaError) && v._error) v = new FormulaError(v._error);
      } catch (err) {
        if (err instanceof FormulaError && /not implemented/i.test(err.message || '')) v = FormulaError.NAME;
        else if (!(err instanceof FormulaError) || err.details) v = new FormulaError('#ERROR!');
        else v = err;
      }
      visiting.delete(key);
    } else {
      v = literal(raw);
    }
    if (v === undefined) v = null;
    memo.set(ref, v);
    return v;
  }

  const out = {};
  for (const sheet of book.sheets) {
    for (const ref of Object.keys(sheet.cells)) {
      if (parseRef(ref)) valueOf(sheet, ref, 0);
    }
    out[sheet.name] = values.get(sheet);
  }
  return out;
}

// Excel serial date <-> JS date (1900 date system).
export function serialToDate(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

export function format(v, style = {}) {
  if (v == null) return '';
  if (v instanceof FormulaError) return v.error;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '#NUM!';
    const dec = style.dec;
    const fixed = (d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    switch (style.fmt) {
      case 'number': return fixed(dec ?? 2);
      case 'integer': return fixed(0);
      case 'currency': return `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec ?? 2, maximumFractionDigits: dec ?? 2 })}`;
      case 'percent': return `${(v * 100).toLocaleString('en-US', { minimumFractionDigits: dec ?? 0, maximumFractionDigits: dec ?? 0 })}%`;
      case 'date': return serialToDate(v).toISOString().slice(0, 10);
      default:
        if (dec != null) return fixed(dec);
        if (Number.isInteger(v)) return String(v);
        return String(Number(v.toPrecision(11)));
    }
  }
  return String(v);
}
