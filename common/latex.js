'use strict';

// LaTeX helpers shared by the main process and Write's LaTeX mode: what the
// cursor is completing, labels and .bib keys, the outline, compile logs and
// SyncTeX lookups.

const TEX_EXTS = ['tex', 'ltx', 'sty', 'cls'];
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'eps', 'bmp', 'webp'];
const TEXT_EXTS = [...TEX_EXTS, 'bib', 'bst', 'txt', 'md', 'csv', 'dat', 'tikz', 'cfg', 'def', 'clo', 'bbx', 'cbx', 'lbx', 'json', 'yml', 'yaml', 'latexmkrc'];

function extOf(file) {
  const base = String(file).split(/[\\/]/).pop();
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : base.toLowerCase();
}

function fileKind(file) {
  const ext = extOf(file);
  if (TEX_EXTS.includes(ext)) return 'tex';
  if (ext === 'bib') return 'bib';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'other';
}

function lineAt(text, index) {
  let n = 1;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) n += 1;
  return n;
}

// Drops % comments (but not \%) so commented-out labels and citations are ignored.
function stripComments(text) {
  return text.replace(/(^|[^\\])%.*$/gm, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

// Reads a balanced {...} group starting at text[i] === '{'. Returns { value, end }.
function readGroup(text, i) {
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') {
      j += 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return { value: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

const CITE_RE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|nocite|bibentry)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/;
const REF_RE = /\\(?:ref|eqref|pageref|autoref|nameref|cref|Cref|vref|Vref|cpageref|labelcref|subref|hyperref\[)\*?\{?([^{}\]]*)$/;
const FILE_RE = /\\(includegraphics|input|include|includeonly|subfile|bibliography|addbibresource|lstinputlisting|includepdf|includesvg)\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]*)$/;
const PKG_RE = /\\(?:usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{([^{}]*)$/;
const CLASS_RE = /\\documentclass(?:\s*\[[^\]]*\])?\s*\{([^{}]*)$/;
const ENV_RE = /\\(begin|end)\s*\{([a-zA-Z*@]*)$/;
const CMD_RE = /\\([a-zA-Z@]*)$/;

// What the text just before the cursor is in the middle of typing.
// Returns { kind, prefix, from } where `from` is the offset (in `before`) the
// completion replaces, or null.
function completionContext(before) {
  const last = (m, group) => {
    const all = m[group];
    const cut = Math.max(all.lastIndexOf(','), -1);
    const prefix = all.slice(cut + 1).replace(/^\s+/, '');
    return { prefix, from: before.length - prefix.length };
  };
  let m = CITE_RE.exec(before);
  if (m) return { kind: 'cite', ...last(m, 1) };
  m = REF_RE.exec(before);
  if (m && /[{[]/.test(before.slice(m.index))) return { kind: 'ref', ...last(m, 1) };
  m = FILE_RE.exec(before);
  if (m) {
    const command = m[1];
    const multi = ['bibliography', 'includeonly'].includes(command);
    return { kind: 'file', command, ...(multi ? last(m, 2) : { prefix: m[2], from: before.length - m[2].length }) };
  }
  m = PKG_RE.exec(before);
  if (m) return { kind: 'package', ...last(m, 1) };
  m = CLASS_RE.exec(before);
  if (m) return { kind: 'class', prefix: m[1], from: before.length - m[1].length };
  m = ENV_RE.exec(before);
  if (m) return { kind: m[1] === 'begin' ? 'begin' : 'end', prefix: m[2], from: before.length - m[2].length };
  m = CMD_RE.exec(before);
  if (m && !/\\\\[a-zA-Z@]*$/.test(before.slice(-m[0].length - 1))) return { kind: 'command', prefix: m[1], from: before.length - m[0].length };
  return null;
}

function bibField(body, name) {
  const re = new RegExp(`(?:^|[,\\s])${name}\\s*=\\s*`, 'i');
  const m = re.exec(body);
  if (!m) return '';
  let i = m.index + m[0].length;
  let value;
  if (body[i] === '{') value = readGroup(body, i)?.value;
  else if (body[i] === '"') {
    const end = body.indexOf('"', i + 1);
    value = end > i ? body.slice(i + 1, end) : '';
  } else value = /^[^,\n}]*/.exec(body.slice(i))[0];
  return String(value || '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

// Entries in a .bib file: [{ key, type, title, author, year, line }].
function bibEntries(text) {
  const out = [];
  const re = /@([a-zA-Z]+)\s*[{(]\s*([^,\s{}()]+)\s*,/g;
  let m;
  while ((m = re.exec(text))) {
    const type = m[1].toLowerCase();
    if (['string', 'comment', 'preamble'].includes(type)) continue;
    const next = text.slice(re.lastIndex).search(/\n\s*@[a-zA-Z]+\s*[{(]/);
    const body = text.slice(re.lastIndex, next < 0 ? text.length : re.lastIndex + next);
    out.push({ key: m[2], type, title: bibField(body, 'title'), author: bibField(body, 'author'), year: bibField(body, 'year') || bibField(body, 'date').slice(0, 4), line: lineAt(text, m.index) });
  }
  return out;
}

const plainTitle = (s) => s.replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}$]/g, '').replace(/\s+/g, ' ').trim();

// \label{...} definitions: [{ label, line, context }].
function labels(text) {
  const clean = stripComments(text);
  const out = [];
  const re = /\\label\s*\{([^{}]+)\}/g;
  let m;
  while ((m = re.exec(clean))) {
    const line = lineAt(clean, m.index);
    const before = clean.slice(Math.max(0, m.index - 400), m.index);
    const env = [...before.matchAll(/\\(?:begin\{([a-zA-Z*]+)\}|(part|chapter|section|subsection|subsubsection|paragraph|caption)\*?\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\})/g)].pop();
    const context = env ? (env[1] ? env[1] : `${env[2]}: ${plainTitle(env[3])}`) : text.split('\n')[line - 1].trim();
    out.push({ label: m[1].trim(), line, context: context.slice(0, 80) });
  }
  return out;
}

// \newcommand / \def / \DeclareMathOperator definitions: [{ name, args }].
function userCommands(text) {
  const clean = stripComments(text);
  const out = [];
  const re = /\\(?:(?:re|provide)?newcommand\*?|DeclareMathOperator\*?|NewDocumentCommand|DeclareRobustCommand\*?)\s*\{?\\([a-zA-Z@]+)\}?(?:\s*\[(\d)\])?|\\def\\([a-zA-Z@]+)/g;
  let m;
  while ((m = re.exec(clean))) out.push({ name: m[1] || m[3], args: Number(m[2] || 0) });
  return out;
}

// \newenvironment / \newtheorem definitions.
function userEnvironments(text) {
  const clean = stripComments(text);
  return [...clean.matchAll(/\\(?:re)?new(?:environment|theorem|tcolorbox|DocumentEnvironment)\*?\s*\{([a-zA-Z*]+)\}/g)].map((m) => m[1]);
}

const LEVELS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };

// Sectioning commands for the outline: [{ level, kind, title, line }].
function outline(text) {
  const clean = stripComments(text);
  const out = [];
  const re = /\\(part|chapter|section|subsection|subsubsection|paragraph)(\*?)\s*(?:\[[^\]]*\])?\s*(?=\{)/g;
  let m;
  while ((m = re.exec(clean))) {
    const g = readGroup(clean, re.lastIndex);
    if (!g) continue;
    const title = plainTitle(g.value);
    out.push({ level: LEVELS[m[1]], kind: m[1], title: title || '(untitled)', line: lineAt(clean, m.index) });
  }
  return out;
}

// Files a document pulls in, relative to the project: \input, \include, \bibliography...
function references(text) {
  const clean = stripComments(text);
  const out = { inputs: [], bibs: [], graphics: [] };
  for (const m of clean.matchAll(/\\(input|include|subfile)\s*\{([^{}]+)\}/g)) out.inputs.push(m[2].trim());
  for (const m of clean.matchAll(/\\(bibliography|addbibresource)(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g)) out.bibs.push(...m[2].split(',').map((s) => s.trim()).filter(Boolean));
  for (const m of clean.matchAll(/\\includegraphics\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g)) out.graphics.push(m[1].trim());
  return out;
}

// The innermost \begin{...} that isn't closed before `before` ends.
function openEnvironment(before) {
  const clean = stripComments(before);
  const stack = [];
  for (const m of clean.matchAll(/\\(begin|end)\s*\{([^{}]+)\}/g)) {
    if (m[1] === 'begin') stack.push(m[2]);
    else {
      const i = stack.lastIndexOf(m[2]);
      if (i >= 0) stack.length = i;
    }
  }
  return stack.pop() || null;
}

// Picks the main file: a magic "% !TEX root" comment, then main.tex, then any
// file with \documentclass. files: [{ path, text }].
function findMain(files) {
  const tex = files.filter((f) => fileKind(f.path) === 'tex' && extOf(f.path) !== 'sty' && extOf(f.path) !== 'cls');
  const withClass = tex.filter((f) => /^[^%\n]*\\documentclass/m.test(f.text || ''));
  const named = (list) => list.find((f) => /(^|\/)main\.tex$/i.test(f.path)) || list.find((f) => !f.path.includes('/')) || list[0];
  return (named(withClass) || named(tex))?.path || null;
}

function texRootComment(text) {
  const m = /^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im.exec(String(text).slice(0, 2000));
  return m ? m[1] : null;
}

// Compile log -> [{ level: 'error'|'warning'|'info', file, line, message }].
// Understands TeX's own log, -file-line-error output, Tectonic's messages and
// BibTeX's .blg.
function parseLog(log, mainFile = null) {
  const lines = String(log || '').replace(/\r/g, '').split('\n');
  const out = [];
  const stack = [];
  const current = () => stack.filter(Boolean).pop() || mainFile;
  const norm = (f) => (f ? f.replace(/^\.\//, '').replace(/\\/g, '/') : f);
  const add = (level, file, line, message) => {
    message = message.replace(/\s+/g, ' ').trim();
    if (!message) return;
    const item = { level, file: norm(file), line: line ? Number(line) : null, message };
    if (!out.some((o) => o.level === item.level && o.file === item.file && o.line === item.line && o.message === item.message)) out.push(item);
  };
  const joinWrapped = (i) => {
    let text = lines[i];
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].trim() && (lines[j].length >= 79 || /^\(\S+\)\s/.test(lines[j + 1]) || /^\s{2,}/.test(lines[j + 1]))) {
      j += 1;
      text += lines[j].length >= 79 || /^\(\S+\)\s/.test(lines[j]) ? ` ${lines[j].replace(/^\(\S+\)\s*/, '')}` : lines[j];
    }
    return { text, end: j };
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let m;
    if ((m = /^(?:error: )?((?:[A-Za-z]:)?[^:\s()]+\.(?:tex|ltx|sty|cls|bib|bbl|aux)):(\d+): (.*)$/.exec(raw))) {
      let message = m[3];
      for (let j = i + 1; j < Math.min(lines.length, i + 3) && lines[j].trim() && !/^l\.\d+/.test(lines[j]); j++) {
        if (/^\S/.test(lines[j]) && !/[.:]$/.test(message)) message += ` ${lines[j]}`;
      }
      add(/warning/i.test(raw.slice(0, 8)) ? 'warning' : 'error', m[1], m[2], message);
      continue;
    }
    if ((m = /^warning: ((?:[A-Za-z]:)?[^:\s()]+\.(?:tex|ltx|sty|cls|bib)):(\d+): (.*)$/.exec(raw))) {
      add('warning', m[1], m[2], m[3]);
      continue;
    }
    if ((m = /^! (.*)$/.exec(raw))) {
      let line = null;
      let detail = '';
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const lm = /^l\.(\d+)\s?(.*)$/.exec(lines[j]);
        if (lm) {
          line = lm[1];
          detail = lm[2].trim();
          break;
        }
      }
      add('error', current(), line, m[1] + (detail && m[1].length < 40 ? ` (${detail.slice(-40)})` : ''));
      continue;
    }
    if ((m = /^((?:LaTeX|Package|Class) (?:(\S+) )?Warning:|LaTeX Font Warning:)/.exec(raw))) {
      const { text, end } = joinWrapped(i);
      const lm = /on input line (\d+)/.exec(text);
      add('warning', current(), lm ? lm[1] : null, text.replace(/^(?:LaTeX|Package|Class)\s+(?:\S+\s+)?Warning:\s*/, '').replace(/\s*on input line \d+\.?/, ''));
      i = end;
      continue;
    }
    if ((m = /^(Overfull|Underfull) \\([hv])box (.*?)(?: (?:in paragraph|detected) at lines? (\d+)(?:--\d+)?)?$/.exec(raw))) {
      add('info', current(), m[4], `${m[1]} \\${m[2]}box ${m[3]}`);
      continue;
    }
    if ((m = /^Warning--(.*)$/.exec(raw))) {
      add('warning', null, null, `BibTeX: ${m[1]}`);
      continue;
    }
    if ((m = /^I (?:couldn't open|found no) (.*)$/.exec(raw))) {
      add('error', null, null, `BibTeX: I ${raw.slice(2)}`);
      continue;
    }
    if ((m = /^error: (.*)$/.exec(raw))) {
      add('error', null, null, m[1]);
      continue;
    }
    // Track which file TeX is reading: "(./chapters/intro.tex" opens, ")" closes.
    for (const t of raw.matchAll(/\((\.{0,2}\/?(?:[A-Za-z]:)?[^\s()]*\.(?:tex|ltx|sty|cls|cfg|def|clo|fd|aux|bbl|toc|out|lof|lot))|\(|\)/g)) {
      if (t[0] === ')') stack.pop();
      else stack.push(t[1] && !/[\\/](texmf|tex\/latex|texlive|MiKTeX)/i.test(t[1]) && /\.(tex|ltx)$/.test(t[1]) ? t[1] : null);
    }
  }
  const order = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

// SyncTeX: parse the (decompressed) .synctex file into inputs and per-page
// records with positions in PDF points from the page's top-left corner.
const SP_PER_PT = 65781.76; // 65536 sp per TeX point, 72.27 TeX points per 72 PDF points

function parseSynctex(text) {
  const inputs = {};
  const pages = {};
  let unit = 1;
  let xOff = 0;
  let yOff = 0;
  let mag = 1000;
  let page = null;
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (!line) continue;
    const c = line[0];
    if (line.startsWith('Input:')) {
      const m = /^Input:(\d+):(.*)$/.exec(line);
      if (m) inputs[m[1]] = m[2];
      continue;
    }
    if (line.startsWith('Unit:')) unit = Number(line.slice(5)) || 1;
    else if (line.startsWith('X Offset:')) xOff = Number(line.slice(9)) || 0;
    else if (line.startsWith('Y Offset:')) yOff = Number(line.slice(9)) || 0;
    else if (line.startsWith('Magnification:')) mag = Number(line.slice(14)) || 1000;
    if (c === '{') {
      page = Number(line.slice(1));
      pages[page] = [];
      continue;
    }
    if (c === '}') {
      page = null;
      continue;
    }
    if (page == null) continue;
    const m = /^([[(hvxkg$])(\d+),(\d+)(?::(-?\d+),(-?\d+))?(?::(-?\d+),(-?\d+),(-?\d+))?/.exec(line);
    if (!m) continue;
    const scale = (unit * mag) / 1000 / SP_PER_PT;
    const rec = { type: m[1], input: m[2], line: Number(m[3]), x: (Number(m[4] || 0) * scale) + xOff / SP_PER_PT, y: (Number(m[5] || 0) * scale) + yOff / SP_PER_PT };
    if (m[6] != null) {
      rec.w = Number(m[6]) * scale;
      rec.h = Number(m[7]) * scale;
      rec.d = Number(m[8]) * scale;
    }
    pages[page].push(rec);
  }
  return { inputs, pages };
}

const sameFile = (a, b) => {
  const n = (f) => String(f || '').replace(/\\/g, '/').replace(/\/\.\//g, '/').replace(/^\.\//, '').toLowerCase();
  const x = n(a);
  const y = n(b);
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
};

// Source line -> { page, x, y } in the PDF, or null.
function synctexForward(sync, file, line) {
  const ids = Object.keys(sync.inputs).filter((id) => sameFile(sync.inputs[id], file));
  if (!ids.length) return null;
  let best = null;
  for (const [page, recs] of Object.entries(sync.pages)) {
    for (const r of recs) {
      if (!ids.includes(r.input) || r.line <= 0) continue;
      const dist = Math.abs(r.line - line) + (r.line > line ? 0.5 : 0);
      if (!best || dist < best.dist || (dist === best.dist && Number(page) === best.page && r.y < best.y)) best = { dist, page: Number(page), x: r.x, y: r.y - (r.h || 0), line: r.line };
    }
    if (best?.dist === 0) break;
  }
  return best && { page: best.page, x: best.x, y: Math.max(0, best.y) };
}

// PDF click (page, x, y in points) -> { file, line }, or null.
function synctexBackward(sync, page, x, y) {
  const recs = sync.pages[page];
  if (!recs?.length) return null;
  let best = null;
  for (const r of recs) {
    if (r.line <= 0 || !sync.inputs[r.input]) continue;
    let dist;
    if (r.w != null && r.type !== '[' && r.type !== '(') {
      const top = r.y - (r.h || 0);
      const bottom = r.y + (r.d || 0);
      const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - r.x - r.w : 0;
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      dist = dx + dy * 2;
    } else if (r.type === 'x' || r.type === 'k' || r.type === 'g' || r.type === '$') {
      dist = Math.abs(r.x - x) + Math.abs(r.y - y) * 2 + 2;
    } else continue;
    if (!best || dist < best.dist) best = { dist, rec: r };
  }
  return best && { file: sync.inputs[best.rec.input], line: best.rec.line };
}

const NEW_PROJECT = {
  'main.tex': `\\documentclass[11pt]{article}

\\usepackage[margin=1in]{geometry}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{hyperref}

\\title{My Document}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
A short summary of what this document is about.
\\end{abstract}

\\section{Introduction}
\\label{sec:intro}

Write here. The preview on the right updates when you compile (Ctrl+Enter).
Type \\verb|\\cite{| to pick a reference from \\texttt{references.bib}, as in
\\cite{knuth1984}, or \\verb|\\ref{| to point at a label such as
Section~\\ref{sec:method} or Equation~\\eqref{eq:energy}.

\\section{Method}
\\label{sec:method}

\\begin{equation}
  E = mc^2
  \\label{eq:energy}
\\end{equation}

\\begin{table}[h]
  \\centering
  \\begin{tabular}{lrr}
    \\toprule
    Item & Value & Share \\\\
    \\midrule
    First & 10 & 25\\% \\\\
    Second & 30 & 75\\% \\\\
    \\bottomrule
  \\end{tabular}
  \\caption{An example table.}
  \\label{tab:example}
\\end{table}

\\section{Conclusion}

See \\cite{lamport1994} for more about \\LaTeX.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}
`,
  'references.bib': `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  year      = {1984}
}

@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\\LaTeX}: A Document Preparation System},
  publisher = {Addison-Wesley},
  edition   = {2nd},
  year      = {1994}
}
`,
};

module.exports = {
  TEX_EXTS,
  IMAGE_EXTS,
  TEXT_EXTS,
  NEW_PROJECT,
  extOf,
  fileKind,
  readGroup,
  stripComments,
  completionContext,
  bibEntries,
  labels,
  userCommands,
  userEnvironments,
  outline,
  references,
  openEnvironment,
  findMain,
  texRootComment,
  parseLog,
  parseSynctex,
  synctexForward,
  synctexBackward,
};
