import test from 'node:test';
import assert from 'node:assert/strict';
import { findGraphic, mathText, readLatex, texText } from '../src/docs/tex-deck.js';
import { cleanDeck, deckPrompt, outlineText, plainDeck } from '../src/docs/deck.js';

const main = String.raw`\documentclass{article}
\usepackage{amsmath,graphicx}
\graphicspath{{figs/}}
\newcommand{\R}{\mathbb{R}}
\newcommand{\ours}{FastNet}
\title{Learning to See \\ in the Dark}
\author{A. Author\thanks{Lab} \and B. Writer}
\begin{document}
\maketitle
\begin{abstract}
We present \ours{}, which maps $f:\R^n\to\R$ quickly~\cite{smith}. % not this
\end{abstract}
\section{Introduction}\label{sec:intro}
Night photos are ` + "``noisy''" + String.raw` --- see Figure~\ref{fig:a} and Eq.~\eqref{eq:loss}.

A second paragraph with \textbf{bold} and $x^2 + \alpha_i$.
\begin{itemize}
  \item First point
  \item[Key] Second point
  \begin{enumerate}\item nested\end{enumerate}
\end{itemize}
\input{sections/method}
\begin{figure}[t]
\includegraphics[width=.5\linewidth]{arch}
\caption{The \ours{} model.}\label{fig:a}
\end{figure}
\begin{table}[h]
\caption{Results.}
\begin{tabular}{l|cc}
\toprule
Model & Acc & Size \\ \midrule
ResNet & 76.1 & 25M \\
\multicolumn{2}{c}{Ours} & 5M \\
\bottomrule
\end{tabular}
\end{table}
\begin{theorem}[Main]
It converges.
\end{theorem}
\end{document}`;
const method = String.raw`\section{Method}
\subsection{Loss}
\begin{equation}
L = \sum_i (y_i - \hat y_i)^2 \label{eq:loss}
\end{equation}
\begin{align}
a &= b \nonumber\\
c &= d \label{eq:c}
\end{align}
See \cref{eq:c}.`;
const files = [{ path: 'main.tex', text: main }, { path: 'sections/method.tex', text: method }];

test('a LaTeX project is read into title, sections, lists, figures, tables and equations', () => {
  const doc = readLatex(files, 'main.tex');
  assert.equal(doc.title, 'Learning to See in the Dark');
  assert.equal(doc.subtitle, 'A. Author, B. Writer');
  assert.deepEqual(doc.blocks.map((b) => b.type), ['heading', 'para', 'heading', 'para', 'heading', 'para', 'para', 'list', 'heading', 'heading', 'math', 'math', 'para', 'image', 'para', 'table', 'para']);
  assert.deepEqual(doc.blocks.filter((b) => b.type === 'heading').map((b) => [b.level, b.text]), [[1, 'Learning to See in the Dark'], [2, 'Abstract'], [2, 'Introduction'], [2, 'Method'], [3, 'Loss']]);
  assert.equal(doc.blocks[3].text, 'We present FastNet, which maps f:ℝⁿ → ℝ quickly.');
  assert.equal(doc.blocks[5].text, 'Night photos are “noisy” — see Figure 1 and Eq. (1).');
  assert.equal(doc.blocks[6].text, 'A second paragraph with bold and x² + αᵢ.');
  assert.deepEqual(doc.blocks[7].items, [{ text: 'First point', depth: 0 }, { text: 'Key: Second point', depth: 0 }, { text: 'nested', depth: 1 }]);
  assert.equal(doc.blocks[12].text, 'See Equation (2).');
  assert.deepEqual(doc.images, [{ path: 'arch', alt: 'The FastNet model.' }]);
  assert.deepEqual(doc.tables[0], [['Model', 'Acc', 'Size'], ['ResNet', '76.1', '25M'], ['Ours', '', '5M']]);
  assert.equal(doc.equations[0].tex, 'L = \\sum_i (y_i - \\hat y_i)^2');
  assert.match(doc.equations[1].tex, /^\\begin\{aligned\}a &= b \\\\\s*c &= d\\end\{aligned\}$/);
  assert.equal(doc.blocks.at(-1).text, 'Theorem (Main): It converges.');
  assert.match(doc.macros, /\\newcommand\{\\R\}\{\\mathbb\{R\}\}/);
});

test('only the selected part is read when there is a selection', () => {
  const doc = readLatex(files, 'main.tex', { fragment: 'See Figure~\\ref{fig:a}.\n\\begin{equation}E=mc^2\\end{equation}' });
  assert.deepEqual(doc.blocks, [{ type: 'para', text: 'See Figure 1.' }, { type: 'math', index: 1 }]);
});

test('figures are found through \\graphicspath and the usual extensions', () => {
  const paths = ['main.tex', 'figs/arch.PNG', 'figs/plot.pdf', 'img/x.jpg'];
  assert.equal(findGraphic('arch', paths, { graphicspath: ['figs'] }), 'figs/arch.PNG');
  assert.equal(findGraphic('figs/plot', paths), 'figs/plot.pdf');
  assert.equal(findGraphic('img/x.jpg', paths), 'img/x.jpg');
  assert.equal(findGraphic('missing', paths), null);
});

test('inline TeX reads as plain text', () => {
  assert.equal(mathText('\\frac{1}{2} x^{2} + \\sqrt{a+b} \\leq \\hat{y}_{ij}'), '1/2 x² + √(a+b) ≤ ŷᵢⱼ');
  assert.equal(texText('Caf\\\'e \\& bar, 50\\% off \\href{https://x.org}{here}\\footnote{no}.'), 'Café & bar, 50% off here.');
});

test('papers go to the deck with their equations', () => {
  const doc = readLatex(files, 'main.tex');
  assert.match(outlineText(doc), /\[Equation 1: L = \\sum_i/);
  const plain = plainDeck(doc, 'paper');
  assert.equal(plain.slides[0].title, 'Learning to See in the Dark');
  assert.deepEqual(plain.slides.filter((s) => s.layout === 'equation').map((s) => s.equation), [1, 2]);
});

test('the AI gets no slide cap unless the author sets a number, and the deck keeps that number', () => {
  const doc = readLatex(files, 'main.tex');
  const free = deckPrompt(doc, { name: 'paper' });
  assert.match(free, /no limit on the number of slides/);
  assert.doesNotMatch(free, /5-12/);
  assert.match(deckPrompt(doc, { name: 'paper', count: 7 }), /Make exactly 7 slides/);
  const s = (title, extra = {}) => ({ layout: 'bullets', title, bullets: ['x'], ...extra });
  const spec = { title: 'T', slides: [{ layout: 'title', title: 'T' }, s('a'), s('b'), s('c'), { layout: 'equation', title: 'Loss', equation: 1 }, { layout: 'equation', title: 'Bad', equation: 9, bullets: ['y'] }] };
  const all = cleanDeck(spec, doc);
  assert.deepEqual(all.slides.map((x) => [x.layout, x.equation]).slice(4, 6), [['equation', 1], ['bullets', 0]]);
  assert.ok(all.slides.some((x) => x.image === 1), 'unused figures still get a slide');
  assert.equal(cleanDeck(spec, doc, { count: 3 }).slides.length, 3);
});
