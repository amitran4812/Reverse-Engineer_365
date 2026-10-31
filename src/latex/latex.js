// Write's LaTeX mode: a project folder with a file tree, a code editor with
// LaTeX suggestions, and a live PDF preview, side by side.

import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, highlightSpecialChars, hoverTooltip } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion, snippet } from '@codemirror/autocomplete';
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import '../shared/ui.css';
import './latex.css';
import { createShell, dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import { popup, closePopup } from '../shared/ribbon.js';
import { openCiteDialog } from '../shared/cite.js';
import cite from '../../common/cite.js';
import { codeBlock } from '../shared/claude-pane.js';
import { bibEntries, labels, outline, userCommands, userEnvironments, fileKind, findMain, parseSynctex, synctexForward, synctexBackward } from '../../common/latex.js';
import { latexCompletions, COMMANDS } from './completions.js';
import { PdfView } from './pdf-view.js';
import '../shared/dark.css';

const info = await window.office.launchInfo();
const project = info.file.latex;
const api = window.office.latex;
const prefsKey = `latex:${project.root}`;
const prefs = (() => {
  try {
    return { dock: false, auto: true, engine: 'auto', sideW: 300, editorFrac: 0.5, closed: [], fontSize: 14, ...JSON.parse(localStorage.getItem(prefsKey) || '{}') };
  } catch {
    return { dock: false, auto: true, engine: 'auto', sideW: 300, editorFrac: 0.5, closed: [], fontSize: 14 };
  }
})();
const savePrefs = () => {
  try {
    localStorage.setItem(prefsKey, JSON.stringify(prefs));
  } catch {
    // storage unavailable: keep the layout for this session only
  }
};

let files = [];
const buffers = new Map(); // path -> { state, saved, dirty, kind }
let current = null;
let mainFile = prefs.main || project.main || null;
let index = { bib: [], labels: [], files: [], commands: [], environments: [] };
let sources = [];
let issues = [];
let sync = null;
let compiling = false;
let compileAgain = false;
let changedSinceCompile = true;
let lastLog = '';
let engines = [];
let view = null;
let editorShown = false;

// ---- Editor ----

// Colors come from latex.css, with dark ones in dark.css.
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--hl-keyword)' },
  { tag: [t.tagName, t.typeName], color: 'var(--hl-tag)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: [t.bracket, t.paren, t.squareBracket], color: 'var(--hl-bracket)' },
  { tag: t.string, color: 'var(--hl-string)' },
  { tag: [t.atom, t.number], color: 'var(--hl-atom)' },
  { tag: t.variableName, color: 'var(--hl-variable)' },
  { tag: t.meta, color: 'var(--hl-meta)' },
  { tag: t.invalid, color: 'var(--hl-invalid)' },
]);
const texLanguage = StreamLanguage.define(stex);
const fontTheme = new Compartment();
const fontCss = (px) => EditorView.theme({ '&': { fontSize: `${px}px` } });

const commandInfo = new Map(COMMANDS.map(([name, , detail]) => [name, detail]));
const commandHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;
  while (start > 0 && /[a-zA-Z@*]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[a-zA-Z@*]/.test(text[end])) end += 1;
  if (text[start - 1] !== '\\') return null;
  const name = text.slice(start, end);
  const own = index.commands.find((c) => c.name === name);
  const detail = commandInfo.get(name) || (own ? 'Defined in this project' : null);
  if (!detail) return null;
  return {
    pos: line.from + start - 1,
    end: line.from + end,
    above: true,
    create: () => ({ dom: h('div', 'tex-hover', `<b>\\${escapeHtml(name)}</b> ${escapeHtml(detail)}`) }),
  };
});

function wrapWith(before, after = '}') {
  return (view) => {
    view.dispatch(view.state.changeByRange((range) => ({
      changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
      range: EditorSelection.range(range.from + before.length, range.to + before.length),
    })), { scrollIntoView: true, userEvent: 'input' });
    return true;
  };
}

const texKeys = [
  { key: 'Mod-Enter', run: () => (compile(), true) },
  { key: 'Mod-b', run: wrapWith('\\textbf{') },
  { key: 'Mod-i', run: wrapWith('\\textit{') },
  { key: 'Mod-/', run: toggleComment },
  { key: 'Mod-Shift-l', run: () => (syncToPdf(), true) },
];

function extensionsFor(kind) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    lintGutter(),
    EditorView.lineWrapping,
    syntaxHighlighting(highlight),
    fontTheme.of(fontCss(prefs.fontSize)),
    keymap.of([...texKeys, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab]),
    ...(kind === 'tex' ? [texLanguage, autocompletion({ override: [latexCompletions(() => index)], activateOnTyping: true, icons: true }), commandHover] : []),
    ...(kind === 'bib' ? [autocompletion({ override: [bibCompletions] })] : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onEdit();
      if (u.selectionSet || u.docChanged) updateCursorStatus();
    }),
  ];
}

const BIB_TYPES = {
  article: 'author = {${}},\n  title = {${}},\n  journal = {${}},\n  year = {${}},\n  volume = {${}},\n  pages = {${}}',
  book: 'author = {${}},\n  title = {${}},\n  publisher = {${}},\n  year = {${}}',
  inproceedings: 'author = {${}},\n  title = {${}},\n  booktitle = {${}},\n  year = {${}}',
  misc: 'author = {${}},\n  title = {${}},\n  howpublished = {\\url{${}}},\n  year = {${}}',
  phdthesis: 'author = {${}},\n  title = {${}},\n  school = {${}},\n  year = {${}}',
  techreport: 'author = {${}},\n  title = {${}},\n  institution = {${}},\n  year = {${}}',
  online: 'author = {${}},\n  title = {${}},\n  url = {${}},\n  urldate = {${}}',
};
function bibCompletions(context) {
  const word = context.matchBefore(/@[a-zA-Z]*/);
  if (!word) return null;
  return {
    from: word.from,
    options: Object.entries(BIB_TYPES).map(([type, body]) => ({ label: `@${type}`, type: 'class', apply: (view, c, from, to) => snippet(`@${type}{\${key},\n  ${body}\n}`)(view, c, from, to) })),
  };
}

// ---- Ribbon ----

const isTex = () => editorShown && !!current && fileKind(current) === 'tex';
const homeTab = {
  id: 'home',
  label: 'Home',
  groups: [
    { label: 'Compile', items: [
      { type: 'big', icon: 'compile', label: 'Recompile', shortcut: 'Ctrl+Enter', run: () => compile() },
      { type: 'stack', items: [
        { type: 'small', icon: 'live', label: 'Compile as I type', run: () => { prefs.auto = !prefs.auto; savePrefs(); shell.refresh(); }, active: () => prefs.auto },
        { type: 'small', icon: 'log', label: 'Logs', run: () => toggleLogs() },
        { type: 'small', icon: 'export', label: 'Download PDF', run: () => downloadPdf() },
      ] },
    ] },
    { label: 'Project', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'newFile', label: 'New file', run: () => newFile('') },
        { type: 'small', icon: 'folder', label: 'New folder', run: () => newFolder('') },
        { type: 'small', icon: 'upload', label: 'Upload', run: (e, b) => uploadMenu(b, '') },
      ] },
      { type: 'big', icon: 'save', label: 'Save All', shortcut: 'Ctrl+S', run: () => shell.save() },
    ] },
    { label: 'Format', items: [
      { type: 'row', items: [
        { type: 'text', text: 'B', style: 'font-weight:700', title: 'Bold \\textbf', shortcut: 'Ctrl+B', run: () => insert('\\textbf{$SEL}'), enabled: isTex },
        { type: 'text', text: 'I', style: 'font-style:italic', title: 'Italic \\textit', shortcut: 'Ctrl+I', run: () => insert('\\textit{$SEL}'), enabled: isTex },
        { type: 'text', text: 'U', style: 'text-decoration:underline', title: 'Underline \\underline', run: () => insert('\\underline{$SEL}'), enabled: isTex },
        { type: 'text', text: 'T', style: 'font-family:Consolas,monospace', title: 'Monospace \\texttt', run: () => insert('\\texttt{$SEL}'), enabled: isTex },
        { type: 'text', text: 'E', style: 'font-style:italic;font-family:Georgia,serif', title: 'Emphasis \\emph', run: () => insert('\\emph{$SEL}'), enabled: isTex },
      ] },
      { type: 'row', items: [
        { type: 'icon', icon: 'bullets', title: 'Bulleted list', run: () => insertBlock('\\begin{itemize}\n\t\\item $SEL\n\\end{itemize}\n'), enabled: isTex },
        { type: 'icon', icon: 'numbers', title: 'Numbered list', run: () => insertBlock('\\begin{enumerate}\n\t\\item $SEL\n\\end{enumerate}\n'), enabled: isTex },
        { type: 'icon', icon: 'quote', title: 'Quote', run: () => insertBlock('\\begin{quote}\n\t$SEL\n\\end{quote}\n'), enabled: isTex },
        { type: 'icon', icon: 'alignCenter', title: 'Center', run: () => insertBlock('\\begin{center}\n\t$SEL\n\\end{center}\n'), enabled: isTex },
      ] },
    ] },
    { label: 'Editing', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'find', label: 'Find & replace', shortcut: 'Ctrl+F', run: () => view && openSearchPanel(view) },
        { type: 'small', icon: 'toPdf', label: 'Show in PDF', shortcut: 'Ctrl+Shift+L', run: () => syncToPdf() },
        { type: 'small', icon: 'chat', label: 'Comment line', shortcut: 'Ctrl+/', run: () => view && toggleComment(view) },
      ] },
    ] },
    { label: 'AI', items: [
      { type: 'big', icon: 'sparkle', label: 'LaTeX Helper', title: 'Ask the AI to write, explain or fix LaTeX (Ctrl+J)', run: () => shell.claude.toggle() },
    ] },
  ],
};

const SECTIONS = [['part', 'Part'], ['chapter', 'Chapter'], ['section', 'Section'], ['subsection', 'Subsection'], ['subsubsection', 'Subsubsection'], ['paragraph', 'Paragraph']];
const insertTab = {
  id: 'insert',
  label: 'Insert',
  groups: [
    { label: 'Structure', items: [
      { type: 'menu', big: true, icon: 'outline', label: 'Heading', items: SECTIONS.map(([cmd, label]) => ({ label, run: () => insertBlock(`\\${cmd}{\${$SEL}}\n\\label{${cmd === 'section' ? 'sec' : cmd.slice(0, 3)}:\${label}}\n`) })) },
      { type: 'stack', items: [
        { type: 'small', icon: 'pageBreak', label: 'New page', run: () => insertBlock('\\newpage\n') },
        { type: 'small', icon: 'notes', label: 'Abstract', run: () => insertBlock('\\begin{abstract}\n\t$SEL\n\\end{abstract}\n') },
        { type: 'small', icon: 'outline', label: 'Contents', run: () => insertBlock('\\tableofcontents\n') },
      ] },
    ] },
    { label: 'Floats', items: [
      { type: 'big', icon: 'table', label: 'Table', run: insertTable },
      { type: 'menu', big: true, icon: 'image', label: 'Figure', items: () => [
        { label: 'Image from this computer…', icon: 'attach', run: insertImageFromComputer },
        ...files.filter((f) => f.kind === 'image').slice(0, 30).map((f) => ({ label: f.path, icon: 'imageFile', run: () => insertGraphic(f.path) })),
        ...(files.some((f) => f.kind === 'image') ? [] : [{ label: 'Empty figure', icon: 'image', run: () => insertGraphic('${file}') }]),
      ] },
    ] },
    { label: 'Math', items: [
      { type: 'menu', big: true, icon: 'equation', label: 'Equation', items: [
        { label: 'Inline math  $ … $', run: () => insert('$${$SEL}$') },
        { label: 'Numbered equation', run: () => insertBlock('\\begin{equation}\n\t$SEL\n\t\\label{eq:${label}}\n\\end{equation}\n') },
        { label: 'Unnumbered equation', run: () => insertBlock('\\[\n\t$SEL\n\\]\n') },
        { label: 'Aligned equations', run: () => insertBlock('\\begin{align}\n\t${a} &= ${b} \\\\\n\t${c} &= ${d}\n\\end{align}\n') },
        { label: 'Fraction', run: () => insert('\\frac{${num}}{${den}}') },
        { label: 'Matrix', run: () => insert('\\begin{pmatrix}\n\t${a} & ${b} \\\\\n\t${c} & ${d}\n\\end{pmatrix}') },
      ] },
    ] },
    { label: 'References', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'cite', label: 'Citation', run: () => insert('\\cite{${}}', { select: true }) },
        { type: 'small', icon: 'bibFile', label: 'Cite a paper…', title: 'Find a paper by DOI, arXiv id, title or PDF and add it to the .bib file', run: () => citePaper() },
        { type: 'small', icon: 'link', label: 'Cross-reference', run: () => insert('\\ref{${}}', { select: true }) },
        { type: 'small', icon: 'label', label: 'Label', run: () => insert('\\label{${key}}') },
      ] },
      { type: 'stack', items: [
        { type: 'small', icon: 'textbox', label: 'Footnote', run: () => insert('\\footnote{${$SEL}}') },
        { type: 'small', icon: 'link', label: 'Link', run: () => insert('\\href{${https://}}{${$SEL}}') },
        { type: 'small', icon: 'bibFile', label: 'Bibliography', run: () => insertBlock(`\\bibliographystyle{plain}\n\\bibliography{${(files.find((f) => f.kind === 'bib')?.path || 'references.bib').replace(/\.bib$/, '')}}\n`) },
      ] },
    ] },
  ],
};

const viewTab = {
  id: 'view',
  label: 'View',
  groups: [
    { label: 'Panes', items: [
      { type: 'big', icon: 'folderOpen', label: 'Files', run: () => toggleFiles('top'), active: () => prefs.dock || filesOpen },
      { type: 'big', icon: 'preview', label: 'PDF Preview', run: () => setPreview(prefs.preview === false), active: () => prefs.preview !== false },
      { type: 'big', icon: 'sparkle', label: 'AI Pane', run: () => shell.claude.toggle() },
    ] },
    { label: 'PDF', items: [
      { type: 'big', icon: 'zoomIn', label: 'Zoom In', run: () => pdf.setZoom(pdf.scale * 1.15) },
      { type: 'big', icon: 'zoomOut', label: 'Zoom Out', run: () => pdf.setZoom(pdf.scale / 1.15) },
      { type: 'big', icon: 'find', label: 'Fit Width', run: () => pdf.setZoom('fit') },
    ] },
    { label: 'Editor', items: [
      { type: 'select', title: 'Editor font size', width: 70, options: [11, 12, 13, 14, 15, 16, 18, 20, 24].map((n) => ({ value: String(n), label: `${n} px` })), value: () => String(prefs.fontSize), change: (v) => setFontSize(Number(v)) },
    ] },
  ],
};

function setFontSize(px) {
  prefs.fontSize = px;
  savePrefs();
  const fx = fontTheme.reconfigure(fontCss(px));
  if (view) view.dispatch({ effects: fx });
  for (const [path, buf] of buffers) if (path !== current) buf.state = buf.state.update({ effects: fx }).state;
}

// ---- LaTeX helper (AI) ----

function latexOut(t) {
  return codeBlock(t, ['latex', 'tex', 'bibtex', '']) ?? t.trim();
}
const replaceSel = (t) => ({ label: 'Replace selection', icon: 'replace', run: () => replaceSelection(latexOut(t)) });
const insertAt = (t) => ({ label: 'Insert at cursor', icon: 'plus', run: () => replaceSelection(latexOut(t), true) });

function replaceSelection(text, atCursor = false) {
  if (!view) return;
  const sel = view.state.selection.main;
  const from = atCursor ? sel.head : sel.from;
  const to = atCursor ? sel.head : sel.to;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, scrollIntoView: true });
  view.focus();
}

const QUICK = {
  write: { label: 'Write LaTeX', icon: 'wand', prompt: 'Write LaTeX for the request below, to go into this file at the cursor. Use packages the document already loads where you can; if it needs another package, name it in one short line after the code. Reply with one ```latex code block.', input: 'Describe what to add, e.g. a 3-column table of results…', actions: (t) => [insertAt(t), replaceSel(t)] },
  explain: { label: 'Explain this LaTeX', icon: 'help', prompt: 'Explain what the selected LaTeX does (or the line at the cursor if nothing is selected), in plain words. Keep it short: one bullet per command or environment that matters.', actions: () => [] },
  fix: { label: 'Fix compile errors', icon: 'proofread', prompt: 'The project fails to compile with the errors listed in <errors>. Explain the cause of each in one line. Then give the corrected version of the open file as one ```latex code block containing the whole file, changing only what is needed.', actions: (t) => [{ label: 'Apply to file', icon: 'replace', run: () => replaceFile(latexOut(t)) }, insertAt(t)] },
  convert: { label: 'Convert to LaTeX', icon: 'equation', prompt: 'Convert the selected text to LaTeX. Plain-language math (for example “x squared over two”) becomes math mode; tables, lists and headings become the matching LaTeX. Reply with one ```latex code block.', actions: (t) => [replaceSel(t), insertAt(t)] },
  table: { label: 'Table from data', icon: 'table', prompt: 'Make a LaTeX table (booktabs, with \\caption and \\label inside a table float) from the data or description below. Reply with one ```latex code block.', input: 'Paste rows (CSV or tab separated) or describe the table…', actions: (t) => [insertAt(t)] },
  improve: { label: 'Improve the writing', icon: 'wand', prompt: 'Improve the wording of the selected text so it reads clearly and academically. Keep every LaTeX command, citation, label and math expression exactly as it is. Reply with one ```latex code block.', actions: (t) => [replaceSel(t)] },
  command: { label: 'Which command do I need?', icon: 'chat', prompt: 'Answer this LaTeX question briefly. Show the command or environment to use with a small example in a ```latex block, and say which package it needs if any.', input: 'e.g. How do I put two figures side by side?', actions: (t) => [insertAt(t)] },
};

function replaceFile(text) {
  if (!view) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  view.focus();
  toast('Applied. Press Ctrl+Z to undo.');
}

function claudeConfig() {
  return {
    intro: 'I’m your LaTeX helper. Ask me to write LaTeX (“a 3-column table of results”), explain a command, convert plain text or math to LaTeX, or fix compile errors.',
    placeholder: 'Ask about LaTeX, or describe what to write…',
    system: [
      'You are a LaTeX expert built into Write, a desktop editor with a LaTeX mode. The open file, the cursor’s surroundings, the selection, the project’s labels and citation keys, and the latest compile errors are provided in tags.',
      'When asked to write or change LaTeX, reply with the LaTeX in one ```latex fenced code block that can be inserted directly, with at most two short sentences outside it. Use \\ref and \\cite only with labels and keys that exist in the project unless asked to add new ones.',
      'When asked a question, answer concisely, with a short example when it helps.',
    ].join('\n'),
    context: () => {
      if (!view || !current) return `<project main="${escapeHtml(mainFile || '')}">No file open.</project>`;
      const doc = view.state.doc.toString();
      const sel = view.state.selection.main;
      const lineNo = view.state.doc.lineAt(sel.head).number;
      const chosen = view.state.sliceDoc(sel.from, sel.to);
      const errs = issues.filter((i) => i.level === 'error').slice(0, 20).map((i) => `${i.file || ''}${i.line ? `:${i.line}` : ''} ${i.message}`).join('\n');
      return [
        `<file name="${escapeHtml(current)}" main="${escapeHtml(mainFile || '')}" cursor_line="${lineNo}">\n${doc.slice(0, 120000)}\n</file>`,
        chosen ? `<selection>\n${chosen}\n</selection>` : `<cursor_line>${view.state.doc.line(lineNo).text}</cursor_line>`,
        `<labels>${index.labels.slice(0, 300).map((l) => l.label).join(', ')}</labels>`,
        `<citation_keys>${index.bib.slice(0, 300).map((b) => b.key).join(', ')}</citation_keys>`,
        `<errors>${errs || 'none'}</errors>`,
      ].join('\n');
    },
    quick: [QUICK.write, QUICK.explain, QUICK.convert, QUICK.fix, QUICK.command],
    actions: (t) => (/```/.test(t) ? [insertAt(t), replaceSel(t)] : []),
  };
}

const aiTab = {
  id: 'claude',
  label: 'LaTeX Helper',
  special: true,
  groups: [
    { label: 'Write', items: [
      { type: 'big', icon: 'wand', label: 'Write LaTeX', run: () => shell.claude.runQuick(QUICK.write) },
      { type: 'big', icon: 'table', label: 'Table from Data', run: () => shell.claude.runQuick(QUICK.table) },
      { type: 'big', icon: 'equation', label: 'Convert to LaTeX', run: () => shell.claude.runQuick(QUICK.convert) },
    ] },
    { label: 'Understand', items: [
      { type: 'big', icon: 'help', label: 'Explain', run: () => shell.claude.runQuick(QUICK.explain) },
      { type: 'big', icon: 'chat', label: 'Which Command?', run: () => shell.claude.runQuick(QUICK.command) },
    ] },
    { label: 'Fix', items: [
      { type: 'big', icon: 'proofread', label: 'Fix Errors', run: () => shell.claude.runQuick(QUICK.fix) },
      { type: 'big', icon: 'wand', label: 'Improve Writing', run: () => shell.claude.runQuick(QUICK.improve) },
    ] },
  ],
};


// ---- Shell ----

const shell = await createShell({
  app: 'docs',
  defaultExt: 'tex',
  tabs: [homeTab, insertTab, viewTab],
  claudeTab: aiTab,
  undo: () => view && undo(view),
  redo: () => view && redo(view),
  getSaveData: () => ({}),
  customSave: async () => {
    await saveAll();
    compile();
    return true;
  },
  customSaveAs: () => saveCurrentAs(),
  exportPdf: () => downloadPdf(),
  print: () => api.openPdf(mainFile).then((r) => r?.error && toast(r.error, 'error')),
  exports: [],
  claude: claudeConfig(),
});
shell.state.name = project.root.split(/[\\/]/).pop();
shell.setTitle();
shell.root.classList.add('app-latex');

// ---- Layout ----

const rootEl = h('div', 'tex');
const side = h('aside', 'tex-side');
const splitA = h('div', 'tex-split tex-split-a');
const edPane = h('section', 'tex-ed-pane');
const splitB = h('div', 'tex-split tex-split-b');
const pvPane = h('section', 'tex-pv-pane');
rootEl.append(side, splitA, edPane, splitB, pvPane);
shell.workspace.append(rootEl);

// Files: a pop-up opened from the Files tab or the corner button, or a pinned
// pane. It holds the file tree, upload and the outline.
side.innerHTML = `
  <div class="tex-side-head"><b>Files</b><span class="tex-side-tools"></span></div>
  <div class="tex-side-summary"></div>
  <div class="tex-tree" tabindex="0"></div>
  <div class="tex-side-head tex-outline-head"><b>Outline</b></div>
  <div class="tex-outline"></div>`;
const treeEl = side.querySelector('.tex-tree');
const outlineEl = side.querySelector('.tex-outline');
const sideTools = side.querySelector('.tex-side-tools');
const tool = (ic, title, run) => {
  const b = h('button', 'tex-tool', icon(ic, 16));
  b.title = title;
  b.onmousedown = (e) => e.preventDefault();
  b.onclick = run;
  return b;
};
const uploadBtn = h('button', 'tex-upload', `${icon('upload', 16)}<span>Upload</span>${icon('chevronDown', 10)}`);
uploadBtn.title = 'Add files or a zipped project';
uploadBtn.onmousedown = (e) => e.preventDefault();
uploadBtn.onclick = () => uploadMenu(uploadBtn, '');
const pinBtn = tool('pin', '', () => setDock(!prefs.dock));
sideTools.append(
  uploadBtn,
  tool('newFile', 'New file', () => newFile('')),
  tool('folder', 'New folder', () => newFolder('')),
  tool('refresh', 'Refresh', () => refreshFiles()),
  pinBtn,
  tool('close', 'Close', () => (prefs.dock ? setDock(false) : closeFiles())),
);
const summaryEl = side.querySelector('.tex-side-summary');

// The same pop-up opens from the ribbon's tab bar and the status bar's corner.
const filesLabel = () => `${icon('folderOpen', 16)}<span>Files</span><span class="tex-files-count"></span>`;
const filesTab = h('button', 'rb-tab tex-files-tab', filesLabel());
filesTab.title = 'Project files and upload';
filesTab.onclick = () => toggleFiles('top');
shell.ribbon.tabBar.children[0].after(filesTab);
const filesCorner = h('button', 'tex-files-corner', filesLabel());
filesCorner.title = 'Project files and upload';
filesCorner.onclick = () => toggleFiles('bottom');
shell.statusLeft.prepend(filesCorner);
let filesOpen = false;

// Editor pane.
const edHead = h('div', 'tex-pane-head');
const crumb = h('div', 'tex-crumb');
const edTools = h('div', 'tex-head-tools');
const syncBtn = h('button', 'tex-btn', `${icon('toPdf', 16)}<span>Show in PDF</span>`);
syncBtn.title = 'Show the cursor’s position in the PDF (Ctrl+Shift+L)';
syncBtn.onclick = () => syncToPdf();
edTools.append(syncBtn);
edHead.append(crumb, edTools);
const edBody = h('div', 'tex-ed-body');
const viewer = h('div', 'tex-file-view');
edPane.append(edHead, edBody, viewer);

// Preview pane.
const pvHead = h('div', 'tex-pane-head tex-pv-head');
const compileBtn = h('button', 'tex-compile', `${icon('compile', 16)}<span>Recompile</span>`);
compileBtn.title = 'Compile (Ctrl+Enter or Ctrl+S)';
compileBtn.onclick = () => (compiling ? api.stop() : compile());
const compileMenu = h('button', 'tex-compile-drop rb-dropdown-trigger', icon('chevronDown', 12));
compileMenu.title = 'Compile options';
compileMenu.onclick = () => showCompileMenu(compileMenu);
const issuesBtn = h('button', 'tex-btn tex-issues');
issuesBtn.title = 'Errors, warnings and the full log';
issuesBtn.onclick = () => toggleLogs();
const pageInfo = h('span', 'tex-page-info');
const zoomOut = tool('zoomOut', 'Zoom out', () => pdf.setZoom(pdf.scale / 1.15));
const zoomFit = h('button', 'tex-btn', 'Fit');
zoomFit.title = 'Fit to width';
zoomFit.onclick = () => pdf.setZoom('fit');
const zoomIn = tool('zoomIn', 'Zoom in', () => pdf.setZoom(pdf.scale * 1.15));
const dlBtn = tool('export', 'Download PDF', () => downloadPdf());
const pvToggle = tool('preview', 'Hide the preview', () => setPreview(false));
pvHead.append(h('div', 'tex-compile-group', ''), issuesBtn, h('span', 'tex-grow'), pageInfo, zoomOut, zoomFit, zoomIn, dlBtn, pvToggle);
pvHead.firstChild.append(compileBtn, compileMenu);
const pvBody = h('div', 'tex-pv-body');
const pdfHost = h('div', 'tex-pdf');
const emptyEl = h('div', 'tex-empty', `${icon('compile', 40)}<p>Compile to see the PDF here.</p>`);
const logsEl = h('div', 'tex-logs');
const busyEl = h('div', 'tex-busy', '<i></i>');
pvBody.append(pdfHost, emptyEl, logsEl, busyEl);
pvPane.append(pvHead, pvBody);
const pdf = new PdfView(pdfHost, {
  onDoubleClick: (page, x, y) => syncFromPdf(page, x, y),
  onPage: (n) => {
    pageInfo.textContent = pdf.pageCount ? `${n} / ${pdf.pageCount}` : '';
  },
});
const pvRail = h('div', 'tex-rail tex-pv-rail');
pvRail.append(tool('preview', 'Show the preview', () => setPreview(true)), h('span', 'tex-rail-label', 'PDF'));
rootEl.append(pvRail);

function toggleFiles(from) {
  if (prefs.dock) return setDock(false);
  if (filesOpen && side.classList.contains(`from-${from}`)) return closeFiles();
  filesOpen = true;
  side.classList.toggle('from-top', from === 'top');
  side.classList.toggle('from-bottom', from === 'bottom');
  applyLayout();
  side.querySelector('.tex-node.active')?.scrollIntoView({ block: 'nearest' });
  treeEl.focus();
}
function closeFiles() {
  if (!filesOpen) return;
  filesOpen = false;
  applyLayout();
}
function setDock(on) {
  prefs.dock = on;
  filesOpen = false;
  savePrefs();
  applyLayout();
}
rootEl.addEventListener('pointerdown', (e) => {
  if (filesOpen && !side.contains(e.target)) closeFiles();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && filesOpen && !document.querySelector('.rb-popup')) closeFiles();
});
function setPreview(on) {
  prefs.preview = on;
  savePrefs();
  applyLayout();
}
function applyLayout() {
  rootEl.classList.toggle('no-side', !prefs.dock);
  rootEl.classList.toggle('files-open', filesOpen && !prefs.dock);
  for (const b of [filesTab, filesCorner]) b.classList.toggle('active', prefs.dock || filesOpen);
  pinBtn.title = prefs.dock ? 'Unpin: show files as a pop-up' : 'Pin as a pane beside the editor';
  pinBtn.classList.toggle('on', prefs.dock);
  rootEl.classList.toggle('no-preview', prefs.preview === false);
  side.style.width = prefs.dock ? `${Math.max(300, prefs.sideW)}px` : '';
  edPane.style.flex = prefs.preview === false ? '1 1 0' : `${prefs.editorFrac} 1 0`;
  pvPane.style.flex = `${1 - prefs.editorFrac} 1 0`;
  shell.refresh();
}

function dragSplit(handle, onMove) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    rootEl.classList.add('dragging');
    const move = (ev) => onMove(ev);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      rootEl.classList.remove('dragging');
      savePrefs();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}
dragSplit(splitA, (e) => {
  prefs.sideW = Math.max(300, Math.min(520, e.clientX - rootEl.getBoundingClientRect().left));
  applyLayout();
});
dragSplit(splitB, (e) => {
  const a = edPane.getBoundingClientRect().left;
  const b = pvPane.getBoundingClientRect().right;
  prefs.editorFrac = Math.max(0.2, Math.min(0.8, (e.clientX - a) / (b - a)));
  applyLayout();
});

// ---- Files ----

async function refreshFiles() {
  const res = await api.list();
  if (res?.error) {
    toast(res.error, 'error');
    return;
  }
  files = res;
  await reindex();
  drawTree();
}

function treeOf(list) {
  const root = { name: '', path: '', dir: true, children: [] };
  const dirs = new Map([['', root]]);
  for (const f of list) {
    const parts = f.path.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const parent = dirs.get(parentPath) || root;
    const node = { ...f, name: parts[parts.length - 1], children: f.dir ? [] : null };
    if (f.dir) dirs.set(f.path, node);
    parent.children.push(node);
  }
  return root;
}

const kindIcon = (f) => (f.dir ? (prefs.closed.includes(f.path) ? 'folder' : 'folderOpen') : { tex: 'texFile', bib: 'bibFile', image: 'imageFile' }[f.kind] || 'file');

function drawTree() {
  treeEl.innerHTML = '';
  const tree = treeOf(files);
  const walk = (node, depth) => {
    for (const f of node.children) {
      const row = h('div', `tex-node${f.dir ? ' dir' : ''}${f.path === current ? ' active' : ''}`);
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.dataset.path = f.path;
      const closed = f.dir && prefs.closed.includes(f.path);
      const dirty = buffers.get(f.path)?.dirty;
      row.innerHTML = `<span class="tex-caret">${f.dir ? (closed ? '▸' : '▾') : ''}</span>${icon(kindIcon(f), 16)}<span class="tex-name">${escapeHtml(f.name)}</span>${f.path === mainFile ? '<span class="tex-badge" title="Main file: this is what gets compiled">main</span>' : ''}${dirty ? '<span class="tex-dot" title="Unsaved changes"></span>' : ''}`;
      row.onclick = () => {
        if (f.dir) {
          prefs.closed = closed ? prefs.closed.filter((p) => p !== f.path) : [...prefs.closed, f.path];
          savePrefs();
          drawTree();
        } else {
          openFile(f.path);
          closeFiles();
        }
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        fileMenu(f, e);
      };
      row.draggable = !f.dir;
      row.ondragstart = (e) => e.dataTransfer.setData('text/x-tex-path', f.path);
      if (f.dir) {
        row.ondragover = (e) => {
          e.preventDefault();
          row.classList.add('drop');
        };
        row.ondragleave = () => row.classList.remove('drop');
        row.ondrop = (e) => {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop');
          dropInto(e, f.path);
        };
      }
      treeEl.append(row);
      if (f.dir && !closed) walk(f, depth + 1);
    }
  };
  walk(tree, 0);
  if (!files.length) treeEl.append(h('div', 'tex-empty-small', 'No files yet.'));
  const nFiles = files.filter((f) => !f.dir).length;
  const nDirs = files.length - nFiles;
  summaryEl.textContent = `${nFiles} file${nFiles === 1 ? '' : 's'}${nDirs ? `, ${nDirs} folder${nDirs === 1 ? '' : 's'}` : ''} · drop files or a .zip here`;
  for (const el of document.querySelectorAll('.tex-files-count')) el.textContent = nFiles;
}

treeEl.ondragover = (e) => e.preventDefault();
treeEl.ondrop = (e) => {
  e.preventDefault();
  dropInto(e, '');
};

async function dropInto(e, dir) {
  const moved = e.dataTransfer.getData('text/x-tex-path');
  if (moved) {
    const name = moved.split('/').pop();
    const to = dir ? `${dir}/${name}` : name;
    if (to !== moved) await renamePath(moved, to);
    return;
  }
  const dropped = [...(e.dataTransfer.files || [])];
  if (!dropped.length) return;
  const zips = dropped.filter((f) => /\.zip$/i.test(f.name));
  const plain = dropped.filter((f) => !zips.includes(f));
  const results = [...(plain.length ? [await api.importFiles(plain, dir)] : []), ...(await Promise.all(zips.map((z) => api.importZip(dir, z))))];
  let added = 0;
  for (const res of results) {
    if (res?.error) toast(res.error, 'error');
    else added += res.added.length;
  }
  if (added) toast(`Added ${added} file${added === 1 ? '' : 's'}`);
  await refreshFiles();
}

function fileMenu(f, e) {
  const dir = f.dir ? f.path : f.path.split('/').slice(0, -1).join('/');
  const items = [
    ...(f.kind === 'tex' && f.path !== mainFile ? [{ label: 'Set as main file', icon: 'texFile', run: () => setMain(f.path) }] : []),
    ...(f.kind === 'image' ? [{ label: 'Insert into document', icon: 'image', run: () => insertGraphic(f.path) }] : []),
    { label: 'New file here', icon: 'newFile', run: () => newFile(dir) },
    { label: 'New folder here', icon: 'folder', run: () => newFolder(dir) },
    { label: 'Add files here', icon: 'upload', run: () => uploadTo(dir) },
    { label: 'Add a .zip here', icon: 'zip', run: () => uploadZip(dir) },
    '-',
    { label: 'Rename', icon: 'textbox', run: () => renamePrompt(f) },
    { label: 'Delete', icon: 'trash', run: () => deletePath(f) },
    { label: 'Show in folder', icon: 'open', run: () => api.reveal(f.path) },
  ];
  popup({ getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }) }, menuList(items));
}

function uploadMenu(anchor, dir) {
  popup(anchor, menuList([
    { label: 'Files from your computer…', icon: 'upload', run: () => uploadTo(dir) },
    { label: 'Files from a .zip…', icon: 'zip', run: () => uploadZip(dir) },
    '-',
    { label: 'New project from a .zip…', icon: 'texFile', run: () => api.openZip().then((r) => r?.error && toast(r.error, 'error')) },
  ]));
}

function menuList(items) {
  const list = h('div', 'rb-menu');
  for (const it of items) {
    if (it === '-') {
      list.append(h('div', 'rb-menu-sep'));
      continue;
    }
    const b = h('button', 'rb-menu-item', `${icon(it.icon, 16)}<span>${escapeHtml(it.label)}</span>`);
    b.onclick = () => {
      closePopup();
      it.run();
    };
    list.append(b);
  }
  return list;
}

function setMain(path) {
  mainFile = path;
  prefs.main = path;
  savePrefs();
  drawTree();
  toast(`${path} is now the main file`);
  compile();
}

async function newFile(dir) {
  const v = await dialog({ title: 'New file', fields: [{ name: 'name', label: 'File name', value: 'chapter.tex' }], ok: 'Create' });
  if (!v?.name?.trim()) return;
  let name = v.name.trim().replace(/^[\\/]+/, '');
  if (!/\.[a-z0-9]+$/i.test(name)) name += '.tex';
  const path = dir ? `${dir}/${name}` : name;
  const text = /\.bib$/i.test(name) ? '' : /\.tex$/i.test(name) ? `% ${name}\n\n` : '';
  const res = await api.create(path, { text });
  if (res?.error) return toast(res.error, 'error');
  await refreshFiles();
  openFile(res.path);
}

async function newFolder(dir) {
  const v = await dialog({ title: 'New folder', fields: [{ name: 'name', label: 'Folder name', value: 'figures' }], ok: 'Create' });
  if (!v?.name?.trim()) return;
  const res = await api.create(dir ? `${dir}/${v.name.trim()}` : v.name.trim(), { folder: true });
  if (res?.error) return toast(res.error, 'error');
  await refreshFiles();
}

async function uploadTo(dir) {
  const res = await api.upload(dir);
  if (res?.error) return toast(res.error, 'error');
  if (res.added.length) toast(`Added ${res.added.length} file${res.added.length === 1 ? '' : 's'}`);
  await refreshFiles();
  return res.added;
}

async function uploadZip(dir) {
  const res = await api.importZip(dir);
  if (res?.error) return toast(res.error, 'error');
  if (res.added.length) toast(`Added ${res.added.length} file${res.added.length === 1 ? '' : 's'} from the .zip`);
  await refreshFiles();
}

async function renamePrompt(f) {
  const v = await dialog({ title: 'Rename', fields: [{ name: 'name', label: 'New name', value: f.name }], ok: 'Rename' });
  if (!v?.name?.trim() || v.name.trim() === f.name) return;
  const dir = f.path.split('/').slice(0, -1).join('/');
  await renamePath(f.path, dir ? `${dir}/${v.name.trim()}` : v.name.trim());
}

async function renamePath(from, to) {
  if (buffers.get(from)?.dirty) await saveFile(from);
  const res = await api.rename(from, to);
  if (res?.error) return toast(res.error, 'error');
  for (const [p, b] of [...buffers]) {
    if (p === from || p.startsWith(`${from}/`)) {
      buffers.delete(p);
      buffers.set(res.path + p.slice(from.length), b);
    }
  }
  if (current && (current === from || current.startsWith(`${from}/`))) current = res.path + current.slice(from.length);
  if (mainFile && (mainFile === from || mainFile.startsWith(`${from}/`))) {
    mainFile = res.path + mainFile.slice(from.length);
    prefs.main = mainFile;
    savePrefs();
  }
  await refreshFiles();
  drawCrumb();
}

async function deletePath(f) {
  const ok = await dialog({ title: `Delete ${f.name}?`, body: `<p>${f.dir ? 'The folder and everything in it' : 'The file'} will be moved to the Recycle Bin.</p>`, ok: 'Delete' });
  if (!ok) return;
  const res = await api.remove(f.path);
  if (res?.error) return toast(res.error, 'error');
  for (const p of [...buffers.keys()]) if (p === f.path || p.startsWith(`${f.path}/`)) buffers.delete(p);
  if (current && (current === f.path || current.startsWith(`${f.path}/`))) {
    current = null;
    showEmptyEditor();
  }
  await refreshFiles();
  updateDirty();
}

// ---- Opening and saving ----

async function openFile(path, line = null) {
  if (path !== current) {
    const f = files.find((x) => x.path === path) || { path, kind: fileKind(path) };
    if (f.kind === 'image' || f.kind === 'other') {
      await showBinary(f);
      current = path;
      prefs.open = path;
      savePrefs();
      drawTree();
      drawCrumb();
      return;
    }
    let buf = buffers.get(path);
    if (!buf) {
      const res = await api.read(path);
      if (res?.error) return toast(res.error, 'error');
      if (res.tooBig || res.binary) return showBinary(f, res);
      buf = { saved: res.text, dirty: false, kind: f.kind, state: EditorState.create({ doc: res.text, extensions: extensionsFor(f.kind) }) };
      buffers.set(path, buf);
    }
    if (view && current && buffers.has(current)) buffers.get(current).state = view.state;
    current = path;
    prefs.open = path;
    savePrefs();
    viewer.hidden = true;
    edBody.hidden = false;
    editorShown = true;
    if (!view) view = new EditorView({ state: buf.state, parent: edBody });
    else view.setState(buf.state);
    applyDiagnostics();
    buildIndex();
    drawTree();
    drawCrumb();
    shell.refresh();
  }
  if (line && view) goToLine(line);
  view?.focus();
}

function goToLine(line) {
  const ln = view.state.doc.line(Math.max(1, Math.min(view.state.doc.lines, line)));
  view.dispatch({ selection: { anchor: ln.from }, effects: EditorView.scrollIntoView(ln.from, { y: 'center' }) });
  const el = view.domAtPos(ln.from).node?.parentElement?.closest('.cm-line');
  el?.classList.add('tex-flash');
  setTimeout(() => el?.classList.remove('tex-flash'), 1200);
  view.focus();
}

async function showBinary(f, res = null) {
  if (view && current && buffers.has(current)) buffers.get(current).state = view.state;
  edBody.hidden = true;
  editorShown = false;
  viewer.hidden = false;
  viewer.innerHTML = '';
  res ||= await api.read(f.path);
  if (res?.error) {
    viewer.append(h('div', 'tex-empty', `<p>${escapeHtml(res.error)}</p>`));
    return;
  }
  const actions = h('div', 'tex-file-actions');
  if (f.kind === 'image') {
    const ins = h('button', 'btn', 'Insert into document');
    ins.onclick = () => insertGraphic(f.path);
    actions.append(ins);
  }
  if (res.base64 && res.mime === 'application/pdf') {
    const host = h('div', 'tex-file-pdf');
    viewer.append(host, actions);
    const small = new PdfView(host);
    small.load(Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0)));
  } else if (res.base64) {
    const img = h('img', 'tex-file-img');
    img.src = `data:${res.mime};base64,${res.base64}`;
    img.alt = f.path;
    viewer.append(img, actions);
  } else {
    viewer.append(h('div', 'tex-empty', `${icon('file', 40)}<p>${escapeHtml(f.path)} can’t be shown here.</p>`), actions);
  }
}

function showEmptyEditor() {
  edBody.hidden = true;
  editorShown = false;
  viewer.hidden = false;
  viewer.innerHTML = '';
  viewer.append(h('div', 'tex-empty', `${icon('texFile', 40)}<p>Pick a file on the left to edit it.</p>`));
  drawCrumb();
}

function drawCrumb() {
  crumb.innerHTML = current ? `${icon(kindIcon({ kind: fileKind(current) }), 16)}<span>${escapeHtml(current)}</span>${buffers.get(current)?.dirty ? '<span class="tex-dot"></span>' : ''}` : '';
  syncBtn.hidden = !current || fileKind(current) !== 'tex';
}

function onEdit() {
  const buf = buffers.get(current);
  if (!buf) return;
  buf.state = view.state;
  const dirty = view.state.doc.toString() !== buf.saved;
  if (dirty !== buf.dirty) {
    buf.dirty = dirty;
    drawTree();
    drawCrumb();
  }
  updateDirty();
  changedSinceCompile = true;
  scheduleIndex();
  scheduleAutoCompile();
}

function updateDirty() {
  const any = [...buffers.values()].some((b) => b.dirty);
  if (any) shell.markDirty();
  else if (shell.state.dirty) shell.markClean();
}

async function saveFile(path) {
  const buf = buffers.get(path);
  if (!buf) return true;
  const text = (path === current && view ? view.state : buf.state).doc.toString();
  const res = await api.write(path, text);
  if (res?.error) {
    toast(res.error, 'error');
    return false;
  }
  buf.saved = text;
  buf.dirty = false;
  return true;
}

async function saveAll() {
  let n = 0;
  for (const [path, buf] of buffers) {
    if (buf.dirty && (await saveFile(path))) n += 1;
  }
  drawTree();
  drawCrumb();
  updateDirty();
  if (n) toast(`Saved ${n} file${n === 1 ? '' : 's'}`);
  return true;
}

async function saveCurrentAs() {
  if (!current || !buffers.has(current)) return false;
  const v = await dialog({ title: 'Save as', fields: [{ name: 'name', label: 'New file name in this project', value: current }], ok: 'Save' });
  if (!v?.name?.trim()) return false;
  const res = await api.create(v.name.trim(), { text: view.state.doc.toString() });
  if (res?.error) {
    toast(res.error, 'error');
    return false;
  }
  await refreshFiles();
  await openFile(res.path);
  return true;
}

function overrides() {
  const out = {};
  for (const [path, buf] of buffers) {
    if (buf.dirty) out[path] = (path === current && view ? view.state : buf.state).doc.toString();
  }
  return out;
}

window.addEventListener('focus', async () => {
  // Pick up changes made outside Work to the open file, when it has no unsaved edits.
  const buf = buffers.get(current);
  if (!buf || buf.dirty) return;
  const res = await api.read(current);
  if (res?.text == null || res.text === buf.saved) return;
  buf.saved = res.text;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: res.text } });
  buf.dirty = false;
  updateDirty();
});

// ---- Project index: labels, citations, commands, outline ----

let indexTimer = 0;
function scheduleIndex() {
  clearTimeout(indexTimer);
  indexTimer = setTimeout(() => buildIndex(), 400);
}

async function reindex() {
  const res = await api.sources();
  sources = Array.isArray(res) ? res : [];
  if (!mainFile || !files.some((f) => f.path === mainFile)) {
    mainFile = findMain(sources);
  }
  buildIndex();
}

function buildIndex() {
  const texts = new Map(sources.map((s) => [s.path, s.text]));
  for (const [path, buf] of buffers) {
    if (buf.kind === 'tex' || buf.kind === 'bib') texts.set(path, (path === current && view ? view.state : buf.state).doc.toString());
  }
  const next = { bib: [], labels: [], files, commands: [], environments: [] };
  for (const [path, text] of texts) {
    if (fileKind(path) === 'bib') next.bib.push(...bibEntries(text).map((b) => ({ ...b, file: path })));
    else if (fileKind(path) === 'tex') {
      next.labels.push(...labels(text).map((l) => ({ ...l, file: path })));
      next.commands.push(...userCommands(text));
      next.environments.push(...userEnvironments(text));
    }
  }
  index = next;
  drawOutline(texts);
}

function drawOutline(texts) {
  outlineEl.innerHTML = '';
  const path = current && fileKind(current) === 'tex' ? current : mainFile;
  const text = path && texts.get(path);
  const items = text ? outline(text) : [];
  if (!items.length) {
    outlineEl.append(h('div', 'tex-empty-small', 'Sections in the open file show up here.'));
    return;
  }
  const min = Math.min(...items.map((i) => i.level));
  for (const it of items) {
    const row = h('div', 'tex-node tex-outline-item', `<span class="tex-name">${escapeHtml(it.title)}</span>`);
    row.style.paddingLeft = `${10 + (it.level - min) * 12}px`;
    row.title = `${it.kind} · line ${it.line}`;
    row.onclick = () => {
      openFile(path, it.line);
      closeFiles();
    };
    outlineEl.append(row);
  }
}

// ---- Compiling ----

let autoTimer = 0;
function scheduleAutoCompile() {
  clearTimeout(autoTimer);
  if (prefs.auto) autoTimer = setTimeout(() => compile({ auto: true }), 1600);
}

async function compile({ auto = false } = {}) {
  if (compiling) {
    compileAgain = true;
    return;
  }
  if (auto && !changedSinceCompile) return;
  compiling = true;
  compileAgain = false;
  changedSinceCompile = false;
  pvPane.classList.add('busy');
  compileBtn.innerHTML = `${icon('stop', 16)}<span>Compiling…</span>`;
  compileBtn.title = 'Stop compiling';
  const res = await api.compile({ main: mainFile, overrides: overrides(), engine: prefs.engine === 'auto' ? null : prefs.engine });
  compiling = false;
  pvPane.classList.remove('busy');
  compileBtn.innerHTML = `${icon('compile', 16)}<span>Recompile</span>`;
  compileBtn.title = 'Compile (Ctrl+Enter or Ctrl+S)';
  if (res?.error) {
    issues = [{ level: 'error', file: null, line: null, message: res.error }];
  } else if (!res.stopped) {
    issues = res.issues || [];
    lastLog = res.log || '';
    if (res.synctex) {
      try {
        sync = parseSynctex(res.synctex);
      } catch {
        sync = null;
      }
    }
    if (res.pdf && res.fresh) {
      emptyEl.hidden = true;
      await pdf.load(res.pdf).catch((err) => toast(`Couldn’t show the PDF: ${err.message}`, 'error'));
      pageInfo.textContent = pdf.pageCount ? `${pdf.currentPage()} / ${pdf.pageCount}` : '';
    } else if (!pdf.pageCount) {
      emptyEl.hidden = false;
      emptyEl.innerHTML = res.noEngine ? engineHelp() : `${icon('log', 40)}<p>No PDF yet. Open the log to see what went wrong.</p>`;
    }
    statusEngine.textContent = res.engine ? `${res.engine} · ${(res.ms / 1000).toFixed(1)}s` : '';
    if (!res.ok && !auto && issues.some((i) => i.level === 'error')) showLogs(true);
  }
  drawIssues();
  applyDiagnostics();
  if (compileAgain || (prefs.auto && changedSinceCompile)) {
    compileAgain = false;
    scheduleAutoCompile();
  }
}

function engineHelp() {
  return `${icon('log', 40)}<p><b>No LaTeX engine found.</b></p><p>Work’s installer includes one. If it’s missing, reinstall Work, or install <a href="#" data-link="https://miktex.org/download">MiKTeX</a> or <a href="#" data-link="https://www.tug.org/texlive/">TeX Live</a> and compile again.</p>`;
}
emptyEl.addEventListener('click', (e) => {
  const link = e.target.closest('[data-link]');
  if (link) {
    e.preventDefault();
    window.office.openExternal(link.dataset.link);
  }
});

function showCompileMenu(anchor) {
  const list = h('div', 'rb-menu tex-compile-menu');
  const row = (label, on, run, detail = '') => {
    const b = h('button', 'rb-menu-item', `<span class="tex-check">${on ? '✓' : ''}</span><span>${escapeHtml(label)}${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</span>`);
    b.onclick = () => {
      closePopup();
      run();
    };
    list.append(b);
  };
  row('Compile as I type', prefs.auto, () => {
    prefs.auto = !prefs.auto;
    savePrefs();
    shell.refresh();
  });
  list.append(h('div', 'rb-menu-sep'), h('div', 'tex-menu-label', 'Engine'));
  row('Automatic', prefs.engine === 'auto', () => setEngine('auto'), 'Built-in Tectonic first, then your TeX installation');
  for (const e of engines) {
    if (e.available) row(e.label, prefs.engine === e.id, () => setEngine(e.id), e.detail);
  }
  const missing = engines.filter((e) => !e.available).map((e) => e.label);
  if (missing.length) list.append(h('div', 'tex-menu-note', `Not found on this computer: ${escapeHtml(missing.join(', '))}`));
  list.append(h('div', 'rb-menu-sep'));
  row('Main file…', false, async () => {
    const tex = files.filter((f) => f.kind === 'tex');
    const v = await dialog({ title: 'Main file', fields: [{ name: 'main', label: 'Compile this file', type: 'select', options: tex.map((f) => ({ value: f.path, label: f.path })), value: mainFile }], ok: 'Use it' });
    if (v?.main) setMain(v.main);
  }, mainFile || '');
  popup(anchor, list);
}

function setEngine(id) {
  prefs.engine = id;
  savePrefs();
  compile();
}

function drawIssues() {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  issuesBtn.innerHTML = `${icon('log', 16)}<span>Logs</span>${errors ? `<b class="tex-count err">${errors}</b>` : ''}${warnings ? `<b class="tex-count warn">${warnings}</b>` : ''}`;
  logsEl.innerHTML = '';
  const head = h('div', 'tex-logs-head', `<b>${errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'No errors'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}</b>`);
  const fix = h('button', 'btn', `${icon('sparkle', 14)} Fix with AI`);
  fix.hidden = !errors;
  fix.onclick = () => shell.claude.runQuick(QUICK.fix);
  const close = h('button', 'tex-tool', icon('close', 14));
  close.title = 'Close';
  close.onclick = () => showLogs(false);
  head.append(h('span', 'tex-grow'), fix, close);
  logsEl.append(head);
  for (const it of issues) {
    const item = h('button', `tex-issue ${it.level}`, `<span class="tex-issue-where">${escapeHtml(it.file || '')}${it.line ? `:${it.line}` : ''}</span><span>${escapeHtml(it.message)}</span>`);
    item.onclick = () => {
      if (it.file && files.some((f) => f.path === it.file)) openFile(it.file, it.line);
    };
    logsEl.append(item);
  }
  const raw = h('details', 'tex-raw', '<summary>Full log</summary>');
  const pre = h('pre');
  pre.textContent = lastLog || 'Nothing yet.';
  raw.append(pre);
  logsEl.append(raw);
}

function showLogs(on) {
  pvPane.classList.toggle('show-logs', on);
}
function toggleLogs() {
  showLogs(!pvPane.classList.contains('show-logs'));
}

function applyDiagnostics() {
  if (!view || !current) return;
  const doc = view.state.doc;
  const list = issues
    .filter((i) => i.file === current && i.line && i.line <= doc.lines && i.level !== 'info')
    .map((i) => {
      const ln = doc.line(i.line);
      return { from: ln.from, to: ln.to, severity: i.level, message: i.message };
    });
  view.dispatch(setDiagnostics(view.state, list));
}

// ---- SyncTeX: jump between the source and the PDF ----

function syncToPdf() {
  if (!sync || !view || !current) {
    toast('Compile first to link the source and the PDF.');
    return;
  }
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  const at = synctexForward(sync, current, line);
  if (!at) return toast('That spot isn’t in the PDF.');
  pdf.reveal(at.page, at.x, at.y);
}

function syncFromPdf(page, x, y) {
  if (!sync) return;
  const at = synctexBackward(sync, page, x, y);
  if (!at) return;
  const file = files.find((f) => f.path === at.file || at.file.endsWith(`/${f.path}`));
  if (file) openFile(file.path, at.line);
}

// ---- Insert helpers ----

function insert(text, { select = false } = {}) {
  if (!view || !current || fileKind(current) !== 'tex') {
    toast('Open a .tex file first.');
    return;
  }
  const sel = view.state.selection.main;
  const chosen = view.state.sliceDoc(sel.from, sel.to).replace(/[{}]/g, (c) => `\\${c}`);
  snippet(text.replace('${$SEL}', chosen || '${}').replace('$SEL', chosen || '${}'))(view, null, sel.from, sel.to);
  view.focus();
  if (select) startCompletion(view);
}

// A paper found by the Cite dialog goes into the project's .bib file and is cited at the cursor.
function citePaper() {
  openCiteDialog({}, {
    style: 'bibtex',
    actions: [{ label: 'Add to .bib and cite', icon: 'bibFile', run: (item, f) => addToBib(item) }],
  });
}

async function addToBib(item) {
  const entry = cite.format(item, 'bibtex').text;
  const key = cite.bibKey(item);
  const bib = files.find((f) => f.kind === 'bib')?.path || 'references.bib';
  const buf = buffers.get(bib);
  const state = buf ? (bib === current && view ? view.state : buf.state) : null;
  let text = state ? state.doc.toString() : '';
  if (!buf && files.some((f) => f.path === bib)) {
    const res = await api.read(bib);
    if (res?.error) return toast(res.error, 'error');
    text = res.text || '';
  }
  const known = new RegExp(`@\\w+\\s*\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`).test(text);
  if (!known) {
    const add = `${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${entry}\n`;
    if (buf) {
      const tr = state.update({ changes: { from: state.doc.length, insert: add } });
      if (bib === current && view) view.dispatch(tr);
      else buf.state = tr.state;
      buf.dirty = true;
      updateDirty();
      drawTree();
    } else {
      const res = await api.write(bib, text + add);
      if (res?.error) return toast(res.error, 'error');
      if (!files.some((f) => f.path === bib)) await refreshFiles();
      else await reindex();
    }
    buildIndex();
  }
  if (current && fileKind(current) === 'tex' && view) {
    const sel = view.state.selection.main;
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: `\\cite{${key}}` } });
  }
  toast(known ? `Already in ${bib}: cited as ${key}` : `Added to ${bib} as ${key}`);
}

function insertBlock(text) {
  if (!view) return insert(text);
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const lead = line.text.slice(0, sel.from - line.from).trim() ? '\n' : '';
  insert(lead + text);
}

async function insertGraphic(path) {
  if (!current || fileKind(current) !== 'tex') {
    const main = mainFile || files.find((f) => f.kind === 'tex')?.path;
    if (main) await openFile(main);
  }
  insertBlock(`\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{${path.replace(/\\/g, '/')}}\n\t\\caption{\${Caption}}\n\t\\label{fig:\${label}}\n\\end{figure}\n`);
}

async function insertTable() {
  const v = await dialog({ title: 'Insert table', fields: [
    { name: 'rows', label: 'Rows', type: 'number', value: 3, min: 1, max: 60 },
    { name: 'cols', label: 'Columns', type: 'number', value: 3, min: 1, max: 20 },
  ], ok: 'Insert' });
  if (!v) return;
  const rows = Math.max(1, Number(v.rows) || 3);
  const cols = Math.max(1, Number(v.cols) || 3);
  const line = (r) => Array.from({ length: cols }, (_, c) => (r === 0 && c === 0 ? '${Header}' : r === 0 ? `Header ${c + 1}` : '')).join(' & ');
  const body = Array.from({ length: rows }, (_, r) => `\t\t${line(r)} \\\\${r === 0 ? '\n\t\t\\midrule' : ''}`).join('\n');
  insertBlock(`\\begin{table}[htbp]\n\t\\centering\n\t\\begin{tabular}{${'l'.repeat(cols)}}\n\t\t\\toprule\n${body}\n\t\t\\bottomrule\n\t\\end{tabular}\n\t\\caption{\${Caption}}\n\t\\label{tab:\${label}}\n\\end{table}\n`);
}

async function insertImageFromComputer() {
  const added = await uploadTo(files.some((f) => f.dir && f.path === 'figures') ? 'figures' : '');
  const img = added?.find((p) => fileKind(p) === 'image');
  if (img) insertGraphic(img);
}

// ---- Status bar ----

const cursorStatus = h('span');
const statusEngine = h('span');
shell.statusLeft.append(h('span', 'tex-status-path', `${icon('folder', 14)} ${escapeHtml(project.root)}`), cursorStatus);
shell.statusRight.append(statusEngine);
function updateCursorStatus() {
  if (!view) return;
  const pos = view.state.selection.main.head;
  const line = view.state.doc.lineAt(pos);
  cursorStatus.textContent = `Line ${line.number}, column ${pos - line.from + 1}`;
}

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key === 'Enter' && !e.defaultPrevented) {
    e.preventDefault();
    compile();
  }
});

// ---- Start ----

applyLayout();
engines = await api.engines();
await refreshFiles();
const first = (prefs.open && files.some((f) => f.path === prefs.open) && prefs.open) || project.open || mainFile || files.find((f) => f.kind === 'tex')?.path;
if (first) await openFile(first);
else showEmptyEditor();
drawIssues();
compile();
