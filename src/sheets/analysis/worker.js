// Background worker that owns the analysis table, so loading and crunching
// millions of rows never blocks the window. Files arrive either as a File
// (drag and drop) or as a handle the main process reads for us in chunks.

import { Dataset } from './engine.js';
import { columnsFromRows } from './columns.js';
import { parseDelimited } from './csv.js';
import { parseXlsx, xlsxSheets } from './xlsx-stream.js';
import { parseParquet } from './parquet.js';
import { JOINS, appendRows, joinColumns, matchColumns } from './combine.js';

let ds = null;
let side = null;
const reads = new Map();
let readSeq = 0;

function readerFor(source) {
  if (source.file) {
    const f = source.file;
    return { size: f.size, read: async (offset, length) => new Uint8Array(await f.slice(offset, offset + length).arrayBuffer()) };
  }
  return {
    size: source.size,
    read: (offset, length) => new Promise((resolve, reject) => {
      const id = ++readSeq;
      reads.set(id, { resolve, reject });
      self.postMessage({ read: { id, handle: source.handle, offset, length } });
    }),
  };
}

const extOf = (name) => String(name).split('.').pop().toLowerCase();

async function parseFile(source, opts, progress) {
  const reader = readerFor(source);
  const ext = opts.ext || extOf(source.name);
  const onProgress = (f, rows) => progress({ fraction: f, rows });
  let res;
  if (ext === 'parquet' || ext === 'parq') res = await parseParquet(reader, { onProgress });
  else if (ext === 'xlsx' || ext === 'xlsm') res = await parseXlsx(reader, { sheet: opts.sheet ?? 0, onProgress });
  else res = await parseDelimited(reader, { ext, onProgress });
  if (!res.columns.length) throw new Error('No columns were found in this file');
  return res;
}

// New table from combined columns; calculated columns and filters carry over.
function rebuild(columns, added) {
  const old = ds;
  ds = new Dataset({ name: old.name, columns, source: old.source });
  for (const c of old.cols.filter((x) => x.expr)) {
    try {
      ds.addCalculated(c.name, c.expr);
    } catch {
      // A formula whose columns are gone is dropped.
    }
  }
  ds.filters = new Map([...old.filters].filter(([n]) => ds.column(n)));
  try {
    ds.setExpressionFilters(old.exprFilters.map((f) => f.expr));
  } catch {
    ds.applyFilters();
  }
  side = null;
  return { info: ds.info(), added };
}

const ops = {
  async sheets(source) {
    return xlsxSheets(readerFor(source));
  },

  async load(source, opts = {}, progress) {
    const res = await parseFile(source, opts, progress);
    ds = new Dataset({ name: res.sheet ? `${source.name} (${res.sheet})` : source.name, columns: res.columns, source: { name: source.name, sheet: res.sheet || null } });
    return ds.info();
  },

  // A second table, held until it is added as rows or columns.
  async loadSide(source, opts = {}, progress) {
    const res = await parseFile(source, opts, progress);
    side = { name: res.sheet ? `${source.name} (${res.sheet})` : source.name, columns: res.columns, rows: res.rows };
    return {
      name: side.name,
      rows: side.rows,
      columns: side.columns.map((c) => ({ name: c.name, type: c.type })),
      match: matchColumns(ds.cols.filter((c) => !c.expr), side.columns),
      joins: JOINS,
    };
  },

  addRows(opts) {
    const base = ds.cols.filter((c) => !c.expr);
    const res = appendRows(base, ds.n, side.columns, side.rows, opts);
    return rebuild(res.columns, side.rows);
  },

  addColumns(opts) {
    const base = ds.cols.filter((c) => !c.expr);
    const res = joinColumns(base, ds.n, side.columns, side.rows, opts);
    return rebuild(res.columns, res.columns.length - base.length);
  },

  dropSide() {
    side = null;
  },

  fromRows(matrix, name) {
    const res = columnsFromRows(matrix);
    if (!res.columns.length || !res.rows) throw new Error('The sheet needs a header row and at least one row of data');
    ds = new Dataset({ name, columns: res.columns });
    return ds.info();
  },

  info: () => ds.info(),
  addCalculated: (name, expr) => {
    const col = ds.addCalculated(name, expr);
    return { name: col, info: ds.info() };
  },
  removeColumn: (name) => {
    ds.removeColumn(name);
    return ds.info();
  },
  setFilter: (name, spec) => {
    ds.setFilter(name, spec);
    return ds.info();
  },
  setExpressionFilters: (list) => {
    ds.setExpressionFilters(list);
    return ds.info();
  },
  setRowset: (mode) => {
    ds.setRowset(mode);
    return ds.info();
  },
  resetFilters: () => {
    ds.resetFilters();
    return ds.info();
  },
  restoreFilters: (state) => {
    ds.filters = new Map(Object.entries(state?.columns || {}).filter(([n]) => ds.column(n)));
    ds.setExpressionFilters(state?.expressions || []);
    return ds.info();
  },
  filterState: () => ds.filterState(),
  profile: (name) => ds.profile(name),
  clearMark: () => {
    ds.clearMark();
    return ds.info();
  },
  markPlot: (spec, sel, mode) => {
    ds.markPlot(spec, sel, mode);
    return ds.info();
  },
  markRows: (ids, mode) => {
    const set = new Set(ids);
    ds.applyMark((i) => set.has(i), mode);
    return ds.info();
  },
  plotData: (spec, view, size) => ds.plotData(spec, view, size),
  fit: (spec, fitSpec) => ds.fit(spec, fitSpec),
  rows: (start, count, source) => ds.rows(start, count, source),
  row: (i) => ds.row(i),
  tableRows: (opts) => ds.tableRows(opts),
  csv: (source, start, count) => ds.csv(source, start, count),
  summary: () => ds.summary(),
};

self.onmessage = async (e) => {
  const m = e.data;
  if (m.readResult) {
    const r = reads.get(m.readResult.id);
    reads.delete(m.readResult.id);
    if (m.readResult.error) r?.reject(new Error(m.readResult.error));
    else r?.resolve(m.readResult.data);
    return;
  }
  const { id, op, args } = m;
  try {
    if (!ops[op]) throw new Error(`Unknown operation ${op}`);
    if (!ds && !['load', 'fromRows', 'sheets'].includes(op)) throw new Error('Open a data file first');
    const result = await ops[op](...(args || []), (p) => self.postMessage({ id, progress: p }));
    const transfer = [...new Set(result?.transfer || [])];
    if (result?.transfer) delete result.transfer;
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
