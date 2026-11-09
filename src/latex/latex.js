// Write's LaTeX mode: a project folder with a file tree, a code editor with
// LaTeX suggestions, and a live PDF preview, side by side.

import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, highlightSpecialChars, hoverTooltip } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, toggleComment } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, startCompletion, snippet } from '@codemirror/autocomplete';
import { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from '@codemirror/search';
import { lintGutter, setDiagnostics, openLintPanel } from '@codemirror/lint';
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
import { texCount } from '../../common/tex-count.js';
import { PdfView, pdfPicture } from './pdf-view.js';
import { presentDialog, preparePictures } from '../docs/to-present.js';
import { keepLoadedImages } from '../docs/deck.js';
import { findGraphic, readLatex } from '../docs/tex-deck.js';
import { fontStack } from '../shared/fonts.js';
import { reviewExtension, reviewData, restoreEffects, trackField, commentField, acceptAll, rejectAll } from './review.js';
import { createReviewPanel } from './review-panel.js';
import { openHistory } from './history.js';
import { openGit, cloneDialog } from './git.js';
import { visualMode, visualExtension, refreshVisual } from './visual.js';
import { tableBuilder, figureBuilder } from './builders.js';
import { proofread } from './writing.js';
import tables from '../../common/latex-table.js';
import '../shared/dark.css';

const info = await window.office.launchInfo();
const project = info.file.latex;
const api = window.office.latex;
const prefsKey = `latex:${project.root}`;
const prefs = (() => {
  try {
    return { dock: false, auto: true, engine: 'auto', sideW: 300, editorFrac: 0.5, closed: [], fontSize: 14, timeLimit: 0, visual: false, ...JSON.parse(localStorage.getItem(prefsKey) || '{}') };
  } catch {
    return { dock: false, auto: true, engine: 'auto', sideW: 300, editorFrac: 0.5, closed: [], fontSize: 14, timeLimit: 0, visual: false };
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
let review = { files: {} };
let writingIssues = [];
let userName = 'You';

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
const fontCss = (px, family = prefs.fontFamily) => EditorView.theme({ '&': { fontSize: `${px}px` }, ...(family ? { '&.cm-editor .cm-scroller': { fontFamily: fontStack(family) } } : {}) });
const MONO_NAME = /mono|code|consol|courier|cousine|menlo|cascadia|inconsolata|terminal|hack|iosevka/i;

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
  { key: 'Mod-Alt-m', run: () => (reviewPane.startComment(), true) },
  { key: 'Mod-Shift-e', run: () => (setVisual(!prefs.visual), true) },
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
    ...(kind === 'tex' || kind === 'bib' ? [reviewExtension({ onAction: () => view?.focus(), onCommentClick: (id) => reviewPane.focusComment(id) })] : []),
    visualMode.of(kind === 'tex' && prefs.visual ? visualExt : []),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) onEdit();
      if (u.selectionSet || u.docChanged) updateCursorStatus();
      if (u.docChanged || u.transactions.some((tr) => tr.effects.length)) onReviewChange(u);
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

// Pictures for the Visual editor, read once from the project.
const pictureCache = new Map();
const visualExt = visualExtension({
  pictureSource: {
    get(name, onLoad) {
      const file = findGraphic(name, files.map((f) => f.path), {});
      if (!file) return false;
      if (pictureCache.has(file)) return pictureCache.get(file);
      pictureCache.set(file, null);
      api.read(file).then(async (res) => {
        let src = false;
        if (res?.base64) src = res.mime === 'application/pdf' ? await pdfPicture(res.base64).catch(() => false) : `data:${res.mime};base64,${res.base64}`;
        pictureCache.set(file, src || false);
        onLoad?.();
      });
      return null;
    },
  },
  onWake: () => view?.dispatch({ effects: refreshVisual.of(null) }),
});

function setVisual(on) {
  prefs.visual = on;
  savePrefs();
  const fx = (kind) => visualMode.reconfigure(kind === 'tex' && on ? visualExt : []);
  if (view && current) view.dispatch({ effects: fx(fileKind(current)) });
  for (const [path, buf] of buffers) if (path !== current) buf.state = buf.state.update({ effects: fx(buf.kind) }).state;
  drawModeSwitch();
  shell.refresh();
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
      { type: 'big', icon: 'zip', label: 'Download .zip', title: 'Download the whole project (.tex, .bib, pictures and the PDF) as one .zip', run: () => downloadZip() },
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
      { type: 'big', icon: 'wordCount', label: 'Word Count', title: 'Words in the text, headings and captions, and how many equations', run: () => wordCount() },
    ] },
    { label: 'AI', items: [
      { type: 'big', icon: 'sparkle', label: 'LaTeX Helper', title: 'Ask the AI to write, explain or fix LaTeX (Ctrl+J)', run: () => shell.claude.toggle() },
    ] },
    { label: 'Present', items: [
      { type: 'big', icon: 'toPresent', label: 'Send to Present', title: 'Turn this paper into a presentation', run: () => toPresent() },
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
      { type: 'menu', big: true, icon: 'table', label: 'Table', items: () => [
        { label: tableAtCursor() ? 'Edit this table…' : 'Table builder…', icon: 'table', run: () => openTableBuilder() },
        { label: 'Quick empty table…', icon: 'grid', run: insertTable },
        { label: 'Table from data with AI…', icon: 'sparkle', run: () => shell.claude.runQuick(QUICK.table) },
      ] },
      { type: 'menu', big: true, icon: 'image', label: 'Figure', items: () => [
        { label: 'Figure builder…', icon: 'figure', run: () => openFigureBuilder() },
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
      { type: 'big', icon: 'equation', label: 'Symbols', title: 'Greek letters, operators, relations and arrows', run: () => symbolPalette(document.querySelector('.rb-big[title^="Greek letters"]')) },
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

const hasTrack = () => !!view && !!view.state.field(trackField, false);
const reviewTab = {
  id: 'review',
  label: 'Review',
  groups: [
    { label: 'Tracking', items: [
      { type: 'big', icon: 'trackChanges', label: 'Track Changes', title: 'Show edits as suggestions to accept or reject', run: () => (reviewPane.setTrack(!reviewPane.tracking()), reviewPane.show(true), shell.refresh()), active: () => reviewPane.tracking(), enabled: hasTrack },
      { type: 'stack', items: [
        { type: 'small', icon: 'acceptChange', label: 'Accept all', run: () => reviewAll(true), enabled: hasTrack },
        { type: 'small', icon: 'rejectChange', label: 'Reject all', run: () => reviewAll(false), enabled: hasTrack },
        { type: 'small', icon: 'panel', label: 'Review pane', run: () => (reviewPane.show(!reviewPane.open), shell.refresh()), active: () => reviewPane.open },
      ] },
    ] },
    { label: 'Comments', items: [
      { type: 'big', icon: 'comment', label: 'New Comment', shortcut: 'Ctrl+Alt+M', run: () => reviewPane.startComment(), enabled: hasTrack },
    ] },
    { label: 'Proofing', items: [
      { type: 'big', icon: 'spellCheck', label: 'Check Writing', title: 'The AI marks spelling, grammar and style problems in the prose, with a fix for each', run: () => checkWriting() },
      { type: 'stack', items: [
        { type: 'small', icon: 'clear', label: 'Clear marks', run: () => clearWriting() },
        { type: 'small', icon: 'log', label: 'List problems', run: () => view && openLintPanel(view) },
        { type: 'small', icon: 'wordCount', label: 'Word count', run: () => wordCount() },
      ] },
    ] },
    { label: 'Versions', items: [
      { type: 'big', icon: 'history', label: 'History', title: 'Every saved version: compare and restore', run: () => showHistory() },
      { type: 'big', icon: 'label', label: 'Name Version', title: 'Keep the project as it is now as a named version', run: () => nameVersion() },
      { type: 'big', icon: 'gitSync', label: 'Git Sync', title: 'Commit and sync with GitHub, GitLab or any Git host', run: () => showGit() },
    ] },
  ],
};

const viewTab = {
  id: 'view',
  label: 'View',
  groups: [
    { label: 'Editor mode', items: [
      { type: 'big', icon: 'code', label: 'Code', title: 'Edit the LaTeX source', run: () => setVisual(false), active: () => !prefs.visual },
      { type: 'big', icon: 'visual', label: 'Visual', shortcut: 'Ctrl+Shift+E', title: 'See headings, maths, lists and pictures as they will look, and edit around them', run: () => setVisual(true), active: () => prefs.visual },
    ] },
    { label: 'Panes', items: [
      { type: 'big', icon: 'folderOpen', label: 'Files', run: () => toggleFiles('top'), active: () => prefs.dock || filesOpen },
      { type: 'big', icon: 'comment', label: 'Review', run: () => (reviewPane.show(!reviewPane.open), shell.refresh()), active: () => reviewPane.open },
      { type: 'big', icon: 'preview', label: 'PDF Preview', run: () => setPreview(prefs.preview === false), active: () => prefs.preview !== false },
      { type: 'big', icon: 'sparkle', label: 'AI Pane', run: () => shell.claude.toggle() },
    ] },
    { label: 'PDF', items: [
      { type: 'big', icon: 'zoomIn', label: 'Zoom In', run: () => pdf.setZoom(pdf.scale * 1.15) },
      { type: 'big', icon: 'zoomOut', label: 'Zoom Out', run: () => pdf.setZoom(pdf.scale / 1.15) },
      { type: 'big', icon: 'find', label: 'Fit Width', run: () => pdf.setZoom('fit') },
    ] },
    { label: 'Editor', items: [
      { type: 'font', title: 'Editor font', width: 120, value: () => prefs.fontFamily || 'Default', filter: (n, g) => g === 'mono' || (!g && MONO_NAME.test(n)), change: (f) => setEditorFont(f) },
      { type: 'select', title: 'Editor font size', width: 70, options: [11, 12, 13, 14, 15, 16, 18, 20, 24].map((n) => ({ value: String(n), label: `${n} px` })), value: () => String(prefs.fontSize), change: (v) => setFontSize(Number(v)) },
    ] },
  ],
};

function setEditorFont(family) {
  prefs.fontFamily = family;
  setFontSize(prefs.fontSize);
}

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
  shorter: { label: 'Make it shorter', icon: 'shorter', prompt: 'Rewrite the selected text to say the same thing in fewer words. Keep every LaTeX command, citation, label and math expression exactly as it is. Reply with one ```latex code block.', actions: (t) => [replaceSel(t)] },
  expand: { label: 'Expand', icon: 'continueWrite', prompt: 'Expand the selected text with more explanation and detail in the same voice, without inventing results, numbers or citations. Keep every LaTeX command, citation, label and math expression. Reply with one ```latex code block.', actions: (t) => [replaceSel(t), insertAt(t)] },
  formal: { label: 'More academic', icon: 'wand', prompt: 'Rewrite the selected text in a formal academic register suitable for a journal paper. Keep every LaTeX command, citation, label and math expression exactly as it is. Reply with one ```latex code block.', actions: (t) => [replaceSel(t)] },
  simpler: { label: 'Simpler', icon: 'wand', prompt: 'Rewrite the selected text in plain, simple language a student could follow, keeping the meaning. Keep every LaTeX command, citation, label and math expression. Reply with one ```latex code block.', actions: (t) => [replaceSel(t)] },
  paraphrase: { label: 'Paraphrase', icon: 'replace', prompt: 'Paraphrase the selected text so it reads differently but means exactly the same. Keep every LaTeX command, citation, label and math expression. Reply with one ```latex code block.', actions: (t) => [replaceSel(t)] },
  abstract: { label: 'Write an abstract', icon: 'summarize', prompt: 'Write an abstract of about 150 to 250 words for this paper from the open file, in the style of the field, without results that aren’t in the text. Reply with one ```latex code block holding a complete abstract environment.', actions: (t) => [insertAt(t)] },
  translate: { label: 'Translate', icon: 'translate', prompt: 'Translate the selected text into the language named below, keeping every LaTeX command, citation, label and math expression. Reply with one ```latex code block.', input: 'Into which language? e.g. German', actions: (t) => [replaceSel(t)] },
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
    quick: [QUICK.write, QUICK.explain, QUICK.convert, QUICK.fix, QUICK.improve, QUICK.shorter, QUICK.command],
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
      { type: 'big', icon: 'spellCheck', label: 'Check Writing', title: 'Mark spelling, grammar and style problems with a fix for each', run: () => checkWriting() },
    ] },
    { label: 'Rewrite', items: [
      { type: 'big', icon: 'wand', label: 'Improve Writing', run: () => shell.claude.runQuick(QUICK.improve) },
      { type: 'stack', items: [
        { type: 'small', icon: 'shorter', label: 'Shorter', run: () => shell.claude.runQuick(QUICK.shorter) },
        { type: 'small', icon: 'continueWrite', label: 'Expand', run: () => shell.claude.runQuick(QUICK.expand) },
        { type: 'small', icon: 'replace', label: 'Paraphrase', run: () => shell.claude.runQuick(QUICK.paraphrase) },
      ] },
      { type: 'stack', items: [
        { type: 'small', icon: 'wand', label: 'More academic', run: () => shell.claude.runQuick(QUICK.formal) },
        { type: 'small', icon: 'wand', label: 'Simpler', run: () => shell.claude.runQuick(QUICK.simpler) },
        { type: 'small', icon: 'translate', label: 'Translate', run: () => shell.claude.runQuick(QUICK.translate) },
      ] },
      { type: 'big', icon: 'summarize', label: 'Abstract', title: 'Write an abstract from the paper', run: () => shell.claude.runQuick(QUICK.abstract) },
    ] },
    { label: 'Present', items: [
      { type: 'big', icon: 'toPresent', label: 'Send to Present', title: 'Turn this paper into a presentation', run: () => toPresent() },
    ] },
  ],
};

// ---- Send to Present ----

// Every .tex file as it is in the editor, saved or not.
function projectTexts() {
  const texts = new Map(sources.map((s) => [s.path, s.text]));
  for (const [path, buf] of buffers) {
    if (buf.kind === 'tex' || buf.kind === 'bib') texts.set(path, (path === current && view ? view.state : buf.state).doc.toString());
  }
  return [...texts].map(([path, text]) => ({ path, text }));
}

// Loads the figures from the project; PDF figures are drawn with pdf.js.
async function loadFigures(doc) {
  const paths = files.map((f) => f.path);
  for (const im of doc.images) {
    const file = findGraphic(im.path, paths, doc);
    const res = file ? await api.read(file).catch(() => null) : null;
    if (res?.base64) im.src = res.mime === 'application/pdf' ? await pdfPicture(res.base64).catch(() => '') : `data:${res.mime};base64,${res.base64}`;
    if (!im.alt && file) im.alt = file.split('/').pop().replace(/\.[^.]+$/, '');
  }
  keepLoadedImages(doc);
  await preparePictures(doc);
}

function toPresent() {
  if (!mainFile) return toast('This project has no main .tex file yet.', 'error');
  const texts = projectTexts();
  const whole = readLatex(texts, mainFile);
  const range = view && isTex() ? view.state.selection.main : null;
  const picked = range && !range.empty ? view.state.sliceDoc(range.from, range.to) : '';
  const part = picked.trim() ? readLatex(texts, mainFile, { fragment: picked }) : null;
  return presentDialog({ name: whole.title || shell.state.name, whole, part, showAi: () => shell.claude.show(), prepare: loadFigures });
}


// ---- Review pane ----

const reviewPane = createReviewPanel({
  getView: () => (view && isTex() || (view && current && fileKind(current) === 'bib') ? view : null),
  author: () => userName,
  otherFiles: () => Object.entries(review.files)
    .filter(([p, d]) => p !== current && d)
    .map(([p, d]) => {
      const state = buffers.get(p)?.state;
      const changes = state?.field(trackField, false) ? state.field(trackField).changes.length : d.base != null ? 'some' : 0;
      const comments = state?.field(commentField, false) ? state.field(commentField).list.filter((c) => !c.resolved).length : (d.comments || []).filter((c) => !c.resolved).length;
      return { path: p, changes, comments };
    })
    .filter((o) => o.changes || o.comments),
  openFile: (p) => openFile(p),
  onClose: () => shell.refresh(),
});

// ---- Shell ----

const shell = await createShell({
  app: 'docs',
  defaultExt: 'tex',
  tabs: [homeTab, insertTab, reviewTab, viewTab],
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
  exports: [{ label: 'Project as a .zip', detail: 'Every .tex, .bib and picture in the project, plus the compiled PDF, in one .zip file.', icon: 'zip', run: () => downloadZip() }],
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
  tool('zip', 'Download the project as a .zip', () => downloadZip()),
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
const modeSwitch = h('div', 'tex-mode');
const reviewBtn = h('button', 'tex-btn', `${icon('comment', 16)}<span>Review</span><b class="tex-review-n"></b>`);
reviewBtn.title = 'Tracked changes and comments';
reviewBtn.onclick = () => {
  reviewPane.show(!reviewPane.open);
  shell.refresh();
};
edTools.append(modeSwitch, reviewBtn, syncBtn);
edHead.append(crumb, edTools);
const edBody = h('div', 'tex-ed-body');
edBody.append(reviewPane.el);

function drawModeSwitch() {
  modeSwitch.innerHTML = '';
  for (const [on, label, ic, title] of [[false, 'Code', 'code', 'Edit the LaTeX source'], [true, 'Visual', 'visual', 'See it more like the finished document (Ctrl+Shift+E)']]) {
    const b = h('button', prefs.visual === on ? 'on' : '', `${icon(ic, 14)}<span>${label}</span>`);
    b.title = title;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => setVisual(on);
    modeSwitch.append(b);
  }
  modeSwitch.hidden = !current || fileKind(current) !== 'tex';
}
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
const zipBtn = tool('zip', 'Download the project as a .zip', () => downloadZip());
const pvToggle = tool('preview', 'Hide the preview', () => setPreview(false));
pvHead.append(h('div', 'tex-compile-group', ''), issuesBtn, h('span', 'tex-grow'), pageInfo, zoomOut, zoomFit, zoomIn, dlBtn, zipBtn, pvToggle);
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
    { label: 'New project from Git…', icon: 'gitSync', run: () => cloneDialog({ api, dialog }) },
    '-',
    { label: 'Download the project as a .zip…', icon: 'zip', run: () => downloadZip() },
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
  for (const p of Object.keys(review.files)) {
    if (p === from || p.startsWith(`${from}/`)) {
      review.files[res.path + p.slice(from.length)] = review.files[p];
      delete review.files[p];
    }
  }
  scheduleReviewSave();
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
  for (const p of Object.keys(review.files)) if (p === f.path || p.startsWith(`${f.path}/`)) delete review.files[p];
  scheduleReviewSave();
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
      let state = EditorState.create({ doc: res.text, extensions: extensionsFor(f.kind) });
      if (review.files[path] && state.field(trackField, false)) state = state.update({ effects: restoreEffects(review.files[path], state.doc) }).state;
      buf = { saved: res.text, dirty: false, kind: f.kind, state };
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
    reviewPane.draw();
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
  drawModeSwitch();
  drawReviewCount();
}

function drawReviewCount() {
  const st = view && current && buffers.has(current) ? view.state : null;
  const n = st?.field(trackField, false) ? st.field(trackField).changes.length + st.field(commentField).list.filter((c) => !c.resolved).length : 0;
  reviewBtn.querySelector('.tex-review-n').textContent = n || '';
  reviewBtn.classList.toggle('tracking', !!st?.field(trackField, false)?.tracking);
  reviewBtn.hidden = !st?.field(trackField, false);
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
  await flushReview();
  api.history.snapshot({ reason: 'save' }).then((r) => r?.error && console.warn(r.error));
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

async function downloadPdf() {
  const res = await api.savePdf(mainFile);
  if (res?.error) return toast(res.error, 'error');
  if (res?.name) toast(`Saved ${res.name}`);
}

async function downloadZip() {
  const res = await api.saveZip({ main: mainFile, overrides: overrides() });
  if (res?.error) return toast(res.error, 'error');
  if (res?.name) toast(`Saved ${res.name} with ${res.files} file${res.files === 1 ? '' : 's'}`);
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
  const started = Date.now();
  const tick = setInterval(() => {
    const sec = Math.round((Date.now() - started) / 1000);
    if (sec >= 3) compileBtn.innerHTML = `${icon('stop', 16)}<span>Compiling… ${sec}s</span>`;
  }, 1000);
  const res = await api.compile({ main: mainFile, overrides: overrides(), engine: prefs.engine === 'auto' ? null : prefs.engine, timeLimit: prefs.timeLimit || 0 });
  clearInterval(tick);
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
  list.append(h('div', 'rb-menu-sep'), h('div', 'tex-menu-label', 'Time limit'));
  for (const [sec, label, detail] of [[0, 'No limit', 'Long theses and big TikZ figures can take as long as they need'], [60, '1 minute', ''], [300, '5 minutes', ''], [1200, '20 minutes', '']]) {
    row(label, (prefs.timeLimit || 0) === sec, () => {
      prefs.timeLimit = sec;
      savePrefs();
    }, detail);
  }
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
  list.push(...writingDiagnostics());
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

// ---- Word count and symbols ----
function wordCount() {
  const all = projectTexts().filter((f) => fileKind(f.path) === 'tex');
  if (!all.length) return toast('Open a .tex file first.');
  const here = current && fileKind(current) === 'tex' && view ? texCount(view.state.doc.toString()) : null;
  const sum = all.map((f) => texCount(f.text)).reduce((a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + b[k]])));
  const row = (label, k, cls = '') => `<tr class="${cls}"><td>${label}</td>${here ? `<td>${here[k].toLocaleString()}</td>` : ''}<td>${sum[k].toLocaleString()}</td></tr>`;
  const body = `<table class="tex-count"><thead><tr><th></th>${here ? `<th>${escapeHtml(current.split('/').pop())}</th>` : ''}<th>Whole project</th></tr></thead><tbody>
    ${row('Words in text', 'words')}${row('Words in headings', 'headers')}${row('Words in captions', 'captions')}${row('Total words', 'total', 'total')}
    ${row('Headings', 'headings')}${row('Captioned figures and tables', 'floats')}${row('Inline equations', 'inline')}${row('Display equations', 'display')}
  </tbody></table><p class="muted">Commands, comments, maths and the preamble aren’t counted as words.</p>`;
  dialog({ title: 'Word count', body, cancel: null });
}

const SYMBOLS = [
  ['Greek', 'alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega'],
  ['Operators', 'pm mp times div cdot ast circ bullet oplus otimes cap cup wedge vee setminus nabla partial sum prod int oint iint lim infty sqrt frac'],
  ['Relations', 'leq geq neq approx equiv sim simeq cong propto ll gg subset supset subseteq supseteq in notin ni perp parallel mid models vdash'],
  ['Arrows', 'leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow uparrow downarrow mapsto to longrightarrow Longrightarrow hookrightarrow rightleftharpoons'],
  ['Other', 'forall exists nexists emptyset varnothing neg top bot angle triangle ell hbar Re Im aleph R N Z dots cdots vdots ddots prime circ'],
];
const GLYPH = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', div: '÷', cdot: '⋅', ast: '∗', circ: '∘', bullet: '•', oplus: '⊕', otimes: '⊗', cap: '∩', cup: '∪', wedge: '∧', vee: '∨', setminus: '∖', nabla: '∇', partial: '∂', sum: '∑', prod: '∏', int: '∫', oint: '∮', iint: '∬', lim: 'lim', infty: '∞', sqrt: '√', frac: 'a⁄b',
  leq: '≤', geq: '≥', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', in: '∈', notin: '∉', ni: '∋', perp: '⊥', parallel: '∥', mid: '∣', models: '⊨', vdash: '⊢',
  leftarrow: '←', rightarrow: '→', leftrightarrow: '↔', Leftarrow: '⇐', Rightarrow: '⇒', Leftrightarrow: '⇔', uparrow: '↑', downarrow: '↓', mapsto: '↦', to: '→', longrightarrow: '⟶', Longrightarrow: '⟹', hookrightarrow: '↪', rightleftharpoons: '⇌',
  forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅', varnothing: '⌀', neg: '¬', top: '⊤', bot: '⊥', angle: '∠', triangle: '△', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', R: 'ℝ', N: 'ℕ', Z: 'ℤ', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', prime: '′',
};
// What each button types: most are the bare command; a few take arguments.
const SYMBOL_CODE = { sqrt: '\\sqrt{${x}}', frac: '\\frac{${a}}{${b}}', R: '\\mathbb{R}', N: '\\mathbb{N}', Z: '\\mathbb{Z}' };
const MATH_ENVS = /\\(begin|end)\{(equation|align|gather|multline|displaymath|math|eqnarray)\*?\}/g;

// Inside maths a symbol goes in as it is; in running text it is wrapped in $ … $.
function inMath(before) {
  const text = before.replace(/(^|[^\\])%.*$/gm, '$1').replace(/\\\$/g, '');
  const dollars = (text.match(/\$/g) || []).length;
  let depth = 0;
  for (const m of text.matchAll(/\\\[|\\\(|\\\]|\\\)/g)) depth += m[0] === '\\[' || m[0] === '\\(' ? 1 : -1;
  for (const m of text.matchAll(MATH_ENVS)) depth += m[1] === 'begin' ? 1 : -1;
  return dollars % 2 === 1 || depth > 0;
}

function symbolPalette(anchor) {
  if (!view || !current || fileKind(current) !== 'tex') return toast('Open a .tex file first.');
  const box = h('div', 'tex-symbols');
  const tabs = h('div', 'tex-sym-tabs');
  const grid = h('div', 'tex-sym-grid');
  const show = (i) => {
    tabs.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', i === j));
    grid.innerHTML = '';
    for (const name of SYMBOLS[i][1].split(' ')) {
      const code = SYMBOL_CODE[name] || `\\${name}`;
      const b = h('button', 'tex-sym', escapeHtml(GLYPH[name] || name));
      b.title = code.replace(/\$\{(\w+)\}/g, '{$1}');
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => {
        const { from, to } = view.state.selection.main;
        const math = inMath(view.state.sliceDoc(Math.max(0, from - 6000), from));
        // A trailing empty field leaves the cursor after the symbol.
        snippet(`${math ? code : `$${code}$`}$` + '{}')(view, null, from, to);
        view.focus();
      };
      grid.append(b);
    }
  };
  SYMBOLS.forEach(([label], i) => {
    const b = h('button', '', escapeHtml(label));
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => show(i);
    tabs.append(b);
  });
  box.append(tabs, grid);
  show(0);
  popup(anchor, box);
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

// ---- Review: tracked changes and comments ----

let reviewTimer = 0;
function onReviewChange(u) {
  const st = u.state;
  if (!st.field(trackField, false) || !current) return;
  const was = u.startState;
  const changed = u.docChanged || st.field(trackField) !== was.field(trackField, false) || st.field(commentField) !== was.field(commentField, false);
  if (!changed) return;
  scheduleReviewSave();
  reviewPane.draw();
  drawReviewCount();
  if (st.field(trackField).tracking !== was.field(trackField, false)?.tracking) shell.refresh();
}

function collectReview() {
  for (const [path, buf] of buffers) {
    const state = path === current && view ? view.state : buf.state;
    if (!state.field(trackField, false)) continue;
    const d = reviewData(state);
    if (d.base == null && !d.comments.length && !d.tracking) delete review.files[path];
    else review.files[path] = d;
  }
  return review;
}

function scheduleReviewSave() {
  clearTimeout(reviewTimer);
  reviewTimer = setTimeout(flushReview, 800);
}

async function flushReview() {
  clearTimeout(reviewTimer);
  const res = await api.setReview({ files: collectReview().files });
  if (res?.error) toast(res.error, 'error');
}

function reviewAll(accept) {
  const v = reviewPane.tracking() || view?.state.field(trackField, false)?.base != null ? view : null;
  if (!v) return toast('There are no tracked changes in this file.');
  if (accept) acceptAll(v);
  else rejectAll(v);
}

// ---- Proofreading ----

let writingVersion = 0;
async function checkWriting() {
  if (!view || !isTex()) return toast('Open a .tex file first.');
  const file = current;
  const sel = view.state.selection.main;
  const text = sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to);
  const id = ++writingVersion;
  toast(sel.empty ? 'Checking the writing in this file…' : 'Checking the selected text…');
  try {
    const found = await proofread({ text, base: sel.empty ? 0 : sel.from, onProgress: (d, t) => { if (t > 1) statusEngine.textContent = `Checking writing ${d}/${t}`; } });
    if (id !== writingVersion || file !== current) return;
    const doc = view.state.doc;
    writingIssues = found.filter((x) => doc.sliceString(x.from, x.to) === x.quote).map((x) => ({ ...x, file }));
    applyDiagnostics();
    statusEngine.textContent = '';
    toast(writingIssues.length ? `Found ${writingIssues.length} thing${writingIssues.length === 1 ? '' : 's'} to look at. Hover a dotted underline to fix it.` : 'No problems found.');
    if (writingIssues.length) openLintPanel(view);
  } catch (err) {
    statusEngine.textContent = '';
    toast(err.message, 'error');
  }
}

function clearWriting() {
  writingIssues = [];
  applyDiagnostics();
}

function writingDiagnostics() {
  if (!view) return [];
  const doc = view.state.doc;
  return writingIssues
    .filter((x) => x.file === current && x.to <= doc.length && doc.sliceString(x.from, x.to) === x.quote)
    .map((x) => ({
      from: x.from,
      to: x.to,
      severity: x.kind === 'style' || x.kind === 'clarity' ? 'info' : 'warning',
      markClass: `cm-proof cm-proof-${x.kind}`,
      source: x.kind[0].toUpperCase() + x.kind.slice(1),
      message: `${x.why || x.kind}${x.suggestion ? ` → “${x.suggestion}”` : ''}`,
      actions: [
        { name: x.suggestion ? 'Fix' : 'Remove', apply: (v, from, to) => {
          v.dispatch({ changes: { from, to, insert: x.suggestion } });
          writingIssues = writingIssues.filter((y) => y !== x);
          applyDiagnostics();
        } },
        { name: 'Ignore', apply: () => {
          writingIssues = writingIssues.filter((y) => y !== x);
          applyDiagnostics();
        } },
      ],
    }));
}

// ---- History and Git ----

async function saveForVersions() {
  if ([...buffers.values()].some((b) => b.dirty)) await saveAll();
  await flushReview();
}

// Puts files changed on disk (restored or pulled) into their open editors.
async function reloadFromDisk(paths = null) {
  await refreshFiles();
  for (const [path, buf] of buffers) {
    if (paths && !paths.includes(path)) continue;
    const res = await api.read(path);
    if (res?.text == null || res.text === buf.saved) continue;
    const state = path === current && view ? view.state : buf.state;
    const tr = state.update({ changes: { from: 0, to: state.doc.length, insert: res.text } });
    if (path === current && view) view.dispatch(tr);
    else buf.state = tr.state;
    buf.saved = res.text;
    buf.dirty = false;
  }
  review = await api.review().then((r) => (r?.error ? review : { files: r.files || {} }));
  updateDirty();
  drawTree();
  drawCrumb();
  compile();
}

function showHistory() {
  openHistory({ api, host: shell.workspace, beforeOpen: saveForVersions, onRestored: (paths) => reloadFromDisk(paths) });
}

async function nameVersion() {
  const v = await dialog({ title: 'Name this version', body: '<p>Keep the project as it is now, under a name you’ll recognise in History, such as “Sent to supervisor”.</p>', fields: [{ name: 'label', label: 'Name', value: '' }], ok: 'Save version' });
  if (!v?.label?.trim()) return;
  await saveForVersions();
  const res = await api.history.snapshot({ label: v.label.trim(), reason: 'named' });
  if (res?.error) return toast(res.error, 'error');
  toast(`Saved the version “${v.label.trim()}”. Find it in History.`);
}

function showGit() {
  openGit({ api, beforeOpen: saveForVersions, onPulled: async () => {
    await reloadFromDisk();
    api.history.snapshot({ reason: 'git' });
  } });
}

// ---- Table and figure builders ----

function tableAtCursor() {
  if (!view || !isTex()) return null;
  const found = tables.tableAround(view.state.doc.toString(), view.state.selection.main.head);
  if (!found) return null;
  const parsed = tables.parseTable(found.text);
  return parsed ? { ...found, parsed } : null;
}

async function openTableBuilder() {
  if (!view || !isTex()) {
    const main = mainFile || files.find((f) => f.kind === 'tex')?.path;
    if (main) await openFile(main);
    else return toast('Open a .tex file first.');
  }
  const at = tableAtCursor();
  tableBuilder({
    initial: at?.parsed || null,
    onInsert: (code, { packages }) => {
      if (at) {
        // Keep the table's own indentation so only real edits show as changes.
        const unit = /\n([ \t]+)\S/.exec(at.text)?.[1] || '\t';
        const out = code.replace(/\n$/, '').replace(/^\t+/gm, (tabs) => unit.repeat(tabs.length));
        view.dispatch({ changes: { from: at.from, to: at.to, insert: out } });
      }
      else insertRaw(code);
      ensurePackages(packages);
    },
  });
}

function openFigureBuilder() {
  figureBuilder({
    images: files.filter((f) => f.kind === 'image').map((f) => ({ path: f.path })),
    readImage: async (p) => {
      const res = await api.read(p).catch(() => null);
      if (!res?.base64) return null;
      return res.mime === 'application/pdf' ? pdfPicture(res.base64).catch(() => null) : `data:${res.mime};base64,${res.base64}`;
    },
    upload: async () => (await uploadTo(files.some((f) => f.dir && f.path === 'figures') ? 'figures' : ''))?.filter((p) => fileKind(p) === 'image'),
    onInsert: async (code, { packages }) => {
      if (!view || !isTex()) {
        const main = mainFile || files.find((f) => f.kind === 'tex')?.path;
        if (main) await openFile(main);
      }
      insertRaw(code);
      ensurePackages(packages);
    },
  });
}

// Inserts text as it is (no snippet fields) on a line of its own.
function insertRaw(text) {
  if (!view) return;
  const sel = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.from);
  const lead = line.text.slice(0, sel.from - line.from).trim() ? '\n' : '';
  view.dispatch({ changes: { from: sel.from, to: sel.to, insert: lead + text }, selection: { anchor: sel.from + lead.length + text.length }, scrollIntoView: true });
  view.focus();
}

// Adds \usepackage lines the builders need to the main file's preamble.
async function ensurePackages(names) {
  if (!names?.length || !mainFile) return;
  const buf = buffers.get(mainFile);
  const state = buf ? (mainFile === current && view ? view.state : buf.state) : null;
  let text = state ? state.doc.toString() : (await api.read(mainFile))?.text;
  if (text == null) return;
  const begin = text.search(/\\begin\s*\{document\}/);
  if (begin < 0) return;
  const pre = text.slice(0, begin);
  const missing = names.filter((n) => !new RegExp(`\\\\(?:usepackage|RequirePackage)\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${n}\\b`).test(pre));
  if (!missing.length) return;
  const last = [...pre.matchAll(/\\usepackage[^\n]*\n/g)].pop();
  const dc = /\\documentclass[^\n]*\n/.exec(pre);
  const at = last ? last.index + last[0].length : dc ? dc.index + dc[0].length : 0;
  const add = missing.map((n) => `\\usepackage{${n}}\n`).join('');
  if (state) {
    const tr = state.update({ changes: { from: at, insert: add } });
    if (mainFile === current && view) view.dispatch(tr);
    else {
      buf.state = tr.state;
      buf.dirty = true;
      updateDirty();
    }
  } else {
    await api.write(mainFile, text.slice(0, at) + add + text.slice(at));
  }
  toast(`Added ${missing.map((n) => `\\usepackage{${n}}`).join(', ')} to ${mainFile}`);
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
review = await api.review().then((r) => (r?.error ? { files: {} } : { files: r.files || {} }));
userName = (await window.office.pdf.user().catch(() => '')) || 'You';
await refreshFiles();
api.history.snapshot({ reason: 'open' });
const first = (prefs.open && files.some((f) => f.path === prefs.open) && prefs.open) || project.open || mainFile || files.find((f) => f.kind === 'tex')?.path;
if (first) await openFile(first);
else showEmptyEditor();
drawIssues();
compile();
