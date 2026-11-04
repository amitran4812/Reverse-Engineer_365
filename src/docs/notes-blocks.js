// Notes blocks: toggles (a line that opens to show what's under it), callouts
// (a tinted box with an icon) and page templates for common kinds of notes.

import { Node, mergeAttributes } from '@tiptap/core';
import { h } from '../shared/shell.js';

export const CALLOUTS = [
  { kind: 'info', label: 'Info', mark: 'i' },
  { kind: 'tip', label: 'Tip', mark: '✓' },
  { kind: 'warn', label: 'Warning', mark: '!' },
  { kind: 'idea', label: 'Idea', mark: '★' },
];

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return { kind: { default: 'info', parseHTML: (el) => el.getAttribute('data-callout') || 'info', renderHTML: (a) => ({ 'data-callout': a.kind }) } };
  },
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { class: 'note-callout' }), 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h('div', 'note-callout');
      dom.dataset.callout = node.attrs.kind;
      const badge = h('button', 'note-callout-mark');
      badge.contentEditable = 'false';
      badge.title = 'Change the callout type';
      const paint = (kind) => {
        badge.textContent = (CALLOUTS.find((c) => c.kind === kind) || CALLOUTS[0]).mark;
        dom.dataset.callout = kind;
      };
      paint(node.attrs.kind);
      badge.onmousedown = (e) => {
        e.preventDefault();
        const i = CALLOUTS.findIndex((c) => c.kind === dom.dataset.callout);
        const next = CALLOUTS[(i + 1) % CALLOUTS.length].kind;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(getPos(), undefined, { kind: next }));
      };
      const body = h('div', 'note-callout-body');
      dom.append(badge, body);
      return {
        dom,
        contentDOM: body,
        update: (n) => {
          if (n.type.name !== 'callout') return false;
          paint(n.attrs.kind);
          return true;
        },
        ignoreMutation: (m) => badge.contains(m.target),
      };
    };
  },
});

// The first paragraph is the toggle's line; the blocks after it fold away.
export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'paragraph block*',
  defining: true,
  addAttributes() {
    return { open: { default: true, parseHTML: (el) => el.getAttribute('data-open') !== 'false', renderHTML: (a) => ({ 'data-open': a.open ? 'true' : 'false' }) } };
  },
  parseHTML: () => [{ tag: 'div[data-toggle]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-toggle': '', class: 'note-toggle' }), 0],
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h('div', 'note-toggle');
      const arrow = h('button', 'note-toggle-arrow');
      arrow.contentEditable = 'false';
      arrow.title = 'Open or close';
      const set = (open) => {
        dom.classList.toggle('closed', !open);
        arrow.setAttribute('aria-expanded', String(open));
      };
      set(node.attrs.open);
      arrow.onmousedown = (e) => {
        e.preventDefault();
        const pos = getPos();
        const cur = editor.state.doc.nodeAt(pos);
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { open: !cur.attrs.open }));
      };
      const body = h('div', 'note-toggle-body');
      dom.append(arrow, body);
      return {
        dom,
        contentDOM: body,
        update: (n) => {
          if (n.type.name !== 'toggle') return false;
          set(n.attrs.open);
          return true;
        },
        ignoreMutation: (m) => arrow.contains(m.target),
      };
    };
  },
});

const p = (text, marks) => ({ type: 'paragraph', content: text ? [{ type: 'text', text, ...(marks ? { marks } : {}) }] : [] });
const hd = (text, level = 2) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const bullets = (...items) => ({ type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });
const tasks = (...items) => ({ type: 'taskList', content: items.map((t) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(t)] })) });
const callout = (kind, text) => ({ type: 'callout', attrs: { kind }, content: [p(text)] });
const toggle = (title, ...content) => ({ type: 'toggle', attrs: { open: true }, content: [p(title, [{ type: 'bold' }]), ...content] });
const today = () => new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

export const TEMPLATES = [
  { id: 'meeting', label: 'Meeting notes', build: () => [
    hd('Meeting: ', 1), p(`Date: ${today()}`), p('Attendees: '),
    hd('Agenda'), bullets(''),
    hd('Notes'), bullets(''),
    hd('Decisions'), bullets(''),
    hd('Action items'), tasks('Owner: task (due date)'),
  ] },
  { id: 'lecture', label: 'Lecture notes', build: () => [
    hd('Lecture: ', 1), p(`Course:   ·   ${today()}`),
    callout('info', 'Key idea of today, in one sentence.'),
    hd('Notes'), bullets(''),
    toggle('Questions to ask', bullets('')),
    hd('Summary'), p(''),
    hd('To review'), tasks('Re-read the slides', 'Do the practice problems'),
  ] },
  { id: 'cornell', label: 'Cornell notes', build: () => [
    hd('Topic: ', 1), p(today()),
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [p('Cues and questions')] }, { type: 'tableHeader', content: [p('Notes')] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p('')] }, { type: 'tableCell', content: [p('')] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [p('')] }, { type: 'tableCell', content: [p('')] }] },
    ] },
    hd('Summary'), p(''),
  ] },
  { id: 'project', label: 'Project plan', build: () => [
    hd('Project: ', 1),
    callout('tip', 'Goal: what does done look like?'),
    hd('Milestones'), tasks('Milestone 1', 'Milestone 2', 'Milestone 3'),
    hd('Risks'), bullets(''),
    toggle('Background and links', p('')),
  ] },
  { id: 'journal', label: 'Daily journal', build: () => [
    hd(today(), 1),
    hd('Top three for today'), tasks('', '', ''),
    hd('Notes'), p(''),
    hd('Grateful for'), bullets(''),
  ] },
];
