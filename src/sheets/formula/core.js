// Values, errors and coercions shared by the formula evaluator and its functions.
// Values are numbers, strings, booleans, null (blank), FormulaError, 2D arrays
// (rows of values), Ref (an unresolved range) and Lambda.

import FormulaParser from 'fast-formula-parser';

export const { FormulaError } = FormulaParser;

export const E = {
  DIV0: FormulaError.DIV0,
  NA: FormulaError.NA,
  NAME: FormulaError.NAME,
  NULL: FormulaError.NULL,
  NUM: FormulaError.NUM,
  REF: FormulaError.REF,
  VALUE: FormulaError.VALUE,
  ERROR: new FormulaError('#ERROR!'),
};

export const err = (code, msg) => new FormulaError(code, msg);
export const isErr = (v) => v instanceof FormulaError;

export class Ref {
  constructor(sheet, r0, c0, r1 = r0, c1 = c0) {
    this.sheet = sheet;
    this.r0 = r0;
    this.c0 = c0;
    this.r1 = r1;
    this.c1 = c1;
  }

  get rows() { return this.r1 - this.r0 + 1; }
  get cols() { return this.c1 - this.c0 + 1; }
}

export class Lambda {
  constructor(params, body, scope) {
    this.params = params;
    this.body = body;
    this.scope = scope;
  }
}

export const isArr = Array.isArray;
export const toArr = (v) => (isArr(v) ? v : [[v]]);
export const first = (v) => (isArr(v) ? (v[0]?.[0] ?? null) : v);
export const flat = (v) => (isArr(v) ? v.flat() : [v]);
export const dims = (a) => [a.length, a[0]?.length ?? 0];
export const fill = (rows, cols, v) => Array.from({ length: rows }, () => Array(cols).fill(v));
export const map2 = (a, fn) => a.map((row, r) => row.map((v, c) => fn(v, r, c)));
export const transpose = (a) => (a.length ? a[0].map((_, c) => a.map((row) => row[c])) : a);
export const column = (list) => (list.length ? list.map((v) => [v]) : [[E.NA]]);

// Date serials count days from 1899-12-30, as Google Sheets and Excel do.
const EPOCH = Date.UTC(1899, 11, 30);
export const DAY_MS = 86400000;
export const dateSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS;
export const serialDate = (n) => new Date(EPOCH + Math.round(n * DAY_MS));
export const msSerial = (ms) => (ms - EPOCH) / DAY_MS;
export const nowSerial = () => {
  const d = new Date();
  return msSerial(d.getTime() - d.getTimezoneOffset() * 60000);
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;

function timeOf(s) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*([ap]\.?m\.?)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  if (m[4]) {
    if (h > 12) return null;
    h = (h % 12) + (/^p/i.test(m[4]) ? 12 : 0);
  }
  return (h * 3600 + Number(m[2]) * 60 + Number(m[3] || 0)) / 86400;
}

// Parses dates and times written the common ways; null when it isn't one.
export function parseDate(text) {
  const s = String(text).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(.+?))?(?:Z|[+-]\d\d:?\d\d)?$/.exec(s);
  let y;
  let mo;
  let d;
  let rest;
  if (m) [, y, mo, d, rest] = m;
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(.+))?$/.exec(s))) [, mo, d, y, rest] = m;
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:\s+(.+))?$/.exec(s)) && monthOf(m[1])) [, , d, y, rest] = m, mo = monthOf(m[1]);
  else if ((m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?[\s,-]+(\d{2,4})(?:\s+(.+))?$/.exec(s)) && monthOf(m[2])) [, d, , y, rest] = m, mo = monthOf(m[2]);
  else {
    const t = timeOf(s);
    return t;
  }
  y = Number(y);
  if (y < 100) y += y < 30 ? 2000 : 1900;
  mo = Number(mo);
  d = Number(d);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  let serial = dateSerial(y, mo, d);
  if (rest) {
    const t = timeOf(rest);
    if (t == null) return null;
    serial += t;
  }
  return serial;
}

// Numbers typed as text: "1,234.5", "12%", "$5", "(3)", "1e3", dates and times.
export function parseNumber(text) {
  let s = String(text).trim();
  if (s === '') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  let pct = false;
  if (s.endsWith('%')) {
    pct = true;
    s = s.slice(0, -1).trim();
  }
  s = s.replace(/^([-+]?)\s*[$€£¥₹]\s*/, '$1');
  let n = null;
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][-+]?\d+)?$/.test(s) && /\d/.test(s)) n = Number(s.replace(/,/g, ''));
  else if (!pct) n = parseDate(s);
  if (n == null || Number.isNaN(n)) return null;
  if (pct) n /= 100;
  return neg ? -n : n;
}

export function toNum(v) {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isErr(v)) throw v;
  if (isArr(v)) return toNum(first(v));
  if (typeof v === 'string') {
    if (v === '') return 0;
    const n = parseNumber(v);
    if (n == null) throw err('#VALUE!', `"${v}" is text and can't be used as a number.`);
    return n;
  }
  throw E.VALUE;
}

export const numText = (n) => {
  if (Number.isInteger(n)) return String(n);
  const s = String(Number(n.toPrecision(15)));
  return s;
};

export function toStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (isErr(v)) throw v;
  if (isArr(v)) return toStr(first(v));
  throw E.VALUE;
}

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v == null) return false;
  if (isErr(v)) throw v;
  if (isArr(v)) return toBool(first(v));
  const s = String(v).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE' || s === '') return false;
  throw err('#VALUE!', `"${v}" isn't TRUE or FALSE.`);
}

export const toInt = (v) => Math.trunc(toNum(v));

// Numbers among the values, the way SUM and friends read ranges (text and blanks skipped).
export function nums(args, { strict = false } = {}) {
  const out = [];
  for (const a of args) {
    if (isArr(a)) {
      for (const row of a) for (const v of row) {
        if (typeof v === 'number') out.push(v);
        else if (isErr(v)) throw v;
      }
    } else if (a !== undefined) {
      if (isErr(a)) throw a;
      if (typeof a === 'number') out.push(a);
      else if (a != null && a !== '') {
        if (strict) out.push(toNum(a));
        else if (typeof a === 'boolean') out.push(a ? 1 : 0);
        else {
          const n = parseNumber(a);
          if (n == null) throw err('#VALUE!', `"${a}" is text and can't be used as a number.`);
          out.push(n);
        }
      }
    }
  }
  return out;
}

// Values the "A" variants count: text as 0, booleans as 1/0.
export function numsA(args) {
  const out = [];
  for (const a of args) {
    for (const v of flat(a)) {
      if (v == null) continue;
      if (isErr(v)) throw v;
      if (typeof v === 'number') out.push(v);
      else if (typeof v === 'boolean') out.push(v ? 1 : 0);
      else out.push(isArr(a) ? 0 : (parseNumber(v) ?? 0));
    }
  }
  return out;
}

const typeRank = (v) => (v == null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 4);

// Sort order: numbers, then text (case-insensitive), then booleans, then errors; blanks last.
export function compare(a, b) {
  const ta = typeRank(a);
  const tb = typeRank(b);
  if (ta !== tb) return (ta || 9) - (tb || 9);
  if (ta === 1) return a - b;
  if (ta === 2) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (ta === 3) return Number(a) - Number(b);
  return 0;
}

// Comparison for the = < > operators: blanks act as 0, "" or FALSE to match the other side.
export function cmp(a, b) {
  if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ta = typeRank(a);
  const tb = typeRank(b);
  if (ta !== tb) return ta - tb;
  return compare(a, b);
}

export const same = (a, b) => cmp(a, b) === 0;

const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
export function wildcard(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '~' && i + 1 < pattern.length) out += escapeRe(pattern[++i]).replace(/[*?]/, '\\$&');
    else if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += escapeRe(ch);
  }
  return new RegExp(`^${out}$`, 'is');
}

// COUNTIF-style criteria: 5, ">5", "<=3", "<>x", "=x", "ab*", dates as text.
export function criterion(c) {
  if (typeof c === 'number' || typeof c === 'boolean') return (v) => v === c || (typeof c === 'number' && typeof v === 'string' && parseNumber(v) === c);
  if (c == null) return (v) => v == null || v === '';
  if (isErr(c)) return (v) => isErr(v) && v.error === c.error;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(String(c));
  const op = m[1] || '=';
  const raw = m[2];
  const n = raw.trim() !== '' ? parseNumber(raw) : null;
  const b = /^(true|false)$/i.test(raw) ? raw.toUpperCase() === 'TRUE' : null;
  const re = op === '=' || op === '<>' ? (/[*?~]/.test(raw) ? wildcard(raw) : null) : null;
  return (v) => {
    if (isErr(v)) return op === '<>' ? !/^#/.test(raw) || v.error !== raw : v.error === raw;
    if (n != null && typeof v === 'number') {
      return { '=': v === n, '<>': v !== n, '<': v < n, '>': v > n, '<=': v <= n, '>=': v >= n }[op];
    }
    if (b != null && typeof v === 'boolean') return op === '<>' ? v !== b : op === '=' ? v === b : false;
    if (raw === '' && (op === '=' || op === '<>')) return (op === '=') === (v == null || v === '');
    if (n != null && (op === '=' || op === '<>') && typeof v === 'string' && parseNumber(v) === n) return op === '=';
    if (v == null || typeof v !== 'string') {
      if (op === '<>') return true;
      return false;
    }
    if (re) return (op === '=') === re.test(v);
    const sv = v.toLowerCase();
    const r = raw.toLowerCase();
    if (n != null && op !== '=' && op !== '<>') return false;
    return { '=': sv === r, '<>': sv !== r, '<': sv < r, '>': sv > r, '<=': sv <= r, '>=': sv >= r }[op];
  };
}

// Elementwise over arrays with Google/Excel broadcasting (a single row or column stretches).
export function broadcast(args, fn) {
  let rows = 1;
  let cols = 1;
  for (const a of args) {
    if (!isArr(a)) continue;
    const [r, c] = dims(a);
    rows = r === 1 ? rows : rows === 1 ? r : Math.max(rows, r);
    cols = c === 1 ? cols : cols === 1 ? c : Math.max(cols, c);
  }
  const at = (a, r, c) => {
    if (!isArr(a)) return a;
    const [ar, ac] = dims(a);
    const rr = ar === 1 ? 0 : r;
    const cc = ac === 1 ? 0 : c;
    if (rr >= ar || cc >= ac) return E.NA;
    return a[rr][cc];
  };
  const out = [];
  for (let r = 0; r < rows; r += 1) {
    const row = [];
    for (let c = 0; c < cols; c += 1) row.push(fn(...args.map((a) => at(a, r, c))));
    out.push(row);
  }
  return out;
}

// Runs fn, turning a thrown FormulaError into a value.
export function attempt(fn) {
  try {
    return fn();
  } catch (e) {
    if (isErr(e)) return e;
    if (e instanceof RangeError) return err('#ERROR!', e.message);
    throw e;
  }
}

// A typed cell's value: numbers (with thousands separators, %, $), booleans, or text.
export function literal(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return raw;
  const s = raw.trim();
  if (s === '') return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ''));
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  if (/^-?\d+(\.\d+)?%$/.test(s)) return Number(s.slice(0, -1)) / 100;
  if (/^-?\$\d[\d,]*(\.\d+)?$/.test(s)) return Number(s.replace(/[$,]/g, ''));
  if (/^(true|false)$/i.test(s)) return s.toUpperCase() === 'TRUE';
  if (/^#(N\/A|REF!|DIV\/0!|VALUE!|NAME\?|NUM!|NULL!|ERROR!)$/.test(s)) return new FormulaError(s);
  return raw;
}
