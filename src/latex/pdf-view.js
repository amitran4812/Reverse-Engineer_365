// PDF preview for Write's LaTeX mode, drawn with pdf.js. Pages render as they
// scroll into view; a recompile swaps pages in place so the view doesn't jump.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { h } from '../shared/shell.js';

pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.js';

const CSS_PER_PT = 96 / 72;

export class PdfView {
  constructor(host, { onDoubleClick, onPage } = {}) {
    this.host = host;
    this.onDoubleClick = onDoubleClick;
    this.onPage = onPage;
    this.doc = null;
    this.zoom = 'fit';
    this.scale = 1;
    this.pages = [];
    this.generation = 0;
    this.scroller = h('div', 'pdf-scroll');
    this.inner = h('div', 'pdf-pages');
    this.scroller.append(this.inner);
    host.append(this.scroller);
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = this.pages.find((x) => x.el === e.target);
        if (!p) continue;
        p.visible = e.isIntersecting;
        if (p.visible) this.draw(p);
      }
    }, { root: this.scroller, rootMargin: '600px 0px' });
    this.scroller.addEventListener('scroll', () => this.onPage?.(this.currentPage()), { passive: true });
    this.scroller.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !this.doc) return;
      e.preventDefault();
      this.setZoom(this.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    }, { passive: false });
    new ResizeObserver(() => {
      if (this.zoom === 'fit' && this.doc) this.layout();
    }).observe(this.scroller);
  }

  get pageCount() {
    return this.doc?.numPages || 0;
  }

  currentPage() {
    const mid = this.scroller.scrollTop + this.scroller.clientHeight / 3;
    let n = 1;
    for (const p of this.pages) if (p.el.offsetTop <= mid) n = p.num;
    return n;
  }

  async load(bytes) {
    const gen = ++this.generation;
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false });
    const doc = await task.promise;
    if (gen !== this.generation) {
      doc.destroy();
      return;
    }
    const keep = { top: this.scroller.scrollTop, left: this.scroller.scrollLeft };
    const old = this.doc;
    this.doc = doc;
    const sizes = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      sizes.push({ page, w: vp.width, hgt: vp.height });
    }
    if (gen !== this.generation) return;
    while (this.pages.length > doc.numPages) {
      const p = this.pages.pop();
      this.observer.unobserve(p.el);
      p.el.remove();
    }
    sizes.forEach((s, i) => {
      let p = this.pages[i];
      if (!p) {
        p = { num: i + 1, el: h('div', 'pdf-page'), canvas: null, visible: false };
        p.el.dataset.page = i + 1;
        p.el.addEventListener('dblclick', (e) => this.dblclick(p, e));
        this.inner.append(p.el);
        this.pages.push(p);
        this.observer.observe(p.el);
      }
      Object.assign(p, { page: s.page, w: s.w, hgt: s.hgt, drawn: null });
    });
    this.layout(false);
    this.scroller.scrollTop = keep.top;
    this.scroller.scrollLeft = keep.left;
    await Promise.all(this.pages.filter((p) => p.visible).map((p) => this.draw(p)));
    old?.destroy();
  }

  clear() {
    this.generation += 1;
    for (const p of this.pages) {
      this.observer.unobserve(p.el);
      p.el.remove();
    }
    this.pages = [];
    this.doc?.destroy();
    this.doc = null;
  }

  fitScale() {
    const widest = Math.max(...this.pages.map((p) => p.w), 1);
    return Math.max(0.2, (this.scroller.clientWidth - 32) / (widest * CSS_PER_PT));
  }

  layout(redraw = true) {
    this.scale = this.zoom === 'fit' ? this.fitScale() : this.zoom;
    for (const p of this.pages) {
      p.el.style.width = `${Math.floor(p.w * this.scale * CSS_PER_PT)}px`;
      p.el.style.height = `${Math.floor(p.hgt * this.scale * CSS_PER_PT)}px`;
    }
    if (redraw) for (const p of this.pages) if (p.visible) this.draw(p);
  }

  setZoom(z) {
    const ratio = this.scroller.scrollTop / Math.max(1, this.scroller.scrollHeight);
    this.zoom = z === 'fit' ? 'fit' : Math.max(0.25, Math.min(5, z));
    this.layout();
    this.scroller.scrollTop = ratio * this.scroller.scrollHeight;
  }

  async draw(p) {
    if (!p.page) return;
    const key = `${this.generation}:${this.scale}`;
    if (p.drawn === key || p.drawing === key) return;
    p.drawing = key;
    const dpr = window.devicePixelRatio || 1;
    const vp = p.page.getViewport({ scale: this.scale * CSS_PER_PT * dpr });
    const canvas = h('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    try {
      await p.page.render({ canvas, viewport: vp }).promise;
    } catch {
      p.drawing = null;
      return;
    }
    if (p.drawing !== key) return;
    p.drawing = null;
    p.drawn = key;
    p.canvas?.remove();
    p.canvas = canvas;
    p.el.prepend(canvas);
  }

  dblclick(p, e) {
    const r = p.el.getBoundingClientRect();
    const x = (e.clientX - r.left) / (this.scale * CSS_PER_PT);
    const y = (e.clientY - r.top) / (this.scale * CSS_PER_PT);
    this.onDoubleClick?.(p.num, x, y);
  }

  // Scrolls so the point (in PDF points from the page's top-left) is in view and marks it.
  reveal(pageNum, x, y) {
    const p = this.pages[pageNum - 1];
    if (!p) return;
    const k = this.scale * CSS_PER_PT;
    this.scroller.scrollTop = p.el.offsetTop + y * k - this.scroller.clientHeight / 3;
    const mark = h('div', 'pdf-mark');
    mark.style.top = `${y * k - 4}px`;
    p.el.append(mark);
    setTimeout(() => mark.remove(), 1600);
  }

  scrollToPage(n) {
    const p = this.pages[Math.max(0, Math.min(this.pages.length - 1, n - 1))];
    if (p) this.scroller.scrollTop = p.el.offsetTop - 8;
  }
}
