'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tex = require('../common/latex');
const project = require('../main/latex');

test('completion context: citations, references, environments, files, commands', () => {
  assert.deepEqual(tex.completionContext('see \\cite{kn'), { kind: 'cite', prefix: 'kn', from: 10 });
  assert.equal(tex.completionContext('\\citep[p.~3]{a, b').prefix, 'b');
  assert.equal(tex.completionContext('\\parencite{').kind, 'cite');
  assert.equal(tex.completionContext('\\autocite[see][12]{x').prefix, 'x');
  assert.deepEqual(tex.completionContext('Eq.~\\eqref{eq:'), { kind: 'ref', prefix: 'eq:', from: 11 });
  assert.equal(tex.completionContext('\\cref{a,sec').prefix, 'sec');
  assert.equal(tex.completionContext('\\Cref{').kind, 'ref');
  assert.deepEqual(tex.completionContext('\\begin{fig'), { kind: 'begin', prefix: 'fig', from: 7 });
  assert.equal(tex.completionContext('\\end{').kind, 'end');
  assert.deepEqual(tex.completionContext('\\includegraphics[width=3cm]{fig'), { kind: 'file', command: 'includegraphics', prefix: 'fig', from: 28 });
  assert.equal(tex.completionContext('\\bibliography{a,re').prefix, 're');
  assert.equal(tex.completionContext('\\usepackage[utf8]{inp').kind, 'package');
  assert.equal(tex.completionContext('\\documentclass[11pt]{art').kind, 'class');
  assert.deepEqual(tex.completionContext('text \\fra'), { kind: 'command', prefix: 'fra', from: 5 });
  assert.equal(tex.completionContext('a line break \\\\'), null);
  assert.equal(tex.completionContext('plain words'), null);
  assert.equal(tex.completionContext('\\cite{done} more'), null);
});

test('reads .bib entries', () => {
  const bib = `@string{ieee = "IEEE"}
@article{smith2020,
  author = {Smith, Jane and Doe, John},
  title = {A {Study} of Things},
  journal = ieee,
  year = 2020
}
@online{web, title = "A page", date = {2021-05-01}}
@comment{ignored, x}`;
  const entries = tex.bibEntries(bib);
  assert.deepEqual(entries.map((e) => e.key), ['smith2020', 'web']);
  assert.equal(entries[0].title, 'A Study of Things');
  assert.equal(entries[0].author, 'Smith, Jane and Doe, John');
  assert.equal(entries[0].year, '2020');
  assert.equal(entries[0].line, 2);
  assert.equal(entries[1].year, '2021');
});

test('finds labels, commands, environments and the outline', () => {
  const doc = `\\documentclass{article}
\\newcommand{\\R}{\\mathbb{R}}
\\newcommand\\vect[1]{\\mathbf{#1}}
\\DeclareMathOperator{\\Tr}{Tr}
\\newtheorem{lemma}{Lemma}
\\begin{document}
\\section{Intro \\emph{here}}\\label{sec:intro}
% \\label{commented}
\\begin{equation}
  x = 1 \\label{eq:x}
\\end{equation}
\\subsection*{Details}
\\end{document}`;
  assert.deepEqual(tex.labels(doc).map((l) => [l.label, l.line, l.context]), [['sec:intro', 7, 'section: Intro here'], ['eq:x', 10, 'equation']]);
  assert.deepEqual(tex.userCommands(doc), [{ name: 'R', args: 0 }, { name: 'vect', args: 1 }, { name: 'Tr', args: 0 }]);
  assert.deepEqual(tex.userEnvironments(doc), ['lemma']);
  assert.deepEqual(tex.outline(doc).map((o) => [o.kind, o.title, o.line]), [['section', 'Intro here', 7], ['subsection', 'Details', 12]]);
  assert.equal(tex.openEnvironment('\\begin{document}\n\\begin{itemize}\\item a\n\\begin{enumerate}\\end{enumerate}'), 'itemize');
  assert.deepEqual(tex.references('\\input{chapters/a}\n\\bibliography{refs,more}\n\\includegraphics[width=1cm]{fig/x.png}'), { inputs: ['chapters/a'], bibs: ['refs', 'more'], graphics: ['fig/x.png'] });
});

test('picks the main file', () => {
  assert.equal(tex.findMain([{ path: 'chapters/a.tex', text: 'x' }, { path: 'paper.tex', text: '\\documentclass{article}' }]), 'paper.tex');
  assert.equal(tex.findMain([{ path: 'x.tex', text: '\\documentclass{a}' }, { path: 'main.tex', text: '\\documentclass{a}' }]), 'main.tex');
  assert.equal(tex.findMain([{ path: 'a.bib', text: '' }]), null);
  assert.equal(tex.texRootComment('% !TEX root = ../main.tex\n\\section{A}'), '../main.tex');
});

test('parses compile logs', () => {
  const log = `This is pdfTeX, Version 3.141592653
(./main.tex
LaTeX2e <2023-11-01>
(/usr/share/texlive/texmf-dist/tex/latex/base/article.cls
Document Class: article 2023/05/17 v1.4n Standard LaTeX document class
) (./chapters/intro.tex
! Undefined control sequence.
l.4 \\foo
         bar
)
./main.tex:12: Missing $ inserted.
<inserted text>
LaTeX Warning: Reference \`sec:x' on page 1 undefined on input line 20.

LaTeX Warning: Citation \`nobody' on page 1 undefined on input line 21.

Overfull \\hbox (12.0pt too wide) in paragraph at lines 30--31
Package natbib Warning: Citation \`a' on page 2 undefined on input line 3
(natbib)                in a long message.

)
Warning--I didn't find a database entry for "nobody"
error: something went wrong in the engine`;
  const issues = tex.parseLog(log, 'main.tex');
  const by = (m) => issues.find((i) => i.message.includes(m));
  assert.deepEqual(by('Undefined control'), { level: 'error', file: 'chapters/intro.tex', line: 4, message: 'Undefined control sequence. (\\foo)' });
  assert.deepEqual(by('Missing $'), { level: 'error', file: 'main.tex', line: 12, message: 'Missing $ inserted.' });
  assert.equal(by("sec:x").level, 'warning');
  assert.equal(by("sec:x").line, 20);
  assert.equal(by("sec:x").file, 'main.tex');
  assert.match(by("Citation `a'").message, /in a long message/);
  assert.equal(by('Overfull').level, 'info');
  assert.equal(by('Overfull').line, 30);
  assert.equal(by('BibTeX').level, 'warning');
  assert.equal(by('engine').level, 'error');
  assert.equal(issues[0].level, 'error');
});

test('SyncTeX: source line to PDF and back', () => {
  const sync = `SyncTeX Version:1
Input:1:/build/./main.tex
Input:2:/build/chapters/intro.tex
Output:pdf
Magnification:1000
Unit:1
X Offset:0
Y Offset:0
Content:
!100
{1
[1,10:4736286,6000000:30000000,40000000,0
(1,10:4736286,6000000:30000000,655360,0
h1,10:4736286,6000000:20000000,655360,0
)
(1,12:4736286,9000000:30000000,655360,0
x1,12:5000000,9000000
)
(2,3:4736286,12000000:30000000,655360,0
h2,3:4736286,12000000:20000000,655360,0
)
]
}1
{2
h1,40:4736286,6000000:20000000,655360,0
}2
Postamble:`;
  const parsed = tex.parseSynctex(sync);
  assert.equal(parsed.inputs['2'], '/build/chapters/intro.tex');
  const fwd = tex.synctexForward(parsed, 'chapters/intro.tex', 3);
  assert.equal(fwd.page, 1);
  assert.ok(Math.abs(fwd.x - 72) < 0.01, `x ${fwd.x}`);
  assert.ok(Math.abs(fwd.y - (12000000 - 655360) / 65781.76) < 0.01);
  assert.equal(tex.synctexForward(parsed, 'main.tex', 40).page, 2);
  const back = tex.synctexBackward(parsed, 1, 100, 12000000 / 65781.76 - 2);
  assert.deepEqual(back, { file: '/build/chapters/intro.tex', line: 3 });
  assert.equal(tex.synctexBackward(parsed, 1, 100, 6000000 / 65781.76).line, 10);
});

test('project files stay inside the project folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-latex-'));
  assert.equal(await project.scaffold(root), true);
  assert.equal(await project.scaffold(root), false);
  await project.create(root, 'chapters/one.tex', { text: '\\section{One}' });
  await project.write(root, 'chapters/one.tex', '\\section{Uno}');
  assert.equal((await project.read(root, 'chapters/one.tex')).text, '\\section{Uno}');
  const list = await project.list(root);
  assert.deepEqual(list.map((f) => f.path), ['chapters', 'chapters/one.tex', 'figures', 'main.tex', 'references.bib']);
  assert.equal(list.find((f) => f.path === 'references.bib').kind, 'bib');
  assert.equal(await project.mainFile(root), 'main.tex');
  assert.throws(() => project.inside(root, '../outside.tex'), /outside the project/);
  assert.equal(project.inside(root, '/x.tex'), path.join(root, 'x.tex'));
  await assert.rejects(project.write(root, '../../evil.tex', 'x'), /outside the project/);
  await assert.rejects(project.rename(root, 'main.tex', '../main.tex'), /outside the project/);
  const res = await project.rename(root, 'chapters/one.tex', 'chapters/first.tex');
  assert.equal(res.path, 'chapters/first.tex');
  const img = path.join(os.tmpdir(), `work-latex-img-${process.pid}.png`);
  fs.writeFileSync(img, Buffer.from('89504e470d0a1a0a', 'hex'));
  const added = await project.importPaths(root, [img], 'figures');
  assert.deepEqual(added.added, [`figures/${path.basename(img)}`]);
  assert.equal((await project.read(root, added.added[0])).mime, 'image/png');
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(img, { force: true });
});
