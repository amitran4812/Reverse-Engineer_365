// Text functions, including Google Sheets' SPLIT, JOIN and REGEX* and the TO_* parsers.

import {
  E, err, flat, isArr, isErr, literal, parseNumber, toBool, toInt, toNum, toStr, wildcard,
} from '../core.js';
import { libCall } from './lib.js';
import { R, S } from './util.js';

const s1 = (f) => S((x) => f(toStr(x)), { min: 1, max: 1 });

// Google writes RE2 patterns; JS accepts most of them. Leading (?i)/(?s)/(?m) become flags.
function regex(pattern, global) {
  let p = toStr(pattern);
  let flags = global ? 'gu' : 'u';
  const m = /^\(\?([ismU]+)\)/.exec(p);
  if (m) {
    p = p.slice(m[0].length);
    for (const f of m[1]) if ('ism'.includes(f) && !flags.includes(f)) flags += f;
  }
  p = p.replace(/\(\?P</g, '(?<').replace(/\\z/g, '$').replace(/\\A/g, '^');
  try {
    return new RegExp(p, flags);
  } catch {
    try {
      return new RegExp(p, flags.replace('u', ''));
    } catch {
      throw err('#REF!', `Function REGEX parameter 2 value "${pattern}" is not a valid regular expression.`);
    }
  }
}

const textOf = (v) => (typeof v === 'number' ? toStr(v) : toStr(v));

function split(text, delim, each, removeEmpty) {
  const s = textOf(text);
  const d = toStr(delim);
  if (d === '') throw err('#VALUE!', 'SPLIT needs a delimiter.');
  const byEach = each === undefined || toBool(each);
  const drop = removeEmpty === undefined || toBool(removeEmpty);
  let parts;
  if (byEach) {
    const set = [...d].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
    parts = s.split(new RegExp(`[${set}]`));
  } else parts = s.split(d);
  if (drop) parts = parts.filter((p) => p !== '');
  if (!parts.length) return [[null]];
  return [parts.map((p) => {
    const v = literal(p);
    return typeof v === 'number' ? v : p;
  })];
}

function textFormat(value, fmt) {
  const f = toStr(fmt);
  let v = value;
  if (typeof v === 'string') {
    const n = parseNumber(v);
    if (n == null || f.includes('@')) return f.includes('@') ? f.replace(/"([^"]*)"/g, '$1').replace(/@/g, v) : v;
    v = n;
  }
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v == null) v = 0;
  return libCall('TEXT', v, f);
}

const UNITS = (() => {
  const u = {};
  const add = (group, list) => {
    for (const [names, factor, prefixes] of list) for (const n of names.split(' ')) u[n] = { group, factor, prefixes };
  };
  add('mass', [['g', 1, true], ['sg', 14593.90294, false], ['lbm', 453.59237, false], ['u', 1.66053906660e-24, true], ['ozm', 28.349523125, false], ['grain', 0.06479891, false], ['cwt shweight', 45359.237, false], ['uk_cwt lcwt hweight', 50802.34544, false], ['stone', 6350.29318, false], ['ton', 907184.74, false], ['uk_ton LTON brton', 1016046.9088, false]]);
  add('distance', [['m', 1, true], ['mi', 1609.344, false], ['Nmi', 1852, false], ['in', 0.0254, false], ['ft', 0.3048, false], ['yd', 0.9144, false], ['ang', 1e-10, true], ['ell', 1.143, false], ['ly', 9.4607304725808e15, true], ['parsec pc', 3.08567758149137e16, false], ['Pica', 0.00423333333333333, false], ['pica', 0.000352777777777778, false], ['survey_mi', 1609.34721869444, false]]);
  add('time', [['yr', 31557600, false], ['day d', 86400, false], ['hr', 3600, false], ['mn min', 60, false], ['sec s', 1, true]]);
  add('pressure', [['Pa p', 1, true], ['atm at', 101325, true], ['mmHg', 133.322, true], ['psi', 6894.75729316836, false], ['Torr', 133.322368421053, false]]);
  add('force', [['N', 1, true], ['dyn dy', 1e-5, true], ['lbf', 4.4482216152605, false], ['pond', 0.00980665, true]]);
  add('energy', [['J', 1, true], ['e', 1e-7, true], ['c', 4.184, true], ['cal', 4.1868, true], ['eV ev', 1.602176634e-19, true], ['HPh hh', 2684519.53769617, false], ['Wh wh', 3600, true], ['flb', 1.3558179483314, false], ['BTU btu', 1055.05585262, false]]);
  add('power', [['HP h', 745.69987158227, false], ['PS', 735.49875, false], ['W w', 1, true]]);
  add('magnetism', [['T', 1, true], ['ga', 1e-4, true]]);
  add('volume', [['tsp', 4.92892159375e-6, false], ['tspm', 5e-6, false], ['tbs', 1.478676478125e-5, false], ['oz', 2.95735295625e-5, false], ['cup', 2.365882365e-4, false], ['pt us_pt', 4.73176473e-4, false], ['uk_pt', 5.6826125e-4, false], ['qt', 9.46352946e-4, false], ['uk_qt', 1.1365225e-3, false], ['gal', 3.785411784e-3, false], ['uk_gal', 4.54609e-3, false], ['l L lt', 1e-3, true], ['ang3 ang^3', 1e-30, true], ['barrel', 0.158987294928, false], ['bushel', 0.03523907016688, false], ['ft3 ft^3', 0.028316846592, false], ['in3 in^3', 1.6387064e-5, false], ['ly3 ly^3', 8.46786664623715e47, false], ['m3 m^3', 1, true], ['mi3 mi^3', 4168181825.44058, false], ['yd3 yd^3', 0.764554857984, false], ['Nmi3 Nmi^3', 6352182208, false], ['Pica3 Picapt3 Pica^3 Picapt^3', 7.58660370370369e-8, false], ['GRT regton', 2.8316846592, false], ['MTON', 1.13267386368, false]]);
  add('area', [['uk_acre', 4046.8564224, false], ['us_acre', 4046.87260987425, false], ['ang2 ang^2', 1e-20, true], ['ar', 100, true], ['ft2 ft^2', 0.09290304, false], ['ha', 10000, false], ['in2 in^2', 6.4516e-4, false], ['ly2 ly^2', 8.95054210748189e31, false], ['m2 m^2', 1, true], ['Morgen', 2500, false], ['mi2 mi^2', 2589988.110336, false], ['Nmi2 Nmi^2', 3429904, false], ['Pica2 Pica^2 Picapt2 Picapt^2', 1.792111e-5 / 1000, false], ['yd2 yd^2', 0.83612736, false]]);
  add('information', [['bit', 1, true], ['byte', 8, true]]);
  add('speed', [['admkn', 0.514773333333333, false], ['kn', 0.514444444444444, false], ['m/h m/hr', 1 / 3600, true], ['m/s m/sec', 1, true], ['mph', 0.44704, false]]);
  return u;
})();
const PREFIX = { Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 10, e: 10, d: 0.1, c: 1e-2, m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24, Yi: 2 ** 80, Zi: 2 ** 70, Ei: 2 ** 60, Pi: 2 ** 50, Ti: 2 ** 40, Gi: 2 ** 30, Mi: 2 ** 20, ki: 2 ** 10 };

function unit(name) {
  if (UNITS[name]) return { ...UNITS[name], power: 1 };
  for (const p of Object.keys(PREFIX).sort((a, b) => b.length - a.length)) {
    if (!name.startsWith(p)) continue;
    const base = UNITS[name.slice(p.length)];
    if (base?.prefixes) {
      const pow = /[23]$/.test(name) ? Number(name.slice(-1)) : 1;
      return { ...base, factor: base.factor * PREFIX[p] ** pow };
    }
  }
  return null;
}

const TEMPS = {
  C: [(v) => v, (v) => v], cel: [(v) => v, (v) => v],
  F: [(v) => ((v - 32) * 5) / 9, (v) => (v * 9) / 5 + 32], fah: [(v) => ((v - 32) * 5) / 9, (v) => (v * 9) / 5 + 32],
  K: [(v) => v - 273.15, (v) => v + 273.15], kel: [(v) => v - 273.15, (v) => v + 273.15],
  Rank: [(v) => ((v - 491.67) * 5) / 9, (v) => (v * 9) / 5 + 491.67], Reau: [(v) => v * 1.25, (v) => v / 1.25],
};

function convert(value, from, to) {
  const v = toNum(value);
  const a = toStr(from);
  const b = toStr(to);
  if (TEMPS[a] && TEMPS[b]) return TEMPS[b][1](TEMPS[a][0](v));
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub || ua.group !== ub.group) throw err('#N/A', `CONVERT can't convert "${a}" to "${b}".`);
  return Number(((v * ua.factor) / ub.factor).toPrecision(15));
}

const halfWidth = (s) => s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ');
const fullWidth = (s) => s.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/ /g, '　');

function between(text, delim, n, before) {
  const s = toStr(text);
  const d = toStr(delim);
  let k = n === undefined ? 1 : toInt(n);
  if (k === 0) throw E.VALUE;
  let idx = -1;
  if (k > 0) {
    let from = 0;
    while (k > 0) {
      idx = s.indexOf(d, from);
      if (idx < 0) throw E.NA;
      from = idx + Math.max(d.length, 1);
      k -= 1;
    }
  } else {
    let from = s.length;
    while (k < 0) {
      idx = s.lastIndexOf(d, from);
      if (idx < 0) throw E.NA;
      from = idx - 1;
      k += 1;
    }
  }
  return before ? s.slice(0, idx) : s.slice(idx + d.length);
}

const findAt = (needle, hay, start, ci) => {
  const n = toStr(needle);
  const h = toStr(hay);
  const st = start === undefined ? 1 : toInt(start);
  if (st < 1 || st > h.length + 1) throw err('#VALUE!', 'The start position is outside the text.');
  if (ci) {
    if (/[*?~]/.test(n)) {
      const re = new RegExp(wildcard(n).source.slice(1, -1), 'is');
      const m = re.exec(h.slice(st - 1));
      if (!m) throw err('#VALUE!', `"${n}" wasn't found in "${h}".`);
      return m.index + st;
    }
    const i = h.toLowerCase().indexOf(n.toLowerCase(), st - 1);
    if (i < 0) throw err('#VALUE!', `"${n}" wasn't found in "${h}".`);
    return i + 1;
  }
  const i = h.indexOf(n, st - 1);
  if (i < 0) throw err('#VALUE!', `"${n}" wasn't found in "${h}".`);
  return i + 1;
};

const bytes = (s) => [...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);

export default {
  CONCATENATE: R((...a) => a.flatMap(flat).map(toStr).join(''), { min: 1 }),
  CONCAT: R((...a) => a.flatMap(flat).map(toStr).join(''), { min: 1 }),
  JOIN: R((d, ...a) => a.flatMap(flat).map(toStr).join(toStr(d)), { min: 2 }),
  TEXTJOIN: R((d, ignore, ...a) => {
    const skip = toBool(ignore);
    const delims = flat(d).map(toStr);
    const parts = a.flatMap(flat).filter((v) => {
      if (isErr(v)) throw v;
      return !(skip && (v == null || v === ''));
    }).map(toStr);
    return parts.reduce((s, p, i) => (i ? s + delims[(i - 1) % delims.length] + p : p), '');
  }, { min: 3 }),
  SPLIT: S(split, { min: 2, max: 4 }),
  LEFT: S((t, n) => {
    const k = n === undefined ? 1 : toInt(n);
    if (k < 0) throw E.VALUE;
    return [...textOf(t)].slice(0, k).join('');
  }, { min: 1, max: 2 }),
  RIGHT: S((t, n) => {
    const k = n === undefined ? 1 : toInt(n);
    if (k < 0) throw E.VALUE;
    const c = [...textOf(t)];
    return k ? c.slice(-k).join('') : '';
  }, { min: 1, max: 2 }),
  MID: S((t, s, n) => {
    const st = toInt(s);
    const k = toInt(n);
    if (st < 1 || k < 0) throw E.VALUE;
    return [...textOf(t)].slice(st - 1, st - 1 + k).join('');
  }, { min: 3, max: 3 }),
  LEFTB: S((t, n) => textOf(t).slice(0, n === undefined ? 1 : toInt(n)), { min: 1, max: 2 }),
  RIGHTB: S((t, n) => {
    const k = n === undefined ? 1 : toInt(n);
    return k ? textOf(t).slice(-k) : '';
  }, { min: 1, max: 2 }),
  MIDB: S((t, s, n) => textOf(t).slice(toInt(s) - 1, toInt(s) - 1 + toInt(n)), { min: 3, max: 3 }),
  LEN: s1((t) => [...t].length),
  LENB: s1(bytes),
  LOWER: s1((t) => t.toLowerCase()),
  UPPER: s1((t) => t.toUpperCase()),
  PROPER: s1((t) => t.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/(\p{N})(\p{L})/gu, (m, a, b) => a + b.toUpperCase())),
  TRIM: s1((t) => t.replace(/ +/g, ' ').trim()),
  CLEAN: s1((t) => t.replace(/[\x00-\x1f]/g, '')),
  SUBSTITUTE: S((t, from, to, nth) => {
    const s = toStr(t);
    const f = toStr(from);
    const r = toStr(to);
    if (!f) return s;
    if (nth === undefined) return s.split(f).join(r);
    const k = toInt(nth);
    if (k < 1) throw E.VALUE;
    let count = 0;
    let i = s.indexOf(f);
    while (i >= 0) {
      count += 1;
      if (count === k) return s.slice(0, i) + r + s.slice(i + f.length);
      i = s.indexOf(f, i + f.length);
    }
    return s;
  }, { min: 3, max: 4 }),
  REPLACE: S((t, s, n, r) => {
    const c = [...toStr(t)];
    const st = toInt(s);
    if (st < 1) throw E.VALUE;
    c.splice(st - 1, toInt(n), toStr(r));
    return c.join('');
  }, { min: 4, max: 4 }),
  REPLACEB: S((t, s, n, r) => {
    const x = toStr(t);
    return x.slice(0, toInt(s) - 1) + toStr(r) + x.slice(toInt(s) - 1 + toInt(n));
  }, { min: 4, max: 4 }),
  REPT: S((t, n) => {
    const k = toInt(n);
    if (k < 0) throw E.VALUE;
    const s = toStr(t);
    if (s.length * k > 32000) throw err('#VALUE!', 'REPT result is longer than 32,000 characters.');
    return s.repeat(k);
  }, { min: 2, max: 2 }),
  FIND: S((n, h, s) => findAt(n, h, s, false), { min: 2, max: 3 }),
  FINDB: S((n, h, s) => findAt(n, h, s, false), { min: 2, max: 3 }),
  SEARCH: S((n, h, s) => findAt(n, h, s, true), { min: 2, max: 3 }),
  SEARCHB: S((n, h, s) => findAt(n, h, s, true), { min: 2, max: 3 }),
  EXACT: S((a, b) => toStr(a) === toStr(b), { min: 2, max: 2 }),
  CHAR: S((n) => {
    const k = toInt(n);
    if (k < 1 || k > 1114111) throw E.VALUE;
    return String.fromCodePoint(k);
  }, { min: 1, max: 1 }),
  UNICHAR: S((n) => {
    const k = toInt(n);
    if (k < 1 || k > 1114111) throw E.VALUE;
    return String.fromCodePoint(k);
  }, { min: 1, max: 1 }),
  CODE: s1((t) => {
    if (!t) throw E.VALUE;
    return t.codePointAt(0);
  }),
  UNICODE: s1((t) => {
    if (!t) throw E.VALUE;
    return t.codePointAt(0);
  }),
  T: S((v) => (typeof v === 'string' ? v : ''), { min: 1, max: 1 }),
  TEXT: S(textFormat, { min: 2, max: 2 }),
  VALUE: S((v) => {
    if (typeof v === 'number') return v;
    if (v == null || v === '') return 0;
    const n = parseNumber(toStr(v));
    if (n == null) throw err('#VALUE!', `VALUE parameter "${v}" can't be parsed to a number.`);
    return n;
  }, { min: 1, max: 1 }),
  NUMBERVALUE: S((t, dec, group) => {
    let s = toStr(t).replace(/\s/g, '');
    const d = dec === undefined ? '.' : toStr(dec)[0];
    const g = group === undefined ? ',' : toStr(group)[0];
    s = s.split(g).join('').split(d).join('.');
    const n = parseNumber(s);
    if (n == null) throw E.VALUE;
    return n;
  }, { min: 1, max: 3 }),
  DOLLAR: S((n, d) => libCall('DOLLAR', toNum(n), d === undefined ? 2 : toNum(d)), { min: 1, max: 2 }),
  FIXED: S((n, d, noCommas) => libCall('FIXED', toNum(n), d === undefined ? 2 : toNum(d), noCommas === undefined ? false : toBool(noCommas)), { min: 1, max: 3 }),
  REGEXMATCH: S((t, p) => regex(p).test(textOf(t)), { min: 2, max: 2 }),
  REGEXEXTRACT: S((t, p) => {
    const m = regex(p).exec(textOf(t));
    if (!m) throw err('#N/A', `Function REGEXEXTRACT parameter 2 value "${p}" does not match text of Function REGEXEXTRACT parameter 1 value "${textOf(t)}".`);
    if (m.length <= 1) return m[0];
    if (m.length === 2) return m[1] ?? '';
    return [m.slice(1).map((x) => x ?? '')];
  }, { min: 2, max: 2 }),
  REGEXREPLACE: S((t, p, r) => textOf(t).replace(regex(p, true), toStr(r).replace(/\\(\d)/g, '$$$1')), { min: 3, max: 3 }),
  TEXTBEFORE: S((t, d, n) => between(t, d, n, true), { min: 2, max: 3 }),
  TEXTAFTER: S((t, d, n) => between(t, d, n, false), { min: 2, max: 3 }),
  ASC: s1(halfWidth),
  DBCS: s1(fullWidth),
  ENCODEURL: s1((t) => encodeURIComponent(t)),
  HYPERLINK: S((url, label) => (label === undefined ? toStr(url) : label), { min: 1, max: 2 }),
  CONVERT: S(convert, { min: 3, max: 3 }),
  TO_TEXT: S((v) => toStr(v), { min: 1, max: 1 }),
  TO_PURE_NUMBER: S((v) => (typeof v === 'string' ? toNum(v) : v ?? 0), { min: 1, max: 1 }),
  TO_PERCENT: S((v) => (typeof v === 'number' ? v : toNum(v)), { min: 1, max: 1 }),
  TO_DOLLARS: S((v) => (typeof v === 'number' ? v : toNum(v)), { min: 1, max: 1 }),
  IMAGE: S(() => '', { min: 1, max: 4 }),
  SPARKLINE: S(() => '', { arrays: [0, 1], min: 1, max: 2 }),
  BAHTTEXT: S((n) => toStr(toNum(n)), { min: 1, max: 1 }),
  PHONETIC: s1((t) => t),
};

export { isArr };
