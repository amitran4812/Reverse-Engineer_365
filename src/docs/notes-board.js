// A write-anywhere area for notes: click anywhere in it to start a text box,
// drag a box by its top edge to move it, and drag the bottom edge to make the
// area taller. Boxes are kept in the node's attributes, so undo, saving and
// Send to Present all see them.

import { Node, mergeAttributes } from '@tiptap/core';
import { h } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

const MIN_HEIGHT = 160;
const MAX_HEIGHT = 3000;
const BOX_WIDTH = 220;
const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SPAN']);

let nextId = 0;
const newId = () => `b${Date.now().toString(36)}${(nextId++).toString(36)}`;

function parseItems(v) {
  if (Array.isArray(v)) return v;
  try {
    const items = JSON.parse(v || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

// Box text keeps simple formatting only (bold, italic, lists, line breaks).
export function cleanBoxHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  const walk = (el) => {
    for (const child of [...el.children]) {
      walk(child);
      if (!KEEP.has(child.tagName)) child.replaceWith(...child.childNodes);
      else for (const a of [...child.attributes]) child.removeAttribute(a.name);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML.replace(/^(<br>)+|(<br>)+$/g, '').trim();
}

const boxText = (html) => {
  const doc = new DOMParser().parseFromString(`<body>${String(html || '').replace(/<br\s*\/?>|<\/?(div|p|li)\b[^>]*>/gi, '\n')}</body>`, 'text/html');
  return doc.body.textContent.split('\n').map((l) => l.trim()).filter(Boolean);
};

const isBlank = (html) => !String(html || '').replace(/<[^>]+>|&nbsp;|\s/g, '');

export const NoteBoard = Node.create({
  name: 'noteBoard',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      height: { default: 360, parseHTML: (el) => Number(el.getAttribute('data-height')) || 360, renderHTML: (a) => ({ 'data-height': a.height }) },
      items: { default: [], parseHTML: (el) => parseItems(el.getAttribute('data-items')), renderHTML: (a) => ({ 'data-items': JSON.stringify(a.items || []) }) },
    };
  },
  parseHTML: () => [{ tag: 'div[data-note-board]' }],
  renderHTML({ HTMLAttributes, node }) {
    // Outside the editor (HTML export, copy) the boxes are placed as they are on screen.
    const boxes = parseItems(node.attrs.items).map((it) => ['div', { class: 'nb-box', style: `position:absolute;left:${it.x}px;top:${it.y}px;width:${it.w}px` }, ...boxText(it.html).map((line) => ['div', line])]);
    return ['div', mergeAttributes(HTMLAttributes, { 'data-note-board': '', class: 'note-board', style: `position:relative;height:${node.attrs.height}px` }), ...boxes];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let current = node;
      let items = parseItems(node.attrs.items).map((it) => ({ ...it }));
      let height = node.attrs.height;
      let committed = JSON.stringify(items);
      const dom = h('div', 'note-board');
      dom.contentEditable = 'false';
      const hint = h('div', 'nb-hint', `${icon('board', 16)}<span>Click anywhere here to write</span>`);
      const resize = h('div', 'nb-resize');
      resize.title = 'Drag to make this area taller or shorter';
      const remove = h('button', 'nb-remove', icon('close', 14));
      remove.type = 'button';
      remove.title = 'Remove this area';

      function commit() {
        const pos = getPos();
        if (typeof pos !== 'number') return;
        const json = JSON.stringify(items);
        if (json === committed && height === current.attrs.height) return;
        committed = json;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, { ...current.attrs, height, items: items.map((it) => ({ ...it })) }));
      }

      function fit() {
        // The area grows to fit its lowest box.
        let need = MIN_HEIGHT;
        for (const el of dom.querySelectorAll('.nb-box')) need = Math.max(need, el.offsetTop + el.offsetHeight + 24);
        if (need > height) {
          height = Math.min(MAX_HEIGHT, need);
          dom.style.height = `${height}px`;
        }
      }

      function boxEl(it) {
        const box = h('div', 'nb-box');
        box.dataset.id = it.id;
        box.style.left = `${it.x}px`;
        box.style.top = `${it.y}px`;
        box.style.width = `${it.w}px`;
        const grip = h('div', 'nb-grip');
        grip.title = 'Drag to move';
        const del = h('button', 'nb-del', icon('close', 12));
        del.type = 'button';
        del.title = 'Delete this box';
        grip.append(del);
        const text = h('div', 'nb-text');
        text.contentEditable = 'true';
        text.spellcheck = true;
        text.innerHTML = it.html || '';
        const size = h('div', 'nb-size');
        size.title = 'Drag to resize';
        box.append(grip, text, size);

        text.addEventListener('input', () => {
          it.html = cleanBoxHtml(text.innerHTML);
          fit();
        });
        text.addEventListener('paste', (e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        });
        text.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') text.blur();
          // Save shortcuts read the editor, so put the box text in first.
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') commit();
        });
        text.addEventListener('blur', () => {
          it.html = cleanBoxHtml(text.innerHTML);
          if (isBlank(it.html)) {
            items = items.filter((x) => x !== it);
            box.remove();
          }
          hint.hidden = items.length > 0;
          commit();
        });
        del.onclick = (e) => {
          e.stopPropagation();
          items = items.filter((x) => x !== it);
          box.remove();
          hint.hidden = items.length > 0;
          commit();
        };
        drag(grip, (dx, dy, start) => {
          it.x = Math.max(0, Math.min(dom.clientWidth - 40, start.x + dx));
          it.y = Math.max(0, start.y + dy);
          box.style.left = `${it.x}px`;
          box.style.top = `${it.y}px`;
          fit();
        }, () => ({ x: it.x, y: it.y }));
        drag(size, (dx, dy, start) => {
          it.w = Math.max(90, Math.min(dom.clientWidth - it.x, start.w + dx));
          box.style.width = `${it.w}px`;
          fit();
        }, () => ({ w: it.w }));
        return box;
      }

      // Pointer drag with mouse, pen or finger; commits when let go.
      function drag(handle, move, startOf) {
        handle.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button')) return;
          e.preventDefault();
          e.stopPropagation();
          const x0 = e.clientX;
          const y0 = e.clientY;
          const start = startOf();
          handle.setPointerCapture(e.pointerId);
          const onMove = (ev) => move(ev.clientX - x0, ev.clientY - y0, start);
          const onUp = () => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.removeEventListener('pointercancel', onUp);
            commit();
          };
          handle.addEventListener('pointermove', onMove);
          handle.addEventListener('pointerup', onUp);
          handle.addEventListener('pointercancel', onUp);
        });
      }

      function draw() {
        dom.innerHTML = '';
        dom.style.height = `${height}px`;
        hint.hidden = items.length > 0;
        dom.append(hint, ...items.map(boxEl), remove, resize);
      }

      dom.addEventListener('pointerdown', (e) => {
        if (e.target !== dom && e.target !== hint && !hint.contains(e.target)) return;
        e.preventDefault();
        const r = dom.getBoundingClientRect();
        const it = { id: newId(), x: Math.max(0, Math.round(Math.min(e.clientX - r.left, r.width - BOX_WIDTH))), y: Math.max(0, Math.round(e.clientY - r.top - 12)), w: BOX_WIDTH, html: '' };
        items.push(it);
        const box = boxEl(it);
        dom.insertBefore(box, remove);
        hint.hidden = true;
        fit();
        box.querySelector('.nb-text').focus();
      });
      drag(resize, (dx, dy, start) => {
        height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, start.h + dy));
        dom.style.height = `${height}px`;
      }, () => ({ h: height }));
      remove.onclick = (e) => {
        e.stopPropagation();
        const pos = getPos();
        if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + current.nodeSize }).run();
      };

      draw();
      return {
        dom,
        update(next) {
          if (next.type.name !== 'noteBoard') return false;
          current = next;
          const json = JSON.stringify(next.attrs.items || []);
          // Our own commits don't redraw, so a box being typed in keeps its caret.
          if (json !== committed || next.attrs.height !== height) {
            items = parseItems(next.attrs.items).map((it) => ({ ...it }));
            height = next.attrs.height;
            committed = json;
            draw();
          }
          return true;
        },
        stopEvent: (e) => dom.contains(e.target),
        ignoreMutation: () => true,
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
      };
    };
  },
});
