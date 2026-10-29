// Downloads Tectonic, a self-contained LaTeX engine, into build/tectonic so
// the installer ships it. With --warm it also compiles a few sample documents
// so Tectonic's package cache (shipped too) holds the common packages, and
// LaTeX projects compile offline from the first run.
//
//   node scripts/fetch-tectonic.mjs [--warm] [--required]

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.15.0';
const TARGETS = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'x86_64-pc-windows-msvc', // runs under Windows' x64 emulation
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'linux-arm64': 'aarch64-unknown-linux-musl',
};

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'build', 'tectonic');
const isWin = process.platform === 'win32';
const bin = join(out, isWin ? 'tectonic.exe' : 'tectonic');
const warm = process.argv.includes('--warm');
const required = process.argv.includes('--required');

function fail(message) {
  console.warn(`fetch-tectonic: ${message}`);
  if (required) process.exit(1);
  console.warn('fetch-tectonic: continuing without the built-in LaTeX engine.');
  process.exit(0);
}

async function download() {
  const target = TARGETS[`${process.platform}-${process.arch}`];
  if (!target) fail(`no Tectonic build for ${process.platform}-${process.arch}`);
  const ext = isWin ? 'zip' : 'tar.gz';
  const url = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/tectonic-${VERSION}-${target}.${ext}`;
  console.log(`fetch-tectonic: downloading ${url}`);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    fail(`download failed: ${err.message}`);
  }
  if (!res.ok) fail(`download failed: HTTP ${res.status}`);
  const tmp = await mkdtemp(join(tmpdir(), 'tectonic-'));
  const archive = join(tmp, `tectonic.${ext}`);
  await writeFile(archive, Buffer.from(await res.arrayBuffer()));
  // Windows 10+ ships bsdtar, which also reads zip files.
  const tar = isWin ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  const r = spawnSync(tar, ['-xf', archive, '-C', out], { stdio: 'inherit' });
  await rm(tmp, { recursive: true, force: true });
  if (r.status !== 0 || !existsSync(bin)) fail('could not unpack the download');
  await writeFile(join(out, 'VERSION'), VERSION);
}

// Sample documents that pull in the packages most projects use.
const SAMPLES = {
  'article.tex': String.raw`\documentclass[11pt]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[english]{babel}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb, amsthm, mathtools, bm}
\usepackage{graphicx, xcolor, float, wrapfig}
\usepackage{booktabs, multirow, tabularx, longtable, array}
\usepackage{caption, subcaption}
\usepackage{enumitem, fancyhdr, setspace, parskip, titlesec}
\usepackage{siunitx, listings, url, microtype, csquotes, lipsum, xspace, appendix}
\usepackage{algorithm, algpseudocode}
\usepackage{tikz, pgfplots}
\pgfplotsset{compat=1.18}
\usepackage[numbers]{natbib}
\usepackage{hyperref, cleveref}
\newtheorem{theorem}{Theorem}
\begin{document}
\title{Warm-up}\author{Work}\maketitle
\tableofcontents
\section{One}\label{sec:one}
\lipsum[1] \textbf{bold} \emph{em} \texttt{tt} \SI{3}{\metre} \cite{a}.
\begin{theorem} $\int_0^1 x\,dx = \tfrac12$ and $\mathbb{R}\bm{x}$ \end{theorem}
\begin{align} a &= b \\ c &= d \end{align}
\begin{figure}[H]\centering\begin{tikzpicture}\draw (0,0) circle (1);\end{tikzpicture}
\begin{tikzpicture}\begin{axis}\addplot {x^2};\end{axis}\end{tikzpicture}\caption{Fig}\label{fig:a}\end{figure}
\begin{table}[h]\centering\begin{tabular}{lr}\toprule a & 1 \\ \midrule b & 2 \\ \bottomrule\end{tabular}\caption{Tab}\end{table}
\begin{algorithm}\begin{algorithmic}\State $x \gets 1$\end{algorithmic}\caption{Alg}\end{algorithm}
\begin{lstlisting}
print("hi")
\end{lstlisting}
See \cref{sec:one} and \url{https://example.com}.
\bibliographystyle{plainnat}
\bibliography{refs}
\end{document}
`,
  'refs.bib': '@book{a, author = {A. Author}, title = {A Book}, publisher = {P}, year = {2020}}\n',
  'plain.tex': String.raw`\documentclass{report}
\usepackage{amsmath, graphicx, hyperref}
\begin{document}\chapter{One}Text \cite{a}.\bibliographystyle{plain}\bibliography{refs}\end{document}
`,
  'ieee.tex': String.raw`\documentclass[conference]{IEEEtran}
\usepackage{cite, amsmath, graphicx}
\begin{document}\title{T}\author{\IEEEauthorblockN{A}}\maketitle\section{Intro}Text \cite{a}.\bibliographystyle{IEEEtran}\bibliography{refs}\end{document}
`,
  'slides.tex': String.raw`\documentclass{beamer}
\usetheme{Madrid}
\begin{document}\begin{frame}{Title}\begin{itemize}\item One\end{itemize}\end{frame}\end{document}
`,
  'book.tex': String.raw`\documentclass{book}
\begin{document}\frontmatter\chapter{Preface}Hi.\mainmatter\chapter{One}Hello.\end{document}
`,
};

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

async function warmCache() {
  const cache = join(out, 'cache');
  await mkdir(cache, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'tectonic-warm-'));
  for (const [name, text] of Object.entries(SAMPLES)) await writeFile(join(work, name), text);
  for (const name of Object.keys(SAMPLES).filter((n) => n.endsWith('.tex'))) {
    console.log(`fetch-tectonic: warming the cache with ${name}`);
    const r = spawnSync(bin, ['-X', 'compile', name], { cwd: work, env: { ...process.env, TECTONIC_CACHE_DIR: cache }, stdio: 'inherit', timeout: 15 * 60 * 1000 });
    if (r.status !== 0) console.warn(`fetch-tectonic: ${name} didn't compile cleanly (exit ${r.status}); the cache may miss some packages`);
  }
  await rm(work, { recursive: true, force: true });
  await writeFile(join(out, 'WARM'), VERSION);
  console.log(`fetch-tectonic: package cache is ${(await dirSize(cache) / 1048576).toFixed(1)} MB`);
}

await mkdir(out, { recursive: true });
const have = existsSync(bin) && (await readFile(join(out, 'VERSION'), 'utf8').catch(() => '')) === VERSION;
if (!have) await download();
else console.log(`fetch-tectonic: Tectonic ${VERSION} already in build/tectonic`);
if (warm && (await readFile(join(out, 'WARM'), 'utf8').catch(() => '')) !== VERSION) await warmCache();
