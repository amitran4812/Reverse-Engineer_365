'use strict';

// Opens an OpenDocument presentation (.odp from LibreOffice, Google Slides
// and others, or flat .fodp) as a Present deck that looks the way it was
// made: slide size, master page artwork and backgrounds, placeholders with
// their text styles, run formatting, bullets and numbering, pictures (with
// crops), shapes, lines, groups and tables. Master artwork goes into shared
// layers, like a .pptx's masters.

const { mergeText, kids, kid, all, attr, esc, escAttr, round, cm, openOdf, imageSrc, Styles, textCss, fontPt, fontCss, cssColor, ALIGN } = require('./odf');
const { enhancedPaths } = require('./odf-geometry');
const { odfChartImage } = require('./odf-chart');
const { shapeSvg, paintCss } = require('./pptx-import');
const { imageSize } = require('./imageSize');

const W = 960;

// ---------- fills and lines

const hexOf = (c) => (cssColor(c) ? c.slice(1).toUpperCase().padEnd(6, '0').slice(0, 6) : undefined);
const rgba = (hex, a) => (a >= 1 ? `#${hex}` : `rgba(${[0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${round(a)})`);
const pct = (v, d) => (v == null ? d : parseFloat(v) / 100);

async function fillOf(g, ctx) {
  const kind = g['draw:fill'];
  if (!kind || kind === 'none') return kind === 'none' ? { none: true } : undefined;
  const alpha = pct(g['draw:opacity'], 1);
  if (kind === 'solid') {
    const hex = hexOf(g['draw:fill-color'] || '#729fcf');
    return hex ? { color: rgba(hex, alpha), hex } : undefined;
  }
  if (kind === 'gradient') {
    const gr = ctx.styles.named.get(`draw:gradient:${g['draw:fill-gradient-name']}`);
    if (!gr) return { color: g['draw:fill-color'] || '#ffffff', hex: hexOf(g['draw:fill-color']) || 'FFFFFF' };
    let stops = all(gr, 'loext:gradient-stop').map((s) => ({ pos: Number(attr(s, 'svg:offset') || 0) * 100, hex: hexOf(attr(s, 'loext:color-value')) })).filter((s) => s.hex);
    if (!stops.length) stops = [{ pos: 0, hex: hexOf(attr(gr, 'draw:start-color')) || 'FFFFFF' }, { pos: 100, hex: hexOf(attr(gr, 'draw:end-color')) || '000000' }];
    const border = pct(attr(gr, 'draw:border'), 0) * 100;
    if (border) stops = stops.map((s) => ({ ...s, pos: border + (s.pos * (100 - border)) / 100 }));
    const style = attr(gr, 'draw:style') || 'linear';
    if (style === 'axial') stops = [...stops.map((s) => ({ ...s, pos: 50 - s.pos / 2 })).reverse(), ...stops.map((s) => ({ ...s, pos: 50 + s.pos / 2 }))];
    const radial = style !== 'linear' && style !== 'axial';
    if (radial) stops = stops.map((s) => ({ ...s, pos: 100 - s.pos })).reverse();
    const ang = parseFloat(attr(gr, 'draw:angle') || '0') / (/deg|rad|grad/.test(attr(gr, 'draw:angle') || '') ? 1 : 10);
    return {
      grad: { angle: (((90 - ang) % 360) + 360) % 360, radial, stops: stops.map((s) => ({ pos: s.pos, color: rgba(s.hex, alpha) })) },
      color: `#${stops[0].hex}`,
      hex: stops[0].hex,
    };
  }
  if (kind === 'bitmap') {
    const img = ctx.styles.named.get(`draw:fill-image:${g['draw:fill-image-name']}`);
    const src = img && (await imageSrc(img, ctx.pkg));
    return src ? { image: src, tile: g['style:repeat'] === 'repeat' } : undefined;
  }
  if (kind === 'hatch') {
    const hex = hexOf(g['draw:fill-color']);
    return g['draw:fill-hatch-solid'] === 'true' && hex ? { color: rgba(hex, alpha), hex } : { none: true };
  }
  return undefined;
}

function lineOf(g, ctx) {
  const kind = g['draw:stroke'];
  if (kind === 'none') return undefined;
  const hex = hexOf(g['svg:stroke-color'] || '#000000');
  if (!hex) return undefined;
  const width = Math.max(1, cm(g['svg:stroke-width'] || '0') * ctx.k);
  const out = { fill: { color: rgba(hex, pct(g['svg:stroke-opacity'], 1)), hex }, width };
  if (kind === 'dash') out.dash = [4, 3];
  for (const [k, end] of [['draw:marker-start', 'head'], ['draw:marker-end', 'tail']]) {
    const m = g[k];
    if (m) out[end] = /circle|oval/i.test(m) ? 'oval' : /square|diamond/i.test(m) ? 'diamond' : 'triangle';
  }
  return out;
}

// ---------- geometry

// draw:transform="rotate (a) translate (x y)" and friends.
function transformOf(s) {
  const out = { rot: 0, tx: 0, ty: 0, has: false };
  for (const m of String(s || '').matchAll(/(rotate|translate|skewX|scale)\s*\(([^)]*)\)/g)) {
    const a = m[2].trim().split(/[\s,]+/);
    if (m[1] === 'rotate') out.rot += Number(a[0]) || 0;
    if (m[1] === 'translate') {
      out.tx += cm(a[0]);
      out.ty += cm(a[1]);
      out.has = true;
    }
  }
  return out;
}

// The shape's unrotated box in px, its size in cm and its rotation in degrees (clockwise).
function boxOf(node, ctx) {
  const w = cm(attr(node, 'svg:width'));
  const h = cm(attr(node, 'svg:height'));
  let x = cm(attr(node, 'svg:x'));
  let y = cm(attr(node, 'svg:y'));
  const t = transformOf(attr(node, 'draw:transform'));
  let rot = 0;
  if (t.has || t.rot) {
    // the shape is rotated about its top-left corner, then moved there
    const a = t.rot;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const cx = t.tx + (w / 2) * c + (h / 2) * s;
    const cy = t.ty - (w / 2) * s + (h / 2) * c;
    x = cx - w / 2;
    y = cy - h / 2;
    rot = (-a * 180) / Math.PI;
  }
  const k = ctx.k;
  return { x: round(x * k), y: round(y * k), w: round(Math.max(1, w * k)), h: round(Math.max(1, h * k)), cm: { w, h }, rot: round(((rot % 360) + 360) % 360) };
}

// ---------- text

const NUM = { 1: (n) => String(n), a: (n) => alpha(n), A: (n) => alpha(n).toUpperCase(), i: (n) => roman(n), I: (n) => roman(n).toUpperCase() };
function alpha(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
  return s;
}
function roman(n) {
  const R = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  return R.reduce((acc, [v, r]) => { while (n >= v) { acc += r; n -= v; } return acc; }, '');
}

function levelStyle(listStyle, level) {
  if (!listStyle) return null;
  const levels = kids(listStyle).filter((n) => /^text:list-level-style-/.test(n.nodeName));
  return levels.find((l) => Number(attr(l, 'text:level')) === level) || levels[levels.length - 1] || null;
}

function inlineHtml(node, ctx, tp, slideNum) {
  let s = '';
  for (const n of Array.from(node.childNodes || [])) {
    if (n.nodeType === 3) {
      if (n.nodeValue) s += `<span style="${runStyle(tp, ctx)}">${esc(n.nodeValue)}</span>`;
      continue;
    }
    if (n.nodeType !== 1) continue;
    const name = n.nodeName;
    if (name === 'text:span') {
      const own = ctx.styles.props('text', attr(n, 'text:style-name')).text;
      s += inlineHtml(n, ctx, mergeText(tp, own), slideNum);
    } else if (name === 'text:a') s += inlineHtml(n, ctx, { ...tp, 'style:text-underline-style': 'solid', ...(tp['fo:color'] ? {} : { 'fo:color': '#0563c1' }) }, slideNum);
    else if (name === 'text:s') s += `<span style="${runStyle(tp, ctx)}">${'&nbsp;'.repeat(Number(attr(n, 'text:c') || 1))}</span>`;
    else if (name === 'text:tab') s += `<span style="${runStyle(tp, ctx)}">&emsp;</span>`;
    else if (name === 'text:line-break') s += '<br>';
    else if (name === 'text:page-number') s += `<span style="${runStyle(tp, ctx)}">${slideNum || esc(n.textContent)}</span>`;
    else if (['office:annotation', 'office:annotation-end', 'text:bookmark', 'text:bookmark-start', 'text:bookmark-end', 'text:soft-page-break', 'presentation:footer', 'presentation:date-time', 'presentation:header'].includes(name)) continue;
    else s += inlineHtml(n, ctx, tp, slideNum);
  }
  return s;
}

// "Automatic" text colour: white on dark fills, black otherwise.
const autoColor = (hex) => {
  if (!hex) return undefined;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? '#ffffff' : undefined;
};

function runStyle(tp, ctx) {
  const { css } = textCss(tp, ctx.styles, { ptPx: ctx.ptPx, base: ctx.basePt });
  if (ctx.autoColor && !css.some((c) => c.startsWith('color:'))) css.push(`color:${ctx.autoColor}`);
  if (!tp['fo:font-weight']) css.push('font-weight:400');
  return css.join(';');
}

// A text container (text-box or shape) to { html, first } in Present's paragraph HTML.
function textHtml(container, ctx, base, { slideNum, listStyle } = {}) {
  const out = [];
  let first = null;
  let any = false;
  const counters = [];
  const para = (p, level, ls, header) => {
    const ps = ctx.styles.props('paragraph', attr(p, 'text:style-name'));
    const pp = { ...base.paragraph, ...ps.paragraph };
    const tp = mergeText(base.text, ps.text);
    const size = fontPt(tp, 18);
    const local = { ...ctx, basePt: size };
    const html = inlineHtml(p, local, tp, slideNum);
    const hasText = /[^\s]/.test(p.textContent);
    if (hasText) any = true;
    if (!first) first = { tp, pp, size };
    const style = [];
    const align = ALIGN[pp['fo:text-align']];
    if (align && align !== 'left') style.push(`text-align:${align}`);
    let marL = cm(pp['fo:margin-left']);
    let indent = cm(pp['fo:text-indent']);
    let bu = '';
    const lvl = level ? levelStyle(ls, level) : null;
    if (lvl && !header) {
      const lp = kid(lvl, 'style:list-level-properties');
      const la = kid(lp, 'style:list-level-label-alignment');
      if (la && attr(la, 'fo:margin-left')) {
        marL += cm(attr(la, 'fo:margin-left'));
        indent += cm(attr(la, 'fo:text-indent'));
      } else {
        const label = cm(attr(lp, 'text:min-label-width'));
        marL += cm(attr(lp, 'text:space-before')) + label;
        indent -= label;
      }
      const bt = { ...(kid(lvl, 'style:text-properties') ? Object.fromEntries(Array.from(kid(lvl, 'style:text-properties').attributes).map((a) => [a.name, a.value])) : {}) };
      let mark = '';
      if (lvl.nodeName === 'text:list-level-style-bullet') mark = attr(lvl, 'text:bullet-char') || '•';
      else if (lvl.nodeName === 'text:list-level-style-image') mark = '•';
      else if (lvl.nodeName === 'text:list-level-style-number' && attr(lvl, 'style:num-format')) {
        const c = counters[level - 1] ?? (Number(attr(lvl, 'text:start-value') || 1) - 1);
        counters[level - 1] = c + 1;
        counters.length = level;
        mark = `${attr(lvl, 'style:num-prefix') || ''}${(NUM[attr(lvl, 'style:num-format')] || NUM[1])(c + 1)}${attr(lvl, 'style:num-suffix') || ''}`;
      }
      if (mark && hasText) {
        bu = ` data-bu="${escAttr(mark)}"`;
        if (indent < 0) style.push(`--bi:${round(-indent * ctx.k)}px`);
        const color = bt['style:use-window-font-color'] === 'true' ? undefined : cssColor(bt['fo:color']);
        if (color || cssColor(tp['fo:color'])) style.push(`--bc:${color || tp['fo:color']}`);
        const bf = bt['fo:font-family'] || ctx.styles.fonts.get(bt['style:font-name']);
        if (bf && !/opensymbol|starsymbol/i.test(bf)) style.push(`--bf:${fontCss(bf)}`);
        else style.push('--bf:Arial');
        if (/%$/.test(bt['fo:font-size'] || '')) style.push(`--bs:${round(parseFloat(bt['fo:font-size']) / 100)}em`);
      }
    }
    if (marL) style.push(`padding-left:${round(marL * ctx.k)}px`);
    if (indent) style.push(`text-indent:${round(indent * ctx.k)}px`);
    style.push(`font-size:${round(size * ctx.ptPx)}px`);
    const lh = pp['fo:line-height'];
    if (/%$/.test(lh || '')) style.push(`line-height:${round(1.2 * (parseFloat(lh) / 100))}`);
    else if (lh && lh !== 'normal') style.push(`line-height:${round(cm(lh) * ctx.k)}px`);
    for (const [k, prop] of [['fo:margin-top', 'margin-top'], ['fo:margin-bottom', 'margin-bottom']]) {
      const v = cm(pp[k]);
      if (v) style.push(`${prop}:${round(v * ctx.k)}px`);
    }
    let inner = html;
    if (!inner.replace(/<br>/g, '').replace(/<span[^>]*><\/span>/g, '')) {
      inner = `${inner}<br>`;
      const f = ctx.styles.font(tp);
      if (f) style.push(`font-family:${fontCss(f)}`);
    }
    out.push(`<div style="${style.join(';')}"${bu}>${inner}</div>`);
  };
  const walk = (node, level, ls, header) => {
    for (const n of kids(node)) {
      if (n.nodeName === 'text:p' || n.nodeName === 'text:h') para(n, level, ls, header);
      else if (n.nodeName === 'text:list') {
        const own = attr(n, 'text:style-name');
        walk(n, level + 1, (own && ctx.styles.lists.get(own)) || ls, false);
      } else if (n.nodeName === 'text:list-item') walk(n, level, ls, header);
      else if (n.nodeName === 'text:list-header') walk(n, level, ls, true);
      else if (n.nodeName === 'text:section') walk(n, level, ls, header);
    }
  };
  walk(container, 0, listStyle || base.list, false);
  return { html: any ? out.join('') : '', first: first || { tp: base.text, pp: base.paragraph, size: fontPt(base.text, 18) } };
}

// ---------- shapes

const ROLE = { title: 'title', subtitle: 'subtitle', outline: 'body', text: 'body' };
const SKIP_CLASS = ['header', 'footer', 'date-time', 'page-number', 'page', 'handout', 'notes'];

function styleOf(node, ctx) {
  const pres = attr(node, 'presentation:style-name');
  const s = pres ? ctx.styles.props('presentation', pres) : ctx.styles.props('graphic', attr(node, 'draw:style-name'));
  const ts = attr(node, 'draw:text-style-name') ? ctx.styles.props('paragraph', attr(node, 'draw:text-style-name')) : null;
  return { graphic: s.graphic, paragraph: { ...s.paragraph, ...(ts?.paragraph || {}) }, text: mergeText(s.text, ts?.text), list: s.list };
}

// Text formatting and padding on an element, from its first paragraph and the shape's style.
function applyText(el, g, first, ctx) {
  el.style.fontSize = round(first.size * ctx.ptPx);
  el.style.color = (first.tp['style:use-window-font-color'] !== 'true' && cssColor(first.tp['fo:color'])) || ctx.autoColor || '#000000';
  el.style.fontFamily = ctx.styles.font(first.tp) || 'Liberation Sans';
  el.style.bold = first.tp['fo:font-weight'] === 'bold' || Number(first.tp['fo:font-weight']) >= 600;
  el.style.align = ALIGN[first.pp['fo:text-align']] || 'left';
  el.style.valign = { middle: 'middle', bottom: 'bottom' }[g['draw:textarea-vertical-align']] || 'top';
  const pad = (k, d) => round(cm(g[k] ?? d) * ctx.k);
  el.style.pad = [pad('fo:padding-top', '0.125cm'), pad('fo:padding-right', '0.25cm'), pad('fo:padding-bottom', '0.125cm'), pad('fo:padding-left', '0.25cm')];
  if (g['fo:wrap-option'] === 'no-wrap') el.style.nowrap = true;
  if (/^tb/.test(g['style:writing-mode'] || '')) el.style.vert = 'vert';
  el.style.free = true;
}

async function readNode(node, ctx, out) {
  const name = node.nodeName;
  if (name === 'draw:g') {
    for (const c of kids(node)) await readNode(c, ctx, out);
    return;
  }
  if (name === 'draw:a') {
    for (const c of kids(node)) await readNode(c, ctx, out);
    return;
  }
  if (!['draw:frame', 'draw:custom-shape', 'draw:rect', 'draw:ellipse', 'draw:circle', 'draw:line', 'draw:connector', 'draw:polygon', 'draw:polyline', 'draw:path', 'draw:regular-polygon'].includes(name)) return;
  const cls = attr(node, 'presentation:class');
  if (SKIP_CLASS.includes(cls)) return;
  if (cls && ctx.master) return; // master placeholders only shape the slides
  const st = styleOf(node, ctx);
  const g = st.graphic;
  const el = { style: {} };
  let box;
  if (name === 'draw:line' || name === 'draw:connector') {
    const [x1, y1, x2, y2] = ['svg:x1', 'svg:y1', 'svg:x2', 'svg:y2'].map((a) => cm(attr(node, a)) * ctx.k);
    box = { x: round(Math.min(x1, x2)), y: round(Math.min(y1, y2)), w: round(Math.max(1, Math.abs(x2 - x1))), h: round(Math.max(1, Math.abs(y2 - y1))), rot: 0 };
    Object.assign(el, { x: box.x, y: box.y, w: box.w, h: box.h });
    const d = `M${round(x1 - box.x)},${round(y1 - box.y)}L${round(x2 - box.x)},${round(y2 - box.y)}`;
    const line = lineOf({ 'draw:stroke': 'solid', ...g }, ctx);
    if (!line) return;
    Object.assign(el, { type: 'shape', html: '', line: true, shape: 'rect', svg: shapeSvg([{ d, fill: false, stroke: true }], null, line, el.w, el.h, {}) });
    el.style.fill = 'transparent';
    el.style.stroke = `#${line.fill.hex}`;
    out.push(el);
    return;
  }
  box = boxOf(node, ctx);
  Object.assign(el, { x: box.x, y: box.y, w: box.w, h: box.h });
  if (box.rot) el.style.rotate = box.rot;
  if (cls && ROLE[cls]) el.role = ROLE[cls];

  if (name === 'draw:frame') {
    const image = kids(node, 'draw:image');
    const table = kid(node, 'table:table');
    const textBox = kid(node, 'draw:text-box');
    if (table) {
      out.push(await readTable(table, el, ctx));
      return;
    }
    const object = kid(node, 'draw:object');
    if (object) {
      const doc = kid(object, 'office:document') ? object : await ctx.pkg.xml(`${attr(object, 'xlink:href')}/content.xml`);
      const src = doc && all(doc, 'chart:chart').length ? odfChartImage(doc, el.w, el.h, ctx.ptPx) : null;
      if (src) out.push({ ...el, type: 'image', src, chart: true });
      return;
    }
    if (image.length) {
      let src = null;
      let used = null;
      for (const im of image) {
        src = await imageSrc(im, ctx.pkg);
        if (src) {
          used = im;
          break;
        }
      }
      if (!src) {
        // A picture with text inside (a caption box drawn as an image frame) keeps its text.
        if (image[0] && kid(image[0], 'text:p')) return readText(kid(node, 'draw:image'), node, el, st, ctx, out, cls);
        return;
      }
      el.type = 'image';
      el.src = src;
      const crop = cropOf(g['fo:clip'], src);
      if (crop) el.style.crop = crop;
      const mirror = g['style:mirror'] || '';
      if (/horizontal/.test(mirror) || /vertical/.test(mirror)) el.style.flip = [/horizontal/.test(mirror) ? -1 : 1, /vertical/.test(mirror) ? -1 : 1];
      const line = g['draw:stroke'] && g['draw:stroke'] !== 'none' ? lineOf(g, ctx) : null;
      if (line) el.style.border = `${round(line.width)}px solid ${line.fill.color}`;
      out.push(el);
      if (used && kid(used, 'text:p')) await readText(used, node, { ...el, style: {}, type: undefined, src: undefined }, st, ctx, out, null);
      return;
    }
    if (kid(node, 'draw:object-ole') || kid(node, 'draw:plugin')) return;
    if (textBox) return readText(textBox, node, el, st, ctx, out, cls);
    return;
  }

  // Drawn shapes
  const fill = await fillOf(g, ctx);
  const line = lineOf(g, ctx);
  let paths;
  let flip = {};
  if (name === 'draw:custom-shape') {
    const geo = kid(node, 'draw:enhanced-geometry');
    paths = geo ? enhancedPaths(geo, el.w, el.h, box.cm) : [{ d: `M0,0H${el.w}V${el.h}H0Z`, fill: true, stroke: true }];
    flip = { h: attr(geo, 'draw:mirror-horizontal') === 'true', v: attr(geo, 'draw:mirror-vertical') === 'true' };
    const type = attr(geo, 'draw:type') || '';
    el.shape = /ellipse|circle/.test(type) ? 'ellipse' : /round-rect|roundRect/.test(type) ? 'roundRect' : 'rect';
  } else if (name === 'draw:ellipse' || name === 'draw:circle') {
    paths = [{ d: `M0,${el.h / 2}A${el.w / 2},${el.h / 2} 0 1 1 ${el.w},${el.h / 2}A${el.w / 2},${el.h / 2} 0 1 1 0,${el.h / 2}Z`, fill: true, stroke: true }];
    el.shape = 'ellipse';
  } else if (name === 'draw:polygon' || name === 'draw:polyline' || name === 'draw:path') {
    const [vx, vy, vw, vh] = (attr(node, 'svg:viewBox') || `0 0 ${el.w} ${el.h}`).split(/\s+/).map(Number);
    const sx = el.w / (vw || 1);
    const sy = el.h / (vh || 1);
    let d;
    if (name === 'draw:path') d = scalePath(attr(node, 'svg:d') || '', vx, vy, sx, sy);
    else {
      const pts = (attr(node, 'draw:points') || '').trim().split(/\s+/).map((p) => p.split(',').map(Number));
      d = `M${pts.map(([x, y]) => `${round((x - vx) * sx)},${round((y - vy) * sy)}`).join('L')}${name === 'draw:polygon' ? 'Z' : ''}`;
    }
    paths = [{ d, fill: name !== 'draw:polyline', stroke: true }];
    el.shape = 'rect';
  } else {
    const r = Math.min(cm(attr(node, 'draw:corner-radius')) * ctx.k, el.w / 2, el.h / 2);
    paths = [{ d: r ? `M${r},0H${el.w - r}A${r},${r} 0 0 1 ${el.w},${r}V${el.h - r}A${r},${r} 0 0 1 ${el.w - r},${el.h}H${r}A${r},${r} 0 0 1 0,${el.h - r}V${r}A${r},${r} 0 0 1 ${r},0Z` : `M0,0H${el.w}V${el.h}H0Z`, fill: true, stroke: true }];
    el.shape = r ? 'roundRect' : 'rect';
  }
  const drawn = (fill && !fill.none) || line;
  ctx = { ...ctx, autoColor: autoColor(fill?.hex) || ctx.autoColor };
  const { html, first } = textHtml(node, ctx, st, { slideNum: ctx.slideNum });
  if (!drawn && !html) return;
  el.type = drawn ? 'shape' : 'text';
  el.html = html;
  if (drawn) {
    el.svg = shapeSvg(paths, fill, line, el.w, el.h, flip);
    el.style.fill = fill?.hex ? `#${fill.hex}` : 'transparent';
    if (line?.fill?.hex) {
      el.style.stroke = `#${line.fill.hex}`;
      el.style.strokeWidth = round(line.width / ctx.ptPx);
    }
    if (flip.h || flip.v) el.flip = [!!flip.h, !!flip.v];
    if (name === 'draw:polyline') el.line = true;
  }
  applyText(el, { 'draw:textarea-vertical-align': 'middle', ...g }, first, ctx);
  out.push(el);
}

async function readText(textBox, frame, el, st, ctx, out, cls) {
  const g = st.graphic;
  const fill = await fillOf(g, ctx);
  ctx = { ...ctx, autoColor: autoColor(fill?.hex) || ctx.autoColor };
  const { html, first } = textHtml(textBox, ctx, st, { slideNum: ctx.slideNum });
  const line = lineOf(g, ctx);
  const drawn = (fill && !fill.none) || line;
  const placeholder = attr(frame, 'presentation:placeholder') === 'true' || (cls && !html);
  if (!html && !drawn && !placeholder) return;
  el.type = drawn ? 'shape' : 'text';
  el.html = html;
  if (drawn) {
    el.shape = 'rect';
    el.svg = shapeSvg([{ d: `M0,0H${el.w}V${el.h}H0Z`, fill: true, stroke: true }], fill, line, el.w, el.h, {});
    el.style.fill = fill?.hex ? `#${fill.hex}` : 'transparent';
    if (line?.fill?.hex) el.style.stroke = `#${line.fill.hex}`;
  }
  applyText(el, g, first, ctx);
  if (placeholder && !html) {
    el.html = '';
    el.placeholder = cls === 'title' ? 'Click to add title' : 'Click to add text';
    if (cls === 'outline') el.style.bullets = true;
  }
  out.push(el);
}

function scalePath(d, vx, vy, sx, sy) {
  // Absolute commands only need their coordinates moved; relative ones only scaled.
  return d.replace(/([MLCQSTHVAZmlcqsthvaz])([^MLCQSTHVAZmlcqsthvaz]*)/g, (all2, c, args) => {
    const n = (args.match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
    const abs = c === c.toUpperCase();
    const X = (v) => round(abs ? (v - vx) * sx : v * sx);
    const Y = (v) => round(abs ? (v - vy) * sy : v * sy);
    const C = c.toUpperCase();
    if (C === 'Z') return c;
    if (C === 'H') return c + n.map(X).join(' ');
    if (C === 'V') return c + n.map(Y).join(' ');
    if (C === 'A') {
      const o = [];
      for (let i = 0; i + 6 < n.length + 1; i += 7) o.push(round(n[i] * sx), round(n[i + 1] * sy), n[i + 2], n[i + 3], n[i + 4], X(n[i + 5]), Y(n[i + 6]));
      return c + o.join(' ');
    }
    return c + n.map((v, i) => (i % 2 ? Y(v) : X(v))).join(' ');
  });
}

// fo:clip="rect(top, right, bottom, left)" in lengths of the picture's own size.
function cropOf(clip, src) {
  const m = /rect\(([^)]*)\)/.exec(clip || '');
  if (!m) return null;
  const [t, r, b, l] = m[1].split(/[\s,]+/).map((v) => (v === 'auto' ? 0 : cm(v)));
  if (!t && !r && !b && !l) return null;
  const size = src.startsWith('data:image/svg') ? null : imageSize(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'));
  if (!size) return null;
  const wcm = (size.width / 96) * 2.54;
  const hcm = (size.height / 96) * 2.54;
  const crop = [l / wcm, t / hcm, r / wcm, b / hcm].map((v) => Math.min(0.95, Math.max(0, round(v * 1000) / 1000)));
  return crop.some((v) => v) ? crop : null;
}

// ---------- tables

async function readTable(tbl, el, ctx) {
  const cols = [];
  const colCell = [];
  for (const c of all(tbl, 'table:table-column')) {
    const w = cm(ctx.styles.props('table-column', attr(c, 'table:style-name')).column['style:column-width']) || 2.5;
    for (let i = 0; i < Number(attr(c, 'table:number-columns-repeated') || 1); i++) {
      cols.push(w);
      colCell.push(attr(c, 'table:default-cell-style-name'));
    }
  }
  const rows = all(tbl, 'table:table-row');
  const cells = [];
  let height = 0;
  for (const tr of rows) {
    const rp = ctx.styles.props('table-row', attr(tr, 'table:style-name')).row;
    const rowH = cm(rp['style:row-height'] || rp['style:min-row-height']) * ctx.k || 0;
    height += rowH;
    const row = [];
    for (const tc of kids(tr).filter((n) => n.nodeName === 'table:table-cell' || n.nodeName === 'table:covered-table-cell')) {
      const ci = row.length;
      if (tc.nodeName === 'table:covered-table-cell') {
        row.push({ html: '', merged: true, h: round(rowH) });
        continue;
      }
      const cs = ctx.styles.props('table-cell', attr(tc, 'table:style-name') || attr(tr, 'table:default-cell-style-name') || colCell[ci]);
      const cp = { ...cs.paragraph, ...cs.graphic, ...cs.cell };
      const { html } = textHtml(tc, ctx, { paragraph: cs.paragraph, text: cs.text, list: null }, { slideNum: ctx.slideNum });
      const cell = { html, h: round(rowH) };
      const fill = (await fillOf(cs.graphic, ctx)) || (cssColor(cp['fo:background-color']) ? { color: cp['fo:background-color'] } : undefined);
      const fc = paintCss(fill);
      if (fc) cell.fill = fc;
      if (attr(tc, 'table:number-columns-spanned') > 1) cell.colspan = Number(attr(tc, 'table:number-columns-spanned'));
      if (attr(tc, 'table:number-rows-spanned') > 1) cell.rowspan = Number(attr(tc, 'table:number-rows-spanned'));
      const va = cp['style:vertical-align'] || cp['draw:textarea-vertical-align'];
      if (va) cell.valign = { middle: 'middle', bottom: 'bottom' }[va] || 'top';
      const p = (k) => round(cm(cp[k] ?? cp['fo:padding'] ?? '0.1cm') * ctx.k);
      cell.pad = [p('fo:padding-top'), p('fo:padding-right'), p('fo:padding-bottom'), p('fo:padding-left')];
      const borders = {};
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const b = cp[`fo:border-${side}`] || cp['fo:border'];
        if (b) borders[side] = borderCss(b, ctx);
      }
      if (Object.keys(borders).length) cell.borders = borders;
      row.push(cell);
    }
    cells.push(row);
  }
  const total = cols.reduce((a, b) => a + b, 0) || 1;
  const plain = (h) => h.replace(/<br>/g, ' ').replace(/<\/div>/g, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  return {
    ...el,
    type: 'table',
    h: Math.max(el.h, round(height)),
    cols: cols.map((w) => round((w / total) * 100)),
    cells,
    rows: cells.map((row) => row.map((c) => plain(c.html))),
    header: false,
  };
}

function borderCss(b, ctx) {
  if (/^none/.test(b)) return 'none';
  const w = /(-?[\d.]+(?:cm|mm|in|pt|px))/.exec(b);
  const c = /#[0-9a-f]{6}/i.exec(b);
  return `${round(Math.max(1, w ? cm(w[1]) * ctx.k : 1))}px solid ${c ? c[0] : '#000000'}`;
}

// ---------- pages

async function backgroundOf(styleName, ctx) {
  if (!styleName) return null;
  const p = ctx.styles.props('drawing-page', styleName).page;
  const fill = await fillOf(p, ctx);
  if (!fill || fill.none) return fill?.none ? { bg: '#FFFFFF', bgCss: '#FFFFFF' } : null;
  return { bg: fill.hex ? `#${fill.hex}` : '#FFFFFF', bgCss: paintCss(fill) };
}

function notesOf(page) {
  const notes = kid(page, 'presentation:notes');
  if (!notes) return '';
  return all(notes, 'draw:frame').filter((f) => attr(f, 'presentation:class') === 'notes')
    .flatMap((f) => all(f, 'text:p').map((p) => p.textContent.trim()))
    .filter(Boolean).join('\n');
}

async function importOdp(buffer) {
  const pkg = await openOdf(buffer);
  const body = all(pkg.content, 'office:presentation')[0];
  if (!body) throw new Error('This doesn’t look like an OpenDocument presentation.');
  const masterStyles = new Styles([pkg.styles]);
  const styles = new Styles([pkg.styles, pkg.content]);
  const masters = new Map(all(pkg.styles, 'style:master-page').map((m) => [attr(m, 'style:name'), m]));
  const firstMaster = masters.values().next().value;
  const layouts = new Map(all(pkg.styles, 'style:page-layout').map((l) => [attr(l, 'style:name'), kid(l, 'style:page-layout-properties')]));
  const pageProps = layouts.get(attr(firstMaster, 'style:page-layout-name'));
  const wcm = cm(attr(pageProps, 'fo:page-width'), 28);
  const hcm = cm(attr(pageProps, 'fo:page-height'), 15.75);
  const k = W / wcm;
  const ptPx = (k * 2.54) / 72;
  const size = { w: W, h: Math.round(hcm * k) };
  const base = { pkg, k, ptPx, basePt: 18 };
  const layers = {};
  const masterLayer = async (m) => {
    const key = `master:${attr(m, 'style:name')}`;
    if (layers[key]) return key;
    const out = [];
    for (const c of kids(m)) await readNode(c, { ...base, styles: masterStyles, master: true }, out);
    layers[key] = { elements: out.map((e, i) => ({ ...e, id: `${key.replace(/\W+/g, '')}-${i}` })) };
    return key;
  };
  const slides = [];
  let n = 0;
  for (const page of kids(body, 'draw:page')) {
    n += 1;
    const master = masters.get(attr(page, 'draw:master-page-name')) || firstMaster;
    const ctx = { ...base, styles, slideNum: n };
    const pageStyle = styles.props('drawing-page', attr(page, 'draw:style-name')).page;
    const ids = [];
    if (master && pageStyle['presentation:background-objects-visible'] !== 'false') ids.push(await masterLayer(master));
    const bg = (pageStyle['presentation:background-visible'] !== 'false' && (await backgroundOf(attr(page, 'draw:style-name'), ctx)))
      || (master && (await backgroundOf(attr(master, 'draw:style-name'), { ...base, styles: masterStyles })));
    const out = [];
    ctx.autoColor = autoColor(bg?.bg?.slice(1));
    for (const c of kids(page)) await readNode(c, ctx, out);
    const s = {
      id: `s${n}`,
      layout: 'blank',
      own: true,
      layers: ids,
      bg: bg?.bg || '#FFFFFF',
      elements: out.map((e, i) => ({ ...e, id: `s${n}e${i}` })),
      notes: notesOf(page),
    };
    if (bg?.bgCss && bg.bgCss !== bg.bg) s.bgCss = bg.bgCss;
    if (pageStyle['presentation:visibility'] === 'hidden') s.hidden = true;
    slides.push(s);
  }
  return { format: 'rea-slides', version: 1, theme: 'paper', size, layers, layouts: await newSlideLayouts(firstMaster, masterStyles, base, masterLayer), slides };
}

// New slides in the deck reuse the first master's title and outline boxes.
async function newSlideLayouts(master, styles, base, masterLayer) {
  if (!master) return {};
  const ctx = { ...base, styles };
  const ph = {};
  for (const f of kids(master, 'draw:frame')) {
    const cls = attr(f, 'presentation:class');
    if (cls !== 'title' && cls !== 'outline') continue;
    const out = [];
    const el = { ...boxOf(f, ctx), style: {}, role: ROLE[cls] };
    delete el.cm;
    delete el.rot;
    const st = styleOf(f, ctx);
    await readText({ childNodes: [] }, f, el, st, ctx, out, cls);
    if (out[0]) ph[cls] = { ...out[0], type: 'text', html: '', placeholder: cls === 'title' ? 'Click to add title' : 'Click to add text' };
  }
  const bg = await backgroundOf(attr(master, 'draw:style-name'), ctx);
  const layer = await masterLayer(master);
  const make = (els) => ({ layers: [layer], bg: bg?.bg || '#FFFFFF', bgCss: bg?.bgCss !== bg?.bg ? bg?.bgCss : undefined, elements: els.filter(Boolean) });
  const title = ph.title && ph.outline ? { ...ph.title, y: round(ph.outline.y * 0.6), h: ph.title.h } : ph.title;
  return {
    obj: make([ph.title, ph.outline]),
    titleOnly: make([ph.title]),
    title: make([title, ph.outline && { ...ph.outline, role: 'subtitle', y: round((title?.y || 0) + (title?.h || 0) + 10), h: round(ph.outline.h / 3), style: { ...ph.outline.style, bullets: false, align: 'center' } }]),
    blank: make([]),
  };
}

module.exports = { importOdp };
