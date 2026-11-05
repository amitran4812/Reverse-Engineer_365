// Write's reading and reviewing tools: the Navigation pane (headings), a table of
// contents that keeps itself up to date, and comments on selected text.

import { Mark, Node, mergeAttributes } from '@tiptap/core';
import { dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import outline from '../../common/outline.js';

const { headingOutline } = outline;

// ---------- comments ----------
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() {
    const attr = (name) => ({ default: '', parseHTML: (el) => el.getAttribute(`data-comment-${name}`) || '', renderHTML: (a) => (a[name] ? { [`data-comment-${name}`]: a[name] } : {}) });
    return {
      id: attr('id'),
      text: attr('text'),
      author: attr('author'),
      date: attr('date'),
      resolved: { default: false, parseHTML: (el) => el.getAttribute('data-comment-resolved') === 'true', renderHTML: (a) => (a.resolved ? { 'data-comment-resolved': 'true' } : {}) },
    };
  },
  parseHTML: () => [{ tag: 'span[data-comment-id]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'doc-comment' }), 0],
});

// ---------- table of contents ----------
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML: () => [{ tag: 'div[data-toc]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'doc-toc' })],
  addNodeView() {
    return ({ editor }) => {
      const dom = h('div', 'doc-toc');
      dom.setAttribute('data-toc', '');
      dom.contentEditable = 'false';
      const draw = () => {
        const items = headingOutline(editor.getJSON());
        dom.innerHTML = `<div class="doc-toc-title">Contents</div>${items.length ? '' : '<div class="doc-toc-empty">Add headings (Home &gt; Styles) and they appear here.</div>'}`;
        items.forEach((it) => {
          const a = h('div', `doc-toc-item lvl${Math.min(it.level, 4)}`, escapeHtml(it.text || '(untitled heading)'));
          a.onmousedown = (e) => {
            e.preventDefault();
            goToHeading(editor, it.index);
          };
          dom.append(a);
        });
      };
      draw();
      editor.on('update', draw);
      return { dom, ignoreMutation: () => true, destroy: () => editor.off('update', draw) };
    };
  },
});

export function goToHeading(editor, index) {
  let n = -1;
  let at = null;
  editor.state.doc.descendants((node, pos) => {
    if (at != null) return false;
    if (node.type.name === 'heading' && ++n === index) at = pos;
    return node.type.name !== 'heading';
  });
  if (at == null) return;
  editor.chain().focus().setTextSelection(at + 1).run();
  editor.view.nodeDOM(at)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

const AUTHOR_KEY = 'work.commentAuthor';
const readAuthor = () => {
  try {
    return localStorage.getItem(AUTHOR_KEY) || '';
  } catch {
    return '';
  }
};

// Every comment in document order, joined across the text it covers.
function allComments(editor) {
  const map = new Map();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name !== 'comment' || !m.attrs.id) continue;
      const c = map.get(m.attrs.id);
      if (c) {
        c.quote += (pos > c.to ? ' ' : '') + node.text;
        c.to = pos + node.nodeSize;
      } else map.set(m.attrs.id, { ...m.attrs, from: pos, to: pos + node.nodeSize, quote: node.text });
    }
  });
  return [...map.values()];
}

function setCommentAttrs(editor, id, patch) {
  const type = editor.schema.marks.comment;
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const m = node.marks.find((x) => x.type === type && x.attrs.id === id);
    if (!m) return;
    tr.removeMark(pos, pos + node.nodeSize, m);
    if (patch) tr.addMark(pos, pos + node.nodeSize, type.create({ ...m.attrs, ...patch }));
  });
  editor.view.dispatch(tr);
}

export function createReview({ editor, canvas, getShell }) {
  // ---------- navigation pane ----------
  const nav = h('aside', 'doc-nav');
  const navHead = h('div', 'doc-nav-head', `<b>Navigation</b>`);
  const navClose = h('button', 'doc-nav-x', icon('close', 14));
  navClose.title = 'Close';
  navHead.append(navClose);
  const navFind = h('input', 'doc-nav-find');
  navFind.placeholder = 'Search headings';
  const navList = h('div', 'doc-nav-list');
  nav.append(navHead, navFind, navList);
  nav.hidden = true;

  // ---------- comments pane ----------
  const side = h('aside', 'doc-comments');
  const sideHead = h('div', 'doc-nav-head', '<b>Comments</b>');
  const showDone = h('label', 'doc-cmt-done', '<input type="checkbox"> Resolved');
  const sideClose = h('button', 'doc-nav-x', icon('close', 14));
  sideClose.title = 'Close';
  sideHead.append(showDone, sideClose);
  const sideList = h('div', 'doc-cmt-list');
  side.append(sideHead, sideList);
  side.hidden = true;

  const row = h('div', 'doc-row');
  row.append(nav, canvas, side);

  let current = -1;
  function drawNav() {
    if (nav.hidden) return;
    const q = navFind.value.trim().toLowerCase();
    const items = headingOutline(editor.getJSON());
    const { from } = editor.state.selection;
    let here = -1;
    let i = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        i += 1;
        if (pos <= from) here = i;
        return false;
      }
      return true;
    });
    current = here;
    navList.innerHTML = '';
    const shown = items.filter((it) => !q || it.text.toLowerCase().includes(q));
    if (!shown.length) navList.append(h('div', 'doc-nav-empty', items.length ? 'No headings match.' : 'Use Heading styles on the Home tab and your headings show up here, so you can jump around the document.'));
    for (const it of shown) {
      const b = h('button', `doc-nav-item lvl${Math.min(it.level, 4)}${it.index === current ? ' on' : ''}`, escapeHtml(it.text || '(untitled heading)'));
      b.onclick = () => goToHeading(editor, it.index);
      navList.append(b);
    }
  }
  navFind.oninput = drawNav;
  navFind.onkeydown = (e) => e.stopPropagation();
  navClose.onclick = () => toggleNav(false);
  function toggleNav(on = nav.hidden) {
    nav.hidden = !on;
    drawNav();
    getShell().refresh();
  }

  function drawComments() {
    if (side.hidden) return;
    const done = showDone.querySelector('input').checked;
    const list = allComments(editor).filter((c) => done || !c.resolved);
    sideList.innerHTML = '';
    if (!list.length) sideList.append(h('div', 'doc-nav-empty', 'Select some text and choose New Comment (Ctrl+Alt+M) to leave a note on it.'));
    const { from } = editor.state.selection;
    for (const c of list) {
      const card = h('div', `doc-cmt${c.resolved ? ' resolved' : ''}${from >= c.from && from <= c.to ? ' on' : ''}`);
      const when = c.date ? new Date(c.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
      card.innerHTML = `<div class="doc-cmt-meta"><b>${escapeHtml(c.author || 'Author')}</b><span>${escapeHtml(when)}</span></div><div class="doc-cmt-quote">${escapeHtml(c.quote.slice(0, 120))}</div><div class="doc-cmt-text">${escapeHtml(c.text)}</div>`;
      const acts = h('div', 'doc-cmt-acts');
      const btn = (label, run) => {
        const b = h('button', 'btn', label);
        b.onclick = (e) => {
          e.stopPropagation();
          run();
        };
        acts.append(b);
      };
      btn('Edit', async () => {
        const v = await dialog({ title: 'Edit comment', fields: [{ name: 'text', label: 'Comment', type: 'textarea', value: c.text }], ok: 'Save' });
        if (v?.text?.trim()) setCommentAttrs(editor, c.id, { text: v.text.trim() });
      });
      btn(c.resolved ? 'Reopen' : 'Resolve', () => setCommentAttrs(editor, c.id, { resolved: !c.resolved }));
      btn('Delete', () => setCommentAttrs(editor, c.id, null));
      card.append(acts);
      card.onclick = () => {
        editor.chain().focus().setTextSelection({ from: c.from, to: c.to }).run();
        editor.view.domAtPos(c.from).node?.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      };
      sideList.append(card);
    }
  }
  showDone.querySelector('input').onchange = drawComments;
  sideClose.onclick = () => toggleComments(false);
  function toggleComments(on = side.hidden) {
    side.hidden = !on;
    drawComments();
    getShell().refresh();
  }

  async function newComment() {
    const { from, to } = editor.state.selection;
    if (from === to) return toast('Select the text you want to comment on first');
    const author = readAuthor();
    const fields = [{ name: 'text', label: 'Comment', type: 'textarea' }];
    if (!author) fields.push({ name: 'author', label: 'Your name (shown on your comments)', value: '' });
    const v = await dialog({ title: 'New comment', fields, ok: 'Comment' });
    if (!v?.text?.trim()) return;
    let name = author;
    if (v.author?.trim()) {
      name = v.author.trim();
      try {
        localStorage.setItem(AUTHOR_KEY, name);
      } catch {}
    }
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    editor.chain().focus().setTextSelection({ from, to }).setMark('comment', { id, text: v.text.trim(), author: name || 'Author', date: new Date().toISOString() }).run();
    toggleComments(true);
  }

  function step(dir) {
    const list = allComments(editor).filter((c) => !c.resolved);
    if (!list.length) return toast('No comments');
    const { from } = editor.state.selection;
    const next = dir > 0 ? list.find((c) => c.from > from) || list[0] : [...list].reverse().find((c) => c.to < from) || list[list.length - 1];
    toggleComments(true);
    editor.chain().focus().setTextSelection({ from: next.from, to: next.to }).scrollIntoView().run();
  }

  function insertToc() {
    editor.chain().focus().insertContent({ type: 'tableOfContents' }).run();
    if (!headingOutline(editor.getJSON()).length) toast('The table lists your headings: use Heading 1, 2 or 3 on the Home tab');
  }

  editor.on('update', () => {
    drawNav();
    drawComments();
  });
  editor.on('selectionUpdate', () => {
    drawNav();
    drawComments();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && e.code === 'KeyM') {
      e.preventDefault();
      newComment();
    }
  });

  return {
    row,
    toggleNav,
    toggleComments,
    newComment,
    insertToc,
    step,
    navOn: () => !nav.hidden,
    commentsOn: () => !side.hidden,
    hasComments: () => allComments(editor).length > 0,
    showIfComments: () => {
      if (allComments(editor).some((c) => !c.resolved)) toggleComments(true);
    },
  };
}
