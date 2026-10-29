'use strict';

// A1-style cell reference helpers shared by the spreadsheet UI and file I/O.

function colName(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseRef(ref) {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(String(ref).trim());
  if (!m) return null;
  return { col: colIndex(m[1]), row: Number(m[2]) - 1 };
}

function refName(row, col) {
  return `${colName(col)}${row + 1}`;
}

// Normalised rectangle {r0,c0,r1,c1} from two corners.
function rect(a, b = a) {
  return {
    r0: Math.min(a.row, b.row),
    c0: Math.min(a.col, b.col),
    r1: Math.max(a.row, b.row),
    c1: Math.max(a.col, b.col),
  };
}

function rangeName(r) {
  const a = refName(r.r0, r.c0);
  const b = refName(r.r1, r.c1);
  return a === b ? a : `${a}:${b}`;
}

// Rewrites every A1-style reference in a formula. fn receives
// {row, col, rowAbs, colAbs} and returns the new {row, col}, or null for #REF!.
// References qualified with a sheet name (Sheet2!A1) are left alone.
const REF_RE = /("[^"]*")|(?<![A-Za-z_\d$!.])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_!])/g;

function mapRefs(formula, fn) {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula;
  return formula.replace(REF_RE, (all, str, cAbs, col, rAbs, row) => {
    if (str) return str;
    const next = fn({ row: Number(row) - 1, col: colIndex(col), rowAbs: !!rAbs, colAbs: !!cAbs });
    if (!next) return '#REF!';
    return `${cAbs}${colName(next.col)}${rAbs}${next.row + 1}`;
  });
}

// Shift relative references by (dRow, dCol), used by copy/paste and fill.
function shiftFormula(formula, dRow, dCol) {
  return mapRefs(formula, (p) => ({
    row: p.rowAbs ? p.row : Math.max(0, p.row + dRow),
    col: p.colAbs ? p.col : Math.max(0, p.col + dCol),
  }));
}

function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toCsv(rows, delimiter = ',') {
  return rows
    .map((r) => r.map((v) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r\t]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(delimiter))
    .join('\r\n');
}

module.exports = { colName, colIndex, parseRef, refName, rect, rangeName, mapRefs, shiftFormula, parseCsv, toCsv };
