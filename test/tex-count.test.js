'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { texCount } = require('../common/tex-count');

test('LaTeX word count skips commands, comments and maths', () => {
  const src = String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Ignored in the preamble}
\begin{document}
\section{Introduction to Things}
We study the problem of \emph{fast} sorting, see \cite{knuth} and Section~\ref{sec:x}. % not counted
The cost is $O(n \log n)$ here.
\begin{equation}
  E = mc^2
\end{equation}
\begin{figure}
  \includegraphics{a.png}
  \caption{A small {\bf picture} of it.}
\end{figure}
\[ a^2 + b^2 = c^2 \]
\end{document}
Trailing words.`;
  const c = texCount(src);
  assert.equal(c.headers, 3);
  assert.equal(c.captions, 5);
  assert.equal(c.words, 14);
  assert.equal(c.inline, 1);
  assert.equal(c.display, 2);
  assert.equal(c.total, 22);
});
