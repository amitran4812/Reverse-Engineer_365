// Columnar storage for the analysis workspace. A column is
//   { name, type: 'number' | 'date' | 'string', data, dict }
// number/date columns keep a Float64Array (NaN = missing, dates as epoch ms);
// string columns keep Int32Array codes into `dict` (-1 = missing).

const MISSING = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '#n/a', '-', '?']);
export const isMissingText = (s) => MISSING.has(s.trim().toLowerCase());

// Grows typed arrays by doubling so millions of rows stay cheap to append.
function grow(arr, need) {
  if (need <= arr.length) return arr;
  let cap = arr.length || 1024;
  while (cap < need) cap *= 2;
  const next = new arr.constructor(cap);
  next.set(arr);
  return next;
}

export class ColumnBuilder {
  constructor(name, length = 0) {
    this.name = name;
    this.kind = 'empty';
    this.num = new Float64Array(Math.max(1024, length));
    this.num.fill(NaN, 0, length);
    this.codes = null;
    this.dict = null;
    this.index = null;
    this.length = length;
  }

  padTo(n) {
    while (this.length < n) this.pushMissing();
  }

  pushMissing() {
    if (this.kind === 'string') {
      this.codes = grow(this.codes, this.length + 1);
      this.codes[this.length++] = -1;
    } else {
      this.num = grow(this.num, this.length + 1);
      this.num[this.length++] = NaN;
    }
  }

  pushNumber(v, kind = 'number') {
    if (this.kind === 'string') return this.pushString(kind === 'date' ? isoDate(v) : String(v));
    if (this.kind === 'empty') this.kind = kind;
    else if (this.kind !== kind && kind === 'date') return this.pushString(isoDate(v));
    this.num = grow(this.num, this.length + 1);
    this.num[this.length++] = v;
    return undefined;
  }

  pushString(s) {
    if (this.kind !== 'string') this.toStrings();
    let code = this.index.get(s);
    if (code === undefined) {
      code = this.dict.length;
      this.dict.push(s);
      this.index.set(s, code);
    }
    this.codes = grow(this.codes, this.length + 1);
    this.codes[this.length++] = code;
  }

  // A text value showed up in a numeric column: keep what was read as text.
  toStrings() {
    const wasDate = this.kind === 'date';
    this.dict = [];
    this.index = new Map();
    this.codes = new Int32Array(Math.max(1024, this.num.length));
    for (let i = 0; i < this.length; i += 1) {
      const v = this.num[i];
      if (Number.isNaN(v)) {
        this.codes[i] = -1;
        continue;
      }
      const s = wasDate ? isoDate(v) : String(v);
      let code = this.index.get(s);
      if (code === undefined) {
        code = this.dict.length;
        this.dict.push(s);
        this.index.set(s, code);
      }
      this.codes[i] = code;
    }
    this.num = null;
    this.kind = 'string';
  }

  finish(length = this.length) {
    this.padTo(length);
    if (this.kind === 'string') return { name: this.name, type: 'string', data: this.codes.slice(0, length), dict: this.dict };
    return { name: this.name, type: this.kind === 'date' ? 'date' : 'number', data: this.num.slice(0, length) };
  }
}

export function isoDate(ms) {
  if (!Number.isFinite(ms)) return '';
  const s = new Date(ms).toISOString();
  return s.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : s.replace('.000Z', 'Z');
}

// ISO-style dates: 2024-01-31, 2024/01/31, optional time and zone.
const DATE_RE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;
export function parseDate(s) {
  const m = DATE_RE.exec(s.trim());
  if (!m) return NaN;
  const [, y, mo, d, hh = '0', mi = '0', ss = '0', frac = '', zone] = m;
  if (Number(mo) > 12 || Number(d) > 31) return NaN;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss), frac ? Math.round(Number(frac) * 1000) : 0);
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const z = zone.slice(1).replace(':', '');
    ms -= sign * (Number(z.slice(0, 2)) * 60 + Number(z.slice(2))) * 60000;
  }
  return ms;
}

// Unique column names: blanks become "Column N", repeats get a suffix.
export function uniqueNames(names) {
  const used = new Set();
  return names.map((raw, i) => {
    const base = String(raw ?? '').trim().replace(/[[\]]/g, '') || `Column ${i + 1}`;
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k += 1) name = `${base} (${k})`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Builds columns from plain rows (sheet data, tests). First row is the header.
export function columnsFromRows(matrix) {
  if (!matrix.length) return { columns: [], rows: 0 };
  const width = Math.max(...matrix.map((r) => r.length));
  const names = uniqueNames(Array.from({ length: width }, (_, c) => matrix[0][c]));
  const builders = names.map((n) => new ColumnBuilder(n));
  for (let r = 1; r < matrix.length; r += 1) {
    for (let c = 0; c < width; c += 1) pushValue(builders[c], matrix[r][c]);
  }
  return { columns: builders.map((b) => b.finish(matrix.length - 1)), rows: matrix.length - 1 };
}

export function pushValue(b, v) {
  if (v == null) return b.pushMissing();
  if (typeof v === 'number') return Number.isFinite(v) ? b.pushNumber(v) : b.pushMissing();
  if (typeof v === 'bigint') return b.pushNumber(Number(v));
  if (typeof v === 'boolean') return b.pushString(v ? 'true' : 'false');
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? b.pushMissing() : b.pushNumber(v.getTime(), 'date');
  if (typeof v === 'object') return b.pushString(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x)));
  const s = String(v);
  if (isMissingText(s)) return b.pushMissing();
  if (b.kind !== 'string') {
    const t = s.trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return b.pushNumber(Number(t));
    const d = parseDate(t);
    if (!Number.isNaN(d)) return b.pushNumber(d, 'date');
  }
  return b.pushString(s);
}

// Display text for one value of a column.
export function cellText(col, i) {
  if (col.type === 'string') {
    const c = col.data[i];
    return c < 0 ? '' : col.dict[c];
  }
  const v = col.data[i];
  if (Number.isNaN(v)) return '';
  if (col.type === 'date') return dateText(col, v);
  return formatNumber(v);
}

// One format per column: dates alone, or date and time when any value has a time.
const DAY = 86_400_000;
function dateText(col, v) {
  if (col.timeOfDay === undefined) {
    col.timeOfDay = 0;
    for (const x of col.data) if (x % DAY) col.timeOfDay = Math.max(col.timeOfDay, x % 1000 ? 2 : 1);
  }
  const s = new Date(v).toISOString();
  return col.timeOfDay ? s.slice(0, col.timeOfDay === 2 ? 23 : 19).replace('T', ' ') : s.slice(0, 10);
}

export function formatNumber(v, digits = 10) {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '' : String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e15)) return v.toExponential(Math.min(digits, 6) - 1).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(digits)));
}
