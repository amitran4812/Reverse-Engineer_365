'use strict';

// Shared reading for OpenDocument files (.odp, .odt and their flat .fodp/.fodt
// forms): the package, named styles with their parents, lengths, fonts and
// text formatting as CSS.

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const parseXml = (text) => new DOMParser({ onError: () => {} }).parseFromString(text, 'application/xml');
const list = (l) => Array.from({ length: l?.length || 0 }, (_, i) => l[i]);
const kids = (node, name) => list(node?.childNodes).filter((n) => n.nodeType === 1 && (!name || n.nodeName === name));
const kid = (node, name) => kids(node, name)[0];
const all = (node, name) => (node ? list(node.getElementsByTagName(name)) : []);
const attr = (n, a) => (n?.getAttribute ? n.getAttribute(a) || undefined : undefined);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const round = (n) => Math.round(n * 100) / 100;

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };

// A length ("2.5cm", "12pt", "0.4in", "3mm", "10px") in centimetres.
const UNIT = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: 2.54 / 96 };
function cm(v, d = 0) {
  const m = /^\s*(-?[\d.]+(?:e-?\d+)?)\s*([a-z]*)/i.exec(v || '');
  if (!m) return d;
  return Number(m[1]) * (UNIT[m[2].toLowerCase()] ?? 1);
}
const pt = (v, d) => (v == null ? d : cm(v) / UNIT.pt);

// Opens a zipped or flat OpenDocument file: { content, styles, meta, media(path) }.
async function openOdf(buffer) {
  const head = buffer.subarray(0, 4).toString('latin1');
  if (head.startsWith('PK')) {
    const zip = await JSZip.loadAsync(buffer);
    const read = async (f) => (zip.file(f) ? parseXml(await zip.file(f).async('string')) : null);
    const cache = new Map();
    return {
      content: await read('content.xml'),
      styles: await read('styles.xml'),
      xml: (f) => read(String(f).replace(/^\.\//, '')),
      async media(href) {
        const p = String(href || '').replace(/^\.\//, '');
        const ext = p.split('.').pop().toLowerCase();
        const f = zip.file(p);
        if (!f) return null;
        if (!cache.has(p)) {
          const data = await f.async('nodebuffer');
          const type = MIME[ext] || sniff(data);
          cache.set(p, type ? `data:${type};base64,${data.toString('base64')}` : null);
        }
        return cache.get(p);
      },
    };
  }
  // Flat XML: one document holds styles, content and pictures as base64.
  const doc = parseXml(buffer.toString('utf8'));
  return { content: doc, styles: doc, flat: true, media: async () => null, xml: async () => null };
}

// Pictures saved without an extension (LibreOffice does this for some) by their first bytes.
function sniff(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b.subarray(0, 200).toString('latin1').includes('<svg')) return 'image/svg+xml';
  return null;
}

// An image inside a draw:image: its file, or base64 data kept inline (flat files).
async function imageSrc(node, pkg) {
  const href = attr(node, 'xlink:href');
  if (href && !/^[a-z]+:/i.test(href)) return pkg.media(href);
  const bin = kid(node, 'office:binary-data');
  if (bin) {
    const data = Buffer.from(bin.textContent.replace(/\s+/g, ''), 'base64');
    const type = sniff(data);
    return type ? `data:${type};base64,${data.toString('base64')}` : null;
  }
  return null;
}

// ---------- styles

class Styles {
  constructor(docs) {
    this.byKey = new Map();
    this.defaults = new Map();
    this.lists = new Map();
    this.fonts = new Map();
    this.named = new Map(); // gradients, fill images, markers, dashes by tag:name
    for (const doc of docs.filter(Boolean)) {
      for (const f of all(doc, 'style:font-face')) this.fonts.set(attr(f, 'style:name'), (attr(f, 'svg:font-family') || attr(f, 'style:name')).replace(/^['"]|['"]$/g, ''));
      for (const s of all(doc, 'style:default-style')) this.defaults.set(attr(s, 'style:family'), s);
      for (const tag of ['draw:gradient', 'draw:fill-image', 'draw:marker', 'draw:stroke-dash', 'draw:hatch', 'draw:opacity']) {
        for (const n of all(doc, tag)) this.named.set(`${tag}:${attr(n, 'draw:name')}`, n);
      }
    }
    // Content styles come last so they win over same-named ones in styles.xml.
    for (const doc of docs.filter(Boolean)) {
      for (const s of all(doc, 'style:style')) this.byKey.set(`${attr(s, 'style:family')}:${attr(s, 'style:name')}`, s);
      for (const s of all(doc, 'text:list-style')) this.lists.set(attr(s, 'style:name'), s);
    }
    this.memo = new Map();
  }

  // Merged properties of a style and its parents: { graphic, paragraph, text, page, cell, list, node }.
  props(family, name) {
    const key = `${family}:${name || ''}`;
    if (this.memo.has(key)) return this.memo.get(key);
    const chain = [];
    const seen = new Set();
    for (let n = name; n && !seen.has(n); ) {
      seen.add(n);
      const s = this.byKey.get(`${family}:${n}`);
      if (!s) break;
      chain.unshift(s);
      n = attr(s, 'style:parent-style-name');
    }
    const def = this.defaults.get(family);
    const out = { graphic: {}, paragraph: {}, text: {}, page: {}, cell: {}, column: {}, row: {}, table: {}, list: null };
    for (const s of [def, ...chain].filter(Boolean)) {
      for (const [tag, k] of [['style:graphic-properties', 'graphic'], ['loext:graphic-properties', 'graphic'], ['style:paragraph-properties', 'paragraph'], ['style:text-properties', 'text'], ['style:drawing-page-properties', 'page'], ['style:table-cell-properties', 'cell'], ['style:table-column-properties', 'column'], ['style:table-row-properties', 'row'], ['style:table-properties', 'table']]) {
        const p = kid(s, tag);
        if (!p) continue;
        const own = {};
        for (const a of list(p.attributes)) own[a.name] = a.value;
        out[k] = k === 'text' ? mergeText(out[k], own) : { ...(out[k] || {}), ...own };
        const ls = kid(p, 'text:list-style');
        if (ls) out.list = ls;
      }
      const ln = attr(s, 'style:list-style-name');
      if (ln && this.lists.has(ln)) out.list = this.lists.get(ln);
    }
    this.memo.set(key, out);
    return out;
  }

  font(t) {
    const name = t['style:font-name'];
    return (name && this.fonts.get(name)) || name || (t['fo:font-family'] || '').replace(/^['"]|['"]$/g, '') || undefined;
  }
}

// ---------- text formatting

// A colour set on a later style replaces an inherited "automatic colour".
function mergeText(a = {}, b = {}) {
  const out = { ...a, ...b };
  if (b['fo:color'] && !b['style:use-window-font-color']) delete out['style:use-window-font-color'];
  return out;
}

const SERIF = /times|georgia|cambria|garamond|antiqua|palatino|constantia|bodoni|baskerville|didot|rockwell|serif|minion|caslon|liberation serif|dejavu serif|book/i;
const fontCss = (f) => {
  const name = String(f).replace(/['"\\;<>]/g, '');
  return `'${name}', ${/sans/i.test(name) || !SERIF.test(name) ? 'sans-serif' : 'serif'}`;
};

const cssColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : undefined);

// Font size in points, following percentages from the base size.
function fontPt(t, base) {
  const v = t['fo:font-size'];
  if (!v) return base;
  if (/%$/.test(v)) return (base || 12) * (parseFloat(v) / 100);
  return pt(v, base);
}

// Text properties to { css: [...], size } with sizes in px via ptPx.
function textCss(t, styles, { ptPx, base }) {
  const s = [];
  const font = styles.font(t);
  if (font) s.push(`font-family:${fontCss(font)}`);
  const size = fontPt(t, base);
  if (t['fo:font-size'] && size) s.push(`font-size:${round(size * ptPx)}px`);
  if (cssColor(t['fo:color']) && t['style:use-window-font-color'] !== 'true') s.push(`color:${t['fo:color']}`);
  if (t['fo:font-weight']) s.push(`font-weight:${t['fo:font-weight'] === 'bold' ? 700 : t['fo:font-weight'] === 'normal' ? 400 : t['fo:font-weight']}`);
  if (t['fo:font-style']) s.push(`font-style:${t['fo:font-style'] === 'italic' || t['fo:font-style'] === 'oblique' ? 'italic' : 'normal'}`);
  const deco = [];
  const on = (k) => t[k] && t[k] !== 'none';
  if (on('style:text-underline-style')) deco.push('underline');
  if (on('style:text-line-through-style')) deco.push('line-through');
  if (deco.length) s.push(`text-decoration:${deco.join(' ')}`);
  else if (t['style:text-underline-style'] === 'none' || t['style:text-line-through-style'] === 'none') s.push('text-decoration:none');
  if (t['fo:text-transform'] === 'uppercase') s.push('text-transform:uppercase');
  if (t['fo:font-variant'] === 'small-caps') s.push('font-variant:small-caps');
  if (cssColor(t['fo:background-color'])) s.push(`background:${t['fo:background-color']}`);
  if (t['fo:letter-spacing'] && t['fo:letter-spacing'] !== 'normal') s.push(`letter-spacing:${round(pt(t['fo:letter-spacing'], 0) * ptPx)}px`);
  const pos = /^(super|sub|-?[\d.]+%)/.exec(t['style:text-position'] || '');
  if (pos && pos[1] !== '0%') s.push(`vertical-align:${pos[1] === 'super' || parseFloat(pos[1]) > 0 ? 'super' : 'sub'}`, `font-size:${round((size || 12) * ptPx * 0.65)}px`);
  if (t['fo:text-shadow'] && t['fo:text-shadow'] !== 'none') s.push('text-shadow:1px 1px 1px rgba(0,0,0,.35)');
  return { css: s, size };
}

const ALIGN = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' };

module.exports = { mergeText, parseXml, list, kids, kid, all, attr, esc, escAttr, round, cm, pt, openOdf, imageSrc, Styles, textCss, fontPt, fontCss, cssColor, ALIGN, sniff, MIME };
