// Reads a LaTeX project into the same blocks a Write document becomes (see
// readDocument in deck.js), so Send to Present works for papers too. It
// follows \input and \include, keeps the title, abstract, sections, lists,
// figures, tables and display equations, and turns the rest into plain text.

import { extOf, readGroup, stripComments } from '../../common/latex.js';

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const LEVELS = { part: 1, chapter: 2, section: 3, subsection: 4, subsubsection: 5 };
const LIST_ENVS = ['itemize', 'enumerate', 'description', 'compactitem', 'compactenum', 'inparaenum', 'asparaenum'];
const FIGURE_ENVS = ['figure', 'figure*', 'wrapfigure', 'SCfigure', 'subfigure', 'marginfigure'];
const TABLE_ENVS = ['table', 'table*', 'wraptable', 'SCtable', 'margintable'];
const TABULAR_ARGS = { tabular: 1, 'tabular*': 2, tabularx: 2, tabulary: 2, longtable: 1, 'longtable*': 1, array: 1, xltabular: 2, supertabular: 1 };
const MATH_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'flalign', 'flalign*', 'alignat', 'alignat*', 'eqnarray', 'eqnarray*', 'displaymath', 'dmath', 'dmath*'];
const QUOTE_ENVS = ['quote', 'quotation', 'verse', 'epigraph'];
const SKIP_ENVS = ['thebibliography', 'verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment', 'tikzpicture', 'pgfpicture', 'filecontents', 'filecontents*', 'titlepage', 'tabbing'];
const THEOREMS = ['theorem', 'lemma', 'corollary', 'proposition', 'definition', 'remark', 'example', 'proof', 'claim', 'assumption', 'conjecture', 'hypothesis', 'observation', 'note', 'problem', 'exercise', 'solution'];
const DROP = new Set(['label', 'footnote', 'footnotetext', 'index', 'glossary', 'vspace', 'hspace', 'addvspace', 'phantom', 'hphantom', 'vphantom', 'thanks', 'marginpar', 'todo', 'pagestyle', 'thispagestyle', 'setlength', 'addtolength', 'setcounter', 'addtocounter', 'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment', 'DeclareMathOperator', 'usepackage', 'bibliographystyle', 'bibliography', 'addbibresource', 'includegraphics', 'caption', 'captionof', 'graphicspath', 'input', 'include', 'hypersetup', 'definecolor', 'newtheorem', 'pagenumbering', 'enlargethispage', 'linespread', 'fontsize', 'rule', 'raisebox', 'nocite', 'cline', 'cmidrule', 'rowcolor', 'cellcolor', 'columncolor']);
const WORDS = {
  LaTeX: 'LaTeX', LaTeXe: 'LaTeX2e', TeX: 'TeX', BibTeX: 'BibTeX', ldots: '…', dots: '…', textellipsis: '…', textendash: '–', textemdash: '—', textbullet: '•',
  S: '§', P: '¶', copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™', ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', o: 'ø', O: 'Ø',
  aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'ı', dag: '†', ddag: '‡', pounds: '£', euro: '€', texteuro: '€', textdegree: '°', degree: '°', textasciitilde: '~',
  textbackslash: '\\', textless: '<', textgreater: '>', textbar: '|', textquotedbl: '"', quad: ' ', qquad: ' ', enspace: ' ', thinspace: ' ', newline: ' ', linebreak: ' ',
  textmu: 'µ', textpm: '±', texttimes: '×', checkmark: '✓', ding: '',
};
const ACCENTS = { "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇', c: '̧', v: '̌', H: '̋', u: '̆', r: '̊', k: '̨' };
const SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν',
  xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  times: '×', cdot: '·', pm: '±', mp: '∓', div: '÷', leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', sim: '∼', simeq: '≃', cong: '≅', equiv: '≡', propto: '∝',
  ll: '≪', gg: '≫', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', gets: '←', Rightarrow: '⇒', Leftarrow: '⇐', implies: '⇒', iff: '⇔', Leftrightarrow: '⇔', leftrightarrow: '↔', mapsto: '↦',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  partial: '∂', nabla: '∇', sum: 'Σ', prod: 'Π', int: '∫', oint: '∮', ell: 'ℓ', hbar: 'ℏ', circ: '∘', bullet: '•', star: '⋆', ast: '∗', oplus: '⊕', otimes: '⊗', perp: '⊥', parallel: '∥', angle: '∠', top: '⊤', bot: '⊥',
  ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', ddots: '⋱', mid: '|', vert: '|', Vert: '‖', '|': '‖', langle: '⟨', rangle: '⟩', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', prime: '′', deg: '°', degree: '°',
  log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos', tan: 'tan', max: 'max', min: 'min', arg: 'arg', lim: 'lim', sup: 'sup', inf: 'inf', det: 'det', Pr: 'Pr', argmax: 'argmax', argmin: 'argmin',
};
const BLACKBOARD = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', E: '𝔼' };
const MARKS = { hat: '̂', widehat: '̂', bar: '̄', overline: '̅', tilde: '̃', widetilde: '̃', vec: '⃗', dot: '̇', ddot: '̈' };
const SUP = Object.fromEntries([...'0123456789+-=()niaTbcdefghijklmoprstuvwxyz'].map((c, i) => [c, '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵀᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ'[i]]));
const SUB = Object.fromEntries([...'0123456789+-=()aehijklmnoprstuvx'].map((c, i) => [c, '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ'[i]]));

const skipSpace = (s, i) => {
  while (i < s.length && /\s/.test(s[i])) i += 1;
  return i;
};

// An optional [...] argument at i (after spaces), or null.
function readOpt(s, i) {
  const j = skipSpace(s, i);
  if (s[j] !== '[') return null;
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === '\\') {
      k += 1;
      continue;
    }
    if (s[k] === '{') depth += 1;
    else if (s[k] === '}') depth -= 1;
    else if (s[k] === ']' && depth === 0) return { value: s.slice(j + 1, k), end: k + 1 };
  }
  return null;
}

// A {...} argument at i (after spaces), or a single token like \alpha or x.
function readArg(s, i) {
  const j = skipSpace(s, i);
  if (s[j] === '{') return readGroup(s, j);
  if (s[j] === '\\') {
    const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(j));
    return m ? { value: m[0], end: j + m[0].length } : null;
  }
  return j < s.length ? { value: s[j], end: j + 1 } : null;
}

// The command name at s[i] === '\\': letters, or one other character.
function commandAt(s, i) {
  const m = /^\\([a-zA-Z@]+|.)/.exec(s.slice(i, i + 64));
  return m ? { name: m[1], end: i + m[0].length } : { name: '', end: i + 1 };
}

// Skips a command's star, optional and brace arguments; returns the brace arguments.
function readArgs(s, i, max = 9) {
  const args = [];
  let j = i;
  if (s[j] === '*') j += 1;
  for (;;) {
    const opt = readOpt(s, j);
    if (opt) {
      j = opt.end;
      continue;
    }
    const k = skipSpace(s, j);
    if (args.length < max && s[k] === '{' && !/\n[ \t]*\n/.test(s.slice(j, k))) {
      const g = readGroup(s, k);
      if (!g) break;
      args.push(g.value);
      j = g.end;
      continue;
    }
    break;
  }
  return { args, end: j };
}

// The end of the environment whose \begin{name} ends at i: { content, end }.
function envBody(s, i, name) {
  const esc = name.replace(/[*]/g, '\\*');
  const re = new RegExp(`\\\\(begin|end)\\s*\\{${esc}\\}`, 'g');
  re.lastIndex = i;
  let depth = 1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    depth += m[1] === 'begin' ? 1 : -1;
    if (depth === 0) return { content: s.slice(i, m.index), end: m.index + m[0].length };
  }
  return { content: s.slice(i), end: s.length };
}

// Splits on a separator at brace depth 0 ('&' for cells, '\\\\' for rows).
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (sep === '\\\\' && s[i + 1] === '\\' && depth === 0) {
        out.push(s.slice(from, i));
        i += 2;
        const opt = readOpt(s, i);
        if (opt && /^\s*-?[\d.]+\s*[a-z]{2}\s*$/.test(opt.value)) i = opt.end;
        from = i;
        i -= 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === sep && depth === 0) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  }
  out.push(s.slice(from));
  return out;
}

const normPath = (p) => {
  const out = [];
  for (const part of p.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
};
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// Inlines \input, \include, \subfile and \import, relative to the main file's folder.
function inlineFiles(text, texts, dir, depth = 0) {
  if (depth > 12) return text;
  const inline = (cmd, base, name) => {
    const want = normPath(`${base}/${name.trim()}`);
    const found = [want, `${want}.tex`].find((p) => texts.has(p)) || [...texts.keys()].find((p) => p.toLowerCase() === `${want}.tex`.toLowerCase());
    if (!found) return ' ';
    let inner = stripComments(texts.get(found));
    // A subfile is a whole document of its own: only its body counts.
    const body = /\\begin\s*\{document\}([\s\S]*?)(\\end\s*\{document\}|$)/.exec(inner);
    if (cmd === 'subfile' && body) inner = body[1];
    return `\n${inlineFiles(inner.replace(/\\endinput[\s\S]*$/, ''), texts, base, depth + 1)}\n`;
  };
  return stripComments(text).replace(/\\(input|include|subfile|(?:sub)?import|(?:sub)?inputfrom)(?![a-zA-Z])\s*(?:\{([^{}]*)\}\s*(?=\{))?\{([^{}]*)\}/g, (m, cmd, first, name) => {
    if (/import|from/.test(cmd)) return first == null ? m : inline(cmd, normPath(`${dir}/${first}`), name);
    return first == null ? inline(cmd, dir, name) : `${inline(cmd, dir, first)}{${name}}`;
  });
}

// Simple macros the author defined (\newcommand{\name}{body} without
// arguments), to expand in the text, and every definition, for the equations.
function readMacros(text) {
  const simple = {};
  const defs = [];
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator)(\*?)\s*(\{\\[a-zA-Z@]+\}|\\[a-zA-Z@]+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[3].replace(/[{}]/g, '');
    let i = m.index + m[0].length;
    const nargs = readOpt(text, i);
    if (nargs) i = nargs.end;
    const dflt = nargs && readOpt(text, i);
    if (dflt) i = dflt.end;
    const body = readGroup(text, skipSpace(text, i));
    if (!body) continue;
    re.lastIndex = body.end;
    if (m[1] === 'DeclareMathOperator') defs.push(`\\newcommand{${name}}{\\operatorname${m[2]}{${body.value}}}`);
    else {
      defs.push(`\\newcommand{${name}}${nargs ? `[${nargs.value}]` : ''}${dflt ? `[${dflt.value}]` : ''}{${body.value}}`);
      if (!nargs) simple[name.slice(1)] = body.value;
    }
  }
  return { simple, defs: defs.join('') };
}

// Numbers for \ref: sections, figures, tables and equations in order.
function readLabels(body) {
  const labels = {};
  const sec = [0, 0, 0, 0, 0, 0];
  let appendix = false;
  let current = { num: '', kind: '' };
  let fig = 0;
  let tab = 0;
  let eq = 0;
  const re = /\\(part|chapter|section|subsection|subsubsection)(\*?)(?![a-zA-Z])|\\appendix(?![a-zA-Z])|\\begin\s*\{([^}]+)\}|\\label\s*\{([^}]*)\}|\\(nonumber|notag)(?![a-zA-Z])|\\\\/g;
  const top = ['chapter', 'section', 'part'].find((c) => new RegExp(`\\\\${c}\\*?\\s*[[{]`).test(body)) === 'chapter' ? 2 : 3;
  let inMath = null;
  let rowNumbered = false;
  const closeRow = () => {
    if (inMath && !rowNumbered) eq += 1;
  };
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (inMath && m.index >= inMath.end) {
      closeRow();
      inMath = null;
    }
    if (m[1]) {
      if (m[2]) continue;
      const lvl = LEVELS[m[1]];
      if (lvl < top) continue;
      const d = lvl - top;
      sec[d] += 1;
      sec.fill(0, d + 1);
      const first = appendix ? String.fromCharCode(64 + sec[0]) : String(sec[0]);
      current = { num: [first, ...sec.slice(1, d + 1)].join('.'), kind: d ? 'Section' : top === 2 ? 'Chapter' : 'Section' };
    } else if (/^\\appendix/.test(m[0])) {
      appendix = true;
      sec.fill(0);
    } else if (m[3]) {
      const env = m[3].trim();
      if (FIGURE_ENVS.includes(env) && env !== 'subfigure') current = { num: String(++fig), kind: 'Figure' };
      else if (TABLE_ENVS.includes(env)) current = { num: String(++tab), kind: 'Table' };
      else if (MATH_ENVS.includes(env) && !env.endsWith('*') && env !== 'displaymath') {
        inMath = { end: envBody(body, m.index + m[0].length, env).end };
        rowNumbered = false;
        current = { num: String(eq + 1), kind: 'Equation' };
      }
    } else if (m[4]) {
      labels[m[4].trim()] = { ...current };
    } else if (m[5]) {
      if (inMath) rowNumbered = true;
    } else if (inMath) {
      closeRow();
      rowNumbered = false;
      current = { num: String(eq + 1), kind: 'Equation' };
    }
  }
  return labels;
}

const mapAll = (s, table) => ([...s].every((c) => table[c]) ? [...s].map((c) => table[c]).join('') : null);

// Inline math as readable text: x^2 becomes x², \alpha becomes α.
export function mathText(tex, macros = {}, depth = 0) {
  let out = '';
  for (let i = 0; i < tex.length;) {
    const c = tex[i];
    if (c === '\\') {
      const { name, end } = commandAt(tex, i);
      i = end;
      if (/^(left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|displaystyle|textstyle|scriptstyle|limits|nolimits|,|;|:|!|quad|qquad| )$/.test(name)) {
        out += /^(quad|qquad|,|;|:| )$/.test(name) ? ' ' : '';
        continue;
      }
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const a = readArg(tex, i);
        const b = a && readArg(tex, a.end);
        if (!b) continue;
        const [x, y] = [mathText(a.value, macros, depth + 1), mathText(b.value, macros, depth + 1)].map((v) => (/^[\w.′]+$/u.test(v) ? v : `(${v})`));
        out += `${x}/${y}`;
        i = b.end;
        continue;
      }
      if (name === 'sqrt') {
        const n = readOpt(tex, i);
        const a = readArg(tex, n ? n.end : i);
        if (!a) continue;
        const v = mathText(a.value, macros, depth + 1);
        out += `${n ? mapAll(n.value, SUP) || '' : ''}√${/^[\w.]+$/u.test(v) ? v : `(${v})`}`;
        i = a.end;
        continue;
      }
      if (name === 'mathbb') {
        const a = readArg(tex, i);
        if (!a) continue;
        out += mapAll(a.value.trim(), BLACKBOARD) || a.value;
        i = a.end;
        continue;
      }
      if (MARKS[name]) {
        const a = readArg(tex, i);
        if (!a) continue;
        const v = mathText(a.value, macros, depth + 1);
        out += v.length === 1 ? (v + MARKS[name]).normalize('NFC') : v;
        i = a.end;
        continue;
      }
      if (/^(mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathfrak|mathscr|boldsymbol|bm|text|textrm|textit|textbf|mbox|operatorname|textnormal|mathnormal|emph|underline)$/.test(name)) {
        const a = readArg(tex, i);
        if (!a) continue;
        out += mathText(a.value, macros, depth + 1);
        i = a.end;
        continue;
      }
      if (macros[name] !== undefined && depth < 8) {
        out += mathText(macros[name], macros, depth + 1);
        continue;
      }
      if (SYMBOLS[name] !== undefined) {
        out += SYMBOLS[name];
        if (/^[a-z]{2,}$/.test(SYMBOLS[name]) && /^[a-zA-Z0-9\\]/.test(tex.slice(skipSpace(tex, i), skipSpace(tex, i) + 1))) out += ' ';
        continue;
      }
      if (/^[{}$%&#_]$/.test(name)) out += name;
      else if (name.length > 1) out += name;
      continue;
    }
    if (c === '^' || c === '_') {
      const a = readArg(tex, i + 1);
      if (!a) {
        i += 1;
        continue;
      }
      const v = mathText(a.value, macros, depth + 1);
      out += mapAll(v.replace(/\s+/g, ''), c === '^' ? SUP : SUB) ?? (c === '^' ? `^(${v})` : `_(${v})`);
      i = a.end;
      continue;
    }
    if (c === '{' || c === '}') {
      i += 1;
      continue;
    }
    if (c === '~') {
      out += ' ';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.replace(/\s+/g, ' ').replace(/\s*([=<>≤≥≈≠±×→∈])\s*/g, ' $1 ').replace(/\s+/g, ' ').trim();
}

// TeX text as plain text: commands keep their words, citations and labels go,
// and \ref becomes the number it points to.
export function texText(s, ctx = {}, depth = 0) {
  const labels = ctx.labels || {};
  const macros = ctx.macros || {};
  let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\\') {
      const { name, end } = commandAt(s, i);
      i = end;
      if (name === '\\') {
        out += ' ';
        const opt = readOpt(s, i);
        if (opt && /^\s*-?[\d.]+\s*[a-z]{2}\s*$/.test(opt.value)) i = opt.end;
        continue;
      }
      if (name === '(' || name === '[') {
        const close = s.indexOf(name === '(' ? '\\)' : '\\]', i);
        const stop = close < 0 ? s.length : close;
        out += mathText(s.slice(i, stop), macros);
        i = stop + 2;
        continue;
      }
      if (/^[%&$#_{} ]$/.test(name)) {
        out += name;
        continue;
      }
      if (/^[,;:!>\-@/]$/.test(name)) {
        out += /[,;:>]/.test(name) ? ' ' : '';
        continue;
      }
      if (ACCENTS[name] !== undefined && (name.length === 1)) {
        const a = readArg(s, i);
        if (!a) continue;
        const base = a.value.replace(/^\\i$/, 'i').replace(/^\\j$/, 'j');
        out += (base + ACCENTS[name]).normalize('NFC');
        i = a.end;
        continue;
      }
      if (/cite|^citeauthor|^citeyear/i.test(name)) {
        i = readArgs(s, i, 1).end;
        out = out.replace(/[  ~]+$/, '');
        continue;
      }
      if (/^(ref|autoref|Autoref|cref|Cref|eqref|pageref|nameref|vref|Vref|cpageref|labelcref)$/.test(name)) {
        const { args, end: e } = readArgs(s, i, 1);
        i = e;
        const keys = (args[0] || '').split(',').map((k) => k.trim()).filter(Boolean);
        const nums = keys.map((k) => labels[k]).filter(Boolean);
        if (!nums.length) continue;
        const list = nums.map((l) => (name === 'eqref' || (/cref|autoref/i.test(name) && l.kind === 'Equation') ? `(${l.num})` : l.num)).join(', ');
        const word = /cref|autoref|vref/i.test(name) && nums[0].kind ? `${nums[0].kind}${nums.length > 1 ? 's' : ''} ` : '';
        out += word + list;
        continue;
      }
      if (name === 'href') {
        const { args, end: e } = readArgs(s, i, 2);
        out += texText(args[1] ?? args[0] ?? '', ctx, depth + 1);
        i = e;
        continue;
      }
      if (name === 'url' || name === 'nolinkurl' || name === 'path') {
        const a = readArg(s, i);
        if (a) {
          out += a.value;
          i = a.end;
        }
        continue;
      }
      if (name === 'textsuperscript' || name === 'textsubscript') {
        const a = readArg(s, i);
        if (!a) continue;
        const v = texText(a.value, ctx, depth + 1);
        out += mapAll(v, name === 'textsuperscript' ? SUP : SUB) ?? v;
        i = a.end;
        continue;
      }
      if (name === 'ensuremath') {
        const a = readArg(s, i);
        if (!a) continue;
        out += mathText(a.value, macros);
        i = a.end;
        continue;
      }
      if (macros[name] !== undefined && depth < 8) {
        if (s[i] === ' ' || s.slice(i, i + 2) === '{}') i += s[i] === ' ' ? 0 : 2;
        out += texText(macros[name], ctx, depth + 1);
        continue;
      }
      if (WORDS[name] !== undefined) {
        out += WORDS[name];
        if (s.slice(i, i + 2) === '{}') i += 2;
        continue;
      }
      if (DROP.has(name)) {
        i = readArgs(s, i, name === 'setlength' || name === 'definecolor' || /command|environment|Operator/.test(name) ? 4 : 1).end;
        continue;
      }
      // Anything else keeps the words of its last {...} argument (\textbf{x},
      // \textcolor{red}{x}); a switch like \small or \centering just goes.
      const { args, end: e } = readArgs(s, i);
      i = e;
      if (args.length) out += texText(args[args.length - 1], ctx, depth + 1);
      continue;
    }
    if (c === '$') {
      const dbl = s[i + 1] === '$';
      let j = i + (dbl ? 2 : 1);
      while (j < s.length && !(s[j] === '$' && s[j - 1] !== '\\')) j += 1;
      out += mathText(s.slice(i + (dbl ? 2 : 1), j), macros);
      i = j + (dbl ? 2 : 1);
      continue;
    }
    if (c === '{' || c === '}') {
      i += 1;
      continue;
    }
    if (c === '~') {
      out += ' ';
      i += 1;
      continue;
    }
    if (c === '-' && s.startsWith('---', i)) {
      out += '—';
      i += 3;
      continue;
    }
    if (c === '-' && s[i + 1] === '-') {
      out += '–';
      i += 2;
      continue;
    }
    if (s.startsWith('``', i) || s.startsWith("''", i)) {
      out += s[i] === '`' ? '“' : '”';
      i += 2;
      continue;
    }
    if (c === '`') {
      out += '‘';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return tidy(out).replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(');
}

// Display math as TeX MathJax can draw, without labels and numbering marks.
function displayTex(env, content) {
  const tex = content.replace(/\\(label|tag\*?)\s*\{[^{}]*\}|\\(nonumber|notag)(?![a-zA-Z])/g, '').trim();
  if (/^(align|flalign|eqnarray)/.test(env)) return `\\begin{aligned}${tex.replace(/&\s*=\s*&/g, '&=')}\\end{aligned}`;
  if (/^alignat/.test(env)) return `\\begin{aligned}${tex.replace(/^\s*\{[^{}]*\}/, '')}\\end{aligned}`;
  if (/^(gather|multline|dmath)/.test(env)) return `\\begin{gathered}${tex}\\end{gathered}`;
  return tex;
}

function tabularRows(content, ctx) {
  const body = content
    .replace(/\\(hline|toprule|midrule|bottomrule|endhead|endfirsthead|endfoot|endlastfoot|addlinespace|hdashline|specialrule|tabularnewline)(?![a-zA-Z])(\s*\{[^{}]*\}){0,3}/g, (m, cmd) => (cmd === 'tabularnewline' ? '\\\\' : ' '))
    .replace(/\\(cline|cmidrule)(\([^)]*\))?\s*\{[^{}]*\}/g, ' ')
    .replace(/\\(caption|label)\s*(\[[^\]]*\])?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');
  const rows = splitTop(body, '\\\\').map((row) => {
    const cells = [];
    for (const cell of splitTop(row, '&')) {
      const multi = /^\s*\\multicolumn\s*\{(\d+)\}\s*\{[^{}]*\}\s*\{([\s\S]*)\}\s*$/.exec(cell);
      if (multi) {
        cells.push(texText(multi[2], ctx), ...Array(Math.max(0, Number(multi[1]) - 1)).fill(''));
        continue;
      }
      cells.push(texText(cell.replace(/\\multirow\s*(\[[^\]]*\])?\s*\{[^{}]*\}\s*(\[[^\]]*\])?\s*\{[^{}]*\}/, ''), ctx));
    }
    return cells;
  }).filter((r) => r.some(Boolean));
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
}

// The first or last \caption in a float, with its text.
function captionOf(content, ctx, last = false) {
  const re = /\\caption(?:of\s*\{[^{}]*\})?\*?\s*(\[[^\]]*\])?\s*\{/g;
  let found = null;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    const g = readGroup(content, m.index + m[0].length - 1);
    if (g) found = g.value;
    if (found && !last) break;
  }
  return found ? texText(found, ctx) : '';
}

function itemsOf(content, depth, ctx, out) {
  const parts = [];
  let from = -1;
  const re = /\\begin\s*\{([^}]+)\}|\\item(?![a-zA-Z])/g;
  for (let m = re.exec(content); m; m = re.exec(content)) {
    if (m[1]) {
      re.lastIndex = envBody(content, m.index + m[0].length, m[1].trim()).end;
      continue;
    }
    if (from >= 0) parts.push(content.slice(from, m.index));
    from = m.index + m[0].length;
  }
  if (from >= 0) parts.push(content.slice(from));
  for (let part of parts) {
    const label = readOpt(part, 0);
    if (label) part = part.slice(label.end);
    const lead = label ? `${texText(label.value, ctx)}: ` : '';
    let text = '';
    const nested = [];
    const re2 = /\\begin\s*\{([^}]+)\}/g;
    let at = 0;
    for (let m = re2.exec(part); m; m = re2.exec(part)) {
      const env = m[1].trim();
      const b = envBody(part, m.index + m[0].length, env);
      if (LIST_ENVS.includes(env)) {
        text += part.slice(at, m.index);
        nested.push(b.content);
        at = b.end;
      }
      re2.lastIndex = b.end;
    }
    text += part.slice(at);
    const t = tidy(lead + texText(text, ctx));
    if (t && t !== ':') out.push({ text: t.replace(/:\s*$/, ''), depth });
    for (const n of nested) itemsOf(n, depth + 1, ctx, out);
  }
  return out;
}

function parseBody(s, doc, ctx, prefix = '') {
  let buf = prefix;
  const flush = () => {
    const text = texText(buf, ctx);
    if (text && text !== tidy(texText(prefix, ctx))) doc.blocks.push({ type: 'para', text });
    buf = '';
  };
  const math = (tex) => {
    if (!tidy(tex)) return;
    flush();
    doc.equations.push({ tex });
    doc.blocks.push({ type: 'math', index: doc.equations.length });
  };
  const image = (path, alt) => {
    doc.images.push({ path: path.trim(), alt });
    doc.blocks.push({ type: 'image', index: doc.images.length });
  };
  const table = (rows) => {
    if (!rows.length) return;
    doc.tables.push(rows);
    doc.blocks.push({ type: 'table', index: doc.tables.length });
  };

  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '\n' && /^\n[ \t]*\n/.test(s.slice(i, i + 64))) {
      flush();
      i += 1;
      continue;
    }
    if (c === '$' && s[i + 1] === '$') {
      const close = s.indexOf('$$', i + 2);
      const stop = close < 0 ? s.length : close;
      math(s.slice(i + 2, stop).trim());
      i = stop + 2;
      continue;
    }
    if (c === '$') {
      let j = i + 1;
      while (j < s.length && !(s[j] === '$' && s[j - 1] !== '\\')) j += 1;
      buf += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c !== '\\') {
      buf += c;
      i += 1;
      continue;
    }
    const { name, end } = commandAt(s, i);
    if (name === '[') {
      const close = s.indexOf('\\]', end);
      const stop = close < 0 ? s.length : close;
      math(s.slice(end, stop).trim());
      i = stop + 2;
      continue;
    }
    if (name.length === 1) {
      buf += s.slice(i, end);
      i = end;
      continue;
    }
    if (name === 'begin') {
      const g = readGroup(s, skipSpace(s, end));
      if (!g) {
        i = end;
        continue;
      }
      const env = g.value.trim();
      const b = envBody(s, g.end, env);
      i = b.end;
      if (env === 'document') {
        parseBody(b.content, doc, ctx);
        continue;
      }
      if (SKIP_ENVS.includes(env)) continue;
      flush();
      if (env === 'abstract') {
        doc.blocks.push({ type: 'heading', level: 2, text: 'Abstract', abstract: true });
        parseBody(b.content, doc, ctx);
      } else if (LIST_ENVS.includes(env)) {
        const items = itemsOf(b.content, 0, ctx, []);
        if (items.length) doc.blocks.push({ type: 'list', items });
      } else if (FIGURE_ENVS.includes(env)) {
        const caption = captionOf(b.content, ctx, true);
        const paths = [...b.content.matchAll(/\\(?:includegraphics|includesvg)\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)].map((m) => m[1]);
        for (const p of paths) image(p, caption);
        if (!paths.length) {
          const rows = [...b.content.matchAll(/\\begin\s*\{(tabular\*?|tabularx|tabulary)\}/g)];
          if (rows.length) parseBody(b.content, doc, ctx);
          else if (caption) doc.blocks.push({ type: 'para', text: `Figure: ${caption}` });
        }
      } else if (TABLE_ENVS.includes(env)) {
        const caption = captionOf(b.content, ctx);
        if (caption) doc.blocks.push({ type: 'para', text: caption });
        const inner = /\\begin\s*\{(tabular\*?|tabularx|tabulary|longtable|array|xltabular)\}/.exec(b.content);
        if (inner) {
          const t = envBody(b.content, inner.index + inner[0].length, inner[1]);
          const { end: e } = readArgs(t.content, 0, TABULAR_ARGS[inner[1]] || 1);
          table(tabularRows(t.content.slice(e), ctx));
        }
      } else if (TABULAR_ARGS[env]) {
        const caption = captionOf(b.content, ctx);
        if (caption) doc.blocks.push({ type: 'para', text: caption });
        const { end: e } = readArgs(b.content, 0, TABULAR_ARGS[env]);
        table(tabularRows(b.content.slice(e), ctx));
      } else if (MATH_ENVS.includes(env)) {
        math(displayTex(env, b.content));
      } else if (QUOTE_ENVS.includes(env)) {
        const text = texText(env === 'epigraph' ? '' : b.content, ctx);
        if (text) doc.blocks.push({ type: 'quote', text });
      } else if (THEOREMS.includes(env.replace(/\*$/, ''))) {
        const opt = readOpt(b.content, 0);
        const word = env.replace(/\*$/, '');
        const lead = `${word[0].toUpperCase()}${word.slice(1)}${opt ? ` (${texText(opt.value, ctx)})` : ''}: `;
        parseBody(opt ? b.content.slice(opt.end) : b.content, doc, ctx, lead);
      } else {
        // center, minipage, columns and the like: their contents count.
        const { end: e } = /^(minipage|wrapfigure|multicols|subfigure|tcolorbox|adjustbox|resizebox|column)$/.test(env) ? readArgs(b.content, 0, env === 'adjustbox' ? 1 : env === 'multicols' ? 1 : 1) : { end: 0 };
        parseBody(b.content.slice(e), doc, ctx);
      }
      continue;
    }
    if (LEVELS[name] || name === 'paragraph' || name === 'subparagraph') {
      const { args, end: e } = readArgs(s, end, 1);
      i = e;
      const text = texText(args[0] || '', ctx);
      flush();
      if (LEVELS[name]) {
        if (text) doc.blocks.push({ type: 'heading', level: LEVELS[name], text });
      } else if (text) buf = `${text}${/[.:!?]$/.test(text) ? '' : ':'} `;
      continue;
    }
    if (/^(newpage|clearpage|cleardoublepage|pagebreak)$/.test(name)) {
      flush();
      doc.blocks.push({ type: 'break' });
      i = end;
      continue;
    }
    if (name === 'par') {
      flush();
      i = end;
      continue;
    }
    if (name === 'includegraphics' || name === 'includesvg') {
      const { args, end: e } = readArgs(s, end, 1);
      i = e;
      if (args[0]) {
        flush();
        image(args[0], '');
      }
      continue;
    }
    if (/^(maketitle|tableofcontents|listoffigures|listoftables|printbibliography|appendix|frontmatter|mainmatter|backmatter|title|author|date|institute|affil|address|email|keywords)$/.test(name)) {
      i = /^(title|author|date|institute|affil|address|email|keywords)$/.test(name) ? readArgs(s, end, 1).end : end;
      continue;
    }
    if (/^(newcommand|renewcommand|providecommand|DeclareMathOperator|newenvironment|renewenvironment|newtheorem|def|usepackage|bibliography|bibliographystyle|addbibresource|graphicspath|label|setlength|setcounter|vspace|hspace)$/.test(name)) {
      if (name === 'def') {
        const m = /^\\def\s*\\[a-zA-Z@]+[^{]*/.exec(s.slice(i));
        const g = m && readGroup(s, i + m[0].length);
        i = g ? g.end : end;
        continue;
      }
      i = readArgs(s, end, /command|environment|Operator/.test(name) ? 4 : name === 'newtheorem' || name === 'setlength' || name === 'setcounter' ? 2 : 1).end;
      continue;
    }
    buf += s.slice(i, end);
    i = end;
  }
  flush();
}

// A LaTeX project as a document for the deck: { title, subtitle, blocks,
// images (with the project path of each picture), tables, equations, macros }.
// files: [{ path, text }]. With fragment, only that piece of TeX is read,
// using the project's macros and label numbers.
export function readLatex(files, main, { fragment } = {}) {
  const texts = new Map(files.map((f) => [normPath(f.path), f.text || '']));
  const mainPath = normPath(main || '');
  const full = inlineFiles(texts.get(mainPath) || '', texts, dirOf(mainPath));
  const begin = /\\begin\s*\{document\}/.exec(full);
  const preamble = begin ? full.slice(0, begin.index) : '';
  const rest = begin ? envBody(full, begin.index + begin[0].length, 'document').content : full;
  const { simple, defs } = readMacros(full);
  const ctx = { labels: readLabels(rest), macros: simple };
  const doc = { title: '', subtitle: '', blocks: [], images: [], tables: [], equations: [], macros: defs, dir: dirOf(mainPath), graphicspath: [] };
  const arg = (cmd) => {
    const m = new RegExp(`\\\\${cmd}(?![a-zA-Z])`).exec(full);
    return m ? readArgs(full, m.index + m[0].length, 1).args[0] || '' : '';
  };
  doc.title = texText(arg('title').replace(/\\\\/g, ' '), ctx);
  doc.subtitle = texText(arg('author').replace(/\\and(?![a-zA-Z])/g, ', ').replace(/\\(thanks|footnote|inst|textsuperscript)\s*\{[^{}]*\}/g, '').replace(/\\\\[\s\S]*?(?=,|$)/g, ''), ctx).replace(/\s*,\s*,/g, ',').replace(/^,\s*|,\s*$/g, '');
  const gp = /\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}/.exec(preamble || full);
  if (gp) doc.graphicspath = [...gp[1].matchAll(/\{([^{}]*)\}/g)].map((m) => normPath(`${doc.dir}/${m[1]}`));

  if (fragment != null) {
    parseBody(stripComments(fragment), doc, ctx);
    return doc;
  }
  if (doc.title) doc.blocks.push({ type: 'heading', level: 1, text: doc.title });
  if (doc.title && doc.subtitle) doc.blocks.push({ type: 'para', text: doc.subtitle });
  const at = doc.blocks.length;
  parseBody(rest, doc, ctx);
  // Sections start at level 2, under the title.
  const levels = doc.blocks.slice(at).filter((b) => b.type === 'heading' && !b.abstract).map((b) => b.level);
  const shift = levels.length ? Math.min(...levels) - 2 : 0;
  for (const b of doc.blocks.slice(at)) {
    if (b.type !== 'heading') continue;
    b.level = b.abstract ? 2 : Math.max(2, Math.min(6, b.level - shift));
    delete b.abstract;
  }
  return doc;
}

const IMAGE_ORDER = ['png', 'jpg', 'jpeg', 'pdf', 'svg', 'gif', 'webp', 'bmp', 'eps'];

// The project file an \includegraphics name points to, trying \graphicspath
// folders and the usual extensions. paths: every file path in the project.
export function findGraphic(name, paths, { dir = '', graphicspath = [] } = {}) {
  const lower = new Map(paths.map((p) => [normPath(p).toLowerCase(), p]));
  const want = String(name).replace(/^"|"$/g, '').trim();
  for (const base of [dir, ...graphicspath, '']) {
    const stem = normPath(`${base}/${want}`).toLowerCase();
    const ext = extOf(stem);
    if (IMAGE_ORDER.includes(ext) && lower.has(stem)) return lower.get(stem);
    for (const e of IMAGE_ORDER) if (lower.has(`${stem}.${e}`)) return lower.get(`${stem}.${e}`);
  }
  return null;
}
