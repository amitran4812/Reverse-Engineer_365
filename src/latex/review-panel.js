// The Review pane beside the LaTeX editor: tracked changes to accept or reject,
// and comments with replies, for the open file.

import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import { trackField, commentField, setTracking, setComments, setActiveComment, acceptOne, rejectOne, acceptAll, rejectAll, describeChange, newId } from './review.js';

const when = (t) => {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export function createReviewPanel({ getView, author, otherFiles, openFile, onClose }) {
  const el = h('aside', 'tc-pane');
  el.hidden = true;
  let showResolved = false;
  let composing = null; // { from, to }
  let drawTimer = 0;

  const view = () => getView();

  function setTrack(on) {
    const v = view();
    if (!v) return toast('Open a .tex file first.');
    v.dispatch({ effects: setTracking.of(on) });
    toast(on ? 'Track changes is on. Edits show as suggestions to accept or reject.' : 'Track changes is off. Changes already made stay until you accept or reject them.');
  }

  function tracking() {
    const v = view();
    return !!v?.state.field(trackField, false)?.tracking;
  }

  function jump(from, to = from) {
    const v = view();
    if (!v) return;
    v.dispatch({ selection: EditorSelection.range(from, to), effects: EditorView.scrollIntoView(from, { y: 'center' }) });
    v.focus();
  }

  function startComment() {
    const v = view();
    if (!v) return toast('Open a .tex file first.');
    let { from, to } = v.state.selection.main;
    if (from === to) {
      const word = v.state.wordAt(from);
      if (word) ({ from, to } = word);
      else {
        const line = v.state.doc.lineAt(from);
        ({ from, to } = line);
      }
    }
    if (from === to) return toast('Select the text to comment on first.');
    composing = { from, to };
    show(true);
    draw();
    el.querySelector('.tc-compose textarea')?.focus();
  }

  function postComment(text) {
    const v = view();
    if (!v || !composing || !text.trim()) return;
    const { list } = v.state.field(commentField);
    const c = { id: newId(), from: composing.from, to: composing.to, text: text.trim(), author: author(), time: Date.now(), resolved: false, replies: [] };
    composing = null;
    v.dispatch({ effects: [setComments.of([...list, c]), setActiveComment.of(c.id)] });
  }

  function patchComment(id, fn) {
    const v = view();
    if (!v) return;
    const { list } = v.state.field(commentField);
    v.dispatch({ effects: setComments.of(list.map((c) => (c.id === id ? fn(c) : c)).filter(Boolean)) });
  }

  function focusComment(id) {
    const v = view();
    if (!v) return;
    const c = v.state.field(commentField).list.find((x) => x.id === id);
    v.dispatch({ effects: setActiveComment.of(id) });
    if (c) jump(c.from, c.to);
    show(true);
    draw();
    el.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function show(on) {
    el.hidden = !on;
    if (on) draw();
  }

  function scheduleDraw() {
    if (el.hidden) return;
    clearTimeout(drawTimer);
    drawTimer = setTimeout(draw, 120);
  }

  function draw() {
    if (el.hidden) return;
    const v = view();
    const keepScroll = el.querySelector('.tc-body')?.scrollTop || 0;
    el.innerHTML = '';
    const head = h('div', 'tc-head', `<b>Review</b>`);
    const close = h('button', 'tex-tool', icon('close', 14));
    close.title = 'Close the Review pane';
    close.onclick = () => {
      show(false);
      onClose?.();
    };
    head.append(close);
    const sw = h('label', 'tc-switch', `<input type="checkbox"${tracking() ? ' checked' : ''}><span>Track changes</span>`);
    sw.querySelector('input').onchange = (e) => setTrack(e.target.checked);
    const body = h('div', 'tc-body');
    el.append(head, sw, body);
    if (!v) {
      body.append(h('div', 'tex-empty-small', 'Open a .tex file to review it.'));
      return;
    }
    const { changes } = v.state.field(trackField);
    const { list, active } = v.state.field(commentField);

    // Changes.
    const ch = h('div', 'tc-section');
    const chHead = h('div', 'tc-sec-head', `<b>Changes</b><span class="tc-n">${changes.length}</span>`);
    if (changes.length) {
      const all = h('button', 'tc-mini ok', `${icon('check', 12)}Accept all`);
      all.onclick = () => acceptAll(v);
      const none = h('button', 'tc-mini', `${icon('close', 12)}Reject all`);
      none.onclick = () => rejectAll(v);
      chHead.append(all, none);
    }
    ch.append(chHead);
    if (!changes.length) ch.append(h('div', 'tc-empty', tracking() ? 'Edits you make now show up here.' : 'Turn on Track changes to suggest edits instead of making them straight away.'));
    changes.slice(0, 300).forEach((c) => {
      const d = describeChange(c, v.state.doc);
      const line = v.state.doc.lineAt(c.from).number;
      const row = h('div', 'tc-change', `<div class="tc-change-top"><span class="tc-kind ${d.kind.toLowerCase()}">${d.kind}</span><span class="tc-line">line ${line}</span></div><div class="tc-change-text">${d.html}</div>`);
      const tools = h('div', 'tc-change-tools');
      const ok = h('button', 'tc-mini ok', icon('check', 12));
      ok.title = 'Accept';
      ok.onclick = (e) => {
        e.stopPropagation();
        acceptOne(v, c);
      };
      const no = h('button', 'tc-mini', icon('close', 12));
      no.title = 'Reject';
      no.onclick = (e) => {
        e.stopPropagation();
        rejectOne(v, c);
      };
      tools.append(ok, no);
      row.querySelector('.tc-change-top').append(tools);
      row.onclick = () => jump(c.from, c.to);
      ch.append(row);
    });
    if (changes.length > 300) ch.append(h('div', 'tc-empty', `${changes.length - 300} more changes. Accept or reject these first.`));

    // Comments.
    const cm = h('div', 'tc-section');
    const open = list.filter((c) => !c.resolved);
    const done = list.filter((c) => c.resolved);
    const cmHead = h('div', 'tc-sec-head', `<b>Comments</b><span class="tc-n">${open.length}</span>`);
    const add = h('button', 'tc-mini', `${icon('plus', 12)}New`);
    add.title = 'Comment on the selected text (Ctrl+Alt+M)';
    add.onmousedown = (e) => e.preventDefault();
    add.onclick = () => startComment();
    cmHead.append(add);
    cm.append(cmHead);
    if (composing) {
      const box = h('div', 'tc-compose');
      box.append(h('div', 'tc-quote', escapeHtml(v.state.sliceDoc(composing.from, composing.to).slice(0, 160))));
      const ta = h('textarea');
      ta.placeholder = 'Write a comment… (Ctrl+Enter to post)';
      const post = h('button', 'btn primary', 'Comment');
      const cancel = h('button', 'btn', 'Cancel');
      post.onclick = () => postComment(ta.value);
      cancel.onclick = () => {
        composing = null;
        draw();
      };
      ta.onkeydown = (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          postComment(ta.value);
        }
        if (e.key === 'Escape') cancel.onclick();
      };
      const row = h('div', 'tc-compose-row');
      row.append(cancel, post);
      box.append(ta, row);
      cm.append(box);
    }
    if (!list.length && !composing) cm.append(h('div', 'tc-empty', 'Select some text and choose New to leave a comment.'));
    for (const c of [...open, ...(showResolved ? done : [])].sort((a, b) => a.from - b.from)) cm.append(commentCard(v, c, c.id === active));
    if (done.length) {
      const t = h('button', 'tc-link', showResolved ? `Hide ${done.length} resolved` : `Show ${done.length} resolved`);
      t.onclick = () => {
        showResolved = !showResolved;
        draw();
      };
      cm.append(t);
    }

    body.append(ch, cm);

    // Other files with pending review.
    const others = otherFiles();
    if (others.length) {
      const of = h('div', 'tc-section');
      of.append(h('div', 'tc-sec-head', '<b>Other files</b>'));
      for (const o of others) {
        const row = h('button', 'tc-file', `${icon('texFile', 14)}<span>${escapeHtml(o.path)}</span><small>${[o.changes ? (typeof o.changes === 'string' ? 'tracked changes' : `${o.changes} change${o.changes === 1 ? '' : 's'}`) : '', o.comments ? `${o.comments} comment${o.comments === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}</small>`);
        row.onclick = () => openFile(o.path);
        of.append(row);
      }
      body.append(of);
    }
    body.scrollTop = keepScroll;
  }

  function commentCard(v, c, isActive) {
    const card = h('div', `tc-comment${isActive ? ' active' : ''}${c.resolved ? ' resolved' : ''}`);
    card.dataset.id = c.id;
    const quote = v.state.sliceDoc(c.from, c.to);
    card.innerHTML = `<div class="tc-quote">${quote ? escapeHtml(quote.slice(0, 160)) : '<i>The commented text was deleted</i>'}</div>`;
    const msg = (m) => h('div', 'tc-msg', `<div class="tc-who"><b>${escapeHtml(m.author || 'You')}</b><span>${when(m.time)}</span></div><div class="tc-text">${escapeHtml(m.text)}</div>`);
    card.append(msg(c));
    for (const r of c.replies || []) card.append(msg(r));
    const tools = h('div', 'tc-comment-tools');
    const reply = h('input', 'tc-reply');
    reply.placeholder = 'Reply…';
    reply.onkeydown = (e) => {
      if (e.key === 'Enter' && reply.value.trim()) {
        const text = reply.value.trim();
        patchComment(c.id, (x) => ({ ...x, replies: [...(x.replies || []), { text, author: author(), time: Date.now() }] }));
      }
    };
    const resolve = h('button', 'tc-mini', `${icon('check', 12)}${c.resolved ? 'Reopen' : 'Resolve'}`);
    resolve.onclick = (e) => {
      e.stopPropagation();
      patchComment(c.id, (x) => ({ ...x, resolved: !x.resolved }));
    };
    const del = h('button', 'tc-mini', icon('trash', 12));
    del.title = 'Delete comment';
    del.onclick = (e) => {
      e.stopPropagation();
      patchComment(c.id, () => null);
    };
    tools.append(reply, resolve, del);
    card.append(tools);
    card.onclick = (e) => {
      if (e.target.closest('button, input')) return;
      v.dispatch({ effects: setActiveComment.of(c.id) });
      jump(c.from, c.to);
    };
    return card;
  }

  return { el, show, draw: scheduleDraw, redraw: draw, startComment, focusComment, setTrack, tracking, get open() { return !el.hidden; } };
}
