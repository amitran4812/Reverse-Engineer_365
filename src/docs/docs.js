import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import '../shared/ui.css';
import './docs.css';
import { createShell, dialog, h, toast } from '../shared/shell.js';
import { markdownToHtml } from '../shared/claude-pane.js';
import { popup } from '../shared/ribbon.js';

const FONTS = ['Calibri', 'Arial', 'Cambria', 'Georgia', 'Garamond', 'Helvetica', 'Segoe UI', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Courier New', 'Consolas'];
const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
const MARGINS = { narrow: '0.5in', normal: '1in', wide: '1.5in' };

const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break' })],
  addCommands() {
    return { setPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

const page = { margins: 'normal', orientation: 'portrait' };
let zoom = 100;

const canvas = h('div', 'doc-canvas');
const paper = h('div', 'doc-page');
canvas.append(paper);

const editor = new Editor({
  element: paper,
  extensions: [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TextStyleKit,
    Highlight.configure({ multicolor: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ allowBase64: true }),
    Placeholder.configure({ placeholder: 'Start typing, or press Ctrl+J to ask Claude to draft something.' }),
    PageBreak,
  ],
  content: '<p></p>',
  autofocus: true,
});

const chain = () => editor.chain().focus();
const is = (name, attrs) => () => editor.isActive(name, attrs);
const isAlign = (a) => () => editor.isActive({ textAlign: a });

function currentFontSize() {
  const s = editor.getAttributes('textStyle').fontSize;
  if (!s) return '11';
  const n = parseFloat(s);
  return String(s.endsWith('px') ? Math.round(n * 0.75 * 2) / 2 : n);
}

function styleTile(label, css, run, active) {
  return { label, html: `<span class="style-tile" style="${css}">AaBbCc</span><small>${label}</small>`, run, active };
}

async function insertImage() {
  const input = h('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => chain().setImage({ src: reader.result, alt: file.name }).run();
    reader.readAsDataURL(file);
  };
  input.click();
}

async function insertTable() {
  const v = await dialog({ title: 'Insert table', fields: [
    { name: 'rows', label: 'Rows', type: 'number', value: 3, min: 1, max: 50 },
    { name: 'cols', label: 'Columns', type: 'number', value: 3, min: 1, max: 12 },
  ], ok: 'Insert' });
  if (v) chain().insertTable({ rows: Number(v.rows) || 3, cols: Number(v.cols) || 3, withHeaderRow: true }).run();
}

async function insertLink() {
  const prev = editor.getAttributes('link').href || 'https://';
  const v = await dialog({ title: 'Insert link', fields: [{ name: 'href', label: 'Address', value: prev }], ok: 'Insert' });
  if (!v) return;
  if (!v.href || v.href === 'https://') chain().extendMarkRange('link').unsetLink().run();
  else chain().extendMarkRange('link').setLink({ href: v.href }).run();
}

// Find / replace over the document's text nodes.
function findMatches(term, caseSensitive) {
  const out = [];
  if (!term) return out;
  const needle = caseSensitive ? term : term.toLowerCase();
  editor.state.doc.descendants((n, pos) => {
    if (!n.isText) return;
    const hay = caseSensitive ? n.text : n.text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0) {
      out.push({ from: pos + i, to: pos + i + term.length });
      i = hay.indexOf(needle, i + term.length);
    }
  });
  return out;
}

async function findReplace(replace = false) {
  const fields = [{ name: 'find', label: 'Find what', value: editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to) }];
  if (replace) fields.push({ name: 'replace', label: 'Replace with', value: '' });
  const v = await dialog({ title: replace ? 'Replace' : 'Find', fields, ok: replace ? 'Replace all' : 'Find next' });
  if (!v || !v.find) return;
  const matches = findMatches(v.find, false);
  if (!matches.length) {
    toast(`Couldn't find “${v.find}”`);
    return;
  }
  if (replace) {
    let tr = editor.state.tr;
    for (const m of [...matches].reverse()) tr = tr.insertText(v.replace, m.from, m.to);
    editor.view.dispatch(tr);
    toast(`Replaced ${matches.length} occurrence${matches.length === 1 ? '' : 's'}`);
  } else {
    const after = matches.find((m) => m.from > editor.state.selection.from) || matches[0];
    chain().setTextSelection(after).scrollIntoView().run();
    toast(`${matches.length} match${matches.length === 1 ? '' : 'es'}`);
  }
}

function applyPage() {
  paper.style.setProperty('--margin', MARGINS[page.margins]);
  paper.classList.toggle('landscape', page.orientation === 'landscape');
  canvas.style.setProperty('--zoom', zoom / 100);
}

function setZoom(z) {
  zoom = Math.max(30, Math.min(300, Math.round(z)));
  applyPage();
  zoomRange.value = zoom;
  zoomLabel.textContent = `${zoom}%`;
}

function plainText() {
  return editor.getText({ blockSeparator: '\n\n' });
}

function selectionText() {
  const { from, to } = editor.state.selection;
  return from === to ? '' : editor.state.doc.textBetween(from, to, '\n\n');
}

function insertMarkdown(md, replace = false) {
  const html = markdownToHtml(md);
  if (replace && !editor.state.selection.empty) chain().deleteSelection().insertContent(html).run();
  else chain().insertContent(html).run();
}

const homeTab = {
  id: 'home',
  label: 'Home',
  groups: [
    { label: 'Clipboard', items: [
      { type: 'big', icon: 'paste', label: 'Paste', run: () => navigator.clipboard.readText().then((t) => chain().insertContent(t).run()).catch(() => toast('Use Ctrl+V to paste')) },
      { type: 'stack', items: [
        { type: 'small', icon: 'cut', label: 'Cut', run: () => document.execCommand('cut') },
        { type: 'small', icon: 'copy', label: 'Copy', run: () => document.execCommand('copy') },
        { type: 'small', icon: 'clear', label: 'Clear format', run: () => chain().unsetAllMarks().clearNodes().run() },
      ] },
    ] },
    { label: 'Font', items: [
      { type: 'row', items: [
        { type: 'select', title: 'Font', width: 132, options: FONTS.map((f) => ({ value: f, label: f, style: `font-family:${f}` })), value: () => (editor.getAttributes('textStyle').fontFamily || 'Calibri').replace(/["']/g, '').split(',')[0], change: (f) => chain().setFontFamily(f).run() },
        { type: 'select', title: 'Font size', width: 56, options: SIZES.map((s) => ({ value: String(s), label: String(s) })), value: currentFontSize, change: (s) => chain().setFontSize(`${s}pt`).run() },
      ] },
      { type: 'row', items: [
        { type: 'text', text: 'B', style: 'font-weight:700', title: 'Bold', shortcut: 'Ctrl+B', run: () => chain().toggleBold().run(), active: is('bold') },
        { type: 'text', text: 'I', style: 'font-style:italic', title: 'Italic', shortcut: 'Ctrl+I', run: () => chain().toggleItalic().run(), active: is('italic') },
        { type: 'text', text: 'U', style: 'text-decoration:underline', title: 'Underline', shortcut: 'Ctrl+U', run: () => chain().toggleUnderline().run(), active: is('underline') },
        { type: 'text', text: 'S', style: 'text-decoration:line-through', title: 'Strikethrough', run: () => chain().toggleStrike().run(), active: is('strike') },
        { type: 'sep' },
        { type: 'color', icon: 'highlight', title: 'Highlight', initial: '#fff3bf', allowNone: true, pick: (c) => (c ? chain().toggleHighlight({ color: c }).run() : chain().unsetHighlight().run()) },
        { type: 'color', icon: 'color', title: 'Font color', initial: '#c0392b', allowNone: true, pick: (c) => (c ? chain().setColor(c).run() : chain().unsetColor().run()) },
      ] },
    ] },
    { label: 'Paragraph', items: [
      { type: 'row', items: [
        { type: 'icon', icon: 'bullets', title: 'Bullets', run: () => chain().toggleBulletList().run(), active: is('bulletList') },
        { type: 'icon', icon: 'numbers', title: 'Numbering', run: () => chain().toggleOrderedList().run(), active: is('orderedList') },
        { type: 'icon', icon: 'outdent', title: 'Decrease indent', run: () => chain().liftListItem('listItem').run() },
        { type: 'icon', icon: 'indent', title: 'Increase indent', run: () => chain().sinkListItem('listItem').run() },
        { type: 'icon', icon: 'quote', title: 'Quote', run: () => chain().toggleBlockquote().run(), active: is('blockquote') },
      ] },
      { type: 'row', items: [
        { type: 'icon', icon: 'alignLeft', title: 'Align left', run: () => chain().setTextAlign('left').run(), active: isAlign('left') },
        { type: 'icon', icon: 'alignCenter', title: 'Center', run: () => chain().setTextAlign('center').run(), active: isAlign('center') },
        { type: 'icon', icon: 'alignRight', title: 'Align right', run: () => chain().setTextAlign('right').run(), active: isAlign('right') },
        { type: 'icon', icon: 'alignJustify', title: 'Justify', run: () => chain().setTextAlign('justify').run(), active: isAlign('justify') },
        { type: 'select', title: 'Line spacing', width: 54, options: ['1.0', '1.15', '1.5', '2.0', '3.0'].map((v) => ({ value: v, label: v })), value: () => editor.getAttributes('textStyle').lineHeight || '1.15', change: (v) => chain().setLineHeight(v).run() },
      ] },
    ] },
    { label: 'Styles', items: [
      { type: 'gallery', items: [
        styleTile('Normal', 'font-size:13px', () => chain().setParagraph().run(), () => editor.isActive('paragraph') && !editor.isActive('blockquote')),
        styleTile('Title', 'font-size:18px;font-weight:300', () => chain().setHeading({ level: 1 }).setTextAlign('center').run(), () => editor.isActive('heading', { level: 1 }) && editor.isActive({ textAlign: 'center' })),
        styleTile('Heading 1', 'font-size:16px;color:var(--accent);font-weight:600', () => chain().setHeading({ level: 1 }).run(), is('heading', { level: 1 })),
        styleTile('Heading 2', 'font-size:14px;color:var(--accent);font-weight:600', () => chain().setHeading({ level: 2 }).run(), is('heading', { level: 2 })),
        styleTile('Heading 3', 'font-size:13px;color:var(--accent-dark);font-weight:600', () => chain().setHeading({ level: 3 }).run(), is('heading', { level: 3 })),
        styleTile('Code', 'font-family:Consolas,monospace;font-size:12px', () => chain().toggleCodeBlock().run(), is('codeBlock')),
      ] },
    ] },
    { label: 'Editing', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'find', label: 'Find', shortcut: 'Ctrl+F', run: () => findReplace(false) },
        { type: 'small', icon: 'replace', label: 'Replace', shortcut: 'Ctrl+H', run: () => findReplace(true) },
      ] },
    ] },
    { label: 'Claude', items: [
      { type: 'big', icon: 'sparkle', label: 'Ask Claude', title: 'Open Claude (Ctrl+J)', run: () => shell.claude.toggle() },
    ] },
  ],
};

const insertTab = {
  id: 'insert',
  label: 'Insert',
  groups: [
    { label: 'Pages', items: [{ type: 'big', icon: 'pageBreak', label: 'Page Break', shortcut: 'Ctrl+Enter', run: () => chain().setPageBreak().run() }] },
    { label: 'Tables', items: [{ type: 'big', icon: 'table', label: 'Table', run: insertTable }] },
    { label: 'Illustrations', items: [{ type: 'big', icon: 'image', label: 'Pictures', run: insertImage }] },
    { label: 'Links', items: [{ type: 'big', icon: 'link', label: 'Link', shortcut: 'Ctrl+K', run: insertLink, active: is('link') }] },
    { label: 'Text', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'hr', label: 'Horizontal line', run: () => chain().setHorizontalRule().run() },
        { type: 'small', icon: 'quote', label: 'Quote', run: () => chain().toggleBlockquote().run() },
        { type: 'small', icon: 'textbox', label: 'Date & time', run: () => chain().insertContent(new Date().toLocaleString()).run() },
      ] },
    ] },
  ],
};

const tableTools = [
  { label: 'Add row', icon: 'insertRow', run: () => chain().addRowAfter().run() },
  { label: 'Add column', icon: 'insertCol', run: () => chain().addColumnAfter().run() },
  { label: 'Delete row', icon: 'deleteRow', run: () => chain().deleteRow().run() },
  { label: 'Delete column', icon: 'deleteCol', run: () => chain().deleteColumn().run() },
  '-',
  { label: 'Merge or split cells', icon: 'table', run: () => chain().mergeOrSplit().run() },
  { label: 'Toggle header row', icon: 'table', run: () => chain().toggleHeaderRow().run() },
  { label: 'Delete table', icon: 'trash', run: () => chain().deleteTable().run() },
];

const layoutTab = {
  id: 'layout',
  label: 'Layout',
  groups: [
    { label: 'Page Setup', items: [
      { type: 'menu', big: true, icon: 'margins', label: 'Margins', items: Object.keys(MARGINS).map((m) => ({ label: `${m[0].toUpperCase()}${m.slice(1)} (${MARGINS[m]})`, run: () => { page.margins = m; applyPage(); shell.markDirty(); } })) },
      { type: 'menu', big: true, icon: 'orientation', label: 'Orientation', items: ['portrait', 'landscape'].map((o) => ({ label: o[0].toUpperCase() + o.slice(1), run: () => { page.orientation = o; applyPage(); shell.markDirty(); } })) },
    ] },
    { label: 'Table', items: [
      { type: 'menu', big: true, icon: 'table', label: 'Table Tools', items: tableTools, enabled: () => editor.isActive('table') },
    ] },
  ],
};

const reviewTab = {
  id: 'review',
  label: 'Review',
  groups: [
    { label: 'Proofing', items: [
      { type: 'big', icon: 'proofread', label: 'Proofread with Claude', run: () => shell.claude.runQuick(QUICK.proofread) },
      { type: 'big', icon: 'wordCount', label: 'Word Count', run: () => {
        const text = plainText();
        const words = (text.match(/\S+/g) || []).length;
        dialog({ title: 'Word count', body: `<p>Words: <b>${words}</b><br>Characters: <b>${text.replace(/\n/g, '').length}</b><br>Paragraphs: <b>${editor.state.doc.childCount}</b></p>`, cancel: null });
      } },
    ] },
    { label: 'Language', items: [{ type: 'big', icon: 'translate', label: 'Translate', run: () => shell.claude.runQuick(QUICK.translate) }] },
  ],
};

const viewTab = {
  id: 'view',
  label: 'View',
  groups: [
    { label: 'Zoom', items: [
      { type: 'big', icon: 'zoomIn', label: 'Zoom In', run: () => setZoom(zoom + 10) },
      { type: 'big', icon: 'zoomOut', label: 'Zoom Out', run: () => setZoom(zoom - 10) },
      { type: 'big', icon: 'find', label: '100%', run: () => setZoom(100) },
    ] },
    { label: 'Show', items: [
      { type: 'big', icon: 'sparkle', label: 'Claude Pane', run: () => shell.claude.toggle() },
    ] },
  ],
};

const QUICK = {
  draft: { label: 'Draft with Claude', icon: 'wand', prompt: 'Write new content for this document. Reply with only the content, in Markdown.', input: 'Describe what to write, then press Enter…', actions: (t) => [{ label: 'Insert', icon: 'plus', run: () => insertMarkdown(t) }] },
  improve: { label: 'Improve the selected text', icon: 'wand', prompt: 'Rewrite the selected text so it reads clearly and professionally while keeping its meaning. Reply with only the rewritten text, in Markdown.', actions: (t) => [{ label: 'Replace selection', icon: 'replace', run: () => insertMarkdown(t, true) }, { label: 'Insert', icon: 'plus', run: () => insertMarkdown(t) }] },
  summarize: { label: 'Summarize this document', icon: 'summarize', prompt: 'Summarize the document in a short paragraph followed by 3–6 key points.', actions: (t) => [{ label: 'Insert summary', icon: 'plus', run: () => insertMarkdown(t) }] },
  proofread: { label: 'Proofread', icon: 'proofread', prompt: 'Proofread the selected text (or the whole document if nothing is selected). List each spelling, grammar or clarity issue with a suggested fix. Then give the fully corrected text under a heading "Corrected text".', actions: (t) => {
    const fixed = t.split(/#+\s*Corrected text\s*\n/i)[1];
    return fixed ? [{ label: 'Apply corrections', icon: 'proofread', run: () => (selectionText() ? insertMarkdown(fixed, true) : editor.commands.setContent(markdownToHtml(fixed))) }] : [];
  } },
  shorter: { label: 'Make it shorter', icon: 'shorter', prompt: 'Make the selected text (or the whole document if nothing is selected) about half as long without losing key information. Reply with only the new text, in Markdown.', actions: (t) => [{ label: 'Replace selection', icon: 'replace', run: () => insertMarkdown(t, true) }] },
  continue: { label: 'Continue writing', icon: 'continueWrite', prompt: 'Continue writing from where the document ends, matching its tone and style. Write one or two paragraphs. Reply with only the new text, in Markdown.', actions: (t) => [{ label: 'Insert at cursor', icon: 'plus', run: () => insertMarkdown(t) }] },
  translate: { label: 'Translate', icon: 'translate', prompt: 'Translate the selected text (or the whole document if nothing is selected). Reply with only the translation, in Markdown. Target language:', input: 'Which language? e.g. Spanish', actions: (t) => [{ label: 'Replace selection', icon: 'replace', run: () => insertMarkdown(t, true) }, { label: 'Insert', icon: 'plus', run: () => insertMarkdown(t) }] },
};

const claudeTab = {
  id: 'claude',
  label: 'Claude',
  special: true,
  groups: [
    { label: 'Write', items: [
      { type: 'big', icon: 'wand', label: 'Draft', run: () => shell.claude.runQuick(QUICK.draft) },
      { type: 'big', icon: 'continueWrite', label: 'Continue Writing', run: () => shell.claude.runQuick(QUICK.continue) },
    ] },
    { label: 'Rewrite', items: [
      { type: 'big', icon: 'wand', label: 'Improve', run: () => shell.claude.runQuick(QUICK.improve) },
      { type: 'big', icon: 'shorter', label: 'Shorten', run: () => shell.claude.runQuick(QUICK.shorter) },
      { type: 'menu', big: true, icon: 'chat', label: 'Tone', items: ['Professional', 'Friendly', 'Confident', 'Simple'].map((tone) => ({ label: tone, run: () => shell.claude.runQuick({ label: `Make it ${tone.toLowerCase()}`, icon: 'chat', prompt: `Rewrite the selected text (or the whole document if nothing is selected) in a ${tone.toLowerCase()} tone. Reply with only the rewritten text, in Markdown.`, actions: (t) => [{ label: 'Replace selection', icon: 'replace', run: () => insertMarkdown(t, true) }] }) })) },
    ] },
    { label: 'Understand', items: [
      { type: 'big', icon: 'summarize', label: 'Summarize', run: () => shell.claude.runQuick(QUICK.summarize) },
      { type: 'big', icon: 'proofread', label: 'Proofread', run: () => shell.claude.runQuick(QUICK.proofread) },
      { type: 'big', icon: 'translate', label: 'Translate', run: () => shell.claude.runQuick(QUICK.translate) },
    ] },
    { label: 'Chat', items: [{ type: 'big', icon: 'chat', label: 'Open Claude', run: () => shell.claude.toggle() }] },
  ],
};

const shell = await createShell({
  app: 'docs',
  defaultExt: 'docx',
  tabs: [homeTab, insertTab, layoutTab, reviewTab, viewTab],
  claudeTab,
  undo: () => chain().undo().run(),
  redo: () => chain().redo().run(),
  getSaveData: () => ({ json: editor.getJSON(), html: editor.getHTML(), text: plainText(), page }),
  exports: [
    { label: 'Web page (.html)', detail: 'Open in any browser.', icon: 'link', ext: 'html' },
    { label: 'Plain text (.txt)', detail: 'Text only, no formatting.', icon: 'textbox', ext: 'txt' },
  ],
  pdfOptions: () => ({ landscape: page.orientation === 'landscape' }),
  claude: {
    intro: 'I can draft, rewrite, summarize or proofread. Select text first to work on just that part.',
    placeholder: 'Ask Claude about this document, or to write something…',
    system: [
      'You are Claude, built into Rea Write, a word processor. The user’s document and current selection are provided in tags.',
      'When asked to write, rewrite or translate, reply with only the resulting content in Markdown (headings, lists, bold, italic and tables are fine), with no preamble or closing remarks, so it can be inserted directly into the document.',
      'When asked a question about the document, answer concisely.',
    ].join('\n'),
    context: () => {
      const sel = selectionText();
      const text = plainText();
      return `<document name="${shell.state.name}">\n${text.slice(0, 400000)}\n</document>${sel ? `\n<selection>\n${sel}\n</selection>` : '\n<selection>(nothing selected)</selection>'}`;
    },
    quick: [QUICK.draft, QUICK.improve, QUICK.summarize, QUICK.proofread, QUICK.continue],
    actions: (t) => [
      { label: 'Insert', icon: 'plus', run: () => insertMarkdown(t) },
      { label: 'Replace selection', icon: 'replace', run: () => insertMarkdown(t, true) },
    ],
  },
});

shell.workspace.append(canvas);

// Status bar: page estimate, word count, zoom.
const pageInfo = h('span');
const words = h('span');
shell.statusLeft.append(pageInfo, words);
const zoomBox = h('div', 'zoom', '<button title="Zoom out">−</button><input type="range" min="30" max="300"><button title="Zoom in">+</button><span></span>');
const zoomRange = zoomBox.querySelector('input');
const zoomLabel = zoomBox.querySelector('span');
zoomRange.oninput = () => setZoom(Number(zoomRange.value));
zoomBox.querySelectorAll('button')[0].onclick = () => setZoom(zoom - 10);
zoomBox.querySelectorAll('button')[1].onclick = () => setZoom(zoom + 10);
shell.statusRight.append(zoomBox);

function updateStatus() {
  const text = plainText();
  const n = (text.match(/\S+/g) || []).length;
  words.textContent = `${n.toLocaleString()} word${n === 1 ? '' : 's'}`;
  const pageHeight = page.orientation === 'landscape' ? 816 : 1056;
  let breaks = 0;
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'pageBreak') breaks += 1;
  });
  const pages = Math.max(1, Math.ceil((paper.scrollHeight * 100) / zoom / pageHeight)) + breaks;
  pageInfo.textContent = `Page count: ${pages}`;
}

let loading = false;
editor.on('update', () => {
  if (!loading) shell.markDirty();
  updateStatus();
});
editor.on('selectionUpdate', () => shell.refresh());
editor.on('transaction', () => shell.refresh());

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'f') {
    e.preventDefault();
    findReplace(false);
  } else if (k === 'h') {
    e.preventDefault();
    findReplace(true);
  } else if (k === 'k') {
    if (!e.shiftKey) {
      e.preventDefault();
      insertLink();
    }
  } else if (k === '=' || k === '+') {
    e.preventDefault();
    setZoom(zoom + 10);
  } else if (k === '-') {
    e.preventDefault();
    setZoom(zoom - 10);
  }
});

// Table context menu (right-click inside a table).
paper.addEventListener('contextmenu', (e) => {
  if (!editor.isActive('table')) return;
  e.preventDefault();
  const list = h('div', 'rb-menu');
  for (const t of tableTools) {
    if (t === '-') {
      list.append(h('div', 'rb-menu-sep'));
      continue;
    }
    const b = h('button', 'rb-menu-item', `<span>${t.label}</span>`);
    b.onclick = () => {
      document.querySelector('.rb-popup')?.remove();
      t.run();
    };
    list.append(b);
  }
  const anchor = { getBoundingClientRect: () => ({ left: e.clientX, bottom: e.clientY }) };
  popup(anchor, list);
});

if (shell.info.file?.data) {
  loading = true;
  editor.commands.setContent(shell.info.file.data.html || '<p></p>');
  loading = false;
  if (shell.info.file.data.warnings?.length) console.info('Import notes:', shell.info.file.data.warnings);
}
setZoom(100);
updateStatus();
if (shell.info.file?.generated) shell.markDirty();
shell.refresh();
