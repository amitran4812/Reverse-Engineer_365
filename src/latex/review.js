// Track changes and comments for LaTeX mode. Tracking keeps the text as it
// was when tracking started (the "base"); every difference between the base
// and the editor is a change to accept or reject. Comments are ranges that
// follow the text as it is edited. Both are saved in .work/review.json.

import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, hoverTooltip } from '@codemirror/view';
import diff from '../../common/diff.js';
import { escapeHtml, h } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

const { wordChanges, acceptChange } = diff;

export const setTracking = StateEffect.define(); // boolean
export const setBase = StateEffect.define(); // string | null
export const setComments = StateEffect.define(); // [{ id, from, to, ... }]
export const setActiveComment = StateEffect.define(); // id | null

// Maps a position in the editor to the same spot in the base text, when it
// sits outside every change.
function toBase(changes, pos) {
  let delta = 0;
  for (const c of changes) {
    if (pos < c.from) break;
    if (pos <= c.to && c.to > c.from) return null;
    if (pos === c.from && c.to === c.from) return null;
    delta += (c.aTo - c.aFrom) - (c.to - c.from);
  }
  return pos + delta;
}

// { tracking, base, changes }
export const trackField = StateField.define({
  create: () => ({ tracking: false, base: null, changes: [] }),
  update(value, tr) {
    let { tracking, base } = value;
    let rebuilt = false;
    for (const e of tr.effects) {
      if (e.is(setTracking)) {
        tracking = e.value;
        if (tracking && base == null) base = tr.startState.doc.toString();
        rebuilt = true;
      }
      if (e.is(setBase)) {
        base = e.value;
        rebuilt = true;
      }
    }
    if (tr.docChanged && base != null && !tracking) {
      // Edits made with tracking off go into the base too, where they don't touch a change.
      const edits = [];
      let clean = true;
      tr.changes.iterChanges((fromA, toA, fromB, toB, text) => {
        const a = toBase(value.changes, fromA);
        const b = toBase(value.changes, toA);
        if (a == null || b == null) clean = false;
        else edits.push([a, b, text.toString()]);
      });
      if (clean) for (const [a, b, text] of edits.reverse()) base = base.slice(0, a) + text + base.slice(b);
      rebuilt = true;
    }
    if (!rebuilt && !tr.docChanged) return value;
    const doc = tr.state.doc.toString();
    if (base != null && base === doc && !tracking) base = null;
    return { tracking, base, changes: base == null ? [] : wordChanges(base, doc) };
  },
});

class DeletedWidget extends WidgetType {
  constructor(text, index) {
    super();
    this.text = text;
    this.index = index;
  }
  eq(o) {
    return o.text === this.text && o.index === this.index;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-tc-del';
    el.dataset.change = this.index;
    el.textContent = this.text.length > 400 ? `${this.text.slice(0, 200)} … ${this.text.slice(-120)}` : this.text;
    el.title = 'Deleted';
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const insMark = (i) => Decoration.mark({ class: 'cm-tc-ins', attributes: { 'data-change': String(i) } });

const trackDecorations = EditorView.decorations.compute([trackField], (state) => {
  const { changes } = state.field(trackField);
  const b = new RangeSetBuilder();
  changes.forEach((c, i) => {
    if (c.deleted) b.add(c.from, c.from, Decoration.widget({ widget: new DeletedWidget(c.deleted, i), side: -1 }));
    if (c.to > c.from) b.add(c.from, c.to, insMark(i));
  });
  return b.finish();
});

// [{ id, from, to, quote, text, author, time, resolved, replies }]
export const commentField = StateField.define({
  create: () => ({ list: [], active: null }),
  update(value, tr) {
    let { list, active } = value;
    if (tr.docChanged) {
      list = list.map((c) => {
        const from = tr.changes.mapPos(c.from, 1);
        const to = Math.max(from, tr.changes.mapPos(c.to, -1));
        return from === c.from && to === c.to ? c : { ...c, from, to };
      });
    }
    for (const e of tr.effects) {
      if (e.is(setComments)) list = e.value;
      if (e.is(setActiveComment)) active = e.value;
    }
    return list === value.list && active === value.active ? value : { list, active };
  },
});

const commentDecorations = EditorView.decorations.compute([commentField], (state) => {
  const { list, active } = state.field(commentField);
  const ranges = list.filter((c) => !c.resolved && c.to > c.from).sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(ranges.map((c) => Decoration.mark({ class: `cm-tc-comment${c.id === active ? ' active' : ''}`, attributes: { 'data-comment': c.id } }).range(c.from, c.to)), true);
});

// Puts saved comments back on their text, finding the quoted words again if
// the file was changed outside Work.
export function anchorComments(list, doc) {
  const text = doc.toString();
  return (list || []).map((c) => {
    let from = Math.min(Math.max(0, c.from | 0), text.length);
    let to = Math.min(Math.max(from, c.to | 0), text.length);
    if (c.quote && text.slice(from, to) !== c.quote) {
      let best = -1;
      for (let i = text.indexOf(c.quote); i >= 0; i = text.indexOf(c.quote, i + 1)) {
        if (best < 0 || Math.abs(i - from) < Math.abs(best - from)) best = i;
      }
      if (best >= 0) {
        from = best;
        to = best + c.quote.length;
      } else {
        to = from;
      }
    }
    return { ...c, from, to };
  });
}

export function describeChange(c, doc) {
  const added = doc.sliceString(c.from, c.to);
  const short = (s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > 60 ? `${t.slice(0, 57)}…` : t || '(line break)';
  };
  if (!c.deleted.trim() && !added.trim()) return { kind: 'Spacing', html: '<span>Changed spaces or line breaks</span>' };
  if (c.deleted && added) return { kind: 'Replaced', html: `<del>${escapeHtml(short(c.deleted))}</del> with <ins>${escapeHtml(short(added))}</ins>` };
  if (c.deleted) return { kind: 'Deleted', html: `<del>${escapeHtml(short(c.deleted))}</del>` };
  return { kind: 'Added', html: `<ins>${escapeHtml(short(added))}</ins>` };
}

export function acceptOne(view, c) {
  const { base } = view.state.field(trackField);
  if (base == null) return;
  view.dispatch({ effects: setBase.of(acceptChange(base, view.state.doc.toString(), c)) });
}

export function rejectOne(view, c) {
  view.dispatch({ changes: { from: c.from, to: c.to, insert: c.deleted }, effects: rebase(view.state) });
}

// Rejecting must not count as a new tracked edit: the base stays the same.
function rebase(state) {
  const { base } = state.field(trackField);
  return setBase.of(base);
}

export function acceptAll(view) {
  const { tracking } = view.state.field(trackField);
  view.dispatch({ effects: setBase.of(tracking ? view.state.doc.toString() : null) });
}

export function rejectAll(view) {
  const { base, tracking } = view.state.field(trackField);
  if (base == null) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: base }, effects: setBase.of(tracking ? base : null) });
}

function changeTooltip(onAction) {
  return hoverTooltip((view, pos) => {
    const { changes } = view.state.field(trackField);
    const i = changes.findIndex((c) => pos >= c.from && pos <= Math.max(c.to, c.from + 1));
    if (i < 0) return null;
    const c = changes[i];
    return {
      pos: c.from,
      end: Math.max(c.to, c.from),
      above: true,
      create: () => {
        const d = describeChange(c, view.state.doc);
        const dom = h('div', 'tc-tip', `<span class="tc-tip-kind">${d.kind}</span>`);
        const ok = h('button', 'tc-tip-btn ok', `${icon('check', 14)}Accept`);
        const no = h('button', 'tc-tip-btn', `${icon('close', 14)}Reject`);
        ok.onmousedown = no.onmousedown = (e) => e.preventDefault();
        ok.onclick = () => {
          acceptOne(view, c);
          onAction();
        };
        no.onclick = () => {
          rejectOne(view, c);
          onAction();
        };
        dom.append(ok, no);
        return { dom };
      },
    };
  }, { hoverTime: 250 });
}

const reviewTheme = EditorView.baseTheme({
  '.cm-tc-ins': { background: 'var(--tc-ins-bg)', textDecoration: 'underline', textDecorationColor: 'var(--tc-ins)', textUnderlineOffset: '3px' },
  '.cm-tc-del': { color: 'var(--tc-del)', textDecoration: 'line-through', background: 'var(--tc-del-bg)', borderRadius: '2px', padding: '0 1px' },
  '.cm-tc-comment': { background: 'var(--tc-comment-bg)', borderBottom: '2px solid var(--tc-comment)' },
  '.cm-tc-comment.active': { background: 'var(--tc-comment-active)' },
});

export function reviewExtension({ onAction = () => {}, onCommentClick = () => {} } = {}) {
  return [
    trackField,
    commentField,
    trackDecorations,
    commentDecorations,
    reviewTheme,
    changeTooltip(onAction),
    EditorView.domEventHandlers({
      click: (e) => {
        const el = e.target.closest?.('[data-comment]');
        if (el) onCommentClick(el.dataset.comment);
        return false;
      },
    }),
  ];
}

// What a file's review looks like when saved.
export function reviewData(state) {
  const { base, tracking } = state.field(trackField);
  const { list } = state.field(commentField);
  return {
    base,
    tracking,
    comments: list.map((c) => ({ ...c, quote: state.sliceDoc(c.from, c.to) })),
  };
}

// Effects that put a saved review onto a freshly opened file.
export function restoreEffects(data, doc) {
  if (!data) return [];
  return [setBase.of(data.base ?? null), setTracking.of(!!data.tracking), setComments.of(anchorComments(data.comments, doc))];
}

export const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
