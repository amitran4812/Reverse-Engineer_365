'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const diff = require('../common/diff');
const tables = require('../common/latex-table');

test('word changes find each edit and accept or reject them one by one', () => {
  const a = 'Hello world.\nThe cat sat on the mat.\nEnd.\n';
  const b = 'Hello brave world.\nThe dog sat on a mat.\nNew line\nEnd.\n';
  const ch = diff.wordChanges(a, b);
  assert.deepEqual(ch.map((c) => [b.slice(c.from, c.to), c.deleted]), [['brave ', ''], ['dog', 'cat'], ['a', 'the'], ['\nNew line', '']]);
  let accepted = a;
  for (const c of [...ch].reverse()) accepted = diff.acceptChange(accepted, b, c);
  assert.equal(accepted, b);
  let rejected = b;
  for (const c of [...ch].reverse()) rejected = diff.rejectChange(a, rejected, c);
  assert.equal(rejected, a);
  assert.deepEqual(diff.wordChanges(a, a), []);
});

test('word changes keep LaTeX commands whole', () => {
  const ch = diff.wordChanges('see \\textbf{x}', 'see \\emph{x}');
  assert.equal(ch.length, 1);
  assert.equal(ch[0].deleted, '\\textbf');
});

test('line diff and stats for history', () => {
  const hunks = diff.lineDiff('a\nb\nc', 'a\nB\nc\nd');
  assert.deepEqual(hunks.map((x) => [x.type, x.lines.join('|')]), [['same', 'a'], ['del', 'b'], ['add', 'B'], ['same', 'c'], ['add', 'd']]);
  assert.deepEqual(diff.lineStats('a\nb\nc', 'a\nB\nc\nd'), { added: 2, removed: 1 });
  const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
  const changed = big.replace('line 1500', 'line X');
  assert.deepEqual(diff.lineStats(big, changed), { added: 1, removed: 1 });
});

test('reads a table back into rows, alignment, caption and label', () => {
  const src = `\\begin{table}[ht]
  \\centering
  \\begin{tabular}{|l|c|p{2cm}|}
    \\hline
    Name & Value \\& more & Note \\\\ \\hline
    a & {x & y} & 50\\% % a comment
    \\\\ \\hline
    b & 2 & \\\\
  \\end{tabular}
  \\caption{Results of \\emph{all}}
  \\label{tab:res}
\\end{table}`;
  const t = tables.parseTable(src);
  assert.deepEqual(t.rows, [['Name', 'Value \\& more', 'Note'], ['a', '{x & y}', '50\\%'], ['b', '2', '']]);
  assert.deepEqual(t.align, ['l', 'c', 'l']);
  assert.equal(t.style, 'grid');
  assert.equal(t.caption, 'Results of \\emph{all}');
  assert.equal(t.label, 'tab:res');
  assert.equal(t.placement, 'ht');
  assert.equal(t.spec, '|l|c|p{2cm}|');
  const out = tables.makeTable(t);
  assert.match(out, /\\begin\{tabular\}\{\|l\|c\|p\{2cm\}\|\}/);
  assert.deepEqual(tables.parseTable(out).rows, t.rows);
  assert.equal(tables.tableAround(`x\n${src}\ny`, 40).from, 2);
  assert.equal(tables.tableAround('no table here', 3), null);
});

test('writes booktabs tables and reads pasted spreadsheet cells', () => {
  const out = tables.makeTable({ rows: [['A', 'B'], ['1', '2']], align: ['l', 'r'], caption: 'Cap', label: 'tab:x' });
  assert.equal(out, '\\begin{table}[htbp]\n\t\\centering\n\t\\begin{tabular}{lr}\n\t\t\\toprule\n\t\tA & B \\\\\n\t\t\\midrule\n\t\t1 & 2 \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\t\\caption{Cap}\n\t\\label{tab:x}\n\\end{table}\n');
  assert.deepEqual(tables.parsePasted('a\tb\n"q,1"\t2\n'), [['a', 'b'], ['q,1', '2']]);
  assert.deepEqual(tables.parsePasted('x,"y ""z"""\n1,2'), [['x', 'y "z"'], ['1', '2']]);
  assert.equal(tables.escapeCell('50% & $5_x'), '50\\% \\& \\$5\\_x');
});
