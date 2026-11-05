'use strict';

// Opens spreadsheets through SheetJS: legacy and binary Excel (.xls, .xlsb),
// OpenDocument (.ods, .fods, .ots), Apple Numbers (.numbers), and .xlsm/.xltx
// as a fallback. Values and formulas come across; formatting doesn't.

const { unwrapFormula } = require('../../common/gsheets');
const { colName } = require('../../common/cellref');

// ---------- Spreadsheets through SheetJS (.xls, .ods, and .xlsm/.xltx as a fallback)

function plainValue(c) {
  if (c.t === 'b') return c.v ? 'TRUE' : 'FALSE';
  if (c.t === 'd' && c.v instanceof Date) return c.v.toISOString().slice(0, 10);
  if (c.t === 'e') return c.w || '';
  return c.v == null ? '' : String(c.v);
}

function importSheetJs(buffer) {
  const XLSX = require('@e965/xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: true, cellStyles: false });
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const cells = {};
    const spillCache = {};
    for (const [ref, c] of Object.entries(ws)) {
      if (ref.startsWith('!')) continue;
      if (c.f) {
        // Formulas keep their saved result as a fallback; Google's wrapped ones are unwrapped.
        const g = unwrapFormula(c.f);
        const r = c.v instanceof Date ? c.v.toISOString().slice(0, 10) : c.t === 'e' ? c.w : c.v;
        if (g.computed) {
          if (r !== undefined) spillCache[ref] = r ?? g.cached;
        } else cells[ref] = r === undefined && g.cached === undefined ? { v: `=${g.formula}` } : { v: `=${g.formula}`, r: r ?? g.cached };
        continue;
      }
      const v = plainValue(c);
      if (v !== '') cells[ref] = { v };
    }
    const cols = {};
    (ws['!cols'] || []).forEach((col, i) => {
      if (col?.wpx) cols[colName(i)] = Math.round(col.wpx);
    });
    return Object.keys(spillCache).length ? { name: name.slice(0, 31), cells, cols, spillCache } : { name: name.slice(0, 31), cells, cols };
  });
  return { sheets: sheets.length ? sheets : [{ name: 'Sheet1', cells: {}, cols: {} }] };
}

module.exports = { importSheetJs };
