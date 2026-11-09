// The Visual editor for LaTeX mode: the same source, shown more like the
// finished document. Headings are big, bold is bold, maths and pictures are
// drawn, lists get bullets and the preamble folds away. Whatever the cursor
// is in turns back into plain LaTeX so it can be edited.

import { StateField, StateEffect, Compartment } from '@codemirror/state';
import { EditorView, Decoration, WidgetType } from '@codemirror/view';

export const visualMode = new Compartment();
export const refreshVisual = StateEffect.define();

let math = null;
let mathReady = null;
function loadMath(onReady) {
  if (math) return math;
  if (!mathReady) {
    const url = './mathjax.js';
    mathReady = import(url).then((m) => {
      math = m;
      onReady?.();
      return m;
    }).catch(() => {
      mathReady = null;
    });
  }
  return null;
}

const mathCache = new Map();
function mathSvg(tex, display) {
  const key = `${display ? 'D' : 'I'}${tex}`;
  if (mathCache.has(key)) return mathCache.get(key);
  let out;
  try {
    out = { svg: math.texToSvg(tex, { display, fontSize: display ? 19 : 16.5 }).svg };
  } catch (err) {
    out = { error: err.message };
  }
  if (mathCache.size > 800) mathCache.clear();
  mathCache.set(key, out);
  return out;
}

let wake = () => {};

class MathWidget extends WidgetType {
  constructor(tex, display, block) {
    super();
    this.tex = tex;
    this.display = display;
    this.block = block;
    this.ready = !!math;
  }
  eq(o) {
    return o.tex === this.tex && o.display === this.display && o.block === this.block && o.ready === this.ready;
  }
  toDOM() {
    const el = document.createElement(this.block ? 'div' : 'span');
    el.className = this.block ? 'cm-vis-math block' : 'cm-vis-math';
    if (!math) {
      loadMath(() => wake());
      el.textContent = this.tex;
      el.classList.add('loading');
      return el;
    }
    const r = mathSvg(this.tex, this.display);
    if (r.error) {
      el.textContent = this.tex;
      el.classList.add('error');
      el.title = r.error;
    } else el.innerHTML = r.svg;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class TextWidget extends WidgetType {
  constructor(text, cls, title = '') {
    super();
    this.text = text;
    this.cls = cls;
    this.title = title;
  }
  eq(o) {
    return o.text === this.text && o.cls === this.cls;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = this.cls;
    el.textContent = this.text;
    if (this.title) el.title = this.title;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class BlockText extends WidgetType {
  constructor(html, cls) {
    super();
    this.html = html;
    this.cls = cls;
  }
  eq(o) {
    return o.html === this.html;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = this.cls;
    el.innerHTML = this.html;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

let pictures = { get: () => null };
class PictureWidget extends WidgetType {
  constructor(path, width) {
    super();
    this.path = path;
    this.width = width;
    this.src = pictures.get(path, () => wake());
  }
  eq(o) {
    return o.path === this.path && o.width === this.width && o.src === this.src;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-vis-pic';
    const src = this.src;
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = this.path;
      img.style.width = `${Math.round(Math.min(1, this.width) * 100)}%`;
      el.append(img);
    } else {
      el.textContent = src === false ? `Picture not found: ${this.path}` : 'Loading picture…';
      el.classList.add('missing');
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const HEADS = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 5, title: 0 };
const STYLE = { textbf: 'cm-vis-b', textit: 'cm-vis-i', emph: 'cm-vis-i', underline: 'cm-vis-u', texttt: 'cm-vis-tt', textsc: 'cm-vis-sc', textsf: 'cm-vis-sf' };
const LIST_ENVS = /^(itemize|enumerate|description|center|flushleft|flushright|quote|quotation|abstract|figure|table|minipage|subfigure)\*?$/;

// Matching closing brace for the one at open, or -1.
function closeBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    } else if (c === '\n' && text[i + 1] === '\n') return -1;
  }
  return -1;
}

function build(state) {
  const text = state.doc.toString();
  const sel = state.selection.ranges;
  const touched = (from, to) => sel.some((r) => r.from <= to && r.to >= from);
  const marks = [];
  const replaces = [];
  const lines = [];
  const add = (from, to, deco) => replaces.push({ from, to, deco });
  const lineClass = (pos, cls) => lines.push(Decoration.line({ class: cls }).range(state.doc.lineAt(pos).from));

  // Comments are left alone: find them so nothing inside one is drawn.
  const commentAt = [];
  for (const m of text.matchAll(/(^|[^\\])%[^\n]*/gm)) commentAt.push([m.index + m[1].length, m.index + m[0].length]);
  const inComment = (pos) => commentAt.some(([a, b]) => pos >= a && pos < b);

  // The preamble folds into one line.
  const begin = /\\begin\s*\{document\}/.exec(text);
  let bodyStart = 0;
  if (begin) {
    const endLine = state.doc.lineAt(begin.index + begin[0].length);
    bodyStart = endLine.to;
    if (!touched(0, endLine.to) && endLine.number > 1) {
      const title = /\\title\s*\{([^{}]*)\}/.exec(text.slice(0, begin.index))?.[1];
      const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(text)?.[1];
      add(0, endLine.to, Decoration.replace({ block: true, widget: new BlockText(`<b>Preamble</b><span>${[cls ? `${cls} document` : '', `${endLine.number - 1} lines`, title ? `“${escapeText(title)}”` : ''].filter(Boolean).join(' · ')}</span><small>Click to edit</small>`, 'cm-vis-preamble') }));
    }
  }

  // Display maths: \[ … \], $$ … $$ and equation-like environments.
  const displayRe = /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\begin\{((?:equation|align|gather|multline|eqnarray|displaymath|flalign|alignat)\*?)\}([\s\S]*?)\\end\{\3\}/g;
  for (const m of text.matchAll(displayRe)) {
    const from = m.index;
    const to = from + m[0].length;
    if (from < bodyStart || inComment(from)) continue;
    if (touched(from, to)) continue;
    let tex = m[1] ?? m[2] ?? m[4];
    tex = tex.replace(/\\label\{[^}]*\}/g, '').replace(/\\(?:nonumber|notag)\b/g, '').trim();
    if (m[3] && /^(align|flalign|alignat|eqnarray)/.test(m[3])) tex = `\\begin{aligned}${tex}\\end{aligned}`;
    if (m[3] && /^gather/.test(m[3])) tex = `\\begin{gathered}${tex}\\end{gathered}`;
    if (m[3] && /^multline/.test(m[3])) tex = `\\begin{gathered}${tex}\\end{gathered}`;
    const a = state.doc.lineAt(from);
    const b = state.doc.lineAt(to);
    const whole = !text.slice(a.from, from).trim() && !text.slice(to, b.to).trim();
    if (whole) add(a.from, b.to, Decoration.replace({ block: true, widget: new MathWidget(tex, true, true) }));
    else if (a.number === b.number) add(from, to, Decoration.replace({ widget: new MathWidget(tex, true, false) }));
  }

  // Inline maths.
  for (const m of text.matchAll(/(?<![\\$])\$(?!\$)((?:\\.|[^$\\\n])+?)\$|\\\((.+?)\\\)/g)) {
    const from = m.index;
    const to = from + m[0].length;
    if (from < bodyStart || inComment(from) || touched(from, to)) continue;
    add(from, to, Decoration.replace({ widget: new MathWidget((m[1] ?? m[2]).trim(), false, false) }));
  }

  // Commands with one argument: headings, text styles, references.
  for (const m of text.matchAll(/\\([a-zA-Z]+)(\*?)(?:\[[^\]\n]*\])?\s*\{/g)) {
    const name = m[1];
    const from = m.index;
    if (from < bodyStart && name !== 'title') continue;
    if (inComment(from)) continue;
    const open = from + m[0].length - 1;
    if (name in HEADS || name in STYLE || /^(cite|citep|citet|parencite|textcite|autocite|ref|eqref|autoref|cref|Cref|pageref|label|footnote|href|url|item|begin|end|includegraphics)$/.test(name)) {
      const close = closeBrace(text, open);
      if (close < 0) continue;
      const inner = text.slice(open + 1, close);
      const to = close + 1;
      if (name in HEADS) {
        if (name === 'title') continue;
        lineClass(from, `cm-vis-h cm-vis-h${HEADS[name]}`);
        if (!touched(from, to)) {
          add(from, open + 1, Decoration.replace({}));
          add(close, to, Decoration.replace({}));
        }
      } else if (name in STYLE) {
        marks.push(Decoration.mark({ class: STYLE[name] }).range(open + 1, close));
        if (!touched(from, to)) {
          add(from, open + 1, Decoration.replace({}));
          add(close, to, Decoration.replace({}));
        }
      } else if (/cite|ref$|^cref|^Cref/.test(name) && !touched(from, to)) {
        const keys = inner.split(',').map((k) => k.trim()).filter(Boolean);
        const shown = /cite/.test(name) ? `[${keys.join(', ')}]` : `↗ ${keys.join(', ')}`;
        add(from, to, Decoration.replace({ widget: new TextWidget(shown, /cite/.test(name) ? 'cm-vis-chip cite' : 'cm-vis-chip ref', m[0] + inner + '}') }));
      } else if (name === 'label' && !touched(from, to)) {
        add(from, to, Decoration.replace({ widget: new TextWidget(`# ${inner}`, 'cm-vis-chip label', `\\label{${inner}}`) }));
      } else if (name === 'footnote' && !touched(from, to)) {
        marks.push(Decoration.mark({ class: 'cm-vis-foot' }).range(open + 1, close));
        add(from, open + 1, Decoration.replace({ widget: new TextWidget('Footnote: ', 'cm-vis-foot-tag') }));
        add(close, to, Decoration.replace({}));
      } else if ((name === 'begin' || name === 'end') && LIST_ENVS.test(inner)) {
        lineClass(from, 'cm-vis-env');
      } else if (name === 'includegraphics') {
        const opts = /\[([^\]]*)\]/.exec(m[0])?.[1] || '';
        const w = /width\s*=\s*([\d.]+)?\s*\\(?:line|text|column)width/.exec(opts);
        const width = w ? Number(w[1] || 1) : 0.6;
        const line = state.doc.lineAt(to);
        lines.push(Decoration.widget({ block: true, side: 1, widget: new PictureWidget(inner.trim(), width) }).range(line.to));
      }
    }
  }

  // \maketitle shows the title, authors and date.
  const pre = begin ? text.slice(0, begin.index) : '';
  for (const m of text.matchAll(/\\maketitle\b/g)) {
    if (m.index < bodyStart || inComment(m.index) || touched(m.index, m.index + m[0].length)) continue;
    const arg = (cmd) => {
      const at = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`).exec(pre);
      if (!at) return '';
      const open = at.index + at[0].length - 1;
      const close = closeBrace(pre, open);
      return close < 0 ? '' : pre.slice(open + 1, close).replace(/\\\\/g, ', ').replace(/\\(?:and|thanks\{[^}]*\})/g, ' · ').replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '').trim();
    };
    const title = arg('title');
    const author = arg('author');
    const date = /\\date\s*\{\s*\}/.test(pre) ? '' : arg('date') || new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
    add(m.index, m.index + m[0].length, Decoration.replace({ widget: new BlockText(`<div class="t">${escapeText(title || 'Untitled')}</div>${author ? `<div class="a">${escapeText(author)}</div>` : ''}${date ? `<div class="d">${escapeText(date)}</div>` : ''}`, 'cm-vis-title') }));
  }

  // A tie is a space that doesn't break.
  for (const m of text.matchAll(/(?<!\\)~/g)) {
    if (m.index < bodyStart || inComment(m.index) || touched(m.index, m.index + 1)) continue;
    add(m.index, m.index + 1, Decoration.replace({ widget: new TextWidget('\u00a0', 'cm-vis-tie') }));
  }

  // List items get a bullet.
  for (const m of text.matchAll(/\\item\b(?:\[[^\]\n]*\])?\s?/g)) {
    const from = m.index;
    const to = from + m[0].length;
    if (from < bodyStart || inComment(from) || touched(from, to)) continue;
    const tag = /\[([^\]]*)\]/.exec(m[0])?.[1];
    add(from, to, Decoration.replace({ widget: new TextWidget(tag ? `${tag} ` : '•  ', 'cm-vis-bullet') }));
  }

  // Keep replacements that don't overlap one already kept.
  replaces.sort((a, b) => a.from - b.from || b.to - a.to);
  const kept = [];
  let end = -1;
  for (const r of replaces) {
    if (r.from < end) continue;
    kept.push(r.deco.range(r.from, r.to));
    end = Math.max(end, r.to);
  }
  return Decoration.set([...kept, ...marks, ...lines], true);
}

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const visualField = StateField.define({
  create: (state) => build(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshVisual))) return build(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const visualTheme = EditorView.theme({
  '&': { background: 'var(--page)' },
  '.cm-content': { fontFamily: 'var(--vis-font, "Latin Modern Roman", "Computer Modern", "CMU Serif", Cambria, Georgia, serif)', maxWidth: '46em', margin: '0 auto', padding: '18px 28px 120px' },
  '.cm-line': { lineHeight: '1.65' },
});

// pictureSource.get(path, onLoad) returns a data URL, null while loading, or false.
export function visualExtension({ pictureSource, onWake }) {
  pictures = pictureSource;
  wake = onWake;
  return [visualField, visualTheme, EditorView.editorAttributes.of({ class: 'cm-visual' })];
}
