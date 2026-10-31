// Find in the PDF: searches each page's text and marks the matches.

import { icon } from '../shared/icons.js';
import { h } from '../shared/shell.js';

export class Finder {
  constructor(reader, host) {
    this.reader = reader;
    this.matches = [];
    this.current = -1;
    this.query = '';
    this.bar = h('div', 'rd-find');
    this.bar.innerHTML = `${icon('find', 16)}<input placeholder="Find in this PDF" spellcheck="false"><span class="rd-find-count"></span>
      <label title="Match case"><input type="checkbox" data-case> Aa</label>
      <button class="rd-ib" data-prev title="Previous (Shift+Enter)">${icon('up', 16)}</button><button class="rd-ib" data-next title="Next (Enter)">${icon('down', 16)}</button><button class="rd-ib" data-close title="Close (Esc)">${icon('close', 14)}</button>`;
    host.prepend(this.bar);
    this.input = this.bar.querySelector('input');
    this.count = this.bar.querySelector('.rd-find-count');
    this.caseBox = this.bar.querySelector('[data-case]');
    let timer = null;
    this.input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.search(), 200);
    });
    this.caseBox.onchange = () => this.search();
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.step(e.shiftKey ? -1 : 1);
      }
      if (e.key === 'Escape') this.close();
    });
    this.bar.querySelector('[data-prev]').onclick = () => this.step(-1);
    this.bar.querySelector('[data-next]').onclick = () => this.step(1);
    this.bar.querySelector('[data-close]').onclick = () => this.close();
  }

  open(text) {
    this.bar.classList.add('open');
    if (text) this.input.value = text;
    this.input.focus();
    this.input.select();
    if (this.input.value && this.input.value !== this.query) this.search();
  }

  close() {
    this.bar.classList.remove('open');
    this.matches = [];
    this.query = '';
    this.paint();
  }

  async search() {
    const q = this.input.value;
    const run = (this.run = {});
    this.query = q;
    this.matches = [];
    this.current = -1;
    this.paint();
    if (!q.trim()) {
      this.count.textContent = '';
      return;
    }
    const cs = this.caseBox.checked;
    const needle = cs ? q : q.toLowerCase();
    const from = this.reader.currentPage() - 1;
    for (let i = 0; i < this.reader.pageCount; i++) {
      const text = await this.reader.text(i);
      if (run !== this.run) return;
      // Line breaks count as spaces, so phrases across lines are found.
      const hay = (cs ? text.str : text.str.toLowerCase()).replace(/\n/g, ' ');
      let at = hay.indexOf(needle);
      while (at >= 0) {
        this.matches.push({ page: i, start: at, end: at + needle.length });
        at = hay.indexOf(needle, at + Math.max(1, needle.length));
      }
      if (this.current < 0 && this.matches.length && this.matches.at(-1).page >= from) {
        this.current = this.matches.findIndex((m) => m.page >= from);
        this.show();
      }
      if (i % 20 === 19) this.count.textContent = `${this.matches.length}…`;
    }
    if (this.current < 0 && this.matches.length) {
      this.current = 0;
      this.show();
    }
    this.label();
    this.paint();
  }

  label() {
    this.count.textContent = this.query.trim() ? (this.matches.length ? `${this.current + 1} of ${this.matches.length}` : 'No matches') : '';
  }

  step(by) {
    if (!this.matches.length) return;
    this.current = (this.current + by + this.matches.length) % this.matches.length;
    this.show();
    this.label();
  }

  async show() {
    const m = this.matches[this.current];
    if (!m) return;
    const p = this.reader.pages[m.page];
    const rects = this.viewRects(p, await this.reader.text(m.page), m.start, m.end);
    if (rects.length) this.reader.reveal(p, rects[0]);
    else this.reader.scrollToPage(m.page + 1);
    this.paint();
  }

  // Marks every match on the pages that have one.
  async paint() {
    for (const p of this.reader.pages) await this.paintPage(p);
  }

  async paintPage(p) {
    p.hits?.replaceChildren();
    const list = [];
    this.matches.forEach((m, k) => m.page === p.index && list.push({ ...m, k }));
    if (!list.length || !p.hits) return;
    const text = await this.reader.text(p.index);
    for (const m of list) {
      for (const [x0, y0, x1, y1] of this.viewRects(p, text, m.start, m.end)) {
        const box = h('div', `rd-hit${m.k === this.current ? ' current' : ''}`);
        Object.assign(box.style, { left: `${(x0 / p.w) * 100}%`, top: `${(y0 / p.hgt) * 100}%`, width: `${((x1 - x0) / p.w) * 100}%`, height: `${((y1 - y0) / p.hgt) * 100}%` });
        p.hits.append(box);
      }
    }
  }

  // Exact boxes from the text layer when the page has one, else estimated.
  viewRects(p, text, start, end) {
    const R = this.reader;
    const out = [];
    const exact = p.spans?.length === text.items.length;
    text.items.forEach((it, k) => {
      const s = text.starts[k];
      const len = it.str.length;
      const a = Math.max(start, s);
      const b = Math.min(end, s + len);
      if (b <= a || !len) return;
      const node = exact && p.spans[k].firstChild;
      if (node?.nodeType === 3 && node.length === len) {
        const range = document.createRange();
        range.setStart(node, a - s);
        range.setEnd(node, b - s);
        for (const r of range.getClientRects()) {
          const [x0, y0] = R.clientToView(p, r.left, r.top);
          const [x1, y1] = R.clientToView(p, r.right, r.bottom);
          out.push([x0, y0, x1, y1]);
        }
        return;
      }
      out.push(R.viewRect(p, [it.x + (it.w * (a - s)) / len, it.y - it.h * 0.22, it.x + (it.w * (b - s)) / len, it.y + it.h * 0.9]));
    });
    return out;
  }
}
