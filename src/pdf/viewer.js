// Read's page view: pdf.js draws each page as it scrolls into view, with a
// text layer for selecting and searching. Layers for annotations sit on top
// and use the page's own coordinates (points at scale 1, rotated as shown).

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { h } from '../shared/shell.js';

pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.js';

export const CSS_PER_PT = 96 / 72;

export class Reader {
  constructor(host, { onPage, onPageReady, onScale, onDrawn } = {}) {
    this.host = host;
    this.onDrawn = onDrawn;
    this.onPage = onPage;
    this.onPageReady = onPageReady;
    this.onScale = onScale;
    this.doc = null;
    this.zoom = 'width';
    this.scale = 1;
    this.viewRotation = 0;
    this.pages = [];
    this.texts = new Map();
    this.generation = 0;
    this.scroller = h('div', 'rd-scroll');
    this.inner = h('div', 'rd-pages');
    this.scroller.append(this.inner);
    host.append(this.scroller);
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = this.pages.find((x) => x.el === e.target);
        if (!p) continue;
        p.visible = e.isIntersecting;
        if (p.visible) this.draw(p);
      }
    }, { root: this.scroller, rootMargin: '800px 0px' });
    let last = 0;
    this.scroller.addEventListener('scroll', () => {
      const n = this.currentPage();
      if (n !== last) this.onPage?.((last = n));
    }, { passive: true });
    this.scroller.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey) || !this.doc) return;
      e.preventDefault();
      this.setZoom(this.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e);
    }, { passive: false });
    new ResizeObserver(() => {
      if (typeof this.zoom === 'string' && this.doc) this.layout();
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

  // Opens bytes with pdf.js. getPassword() is asked for when the file is locked.
  async load(bytes, { getPassword, keepPlace = false } = {}) {
    const gen = ++this.generation;
    const task = pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false, enableXfa: false });
    task.onPassword = async (update, reason) => {
      const pw = await getPassword?.(reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD);
      if (pw == null) task.destroy();
      else update(pw);
    };
    const doc = await task.promise;
    if (gen !== this.generation) {
      task.destroy();
      return null;
    }
    const keep = keepPlace ? { top: this.scroller.scrollTop, left: this.scroller.scrollLeft } : { top: 0, left: 0 };
    const old = this.task;
    this.task = task;
    this.doc = doc;
    this.texts.clear();
    for (const p of this.pages) {
      this.observer.unobserve(p.el);
      p.el.remove();
    }
    this.pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (gen !== this.generation) return null;
      const p = { num: i, index: i - 1, page, el: h('div', 'rd-page'), visible: false, drawn: null };
      p.el.dataset.page = i;
      p.layers = h('div', 'rd-layers');
      p.el.append(p.layers);
      this.setViewport(p);
      this.inner.append(p.el);
      this.pages.push(p);
      this.observer.observe(p.el);
      this.onPageReady?.(p);
    }
    this.layout(false);
    this.scroller.scrollTop = keep.top;
    this.scroller.scrollLeft = keep.left;
    old?.destroy();
    return doc;
  }

  setViewport(p) {
    p.rotation = (p.page.rotate + this.viewRotation) % 360;
    p.vp = p.page.getViewport({ scale: 1, rotation: p.rotation });
    p.w = p.vp.width;
    p.hgt = p.vp.height;
  }

  clear() {
    this.generation += 1;
    for (const p of this.pages) {
      this.observer.unobserve(p.el);
      p.el.remove();
    }
    this.pages = [];
    this.task?.destroy();
    this.task = null;
    this.doc = null;
  }

  fitScale(mode) {
    const widest = Math.max(...this.pages.map((p) => p.w), 1);
    const byWidth = (this.scroller.clientWidth - 40) / (widest * CSS_PER_PT);
    if (mode === 'width') return Math.max(0.1, Math.min(byWidth, 4));
    const tallest = Math.max(...this.pages.map((p) => p.hgt), 1);
    return Math.max(0.1, Math.min(byWidth, (this.scroller.clientHeight - 24) / (tallest * CSS_PER_PT)));
  }

  layout(redraw = true) {
    this.scale = typeof this.zoom === 'string' ? this.fitScale(this.zoom) : this.zoom;
    const k = this.scale * CSS_PER_PT;
    for (const p of this.pages) {
      p.el.style.width = `${Math.floor(p.w * k)}px`;
      p.el.style.height = `${Math.floor(p.hgt * k)}px`;
      p.el.style.setProperty('--total-scale-factor', k);
    }
    if (redraw) for (const p of this.pages) if (p.visible) this.draw(p);
    this.onScale?.(this.scale);
  }

  // Zooms, keeping the point under the mouse (or the page top) still.
  setZoom(z, at = null) {
    const r = this.scroller.getBoundingClientRect();
    const ax = at ? at.clientX - r.left : 0;
    const ay = at ? at.clientY - r.top : 0;
    const before = this.scale;
    const x = this.scroller.scrollLeft + ax;
    const y = this.scroller.scrollTop + ay;
    this.zoom = typeof z === 'string' ? z : Math.max(0.1, Math.min(8, z));
    this.layout();
    const f = this.scale / before;
    this.scroller.scrollLeft = x * f - ax;
    this.scroller.scrollTop = y * f - ay;
  }

  rotateView(by) {
    const n = this.currentPage();
    this.viewRotation = (((this.viewRotation + by) % 360) + 360) % 360;
    for (const p of this.pages) {
      this.setViewport(p);
      p.drawn = null;
      p.linkBox?.remove();
      p.linkBox = null;
      this.onPageReady?.(p);
    }
    this.layout();
    this.scrollToPage(n);
  }

  async draw(p) {
    const key = `${this.scale}:${p.rotation}`;
    if (p.drawn === key || p.drawing === key) return;
    p.drawing = key;
    const dpr = window.devicePixelRatio || 1;
    const css = p.page.getViewport({ scale: this.scale * CSS_PER_PT, rotation: p.rotation });
    const vp = p.page.getViewport({ scale: this.scale * CSS_PER_PT * dpr, rotation: p.rotation });
    const canvas = h('canvas', 'rd-canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    try {
      await p.page.render({ canvas, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    } catch {
      if (p.drawing === key) p.drawing = null;
      return;
    }
    if (p.drawing !== key) return;
    p.drawing = null;
    p.drawn = key;
    p.canvas?.remove();
    p.canvas = canvas;
    p.el.prepend(canvas);
    // Text layer, for selecting, copying and marking up text.
    const div = h('div', 'textLayer');
    let spans = [];
    try {
      const layer = new pdfjs.TextLayer({ textContentSource: p.page.streamTextContent(), container: div, viewport: css });
      await layer.render();
      spans = layer.textDivs;
      div.append(h('div', 'endOfContent'));
    } catch {
      /* pages with no text */
    }
    if (p.drawn !== key) return;
    p.textDiv?.remove();
    p.textDiv = div;
    // One span per text item, in the same order as text(index).items.
    p.spans = spans;
    p.layers.before(div);
    this.links(p);
    this.onDrawn?.(p);
  }

  // Links in the page open in the browser or jump within the PDF.
  async links(p) {
    if (p.linkBox) return;
    p.linkBox = h('div', 'rd-links');
    p.layers.prepend(p.linkBox);
    const list = await p.page.getAnnotations({ intent: 'display' }).catch(() => []);
    for (const a of list) {
      if (a.subtype !== 'Link' || !(a.url || a.dest)) continue;
      const link = h('a', 'rd-link');
      const [x0, y0, x1, y1] = this.viewRect(p, a.rect);
      Object.assign(link.style, { left: `${(x0 / p.w) * 100}%`, top: `${(y0 / p.hgt) * 100}%`, width: `${((x1 - x0) / p.w) * 100}%`, height: `${((y1 - y0) / p.hgt) * 100}%` });
      link.title = a.url || 'Go to this place in the PDF';
      link.onclick = async (e) => {
        e.preventDefault();
        if (a.url) return window.office.openExternal(a.url);
        const d = await this.destination(a.dest);
        if (d) this.scrollToPage(d.page, d.y);
      };
      p.linkBox.append(link);
    }
  }

  // Page items as { str, x, y, w, h } in user space, plus the joined text.
  async text(index) {
    if (this.texts.has(index)) return this.texts.get(index);
    const p = this.pages[index];
    const tc = await p.page.getTextContent();
    const items = tc.items.filter((it) => it.str != null).map((it) => {
      const [a, b, c, d, e, f] = it.transform;
      const hgt = it.height || Math.hypot(c, d) || Math.hypot(a, b);
      return { str: it.str, x: e, y: f, w: it.width, h: hgt, eol: it.hasEOL, flat: Math.abs(b) < 1e-3 && Math.abs(c) < 1e-3 };
    });
    let str = '';
    const starts = [];
    for (const it of items) {
      starts.push(str.length);
      str += it.str + (it.eol ? '\n' : '');
    }
    const out = { items, str, starts };
    this.texts.set(index, out);
    return out;
  }

  // User space <-> page view (points at scale 1, rotated as shown).
  toView(p, x, y) {
    return p.vp.convertToViewportPoint(x, y);
  }

  toUser(p, vx, vy) {
    return p.vp.convertToPdfPoint(vx, vy);
  }

  viewRect(p, [x0, y0, x1, y1]) {
    const [ax, ay] = this.toView(p, x0, y0);
    const [bx, by] = this.toView(p, x1, y1);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }

  userRect(p, [vx0, vy0, vx1, vy1]) {
    const [ax, ay] = this.toUser(p, vx0, vy0);
    const [bx, by] = this.toUser(p, vx1, vy1);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  }

  // A mouse position as page view coordinates.
  clientToView(p, clientX, clientY) {
    const r = p.el.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * p.w, ((clientY - r.top) / r.height) * p.hgt];
  }

  pageAt(clientX, clientY) {
    for (const p of this.pages) {
      const r = p.el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return p;
    }
    return null;
  }

  scrollToPage(n, y = null) {
    const p = this.pages[Math.max(0, Math.min(this.pages.length - 1, n - 1))];
    if (!p) return;
    const k = this.scale * CSS_PER_PT;
    this.scroller.scrollTop = p.el.offsetTop - 12 + (y != null ? y * k - this.scroller.clientHeight / 3 : 0);
  }

  // Scrolls a box (page view coordinates) into view if it isn't.
  reveal(p, [x0, y0, x1, y1]) {
    const k = this.scale * CSS_PER_PT;
    const top = p.el.offsetTop + y0 * k;
    const bottom = p.el.offsetTop + y1 * k;
    const s = this.scroller;
    if (top < s.scrollTop + 40 || bottom > s.scrollTop + s.clientHeight - 40) s.scrollTop = top - s.clientHeight / 3;
    const left = p.el.offsetLeft + x0 * k;
    if (left < s.scrollLeft || left > s.scrollLeft + s.clientWidth - 60) s.scrollLeft = left - 60;
  }

  // Where an outline entry or link points: { page, y } in view coordinates.
  async destination(dest) {
    try {
      const d = typeof dest === 'string' ? await this.doc.getDestination(dest) : dest;
      if (!Array.isArray(d)) return null;
      const index = typeof d[0] === 'number' ? d[0] : await this.doc.getPageIndex(d[0]);
      const p = this.pages[index];
      const mode = d[1]?.name;
      let y = null;
      if (p && (mode === 'XYZ' || mode === 'FitH' || mode === 'FitBH') && d[mode === 'XYZ' ? 3 : 2] != null) {
        y = this.toView(p, 0, d[mode === 'XYZ' ? 3 : 2])[1];
      }
      return { page: index + 1, y };
    } catch {
      return null;
    }
  }

  async render(index, scale, { canvas } = {}) {
    const p = this.pages[index];
    const vp = p.page.getViewport({ scale, rotation: p.rotation });
    const c = canvas || h('canvas');
    c.width = Math.ceil(vp.width);
    c.height = Math.ceil(vp.height);
    await p.page.render({ canvas: c, viewport: vp, annotationMode: pdfjs.AnnotationMode.ENABLE }).promise;
    return c;
  }
}

export { pdfjs };
