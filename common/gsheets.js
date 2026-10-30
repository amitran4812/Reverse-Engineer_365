'use strict';

// Google Sheets writes formulas Excel doesn't know into .xlsx exports as
//   IFERROR(__xludf.DUMMYFUNCTION("GOOGLEFINANCE(""GOOG"")"),171.95)
// and the cells an array result spilled into as
//   IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),42)
// These helpers read that form back and write it, so files round-trip.

const PREFIX = /^\s*IFERROR\(\s*__xludf\.DUMMYFUNCTION\(\s*"/i;
const DUMMY = /__xludf\.DUMMYFUNCTION\(\s*"/gi;

// Reads a "..." string body starting at i (just after the opening quote).
function quoted(s, i) {
  let out = '';
  for (; i < s.length; i += 1) {
    if (s[i] === '"') {
      if (s[i + 1] === '"') {
        out += '"';
        i += 1;
        continue;
      }
      return { text: out, end: i + 1 };
    }
    out += s[i];
  }
  return null;
}

function cachedLiteral(text) {
  const t = text.trim();
  if (t === '') return undefined;
  if (/^".*"$/s.test(t)) return t.slice(1, -1).replace(/""/g, '"');
  if (/^(TRUE|FALSE)$/i.test(t)) return t.toUpperCase() === 'TRUE';
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

// formula: text after "=". Returns { formula, cached, computed } with Google's real formula.
function unwrapFormula(formula) {
  const f = String(formula);
  if (!/__xludf\.DUMMYFUNCTION/i.test(f)) return { formula: f, computed: false };
  const m = PREFIX.exec(f);
  if (m) {
    const q = quoted(f, m[0].length);
    const rest = q && /^\s*\)\s*,(.*)\)\s*$/s.exec(f.slice(q.end));
    if (q && rest) {
      const computed = q.text.trim() === '"COMPUTED_VALUE"';
      return { formula: computed ? '' : q.text, cached: cachedLiteral(rest[1]), computed };
    }
  }
  let out = '';
  let last = 0;
  DUMMY.lastIndex = 0;
  for (let hit = DUMMY.exec(f); hit; hit = DUMMY.exec(f)) {
    const q = quoted(f, hit.index + hit[0].length);
    const close = q && /^\s*\)/.exec(f.slice(q.end));
    if (!close) break;
    out += f.slice(last, hit.index) + q.text;
    last = q.end + close[0].length;
    DUMMY.lastIndex = last;
  }
  return { formula: out + f.slice(last), computed: false };
}

const literalText = (v) => {
  if (v == null || v === '') return '""';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '""';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `"${String(v).replace(/"/g, '""')}"`;
};

function wrapFormula(formula, cached) {
  return `IFERROR(__xludf.DUMMYFUNCTION("${String(formula).replace(/"/g, '""')}"),${literalText(cached)})`;
}

const computedFormula = (value) => wrapFormula('"COMPUTED_VALUE"', value);

// Functions only Google Sheets has; formulas using them are wrapped when saved as .xlsx.
const GOOGLE_ONLY = new Set(['ARRAYFORMULA', 'GOOGLEFINANCE', 'GOOGLETRANSLATE', 'DETECTLANGUAGE', 'IMPORTRANGE', 'IMPORTDATA', 'IMPORTHTML', 'IMPORTXML', 'IMPORTFEED',
  'QUERY', 'SPLIT', 'JOIN', 'REGEXMATCH', 'REGEXEXTRACT', 'REGEXREPLACE', 'FLATTEN', 'SORTN', 'ARRAY_CONSTRAIN', 'COUNTUNIQUE', 'COUNTUNIQUEIFS', 'IMAGE', 'SPARKLINE',
  'TO_DATE', 'TO_DOLLARS', 'TO_PERCENT', 'TO_PURE_NUMBER', 'TO_TEXT', 'ISEMAIL', 'ISURL', 'ISBETWEEN', 'ISDATE', 'EPOCHTODATE', 'MARGINOFERROR', 'AVERAGE.WEIGHTED',
  'ADD', 'MINUS', 'MULTIPLY', 'DIVIDE', 'POW', 'EQ', 'NE', 'GT', 'GTE', 'LT', 'LTE', 'UMINUS', 'UPLUS', 'UNARY_PERCENT', 'CONTINUE']);

const usesGoogleOnly = (formula) => (String(formula).toUpperCase().match(/[A-Z_][A-Z0-9_.]*(?=\s*\()/g) || []).some((n) => GOOGLE_ONLY.has(n));

module.exports = { unwrapFormula, wrapFormula, computedFormula, usesGoogleOnly };
