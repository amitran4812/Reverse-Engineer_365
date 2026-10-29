'use strict';

// Converts between the spreadsheet model and .xlsx / .csv files.
//
// Model: { sheets: [{ name, cells: { A1: { v, r, s } }, cols: { A: px } }] }
//   v = what the user typed ("=SUM(A1:A3)", "42", "hello")
//   r = computed result (sent by the renderer so files carry cached values)
//   s = style { b, i, u, color, bg, align, fmt }

const ExcelJS = require('exceljs');
const { colIndex, colName, parseCsv, parseRef, toCsv } = require('../../common/cellref');
const { hex } = require('./docx');

const NUMFMT = {
  number: '#,##0.00',
  currency: '"$"#,##0.00',
  percent: '0.00%',
  date: 'yyyy-mm-dd',
  integer: '0',
};
const FMT_BY_NUMFMT = Object.fromEntries(Object.entries(NUMFMT).map(([k, v]) => [v, k]));

function guessFmt(numFmt) {
  if (!numFmt) return undefined;
  if (FMT_BY_NUMFMT[numFmt]) return FMT_BY_NUMFMT[numFmt];
  if (numFmt.includes('%')) return 'percent';
  if (/[$€£¥]/.test(numFmt)) return 'currency';
  if (/[dmy]{2}/i.test(numFmt)) return 'date';
  if (numFmt.includes('0.0')) return 'number';
  return undefined;
}

function scalar(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v);
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s.trim())) return Number(s);
  if (/^(true|false)$/i.test(s.trim())) return s.trim().toUpperCase() === 'TRUE';
  return s;
}

async function exportXlsx(model) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Work';
  for (const sheet of model.sheets) {
    const ws = wb.addWorksheet(sheet.name || 'Sheet');
    for (const [col, width] of Object.entries(sheet.cols || {})) {
      ws.getColumn(colIndex(col) + 1).width = Math.max(4, Math.round(width / 7));
    }
    for (const [ref, cell] of Object.entries(sheet.cells || {})) {
      if (!parseRef(ref)) continue;
      const c = ws.getCell(ref);
      const v = cell.v ?? '';
      if (typeof v === 'string' && v.startsWith('=') && v.length > 1) {
        const result = typeof cell.r === 'string' && cell.r.startsWith('#') ? undefined : scalar(cell.r);
        c.value = { formula: v.slice(1), result: result ?? undefined };
      } else {
        const sv = scalar(v);
        if (cell.s?.fmt === 'date' && typeof sv === 'string' && !Number.isNaN(Date.parse(sv))) {
          c.value = new Date(sv);
        } else {
          c.value = sv;
        }
      }
      const s = cell.s || {};
      if (s.b || s.i || s.u || s.color) {
        c.font = { bold: !!s.b, italic: !!s.i, underline: !!s.u, ...(hex(s.color) ? { color: { argb: `FF${hex(s.color)}` } } : {}) };
      }
      if (hex(s.bg)) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex(s.bg)}` } };
      if (s.align) c.alignment = { horizontal: s.align };
      if (NUMFMT[s.fmt]) c.numFmt = NUMFMT[s.fmt];
    }
  }
  if (!model.sheets.length) wb.addWorksheet('Sheet1');
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function argbToCss(color) {
  const argb = color?.argb;
  if (!argb || argb.length < 6) return undefined;
  return `#${argb.slice(-6)}`;
}

function cellInput(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.formula || v.sharedFormula) return `=${cell.formula || v.formula}`;
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.error) return v.error;
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(v);
}

async function importXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const cells = {};
    const cols = {};
    ws.columns?.forEach((col, i) => {
      if (col.width) cols[colName(i)] = Math.round(col.width * 7);
    });
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cellInput(cell);
        const s = {};
        if (cell.font?.bold) s.b = true;
        if (cell.font?.italic) s.i = true;
        if (cell.font?.underline) s.u = true;
        if (argbToCss(cell.font?.color)) s.color = argbToCss(cell.font.color);
        if (cell.fill?.type === 'pattern' && argbToCss(cell.fill.fgColor)) s.bg = argbToCss(cell.fill.fgColor);
        if (['left', 'center', 'right'].includes(cell.alignment?.horizontal)) s.align = cell.alignment.horizontal;
        const fmt = guessFmt(cell.numFmt);
        if (fmt) s.fmt = fmt;
        if (v === '' && !Object.keys(s).length) return;
        cells[cell.address] = Object.keys(s).length ? { v, s } : { v };
      });
    });
    sheets.push({ name: ws.name, cells, cols });
  });
  return { sheets: sheets.length ? sheets : [{ name: 'Sheet1', cells: {}, cols: {} }] };
}

function importCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const cells = {};
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v !== '') cells[`${colName(c)}${r + 1}`] = { v };
  }));
  return { sheets: [{ name: 'Sheet1', cells, cols: {} }] };
}

// CSV holds a single sheet of values, so export computed results.
function exportCsv(model, sheetIndex = 0) {
  const sheet = model.sheets[sheetIndex] || model.sheets[0];
  let maxR = -1;
  let maxC = -1;
  const grid = new Map();
  for (const [ref, cell] of Object.entries(sheet?.cells || {})) {
    const p = parseRef(ref);
    if (!p) continue;
    maxR = Math.max(maxR, p.row);
    maxC = Math.max(maxC, p.col);
    const v = cell.v ?? '';
    grid.set(ref, typeof v === 'string' && v.startsWith('=') ? (cell.r ?? '') : v);
  }
  const rows = [];
  for (let r = 0; r <= maxR; r += 1) {
    const row = [];
    for (let c = 0; c <= maxC; c += 1) row.push(grid.get(`${colName(c)}${r + 1}`) ?? '');
    rows.push(row);
  }
  return toCsv(rows);
}

// OpenDocument spreadsheet through SheetJS: values and formulas, no styling.
function exportOds(model) {
  const XLSX = require('@e965/xlsx');
  const wb = XLSX.utils.book_new();
  for (const sheet of model.sheets) {
    const ws = {};
    let maxR = 0;
    let maxC = 0;
    for (const [ref, cell] of Object.entries(sheet.cells || {})) {
      const v = String(cell.v ?? '');
      if (v === '') continue;
      const { row: r, col: c } = parseRef(ref);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
      if (v.startsWith('=')) ws[ref] = { t: 'n', v: 0, f: v.slice(1) };
      else if (/^-?\d+(\.\d+)?$/.test(v)) ws[ref] = { t: 'n', v: Number(v) };
      else ws[ref] = { t: 's', v };
    }
    ws['!ref'] = `A1:${colName(maxC)}${maxR + 1}`;
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'ods' });
}

module.exports = { exportXlsx, importXlsx, importCsv, exportCsv, exportOds };
