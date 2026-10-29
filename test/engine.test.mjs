import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBook, format, literal } from '../src/sheets/engine.js';

const run = (cells, extra = []) => computeBook({ sheets: [{ name: 'Sheet1', cells }, ...extra] }).Sheet1;

test('basic arithmetic, ranges and dependencies', () => {
  const v = run({ A1: { v: '10' }, A2: { v: '20' }, A3: { v: '=SUM(A1:A2)' }, B1: { v: '=A3*2' }, B2: { v: '=AVERAGE(A1:A3)' } });
  assert.equal(v.get('A3'), 30);
  assert.equal(v.get('B1'), 60);
  assert.equal(v.get('B2'), 20);
});

test('errors propagate and cycles are caught', () => {
  const v = run({ A1: { v: '=1/0' }, A2: { v: '=A1+1' }, B1: { v: '=B2' }, B2: { v: '=B1' }, C1: { v: '=SUM(' }, C2: { v: '=NOPE(1)' }, C3: { v: '=IFERROR(A1,"ok")' } });
  assert.equal(format(v.get('A1')), '#DIV/0!');
  assert.equal(format(v.get('A2')), '#DIV/0!');
  assert.equal(format(v.get('B1')), '#REF!');
  assert.equal(format(v.get('C1')), '#ERROR!');
  assert.equal(format(v.get('C2')), '#NAME?');
  assert.equal(v.get('C3'), 'ok');
});

test('lookup, text, logic and added functions', () => {
  const v = run({
    A1: { v: 'apple' }, B1: { v: '3' }, A2: { v: 'pear' }, B2: { v: '5' },
    C1: { v: '=VLOOKUP("pear",A1:B2,2,FALSE)' },
    C2: { v: '=MATCH("pear",A1:A2,0)' },
    C3: { v: '=XLOOKUP("apple",A1:A2,B1:B2)' },
    C4: { v: '=ROUND(PMT(0.05/12,60,-20000),2)' },
    C5: { v: '=IF(B2>4,"big","small")&"!"' },
    C6: { v: '=SUMIF(B1:B2,">4")' },
    C7: { v: '=UPPER(A1)' },
  });
  assert.equal(v.get('C1'), 5);
  assert.equal(v.get('C2'), 2);
  assert.equal(v.get('C3'), 3);
  assert.equal(v.get('C4'), 377.42);
  assert.equal(v.get('C5'), 'big!');
  assert.equal(v.get('C6'), 5);
  assert.equal(v.get('C7'), 'APPLE');
});

test('cross-sheet references', () => {
  const v = run({ A1: { v: '=Data!A1*2' } }, [{ name: 'Data', cells: { A1: { v: '21' } } }]);
  assert.equal(v.get('A1'), 42);
});

test('literals and number formats', () => {
  assert.equal(literal('1,234.5'), 1234.5);
  assert.equal(literal('12%'), 0.12);
  assert.equal(literal('$1,000'), 1000);
  assert.equal(literal('TRUE'), true);
  assert.equal(literal('007a'), '007a');
  assert.equal(format(1234.5, { fmt: 'currency' }), '$1,234.50');
  assert.equal(format(-3, { fmt: 'currency' }), '-$3.00');
  assert.equal(format(0.256, { fmt: 'percent', dec: 1 }), '25.6%');
  assert.equal(format(45000, { fmt: 'date' }), '2023-03-15');
  assert.equal(format(0.1 + 0.2), '0.3');
});

test('functions added on top of the parser', () => {
  const cells = {
    A1: { v: 'East' }, B1: { v: '10' }, A2: { v: 'West' }, B2: { v: '20' }, A3: { v: 'East' }, B3: { v: '30' }, A4: { v: '' },
    C1: { v: '=SUMIFS(B1:B3,A1:A3,"East")' },
    C2: { v: '=COUNTIFS(A1:A3,"E*",B1:B3,">15")' },
    C3: { v: '=AVERAGEIFS(B1:B3,A1:A3,"<>West")' },
    C4: { v: '=MEDIAN(B1:B3)' },
    C5: { v: '=ROUND(STDEV(B1:B3),4)' },
    C6: { v: '=LARGE(B1:B3,1)&"/"&SMALL(B1:B3,1)&"/"&RANK(20,B1:B3)' },
    C7: { v: '=SUBSTITUTE("a-b-c","-","+")' },
    C8: { v: '=TEXTJOIN(", ",TRUE,A1:A4)' },
    C9: { v: '=CHOOSE(2,"x","y","z")' },
    C10: { v: '=ROUND(FV(0.05,10,-100),2)' },
    C11: { v: '=VALUE("1,234")+1' },
  };
  const v = run(cells);
  assert.equal(v.get('C1'), 40);
  assert.equal(v.get('C2'), 1);
  assert.equal(v.get('C3'), 20);
  assert.equal(v.get('C4'), 20);
  assert.equal(v.get('C5'), 10);
  assert.equal(v.get('C6'), '30/10/2');
  assert.equal(v.get('C7'), 'a+b+c');
  assert.equal(v.get('C8'), 'East, West, East');
  assert.equal(v.get('C9'), 'y');
  assert.equal(v.get('C10'), 1257.79);
  assert.equal(v.get('C11'), 1235);
});
