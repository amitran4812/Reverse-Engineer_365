import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { computeBook, format, FUNCTION_NAMES } from '../src/sheets/engine.js';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const { importXlsx, exportXlsx } = require('../main/formats/xlsx.js');
const { unwrapFormula } = require('../common/gsheets.js');

const cellsOf = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' ? v : { v: String(v) }]));
const run = (cells, env, extra = []) => computeBook({ sheets: [{ name: 'Sheet1', cells: cellsOf(cells) }, ...extra] }, env).Sheet1;
const show = (v) => (v && typeof v === 'object' ? format(v) : v);

test('arrays flow through operators and spill into neighbouring cells', () => {
  const v = run({
    A1: 10, A2: 20, A3: 30,
    B1: '=A1:A3*2',
    C1: '=ARRAYFORMULA(IF(A1:A3>15,"big","small"))',
    D1: '=SUM(A1:A3*A1:A3)',
    E1: '=SEQUENCE(2,3)',
    E5: '=B3+1',
    H1: '={1,2;3,4}',
    H4: '=SPLIT("x,y,z", ",")',
    J1: '=A1:A3', J2: 'blocker',
  });
  assert.deepEqual([v.get('B1'), v.get('B2'), v.get('B3')], [20, 40, 60]);
  assert.deepEqual([v.get('C1'), v.get('C3')], ['small', 'big']);
  assert.equal(v.get('D1'), 1400);
  assert.equal(v.get('G2'), 6);
  assert.equal(v.get('E5'), 61);
  assert.equal(v.get('I2'), 4);
  assert.equal(v.get('J4'), 'z');
  assert.equal(show(v.get('J1')), '#REF!');
});

test('Google Sheets functions: FILTER, SORT, UNIQUE, QUERY, REGEX, LAMBDA', () => {
  const v = run({
    A1: 'Name', B1: 'Team', C1: 'Score',
    A2: 'Ann', B2: 'Red', C2: 7,
    A3: 'Bob', B3: 'Blue', C3: 3,
    A4: 'Cy', B4: 'Red', C4: 9,
    E1: '=FILTER(A2:A4,C2:C4>5)',
    F1: '=SORT(A2:C4,3,FALSE)',
    J1: '=UNIQUE(B2:B4)',
    K1: '=QUERY(A1:C4,"select B, sum(C) group by B order by sum(C) desc",1)',
    N1: '=REGEXEXTRACT("Order #4521 shipped","\\d+")+1',
    N2: '=REGEXMATCH("hello@x.org","^\\S+@\\S+$")',
    N3: '=REGEXREPLACE("a1b22","\\d+","#")',
    N4: '=LET(t,SUM(C2:C4),t/COUNT(C2:C4))',
    N5: '=JOIN("|",BYROW(C2:C4,LAMBDA(r,r*10)))',
    N6: '=REDUCE(0,C2:C4,LAMBDA(acc,x,acc+x))',
    N7: '=COUNTUNIQUE(B2:B4)',
    N8: '=XLOOKUP("Cy",A2:A4,C2:C4)',
    N9: '=TEXTJOIN(", ",TRUE,FLATTEN(A2:A4))',
    N10: '=IFERROR(VLOOKUP("Zed",A2:C4,3,FALSE),"none")',
    N11: '=QUERY(A2:C4,"select A where C < 8 and B = \'Blue\'")',
  });
  assert.deepEqual([v.get('E1'), v.get('E2')], ['Ann', 'Cy']);
  assert.deepEqual([v.get('F1'), v.get('H1'), v.get('F3')], ['Cy', 9, 'Bob']);
  assert.deepEqual([v.get('J1'), v.get('J2')], ['Red', 'Blue']);
  assert.deepEqual([v.get('K1'), v.get('L1'), v.get('K2'), v.get('L2'), v.get('K3'), v.get('L3')], ['Team', 'sum Score', 'Red', 16, 'Blue', 3]);
  assert.equal(v.get('N1'), 4522);
  assert.equal(v.get('N2'), true);
  assert.equal(v.get('N3'), 'a#b#');
  assert.equal(v.get('N4'), 19 / 3);
  assert.equal(v.get('N5'), '70|30|90');
  assert.equal(v.get('N6'), 19);
  assert.equal(v.get('N7'), 2);
  assert.equal(v.get('N8'), 9);
  assert.equal(v.get('N9'), 'Ann, Bob, Cy');
  assert.equal(v.get('N10'), 'none');
  assert.equal(v.get('N11'), 'Bob');
});

test('math, text, date, stats and finance functions', () => {
  const v = run({
    A1: '=ROUND(2.345,2)', A2: '=MROUND(17,5)', A3: '=CEILING(4.1,0.5)', A4: '=MOD(-3,2)', A5: '=-2^2',
    B1: '=PROPER("hello wORLD")', B2: '=SUBSTITUTE("a-a-a","-","+",2)', B3: '=TEXT(0.256,"0.0%")', B4: '=TEXT(45000,"yyyy-mm-dd")', B5: '=LEN("héllo")',
    C1: '=DATE(2024,2,29)+1', C2: '=EOMONTH("2024-01-15",1)', C3: '=DATEDIF("2020-01-01","2024-03-01","Y")', C4: '=WEEKDAY("2024-01-07")', C5: '="2024-01-02"+1',
    D1: '=STDEV.S({2,4,4,4,5,5,7,9})', D2: '=PERCENTILE({1,2,3,4},0.3)', D3: '=ROUND(NORM.S.INV(0.975),4)', D4: '=MEDIAN(1,5,2,8)', D5: '=ROUND(CORREL({1,2,3},{2,4,7}),6)',
    E1: '=ROUND(PMT(0.05/12,60,-20000),2)', E2: '=ROUND(IRR({-100,30,40,50}),6)', E3: '=ROUND(NPER(0.01,-100,1000),4)', E4: '=ROUND(RATE(60,-377.42,20000)*12,4)', E5: '=ROUND(YIELD(DATE(2008,2,15),DATE(2016,11,15),0.0575,95.04287,100,2,0),4)',
    F1: '=CONVERT(100,"F","C")', F2: '=BIN2DEC("1111")', F3: '=DEC2HEX(255)', F4: '=ROMAN(1999)', F5: '=SUMPRODUCT({1,2},{3,4})',
  });
  assert.deepEqual([v.get('A1'), v.get('A2'), v.get('A3'), v.get('A4'), v.get('A5')], [2.35, 15, 4.5, 1, 4]);
  assert.deepEqual([v.get('B1'), v.get('B2'), v.get('B3'), v.get('B4'), v.get('B5')], ['Hello World', 'a-a+a', '25.6%', '2023-03-15', 5]);
  assert.deepEqual([v.get('C1'), v.get('C2'), v.get('C3'), v.get('C4'), v.get('C5')], [45352, 45351, 4, 1, 45294]);
  assert.equal(Number(v.get('D1').toFixed(6)), 2.13809);
  assert.equal(Number(v.get('D2').toFixed(6)), 1.9);
  assert.deepEqual([v.get('D3'), v.get('D4'), v.get('D5')], [1.96, 3.5, 0.993399]);
  assert.deepEqual([v.get('E1'), v.get('E2'), v.get('E3'), v.get('E4'), v.get('E5')], [377.42, 0.088963, 10.5886, 0.05, 0.065]);
  assert.equal(Number(v.get('F1').toFixed(6)), 37.777778);
  assert.deepEqual([v.get('F2'), v.get('F3'), v.get('F4'), v.get('F5')], [15, 'FF', 'MCMXCIX', 11]);
  assert.ok(FUNCTION_NAMES.length > 500);
});

test('references: whole and open columns, INDIRECT, OFFSET, INDEX ranges, other sheets', () => {
  const v = run({
    A1: 1, A2: 2, A3: 3, A4: 4,
    B1: '=SUM(A:A)', B2: '=SUM(A2:A)', B3: '=SUM(INDIRECT("A1:A"&2))', B4: '=SUM(OFFSET(A1,1,0,2,1))', B5: '=SUM(A1:INDEX(A1:A4,3))',
    B6: "='Data sheet'!B2*2", B7: '=ROW()', B8: '=COLUMNS(A1:D1)',
  }, {}, [{ name: 'Data sheet', cells: { B2: { v: '21' } } }]);
  assert.deepEqual([v.get('B1'), v.get('B2'), v.get('B3'), v.get('B4'), v.get('B5'), v.get('B6'), v.get('B7'), v.get('B8')], [10, 9, 3, 5, 6, 42, 7, 4]);
});

function fakeWeb(answers) {
  const asked = [];
  return {
    asked,
    get(kind, params) {
      asked.push([kind, params]);
      const a = answers[kind];
      return typeof a === 'function' ? a(params) : a;
    },
  };
}

test('GOOGLEFINANCE uses live data, and saved values while it loads or fails', () => {
  const quote = { price: 171.5, closeYest: 170, change: 1.5, changePct: 0.88, name: 'Alphabet Inc.', currency: 'USD', high52: 190 };
  const rows = [[45292 + 16 / 24, 1, 2, 0.5, 140, 1000], [45293 + 16 / 24, 2, 3, 1, 142, 2000]];
  const web = fakeWeb({ quote: { value: quote }, history: { value: rows } });
  const v = run({
    A1: '=GOOGLEFINANCE("NASDAQ:GOOG")',
    A2: '=GOOGLEFINANCE("NASDAQ:GOOG","name")',
    A3: '=GOOGLEFINANCE("GOOG","changepct")',
    C1: '=GOOGLEFINANCE("GOOG","close",DATE(2024,1,1),2)',
  }, { web });
  assert.equal(v.get('A1'), 171.5);
  assert.equal(v.get('A2'), 'Alphabet Inc.');
  assert.equal(v.get('A3'), 0.88);
  assert.deepEqual([v.get('C1'), v.get('D1'), v.get('D2'), v.get('D3')], ['Date', 'Close', 140, 142]);
  assert.deepEqual(web.asked.find(([k]) => k === 'history')[1], { symbol: 'GOOG', from: 45292, to: 45294, interval: 'daily' });

  // Offline: the file's saved results (formula cell r, spilled values in spillCache) show instead of errors.
  const offline = fakeWeb({ quote: { error: 'No connection' }, history: undefined });
  const book = {
    sheets: [{
      name: 'Sheet1',
      cells: { A1: { v: '=GOOGLEFINANCE("GOOG")', r: 165.2 }, B1: { v: '=A1*2' }, C1: { v: '=GOOGLEFINANCE("GOOG","close",DATE(2024,1,1),2)', r: 'Date' }, E1: { v: '=D2+1' } },
      spillCache: { D1: 'Close', C2: 45292.67, D2: 139, C3: 45293.67, D3: 141 },
    }],
  };
  const o = computeBook(book, { web: offline }).Sheet1;
  assert.deepEqual([o.get('A1'), o.get('B1'), o.get('C1'), o.get('D2'), o.get('E1')], [165.2, 330.4, 'Date', 139, 140]);
  // No saved value: the error says why.
  const none = run({ A1: '=GOOGLEFINANCE("GOOG")' }, { web: offline });
  assert.equal(none.get('A1').message, 'No connection');
});

test('IMPORTRANGE, IMPORTDATA and translation go through the data provider', () => {
  const web = fakeWeb({
    range: (p) => ({ value: p.range === 'Sheet1!A1:B2' ? [[1, 2], [3, 4]] : [[null]] }),
    text: { value: { text: 'a,b\n1,2\n3,4\n', type: 'text/csv' } },
    translate: { value: { text: 'hello', lang: 'es' } },
  });
  const v = run({
    A1: '=IMPORTRANGE("https://docs.google.com/spreadsheets/d/abc123/edit","Sheet1!A1:B2")',
    D1: '=SUM(IMPORTRANGE("abc123","Sheet1!A1:B2"))',
    E1: '=IMPORTDATA("https://example.com/x.csv")',
    H1: '=GOOGLETRANSLATE("hola","es","en")', H2: '=DETECTLANGUAGE("hola")',
  }, { web });
  assert.deepEqual([v.get('A1'), v.get('B2'), v.get('D1')], [1, 4, 10]);
  assert.deepEqual(web.asked.find(([k]) => k === 'range')[1], { key: 'abc123', range: 'Sheet1!A1:B2' });
  assert.deepEqual([v.get('E1'), v.get('F3')], ['a', 4]);
  assert.deepEqual([v.get('H1'), v.get('H2')], ['hello', 'es']);
});

test('Google Sheets .xlsx exports open with their real formulas and saved values', async () => {
  assert.deepEqual(unwrapFormula('IFERROR(__xludf.DUMMYFUNCTION("GOOGLEFINANCE(""NASDAQ:GOOG"",""price"")"),171.95)'), { formula: 'GOOGLEFINANCE("NASDAQ:GOOG","price")', cached: 171.95, computed: false });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Prices');
  ws.getCell('A1').value = { formula: 'IFERROR(__xludf.DUMMYFUNCTION("GOOGLEFINANCE(""NASDAQ:GOOG"",""price"")"),171.95)', result: 171.95 };
  ws.getCell('B1').value = { formula: 'IFERROR(__xludf.DUMMYFUNCTION("SPLIT(""a b"","" "")"),"a")', result: 'a' };
  ws.getCell('C1').value = { formula: 'IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"b")', result: 'b' };
  ws.getCell('D1').value = { formula: 'A1*2', result: 343.9 };
  const book = await importXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
  const s = book.sheets[0];
  assert.deepEqual(s.cells.A1, { v: '=GOOGLEFINANCE("NASDAQ:GOOG","price")', r: 171.95 });
  assert.equal(s.cells.B1.v, '=SPLIT("a b"," ")');
  assert.equal(s.cells.C1, undefined);
  assert.deepEqual(s.spillCache, { C1: 'b' });

  // Without live data the saved price shows; SPLIT recomputes and spills over the saved value.
  const v = computeBook(book, {}).Prices;
  assert.deepEqual([v.get('A1'), v.get('B1'), v.get('C1'), v.get('D1')], [171.95, 'a', 'b', 343.9]);

  // Saving wraps Google-only formulas and spilled cells the same way, so the file round-trips.
  const out = await exportXlsx({ sheets: [{ ...s, cells: { ...s.cells, B1: { ...s.cells.B1, r: 'a' } }, spilled: { C1: 'b' }, spillAnchors: ['B1'] }] });
  const back = await importXlsx(out);
  assert.equal(back.sheets[0].cells.A1.v, '=GOOGLEFINANCE("NASDAQ:GOOG","price")');
  assert.equal(back.sheets[0].cells.B1.v, '=SPLIT("a b"," ")');
  assert.equal(back.sheets[0].cells.D1.v, '=A1*2');
  assert.deepEqual(back.sheets[0].spillCache, { C1: 'b' });
});

test('market data: Google tickers map to the data service and quotes are read', async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/chart/NOPE') {
      res.statusCode = 404;
      res.end(JSON.stringify({ chart: { error: { description: 'No data found, symbol may be delisted' } } }));
      return;
    }
    const day = 86400;
    const t0 = 1704205800;
    res.end(JSON.stringify({
      chart: {
        result: [{
          meta: { currency: 'USD', regularMarketPrice: 142, regularMarketTime: t0 + day, longName: 'Alphabet Inc.', gmtoffset: -18000, fiftyTwoWeekHigh: 150, fiftyTwoWeekLow: 100, exchangeName: 'NMS' },
          timestamp: [t0, t0 + day],
          indicators: { quote: [{ open: [139, 141], high: [141, 143], low: [138, 140], close: [140, 142], volume: [1000, 2000] }] },
        }],
      },
    }));
  });
  await new Promise((r) => server.listen(0, r));
  process.env.REA_WEB_MOCK = `http://127.0.0.1:${server.address().port}`;
  delete require.cache[require.resolve('../main/webdata.js')];
  const web = require('../main/webdata.js');
  try {
    assert.equal(web.yahooSymbol('NASDAQ:GOOG'), 'GOOG');
    assert.equal(web.yahooSymbol('NSE:RELIANCE'), 'RELIANCE.NS');
    assert.equal(web.yahooSymbol('CURRENCY:USDINR'), 'USDINR=X');
    assert.equal(web.yahooSymbol('CURRENCY:BTCUSD'), 'BTC-USD');
    assert.equal(web.yahooSymbol('INDEXSP:.INX'), '^GSPC');
    assert.equal(web.yahooSymbol('NYSE:BRK.B'), 'BRK-B');
    const q = await web.data('quote', { symbol: 'NASDAQ:GOOG' });
    assert.deepEqual([q.price, q.closeYest, q.change, q.name, q.currency, q.high52], [142, 140, 2, 'Alphabet Inc.', 'USD', 150]);
    const rows = await web.data('history', { symbol: 'GOOG', from: 45293, to: 45296, interval: 'daily' });
    assert.deepEqual(rows.map((r) => [r[0], r[4]]), [[45293 + 16 / 24, 140], [45294 + 16 / 24, 142]]);
    await assert.rejects(web.data('quote', { symbol: 'NOPE' }), /couldn't find "NOPE"/);
  } finally {
    server.close();
    delete process.env.REA_WEB_MOCK;
  }
});
