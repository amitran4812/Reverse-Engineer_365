import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { parseDelimited } from '../src/sheets/analysis/csv.js';
import { parseXlsx } from '../src/sheets/analysis/xlsx-stream.js';
import { parseParquet } from '../src/sheets/analysis/parquet.js';
import { evaluateColumn } from '../src/sheets/analysis/expr.js';
import { fit, polyFit } from '../src/sheets/analysis/fit.js';
import { Dataset, m4 } from '../src/sheets/analysis/engine.js';
import { SLIDE_H, SLIDE_W, buildSlide, gridFor, planSlide } from '../src/sheets/analysis/slide.js';
import { cellText } from '../src/sheets/analysis/columns.js';

const reader = (bytes, chunk = 1 << 20) => ({
  size: bytes.length,
  read: async (offset, length) => bytes.subarray(offset, offset + Math.min(length, chunk)),
});
const enc = (s) => new TextEncoder().encode(s);
const byName = (res) => Object.fromEntries(res.columns.map((c) => [c.name, c]));

test('CSV streams across chunk edges with quotes, dates, missing values and long numbers', async () => {
  const text = '﻿Date,Site,Value,Id\r\n2024-01-01,"A, north",1.5,12345678901234567\r\n2024-01-02,B,,2\r\n2024-01-03,"say ""hi""",-3e2,3\r\n';
  const res = await parseDelimited(reader(enc(text), 7));
  assert.equal(res.rows, 3);
  const c = byName(res);
  assert.equal(c.Date.type, 'date');
  assert.equal(c.Site.type, 'string');
  assert.deepEqual([0, 1, 2].map((i) => cellText(c.Site, i)), ['A, north', 'B', 'say "hi"']);
  assert.equal(c.Value.type, 'number');
  assert.ok(Number.isNaN(c.Value.data[1]));
  assert.equal(c.Value.data[2], -300);
  assert.equal(c.Id.type, 'number');
  assert.equal(cellText(c.Date, 1), '2024-01-02');
});

test('tab-separated text is detected and columns get unique names', async () => {
  const res = await parseDelimited(reader(enc('x\tx\ty\n1\t2\t3\n4\t5\t6\n')), { ext: 'tsv' });
  assert.deepEqual(res.columns.map((c) => c.name), ['x', 'x (2)', 'y']);
  assert.deepEqual(Array.from(res.columns[2].data), [3, 6]);
});

test('date columns with times show one format for every row', async () => {
  const res = await parseDelimited(reader(enc('t,v\n2024-01-01T00:00:00,1\n2024-01-01T00:00:10,2\n')));
  const t = res.columns[0];
  assert.equal(cellText(t, 0), '2024-01-01 00:00:00');
  assert.equal(cellText(t, 1), '2024-01-01 00:00:10');
});

test('xlsx sheets stream with shared strings, numbers and dates', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.addRow(['When', 'Name', 'Amount']);
  for (let i = 0; i < 500; i += 1) ws.addRow([new Date(Date.UTC(2024, 0, 1 + i)), `n${i % 7}`, i * 0.5]);
  wb.addWorksheet('Other').addRow(['only']);
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const res = await parseXlsx(reader(bytes));
  assert.deepEqual(res.sheets, ['Data', 'Other']);
  assert.equal(res.rows, 500);
  const c = byName(res);
  assert.equal(c.When.type, 'date');
  assert.equal(cellText(c.When, 31), '2024-02-01');
  assert.equal(cellText(c.Name, 8), 'n1');
  assert.equal(c.Amount.data[499], 249.5);
  const other = await parseXlsx(reader(bytes), { sheet: 'Other' });
  assert.equal(other.sheet, 'Other');
});

test('Parquet files load by row group', async () => {
  const n = 2500;
  const buf = parquetWriteBuffer({
    columnData: [
      { name: 'id', data: Int32Array.from({ length: n }, (_, i) => i), type: 'INT32' },
      { name: 'value', data: Float64Array.from({ length: n }, (_, i) => i / 4), type: 'DOUBLE' },
      { name: 'label', data: Array.from({ length: n }, (_, i) => `L${i % 3}`), type: 'STRING' },
    ],
    rowGroupSize: 1000,
  });
  const res = await parseParquet(reader(new Uint8Array(buf)));
  assert.equal(res.rows, n);
  const c = byName(res);
  assert.equal(c.id.data[2499], 2499);
  assert.equal(c.value.data[10], 2.5);
  assert.equal(cellText(c.label, 4), 'L1');
});

const sample = () => {
  const n = 1000;
  const x = Float64Array.from({ length: n }, (_, i) => i);
  const y = Float64Array.from(x, (v) => 2 + 3 * v);
  const dict = ['A', 'B'];
  const g = Int32Array.from({ length: n }, (_, i) => i % 2);
  return new Dataset({ name: 't', columns: [{ name: 'x', type: 'number', data: x }, { name: 'y', type: 'number', data: y }, { name: 'g', type: 'string', data: g, dict }] });
};

test('formulas evaluate whole columns', () => {
  const d = sample();
  const ctx = d.exprContext();
  const v = evaluateColumn('[y] - 3 * [x] + if([g] == "A", 1, 0)', ctx);
  assert.equal(v[0], 3);
  assert.equal(v[1], 2);
  const cs = evaluateColumn('cumsum([x])', ctx);
  assert.equal(cs[3], 6);
  assert.equal(evaluateColumn('mean([x])', ctx)[5], 499.5);
  assert.throws(() => evaluateColumn('[nope] + 1', ctx));
});

test('sigma, limits and grouped stats', () => {
  const d = sample();
  const ctx = d.exprContext();
  const sd = evaluateColumn('sigma([x])', ctx)[0];
  assert.ok(Math.abs(sd - 288.8194) < 1e-3);
  assert.equal(evaluateColumn('stddev([x])', ctx)[0], sd);
  assert.ok(Math.abs(evaluateColumn('ucl([x])', ctx)[0] - (499.5 + 3 * sd)) < 1e-9);
  assert.ok(Math.abs(evaluateColumn('lcl([x], 2)', ctx)[0] - (499.5 - 2 * sd)) < 1e-9);
  assert.ok(Math.abs(evaluateColumn('zscore([x])', ctx)[0] + 499.5 / sd) < 1e-9);
  const byG = evaluateColumn('avg([x]) over [g]', ctx);
  assert.equal(byG[0], 499);
  assert.equal(byG[1], 500);
  const sdG = evaluateColumn('StdDev([x]) OVER ([g])', ctx);
  assert.ok(Math.abs(sdG[0] - sdG[1]) < 1e-9 && sdG[0] > sd);
  assert.equal(evaluateColumn('count([x]) over [g]', ctx)[3], 500);
});

test('normal inverse and cdf', () => {
  const ctx = sample().exprContext();
  const near = (f, want, tol = 1e-6) => assert.ok(Math.abs(evaluateColumn(f, ctx)[0] - want) < tol, f);
  near('normsinv(0.975)', 1.959963985);
  near('normsinv(0.0013498980316301)', -3, 1e-9);
  near('normsinv(1e-9)', -5.997807015, 1e-8);
  near('norminv(0.5, 10, 2)', 10);
  near('norminv(0.8413447, 10, 2)', 12, 1e-5);
  near('normsdist(1.96)', 0.9750021);
  near('normdist(13, 10, 1)', 0.9986501);
  near('normsinv(normsdist(4.5))', 4.5, 1e-5);
});

test('split and text functions', () => {
  const dict = ['LOT1_W03_SITE7', 'LOT2_W11_SITE2', 'X'];
  const d = new Dataset({ name: 't', columns: [{ name: 'Tag', type: 'string', data: Int32Array.from([0, 1, 2, -1]), dict }] });
  const ctx = d.exprContext();
  const text = (v) => Array.from(v.codes, (c) => (c < 0 ? null : v.dict[c]));
  assert.deepEqual(text(evaluateColumn('split([Tag], "_", 2)', ctx)), ['W03', 'W11', null, null]);
  assert.deepEqual(text(evaluateColumn('split([Tag], "_", -1)', ctx)), ['SITE7', 'SITE2', 'X', null]);
  assert.deepEqual(text(evaluateColumn('lower(left([Tag], 4))', ctx)), ['lot1', 'lot2', 'x', null]);
  assert.deepEqual(Array.from(evaluateColumn('number(mid(split([Tag], "_", 2), 2))', ctx)).slice(0, 2), [3, 11]);
  assert.deepEqual(text(evaluateColumn('concat(split([Tag], "_", 1), "-", 9)', ctx)).slice(0, 2), ['LOT1-9', 'LOT2-9']);
});

test('spotfire statistics, ranking and OVER navigation', () => {
  const lot = ['A', 'B'];
  const d = new Dataset({ name: 't', columns: [
    { name: 'Lot', type: 'string', data: Int32Array.from([0, 0, 0, 1, 1, 1]), dict: lot },
    { name: 'Day', type: 'number', data: Float64Array.from([1, 2, 3, 1, 2, 2]) },
    { name: 'V', type: 'number', data: Float64Array.from([1, 2, 3, 10, 20, 40]) },
  ] });
  const ctx = d.exprContext();
  const col = (f) => Array.from(evaluateColumn(f, ctx));
  const one = (f) => evaluateColumn(f, ctx)[0];
  assert.equal(one('median([V])'), 6.5);
  assert.equal(one('percentile([V], 50)'), 6.5);
  assert.equal(one('q1([V])'), 2.25);
  assert.equal(one('iqr([V])'), 17.5 - 2.25);
  assert.equal(one('uniquecount([Lot])'), 2);
  assert.equal(one('Count()'), 6);
  assert.equal(one('var([V])'), evaluateColumn('sigma([V])', ctx)[0] ** 2);
  assert.deepEqual(col('Sum([V]) OVER AllPrevious([Day])'), [11, 73, 76, 11, 73, 73]);
  assert.deepEqual(col('Sum([V]) OVER Intersect([Lot], AllPrevious([Day]))'), [1, 3, 6, 10, 70, 70]);
  assert.deepEqual(col('Sum([V]) OVER Intersect([Lot], Previous([Day]))').map((x) => (Number.isNaN(x) ? null : x)), [null, 1, 2, null, 10, 10]);
  assert.deepEqual(col('Avg([V]) OVER Intersect([Lot], Next([Day]))').map((x) => (Number.isNaN(x) ? null : x)), [2, 3, null, 30, null, null]);
  assert.deepEqual(col('rank([V])'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(col('rank([V], "desc", [Lot])'), [3, 2, 1, 3, 2, 1]);
  assert.deepEqual(col('denserank([Day])'), [1, 2, 3, 1, 2, 2]);
  assert.deepEqual(col('rank([Day])'), [1, 3, 6, 1, 3, 3]);
  assert.deepEqual(col('rankreal([Day])'), [1.5, 4, 6, 1.5, 4, 4]);
  const firsts = evaluateColumn('first([Lot]) over [Day]', ctx);
  assert.deepEqual(Array.from(firsts.codes, (c) => firsts.dict[c]), ['A', 'A', 'A', 'A', 'A', 'A']);
  assert.throws(() => evaluateColumn('median([V]) OVER AllPrevious([Day])', ctx), /AllPrevious/);
});

test('spotfire text, logic, conversion and date functions', () => {
  const dict = ['LOT1_W03', 'lot2_w11', ' x '];
  const day = Date.UTC(2024, 0, 31);
  const d = new Dataset({ name: 't', columns: [
    { name: 'Tag', type: 'string', data: Int32Array.from([0, 1, 2]), dict },
    { name: 'When', type: 'date', data: Float64Array.from([day, Date.UTC(2024, 1, 29, 13, 45), NaN]) },
    { name: 'N', type: 'number', data: Float64Array.from([1, 2, NaN]) },
  ] });
  const ctx = d.exprContext();
  const text = (f) => { const v = evaluateColumn(f, ctx); return Array.from(v.codes, (c) => (c < 0 ? null : v.dict[c])); };
  const nums = (f) => Array.from(evaluateColumn(f, ctx), (x) => (Number.isNaN(x) ? null : x));
  assert.deepEqual(nums('find("_", [Tag])'), [5, 5, 0]);
  assert.deepEqual(text('substitute([Tag], "_", "-")'), ['LOT1-W03', 'lot2-w11', ' x ']);
  assert.deepEqual(text('rxextract([Tag], "W(\\d+)", 1, "i")'), ['03', '11', null]);
  assert.deepEqual(text('rxreplace([Tag], "\\d", "#")'), ['LOT#_W##', 'lot#_w##', ' x ']);
  assert.deepEqual(text('replace([Tag], 1, 3, "Run")'), ['Run1_W03', 'Run2_w11', 'Run']);
  assert.deepEqual(text('[Tag] & "/" & [N]'), ['LOT1_W03/1', 'lot2_w11/2', ' x /']);
  assert.deepEqual(text('case when [N] = 1 then "one" when [N] = 2 then "two" else "none" end'), ['one', 'two', 'none']);
  assert.deepEqual(text('case [N] when 1 then "a" else "b" end'), ['a', 'b', 'b']);
  assert.deepEqual(nums('[N] in (2, 3)'), [0, 1, null]);
  assert.deepEqual(nums('[N] is null'), [0, 0, 1]);
  assert.deepEqual(nums('[N] is not null'), [1, 1, 0]);
  assert.deepEqual(nums('sn([N], 0)'), [1, 2, 0]);
  assert.deepEqual(nums('integer("42.9")'), [42, 42, 42]);
  assert.deepEqual(text('string([N])'), ['1', '2', null]);
  assert.deepEqual(nums('year([When])'), [2024, 2024, null]);
  assert.deepEqual(nums('month([When])'), [1, 2, null]);
  assert.deepEqual(nums('quarter([When])'), [1, 1, null]);
  assert.deepEqual(nums('hour([When])'), [0, 13, null]);
  assert.deepEqual(nums('dayofweek([When])'), [3, 4, null]);
  assert.deepEqual(nums('week([When])'), [5, 9, null]);
  assert.deepEqual(nums('datepart("dy", [When])'), [31, 60, null]);
  assert.deepEqual(nums('datediff("day", [When], date("2024-03-01"))'), [30, 0, null]);
  assert.deepEqual(nums('datediff("month", date(2023, 12, 31), [When])'), [1, 2, null]);
  assert.equal(evaluateColumn('dateadd("month", 1, [When])', ctx)[0], Date.UTC(2024, 1, 29));
  d.addCalculated('Next', 'dateadd("day", 7, [When])');
  assert.equal(d.info().columns.find((c) => c.name === 'Next').type, 'date');
  d.addCalculated('Day', 'date([When])');
  assert.equal(d.column('Day').data[1], Date.UTC(2024, 1, 29));
  assert.deepEqual(nums('log(8, 2)'), [3, 3, 3]);
  assert.deepEqual(nums('divint(7, 2) + ceiling(1.2) + degrees(pi())'), [185, 185, 185]);
});

test('filters, calculated columns and marking work together', () => {
  const d = sample();
  d.addCalculated('z', '[x] * 2');
  d.setFilter('x', { kind: 'range', min: 100, max: 199 });
  assert.equal(d.info().filtered, 100);
  d.setFilter('g', { kind: 'values', values: ['A'] });
  assert.equal(d.info().filtered, 50);
  d.setExpressionFilters(['[z] < 300']);
  assert.equal(d.info().filtered, 25);
  d.markPlot({ type: 'scatter', x: 'x', y: [{ col: 'y' }] }, { x0: 100, x1: 120 }, 'replace');
  assert.equal(d.info().marked, 11);
  d.setRowset('marked');
  assert.equal(d.info().filtered, 11);
  d.resetFilters();
  assert.equal(d.info().filtered, 1000);
  const bars = d.aggregate({ type: 'bar', x: 'g', y: [{ col: 'x' }], agg: 'count' });
  assert.deepEqual(bars.labels, ['A', 'B']);
  assert.deepEqual(Array.from(bars.values), [500, 500]);
});

test('M4 keeps the extremes of each pixel column', () => {
  const n = 100000;
  const x = Float64Array.from({ length: n }, (_, i) => i);
  const y = Float64Array.from(x, (v) => Math.sin(v / 50));
  y[50001] = 10;
  const rows = Uint32Array.from(x);
  const out = m4(rows, x, y, 0, n - 1, 200);
  assert.ok(out.n <= 800);
  assert.ok(Math.max(...out.y) === 10);
  assert.ok(Math.min(...out.y) < -0.99);
});

test('fits recover their parameters', () => {
  const x = Float64Array.from({ length: 200 }, (_, i) => i / 10);
  const lin = polyFit(x, Float64Array.from(x, (v) => 1.5 + 0.25 * v), 1);
  assert.ok(Math.abs(lin.coef[0] - 1.5) < 1e-9 && Math.abs(lin.coef[1] - 0.25) < 1e-9);
  assert.ok(lin.r2 > 0.999999);
  const quad = fit(x, Float64Array.from(x, (v) => 1 - 2 * v + 0.5 * v * v), { model: 'poly', degree: 2 });
  assert.ok(Math.abs(quad.coef[2] - 0.5) < 1e-8);
  const ex = fit(x, Float64Array.from(x, (v) => 3 * Math.exp(-0.4 * v) + 0.01 * Math.sin(v * 7)), { model: 'expdecay' });
  assert.ok(ex.converged);
  assert.ok(ex.r2 > 0.999);
  const g = fit(x, Float64Array.from(x, (v) => 5 * Math.exp(-((v - 10) ** 2) / (2 * 1.5 ** 2))), { model: 'gauss' });
  assert.ok(g.r2 > 0.9999);
  const custom = fit(x, Float64Array.from(x, (v) => 2 * Math.sqrt(v) + 1), { model: 'custom', equation: 'a*sqrt(x)+b' });
  assert.ok(Math.abs(custom.coef[0] - 2) < 1e-4 && Math.abs(custom.coef[1] - 1) < 1e-4);
});

import { appendRows, joinColumns, matchColumns } from '../src/sheets/analysis/combine.js';

const table = async (text) => parseDelimited(reader(enc(text)));

test('Add Rows matches columns by name, maps the rest and labels the source', async () => {
  const a = await table('Site,Temp\nA,1\nB,2\n');
  const b = await table('site,Temperature,Extra\nC,3,x\n');
  const auto = matchColumns(a.columns, b.columns);
  assert.deepEqual(auto.map((m) => m.to), ['Site', null, null]);
  const res = appendRows(a.columns, a.rows, b.columns, b.rows, {
    mapping: [{ from: 'site', to: 'Site' }, { from: 'Temperature', to: 'Temp' }, { from: 'Extra', to: null }],
    source: { name: 'File', base: 'a.csv', add: 'b.csv' },
  });
  const c = byName(res);
  assert.equal(res.rows, 3);
  assert.deepEqual(Array.from(c.Temp.data), [1, 2, 3]);
  assert.deepEqual([0, 1, 2].map((i) => cellText(c.Site, i)), ['A', 'B', 'C']);
  assert.equal(cellText(c.Extra, 0), '');
  assert.equal(cellText(c.Extra, 2), 'x');
  assert.deepEqual([0, 2].map((i) => cellText(c.File, i)), ['a.csv', 'b.csv']);
});

test('Add Rows turns a column into text when the files disagree on its type', async () => {
  const a = await table('id,v\n1,10\n');
  const b = await table('id,v\nx7,20\n');
  const c = byName(appendRows(a.columns, a.rows, b.columns, b.rows));
  assert.equal(c.id.type, 'string');
  assert.deepEqual([0, 1].map((i) => cellText(c.id, i)), ['1', 'x7']);
  assert.equal(c.v.type, 'number');
});

test('Add Columns joins on keys with each join type', async () => {
  const a = await table('id,name\n1,one\n2,two\n3,three\n');
  const b = await table('key,score\n2,20\n3,30\n3,31\n4,40\n');
  const keys = [{ base: 'id', add: 'key' }];
  const left = joinColumns(a.columns, a.rows, b.columns, b.rows, { keys, how: 'left' });
  assert.equal(left.rows, 4);
  assert.deepEqual(Array.from(byName(left).score.data).map((v) => (Number.isNaN(v) ? null : v)), [null, 20, 30, 31]);
  assert.equal(joinColumns(a.columns, a.rows, b.columns, b.rows, { keys, how: 'inner' }).rows, 3);
  const full = byName(joinColumns(a.columns, a.rows, b.columns, b.rows, { keys, how: 'full' }));
  assert.deepEqual(Array.from(full.id.data), [1, 2, 3, 3, 4]);
  assert.equal(cellText(full.name, 4), '');
  const right = joinColumns(a.columns, a.rows, b.columns, b.rows, { keys, how: 'right' });
  assert.equal(right.rows, 4);
  assert.ok(!byName(right).key);
});

test('slide tables take filtered, marked or all rows narrowed by a formula', () => {
  const d = sample();
  d.setFilter('x', { kind: 'range', min: 0, max: 99 });
  const some = d.tableRows({ columns: ['x', 'g'], where: '[x] >= 10 and [x] <= 12', limit: 20 });
  assert.equal(some.total, 3);
  assert.deepEqual(some.columns, ['x', 'g']);
  assert.deepEqual(some.rows.map((r) => r[0]), ['10', '11', '12']);
  const all = d.tableRows({ source: 'all', columns: ['x'], where: '[x] > 990', limit: 5 });
  assert.equal(all.total, 9);
  assert.equal(all.rows.length, 5);
  assert.equal(d.tableRows({ columns: ['x'], limit: 3 }).total, 100);
  assert.throws(() => d.tableRows({ where: '[nope] > 1' }));
});

test('a slide fits the charts in a grid and the table beside or under them', () => {
  const inside = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= SLIDE_W && b.y + b.h <= SLIDE_H;
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const table = { columns: ['Year', 'Sales'], rows: [['2021', '5'], ['2022', '7']] };
  for (const count of [1, 2, 3, 4, 5, 7, 12]) {
    for (const t of [null, table, { columns: ['a', 'b', 'c', 'd', 'e', 'f'], rows: Array.from({ length: 30 }, () => ['1', '2', '3', '4', '5', '6']) }]) {
      const plan = planSlide({ count, table: t });
      assert.equal(plan.cells.length, count);
      for (const c of plan.cells) {
        assert.ok(inside(c), `cell inside slide for ${count}`);
        assert.ok(!overlap(c, plan.title));
        if (plan.table) assert.ok(!overlap(c, plan.table), `chart and table overlap for ${count}`);
      }
      plan.cells.forEach((a, i) => plan.cells.slice(i + 1).forEach((b) => assert.ok(!overlap(a, b))));
      if (t) assert.ok(inside(plan.table));
    }
  }
  assert.deepEqual(gridFor(4, 880, 430), { cols: 2, rows: 2 });
  const plan = planSlide({ count: 2, table });
  const slide = buildSlide({ title: 'Sales <2022>', plan, charts: [{ src: 'data:image/png;base64,AA', caption: 'A' }, { src: 'data:image/png;base64,AA', caption: 'B' }], table });
  assert.equal(slide.elements.filter((e) => e.type === 'image').length, 2);
  assert.equal(slide.elements[0].html, 'Sales &lt;2022&gt;');
  const tbl = slide.elements.find((e) => e.type === 'table');
  assert.deepEqual(tbl.rows[0], ['Year', 'Sales']);
  assert.equal(new Set(slide.elements.map((e) => e.id)).size, slide.elements.length);
  assert.equal(planSlide({ count: 0, table }).table.w, SLIDE_W - 72);
});

test('each visualization can have its own filters, limit and trellis panels', () => {
  const d = sample();
  const base = { type: 'scatter', x: 'x', y: [{ col: 'y' }] };
  d.setFilter('x', { kind: 'range', min: 0, max: 499 });
  assert.equal(d.plotRows(base).length, 500);
  assert.equal(d.plotRows({ ...base, ignoreFilters: true }).length, 1000);
  assert.equal(d.plotRows({ ...base, limit: '[x] < 100' }).length, 100);
  const own = d.plotRows({ ...base, vizFilters: { g: { kind: 'values', values: ['A'] } } });
  assert.ok(own.length > 0 && own.length < 500);
  assert.ok([...own].every((i) => d.column('g').dict[d.column('g').data[i]] === 'A'));
  const tr = d.trellis({ ...base, trellis: { by: 'g' } });
  assert.equal(tr.panels.length, d.column('g').dict.length);
  const sum = tr.panels.reduce((a, p) => a + d.plotRows({ ...base, panel: p.panel }).length, 0);
  assert.equal(sum, 500);
  const panel = d.scatter({ ...base, panel: tr.panels[0].panel }, null, { w: 300, h: 200 });
  assert.deepEqual(panel.bounds.x, d.scatter(base, null, { w: 300, h: 200 }).bounds.x);
  const grid = d.trellis({ ...base, trellis: { mode: 'grid', rows: 'g', cols: 'g', max: 4 } });
  assert.ok(grid.panels.length <= 4);
  d.markPlot({ ...base, limit: '[x] < 10' }, { x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9 }, 'replace');
  assert.equal(d.markCount, 10);
});

test('scatter extras: size and shape by, labels, line connection and reference stats', () => {
  const d = sample();
  const spec = {
    type: 'scatter', x: 'x', y: [{ col: 'y' }],
    marker: { sizeBy: 'x', shapeBy: 'g', jitter: 0.5 },
    labels: { show: 'all', col: 'g', max: 5 },
    connect: { on: true, by: 'g' },
    refLines: [{ axis: 'y', kind: 'mean' }],
  };
  const out = d.scatter(spec, null, { w: 300, h: 200 });
  const se = out.series[0];
  assert.equal(se.z.length, se.n);
  assert.ok(se.z.every((v) => v >= 0 && v <= 1));
  assert.ok(se.s.every((v) => v >= 0 && v < 7));
  assert.equal(out.labels.length, 5);
  assert.equal(out.paths.length, d.column('g').dict.length);
  for (const p of out.paths) for (let k = 1; k < p.n; k += 1) assert.ok(p.x[k] >= p.x[k - 1]);
  assert.ok(Math.abs(out.refStats.x.mean - 499.5) < 1e-9);
  const again = d.scatter(spec, null, { w: 300, h: 200 });
  assert.deepEqual(Array.from(again.series[0].x.slice(0, 20)), Array.from(se.x.slice(0, 20)));
});

test('waterfall, combination, treemap, KPI and parallel coordinates', () => {
  const d = sample();
  const wf = d.plotData({ type: 'waterfall', x: 'g', y: [{ col: 'x' }], agg: 'sum' });
  const n = wf.labels.length - 1;
  assert.equal(wf.labels[n], 'Total');
  assert.equal(wf.values[n], 499500);
  assert.equal(wf.starts[n - 1] + wf.values[n - 1], 499500);
  assert.equal(wf.cats[n], -1);
  const combo = d.plotData({ type: 'combo', x: 'g', y: [{ col: 'x' }, { col: 'y', axis: 'right' }], agg: 'mean' });
  assert.equal(combo.kind, 'bars');
  assert.equal(combo.lines.length, 1);
  assert.equal(combo.lines[0].values.length, combo.labels.length);
  assert.equal(combo.lines[0].axis, 'right');
  const tm = d.plotData({ type: 'treemap', x: 'g', y: [], agg: 'count' });
  assert.equal(tm.kind, 'treemap');
  assert.equal(Array.from(tm.values).reduce((a, b) => a + b, 0), 1000);
  const kpi = d.plotData({ type: 'kpi', x: null, y: [{ col: 'x' }], agg: 'mean' });
  assert.equal(kpi.labels.length, 1);
  assert.equal(kpi.values[0], 499.5);
  const pc = d.plotData({ type: 'parallel', y: [{ col: 'x' }, { col: 'y' }], color: 'g' });
  assert.equal(pc.cols.length, 2);
  assert.equal(pc.values.length, pc.n * 2);
  assert.ok(Array.from(pc.values).every((v) => v >= 0 && v <= 1));
  d.markPlot({ type: 'parallel', y: [{ col: 'x' }, { col: 'y' }] }, { col: 'x', lo: 0, hi: 99 }, 'replace');
  assert.equal(d.markCount, 100);
  d.markPlot({ type: 'treemap', x: 'g', y: [] }, { cats: [tm.cats[0]] }, 'replace');
  assert.equal(d.markCount, tm.values[0]);
});
