'use strict';

// Opens a .pptx as a Present deck that looks the way PowerPoint shows it:
// slide size, theme colours and fonts, master and layout backgrounds and
// artwork, placeholder positions and text styles, run formatting, bullets,
// pictures (with crops), shapes, lines, groups, tables, charts and SmartArt.
//
// Everything is placed on a canvas 960px wide (the height follows the slide
// size). Master and layout artwork goes into shared "layers" that slides
// point at, so it isn't copied onto every slide and can't be moved by mistake.

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const { chartSvg } = require('./pptx-chart');

const W = 960;
const parseXml = (text) => new DOMParser({ onError: () => {} }).parseFromString(text, 'application/xml');
const local = (n) => n.localName || n.nodeName.replace(/^.*:/, '');
const kids = (node, name) => (node ? Array.from(node.childNodes || []).filter((n) => n.nodeType === 1 && (!name || local(n) === name)) : []);
const kid = (node, ...names) => names.reduce((n, name) => kids(n, name)[0], node);
const desc = (node, name) => (node ? Array.from(node.getElementsByTagName('*')).filter((n) => local(n) === name) : []);
const num = (v, d = 0) => (v == null || v === '' ? d : Number(v));
const attr = (n, a) => (n ? n.getAttribute(a) || undefined : undefined);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const round = (n) => Math.round(n * 100) / 100;

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };

class Pkg {
  constructor(zip) {
    this.zip = zip;
    this.cache = new Map();
  }
  async xml(file) {
    if (!file) return null;
    if (!this.cache.has(file)) {
      const f = this.zip.file(file);
      this.cache.set(file, f ? parseXml(await f.async('string')) : null);
    }
    return this.cache.get(file);
  }
  async rels(file) {
    const key = `rels:${file}`;
    if (!this.cache.has(key)) {
      const doc = await this.xml(file.replace(/([^/]+)$/, '_rels/$1.rels'));
      const out = {};
      for (const r of desc(doc, 'Relationship')) {
        const t = r.getAttribute('Target');
        const external = r.getAttribute('TargetMode') === 'External';
        out[r.getAttribute('Id')] = { type: r.getAttribute('Type'), external, path: external ? t : t.startsWith('/') ? t.slice(1) : new URL(t, `http://x/${file}`).pathname.slice(1) };
      }
      this.cache.set(key, out);
    }
    return this.cache.get(key);
  }
  async media(file) {
    const ext = (file || '').split('.').pop().toLowerCase();
    if (!MIME[ext]) return null;
    const key = `media:${file}`;
    if (!this.cache.has(key)) {
      const f = this.zip.file(file);
      this.cache.set(key, f ? `data:${MIME[ext]};base64,${await f.async('base64')}` : null);
    }
    return this.cache.get(key);
  }
}

// ---------- colours

const PRESET = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', darkGray: 'A9A9A9', lightGray: 'D3D3D3', orange: 'FFA500', navy: '000080', silver: 'C0C0C0', maroon: '800000', purple: '800080', teal: '008080', cyan: '00FFFF', magenta: 'FF00FF' };

function toHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]) {
  if (!s) return [l, l, l].map((v) => v * 255);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => v * 255);
}

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
// tint and shade work on linear light, the way PowerPoint mixes them
const toLinear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * clamp(v) ** (1 / 2.4) - 0.055);

// A colour element (srgbClr, schemeClr, ...) to { hex, alpha }.
function colorEl(node, ctx) {
  if (!node) return null;
  let hex;
  const name = local(node);
  if (name === 'srgbClr') hex = attr(node, 'val');
  else if (name === 'sysClr') hex = attr(node, 'lastClr') || (attr(node, 'val') === 'window' ? 'FFFFFF' : '000000');
  else if (name === 'prstClr') hex = PRESET[attr(node, 'val')] || '000000';
  else if (name === 'scrgbClr') hex = ['r', 'g', 'b'].map((k) => Math.round(clamp(num(attr(node, k)) / 100000) * 255).toString(16).padStart(2, '0')).join('');
  else if (name === 'schemeClr') {
    const v = attr(node, 'val');
    if (v === 'phClr') return ctx.phClr ? applyMods(ctx.phClr, node) : null;
    hex = ctx.scheme[ctx.clrMap[v] || v];
  } else return null;
  if (!hex) return null;
  return applyMods({ hex, alpha: 1 }, node);
}

function applyMods(base, node) {
  let rgb = [0, 2, 4].map((i) => parseInt(base.hex.slice(i, i + 2), 16));
  let alpha = base.alpha;
  for (const m of kids(node)) {
    const v = num(attr(m, 'val')) / 100000;
    const n = local(m);
    if (n === 'alpha') alpha = v;
    else if (n === 'alphaOff') alpha = clamp(alpha + v);
    else if (n === 'alphaMod') alpha = clamp(alpha * v);
    else if (n === 'tint') rgb = rgb.map((c) => toSrgb(toLinear(c) * v + (1 - v)));
    else if (n === 'shade') rgb = rgb.map((c) => toSrgb(toLinear(c) * v));
    else if (['lumMod', 'lumOff', 'satMod', 'satOff', 'hueOff', 'hueMod'].includes(n)) {
      const hsl = toHsl(rgb);
      if (n === 'hueOff') hsl[0] = (((hsl[0] + num(attr(m, 'val')) / 60000 / 360) % 1) + 1) % 1;
      if (n === 'hueMod') hsl[0] = (hsl[0] * v) % 1;
      if (n === 'satOff') hsl[1] = clamp(hsl[1] + v);
      if (n === 'lumMod') hsl[2] = clamp(hsl[2] * v);
      if (n === 'lumOff') hsl[2] = clamp(hsl[2] + v);
      if (n === 'satMod') hsl[1] = clamp(hsl[1] * v);
      rgb = fromHsl(hsl);
    }
  }
  const hex = rgb.map((c) => Math.round(clamp(c, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase();
  return { hex, alpha };
}

const schemeColor = (v, ctx) => {
  const hex = ctx.scheme[ctx.clrMap[v] || v];
  return hex ? `#${hex}` : undefined;
};

const css = (c) => (!c ? undefined : c.alpha < 1 ? `rgba(${[0, 2, 4].map((i) => parseInt(c.hex.slice(i, i + 2), 16)).join(',')},${round(c.alpha)})` : `#${c.hex}`);
const colorOf = (parent, ctx) => colorEl(kids(parent).find((n) => /Clr$/.test(local(n))), ctx);

// ---------- fills and lines

// A fill (solidFill, gradFill, blipFill, noFill, grpFill) inside `parent`.
// Returns undefined when nothing is set, so the caller can fall back.
async function fillOf(parent, ctx, rels) {
  for (const f of kids(parent)) {
    const n = local(f);
    if (n === 'noFill') return { none: true };
    if (n === 'solidFill') {
      const c = colorOf(f, ctx);
      return c ? { color: css(c), hex: c.hex } : { none: true };
    }
    if (n === 'gradFill') {
      const stops = desc(f, 'gs').map((gs) => ({ pos: num(attr(gs, 'pos')) / 1000, c: colorOf(gs, ctx) })).filter((s) => s.c).sort((a, b) => a.pos - b.pos);
      if (!stops.length) return { none: true };
      const lin = kid(f, 'lin');
      const path = kid(f, 'path');
      return { grad: { angle: lin ? num(attr(lin, 'ang')) / 60000 : 90, radial: !!path && !lin, stops: stops.map((s) => ({ pos: s.pos, color: css(s.c) })) }, color: css(stops[0].c), hex: stops[0].c.hex };
    }
    if (n === 'blipFill') {
      const src = await blipSrc(f, ctx, rels);
      return src ? { image: src, tile: !!kid(f, 'tile') } : undefined;
    }
    if (n === 'grpFill') return ctx.groupFill;
    if (n === 'pattFill') {
      const c = colorOf(kid(f, 'fgClr'), ctx);
      return c ? { color: css(c), hex: c.hex } : undefined;
    }
  }
  return undefined;
}

async function blipSrc(blipFill, ctx, rels) {
  const blip = kid(blipFill, 'blip');
  if (!blip) return null;
  const svg = desc(blip, 'svgBlip')[0];
  for (const b of [svg, blip]) {
    const id = b && (b.getAttribute('r:embed') || b.getAttribute('r:link'));
    const rel = id && rels[id];
    if (rel && !rel.external) {
      const src = await ctx.pkg.media(rel.path);
      if (src) return src;
    }
  }
  return null;
}

function paintCss(fill) {
  if (!fill || fill.none) return undefined;
  if (fill.grad) {
    const stops = fill.grad.stops.map((s) => `${s.color} ${round(s.pos)}%`).join(', ');
    return fill.grad.radial ? `radial-gradient(circle, ${stops})` : `linear-gradient(${round((fill.grad.angle + 90) % 360)}deg, ${stops})`;
  }
  if (fill.image) return `url("${fill.image}") center / ${fill.tile ? 'auto' : '100% 100%'} ${fill.tile ? 'repeat' : 'no-repeat'}`;
  return fill.color;
}

const DASH = { dash: [4, 3], sysDash: [3, 1], sysDot: [1, 1], dot: [1, 2], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };

async function lineOf(ln, ctx, rels) {
  if (!ln) return undefined;
  const fill = await fillOf(ln, ctx, rels);
  const out = {};
  if (fill) out.fill = fill;
  if (attr(ln, 'w') != null) out.width = Math.max(0.5, num(attr(ln, 'w')) * ctx.k);
  const dash = attr(kid(ln, 'prstDash'), 'val');
  if (dash && DASH[dash]) out.dash = DASH[dash];
  for (const end of ['headEnd', 'tailEnd']) {
    const t = attr(kid(ln, end), 'type');
    if (t && t !== 'none') out[end === 'headEnd' ? 'head' : 'tail'] = t;
  }
  return out;
}

// ---------- theme

async function readTheme(pkg, file) {
  const doc = await pkg.xml(file);
  const scheme = {};
  for (const c of kids(desc(doc, 'clrScheme')[0])) {
    const v = kids(c)[0];
    if (v) scheme[local(c)] = local(v) === 'sysClr' ? attr(v, 'lastClr') || '000000' : attr(v, 'val');
  }
  const font = (k) => attr(kid(desc(doc, k)[0], 'latin'), 'typeface');
  const fmt = desc(doc, 'fmtScheme')[0];
  return {
    scheme,
    major: font('majorFont') || 'Calibri Light',
    minor: font('minorFont') || 'Calibri',
    fills: kids(kid(fmt, 'fillStyleLst')),
    lines: kids(kid(fmt, 'lnStyleLst')),
    bgFills: kids(kid(fmt, 'bgFillStyleLst')),
    file,
  };
}

function clrMapOf(node, base) {
  if (!node) return base;
  const map = {};
  for (const a of Array.from(node.attributes || [])) map[a.name] = a.value;
  return { ...base, ...map };
}

// ---------- text styles

function parseRPr(r, ctx) {
  if (!r) return {};
  const out = {};
  const sz = attr(r, 'sz');
  if (sz) out.sz = num(sz) / 100;
  for (const k of ['b', 'i']) if (attr(r, k) != null) out[k] = attr(r, k) === '1' || attr(r, k) === 'true';
  if (attr(r, 'u')) out.u = attr(r, 'u') !== 'none';
  if (attr(r, 'strike')) out.strike = attr(r, 'strike') !== 'noStrike';
  if (attr(r, 'cap')) out.cap = attr(r, 'cap');
  if (attr(r, 'baseline')) out.baseline = num(attr(r, 'baseline')) / 1000;
  if (attr(r, 'spc')) out.spc = num(attr(r, 'spc')) / 100;
  const fill = kid(r, 'solidFill');
  if (fill) {
    const c = colorOf(fill, ctx);
    if (c) out.color = css(c);
  } else if (kid(r, 'gradFill')) {
    const c = colorOf(desc(kid(r, 'gradFill'), 'gs')[0], ctx);
    if (c) out.color = css(c);
  }
  const hl = colorOf(kid(r, 'highlight'), ctx);
  if (hl) out.highlight = css(hl);
  const latin = attr(kid(r, 'latin'), 'typeface') || attr(kid(r, 'ea'), 'typeface');
  if (latin) out.font = latin;
  const sym = attr(kid(r, 'sym'), 'typeface');
  if (sym && !out.font) out.font = sym;
  return out;
}

function parsePPr(p, ctx) {
  if (!p) return {};
  const out = {};
  if (attr(p, 'algn')) out.algn = attr(p, 'algn');
  if (attr(p, 'marL') != null) out.marL = num(attr(p, 'marL'));
  if (attr(p, 'indent') != null) out.indent = num(attr(p, 'indent'));
  if (attr(p, 'rtl')) out.rtl = attr(p, 'rtl') === '1';
  for (const k of ['lnSpc', 'spcBef', 'spcAft']) {
    const s = kid(p, k);
    if (!s) continue;
    const pct = kid(s, 'spcPct');
    const pts = kid(s, 'spcPts');
    if (pct) out[k] = { pct: num(attr(pct, 'val')) / 100000 };
    else if (pts) out[k] = { pt: num(attr(pts, 'val')) / 100 };
  }
  if (kid(p, 'buNone')) out.bu = 'none';
  else if (kid(p, 'buChar')) {
    out.bu = 'char';
    out.buChar = attr(kid(p, 'buChar'), 'char');
  } else if (kid(p, 'buAutoNum')) {
    out.bu = 'num';
    out.buNum = attr(kid(p, 'buAutoNum'), 'type') || 'arabicPeriod';
    out.buStart = num(attr(kid(p, 'buAutoNum'), 'startAt'), 1);
  } else if (kid(p, 'buBlip')) {
    out.bu = 'char';
    out.buChar = '•';
  }
  if (kid(p, 'buClr')) out.buColor = css(colorOf(kid(p, 'buClr'), ctx));
  if (kid(p, 'buClrTx')) out.buColor = undefined;
  if (kid(p, 'buSzPct')) out.buSize = num(attr(kid(p, 'buSzPct'), 'val')) / 100000;
  if (kid(p, 'buSzPts')) out.buPts = num(attr(kid(p, 'buSzPts'), 'val')) / 100;
  if (kid(p, 'buFont')) out.buFont = attr(kid(p, 'buFont'), 'typeface');
  if (kid(p, 'buFontTx')) out.buFont = undefined;
  const def = kid(p, 'defRPr');
  if (def) out.rPr = parseRPr(def, ctx);
  return out;
}

// A list style (lstStyle, titleStyle, ...) to { 1: pPr, 2: pPr, ... }.
function parseLevels(node, ctx) {
  const out = {};
  if (!node) return out;
  const def = kid(node, 'defPPr');
  for (let l = 1; l <= 9; l++) {
    const lv = kid(node, `lvl${l}pPr`);
    const base = def ? parsePPr(def, ctx) : {};
    const own = lv ? parsePPr(lv, ctx) : {};
    if (def || lv) out[l] = mergeP(base, own);
  }
  return out;
}

const mergeP = (a, b) => ({ ...a, ...b, rPr: { ...(a?.rPr || {}), ...(b?.rPr || {}) } });

function mergeLevels(...lists) {
  const out = {};
  for (let l = 1; l <= 9; l++) out[l] = lists.reduce((acc, lst) => (lst?.[l] ? mergeP(acc, lst[l]) : acc), { rPr: {} });
  return out;
}

function parseBodyPr(b) {
  if (!b) return {};
  const out = {};
  if (attr(b, 'anchor')) out.anchor = attr(b, 'anchor');
  for (const k of ['lIns', 'tIns', 'rIns', 'bIns']) if (attr(b, k) != null) out[k] = num(attr(b, k));
  if (attr(b, 'wrap')) out.wrap = attr(b, 'wrap');
  if (attr(b, 'vert')) out.vert = attr(b, 'vert');
  if (attr(b, 'rot')) out.rot = num(attr(b, 'rot')) / 60000;
  const norm = kid(b, 'normAutofit');
  if (norm) out.fit = { scale: num(attr(norm, 'fontScale'), 100000) / 100000, lnRed: num(attr(norm, 'lnSpcReduction'), 0) / 100000 };
  else if (kid(b, 'noAutofit') || kid(b, 'spAutoFit')) out.fit = null;
  return out;
}

// ---------- text to HTML

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
function autoNum(type, n) {
  let s = String(n);
  if (/^roman/.test(type)) s = ROMAN.reduce((acc, [v, r]) => { while (n >= v) { acc += r; n -= v; } return acc; }, '');
  else if (/^alpha/.test(type)) {
    s = '';
    for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(97 + ((x - 1) % 26)) + s;
  }
  if (/Uc/.test(type)) s = s.toUpperCase();
  if (/ParenBoth$/.test(type)) return `(${s})`;
  if (/ParenR$/.test(type)) return `${s})`;
  if (/Period$/.test(type)) return `${s}.`;
  if (/Minus$/.test(type)) return `- ${s} -`;
  return s;
}

function fontName(f, ctx) {
  if (!f) return undefined;
  if (f.startsWith('+mj')) return ctx.theme.major;
  if (f.startsWith('+mn')) return ctx.theme.minor;
  return f;
}

const SERIF = /times|georgia|cambria|garamond|antiqua|palatino|constantia|bodoni|baskerville|didot|rockwell|serif|minion|caslon|book/i;
const fontCss = (f) => {
  const name = String(f).replace(/['"\\;<>]/g, '');
  return `'${name}', ${/sans/i.test(name) || !SERIF.test(name) ? 'sans-serif' : 'serif'}`;
};

function runCss(rp, ctx, scale) {
  const s = [];
  if (rp.font) s.push(`font-family:${fontCss(fontName(rp.font, ctx))}`);
  if (rp.sz) s.push(`font-size:${round(rp.sz * ctx.pt * scale)}px`);
  if (rp.color) s.push(`color:${rp.color}`);
  s.push(`font-weight:${rp.b ? 700 : 400}`);
  if (rp.i) s.push('font-style:italic');
  const deco = [rp.u && 'underline', rp.strike && 'line-through'].filter(Boolean);
  if (deco.length) s.push(`text-decoration:${deco.join(' ')}`);
  if (rp.cap === 'all') s.push('text-transform:uppercase');
  if (rp.cap === 'small') s.push('font-variant:small-caps');
  if (rp.spc) s.push(`letter-spacing:${round(rp.spc * ctx.pt)}px`);
  if (rp.highlight) s.push(`background:${rp.highlight}`);
  if (rp.baseline) s.push(`vertical-align:${rp.baseline > 0 ? 'super' : 'sub'};font-size:${round((rp.sz || 18) * ctx.pt * scale * 0.65)}px`);
  return s.join(';');
}

// txBody to { html, first } where first is the first paragraph's resolved style.
function textHtml(txBody, levels, ctx, fit, { slideNum, baseColor } = {}) {
  const scale = fit?.scale || 1;
  const lnRed = fit?.lnRed || 0;
  const counters = [];
  let first = null;
  let any = false;
  const out = [];
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr');
    const lvl = num(attr(pPr, 'lvl'), 0) + 1;
    const ps = mergeP(levels[lvl] || {}, parsePPr(pPr, ctx));
    const runs = kids(p).filter((n) => ['r', 'br', 'fld'].includes(local(n)));
    const end = parseRPr(kid(p, 'endParaRPr'), ctx);
    const base = { color: baseColor, ...ps.rPr };
    const firstRun = runs.find((r) => local(r) !== 'br');
    const pr = { ...base, ...(firstRun ? parseRPr(kid(firstRun, 'rPr'), ctx) : end) };
    const size = (pr.sz || 18) * ctx.pt * scale;
    if (!first) first = { ...pr, algn: ps.algn };
    const style = [];
    const algn = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify' }[ps.algn];
    if (algn) style.push(`text-align:${algn}`);
    if (ps.marL) style.push(`padding-left:${round(ps.marL * ctx.k)}px`);
    if (ps.indent) style.push(`text-indent:${round(ps.indent * ctx.k)}px`);
    style.push(`font-size:${round(size)}px`);
    const ls = ps.lnSpc;
    if (ls?.pct) style.push(`line-height:${round(1.2 * Math.max(0.5, ls.pct - lnRed))}`);
    else if (ls?.pt) style.push(`line-height:${round(ls.pt * ctx.pt * scale)}px`);
    for (const [k, prop] of [['spcBef', 'margin-top'], ['spcAft', 'margin-bottom']]) {
      const v = ps[k];
      const px = v?.pt != null ? v.pt * ctx.pt * scale : v?.pct != null ? v.pct * size * 1.2 : 0;
      if (px) style.push(`${prop}:${round(px)}px`);
    }
    if (ps.rtl) style.push('direction:rtl');
    let bu = '';
    const hasText = runs.some((r) => local(r) !== 'br' && kid(r, 't')?.textContent);
    counters.length = lvl;
    if (hasText && ps.bu && ps.bu !== 'none') {
      let mark = ps.buChar || '•';
      if (ps.bu === 'num') {
        const c = counters[lvl - 1];
        counters[lvl - 1] = c && c.type === ps.buNum ? { type: c.type, n: c.n + 1 } : { type: ps.buNum, n: ps.buStart || 1 };
        mark = autoNum(ps.buNum, counters[lvl - 1].n);
      }
      bu = ` data-bu="${escAttr(mark)}"`;
      const bs = [];
      if (ps.indent < 0) bs.push(`--bi:${round(-ps.indent * ctx.k)}px`);
      if (ps.buColor || pr.color) bs.push(`--bc:${ps.buColor || pr.color}`);
      if (ps.buFont && !ps.buFont.startsWith('+')) bs.push(`--bf:${fontCss(ps.buFont)}`);
      else if (ps.bu === 'char') bs.push('--bf:Arial');
      if (ps.buPts) bs.push(`--bs:${round(ps.buPts * ctx.pt * scale)}px`);
      else if (ps.buSize) bs.push(`--bs:${round(ps.buSize)}em`);
      style.push(...bs);
    } else if (hasText) counters[lvl - 1] = undefined;
    let inner = '';
    for (const r of runs) {
      if (local(r) === 'br') {
        inner += '<br>';
        continue;
      }
      const rPr = kid(r, 'rPr');
      const rp = { ...base, ...parseRPr(rPr, ctx) };
      if (kid(rPr, 'hlinkClick')) {
        if (!kid(rPr, 'solidFill')) rp.color = schemeColor('hlink', ctx) || rp.color;
        rp.u = true;
      }
      let t = kid(r, 't')?.textContent || '';
      if (local(r) === 'fld' && /slidenum/i.test(attr(r, 'type') || '') && slideNum) t = String(slideNum);
      if (!t) continue;
      any = true;
      inner += `<span style="${runCss(rp, ctx, scale)}">${esc(t).replace(/\t/g, '&emsp;').replace(/\v/g, '<br>')}</span>`;
    }
    if (!inner.replace(/<br>/g, '')) {
      inner = `${inner}<br>`;
      if (pr.font) style.push(`font-family:${fontCss(fontName(pr.font, ctx))}`);
    }
    out.push(`<div style="${style.join(';')}"${bu}>${inner}</div>`);
  }
  return { html: any ? out.join('') : '', first: first || {} };
}

// ---------- geometry

function presetPath(prst, w, h, av) {
  const m = Math.min(w, h);
  const a = (k, d) => (av[k] != null ? av[k] : d) / 100000;
  const poly = (...pts) => `M${pts.map((p) => p.map(round).join(',')).join('L')}Z`;
  const rr = (r) => `M${r},0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h - r}A${r},${r} 0 0 1 ${w - r},${h}H${r}A${r},${r} 0 0 1 0,${h - r}V${r}A${r},${r} 0 0 1 ${r},0Z`;
  switch (prst) {
    case 'roundRect': case 'flowChartAlternateProcess': return rr(round(m * a('adj', 16667)));
    case 'round2SameRect': { const r = round(m * a('adj1', 16667)); return `M${r},0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h}H0V${r}A${r},${r} 0 0 1 ${r},0Z`; }
    case 'round1Rect': { const r = round(m * a('adj', 16667)); return `M0,0H${w - r}A${r},${r} 0 0 1 ${w},${r}V${h}H0Z`; }
    case 'snip1Rect': { const s = m * a('adj', 16667); return poly([0, 0], [w - s, 0], [w, s], [w, h], [0, h]); }
    case 'snip2SameRect': { const s = m * a('adj1', 16667); return poly([s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]); }
    case 'flowChartTerminator': return rr(round(h / 2));
    case 'ellipse': case 'flowChartConnector': case 'donut': return `M0,${h / 2}A${w / 2},${h / 2} 0 1 1 ${w},${h / 2}A${w / 2},${h / 2} 0 1 1 0,${h / 2}Z`;
    case 'triangle': case 'flowChartExtract': { const x = w * a('adj', 50000); return poly([x, 0], [w, h], [0, h]); }
    case 'rtTriangle': return poly([0, 0], [w, h], [0, h]);
    case 'diamond': case 'flowChartDecision': return poly([w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]);
    case 'parallelogram': case 'flowChartInputOutput': { const x = m * a('adj', 25000); return poly([x, 0], [w, 0], [w - x, h], [0, h]); }
    case 'trapezoid': { const x = m * a('adj', 25000); return poly([x, 0], [w - x, 0], [w, h], [0, h]); }
    case 'pentagon': return poly([w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]);
    case 'hexagon': { const x = m * a('adj', 25000); return poly([x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]); }
    case 'octagon': { const x = m * a('adj', 29289); return poly([x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]); }
    case 'homePlate': { const x = w - m * a('adj', 50000); return poly([0, 0], [x, 0], [w, h / 2], [x, h], [0, h]); }
    case 'chevron': { const x = m * a('adj', 50000); return poly([0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]); }
    case 'plus': { const x = m * a('adj', 25000); return poly([x, 0], [w - x, 0], [w - x, x], [w, x], [w, h - x], [w - x, h - x], [w - x, h], [x, h], [x, h - x], [0, h - x], [0, x], [x, x]); }
    case 'rightArrow': { const t = h * a('adj1', 50000) / 2; const x = w - m * a('adj2', 50000); return poly([0, h / 2 - t], [x, h / 2 - t], [x, 0], [w, h / 2], [x, h], [x, h / 2 + t], [0, h / 2 + t]); }
    case 'leftArrow': { const t = h * a('adj1', 50000) / 2; const x = m * a('adj2', 50000); return poly([w, h / 2 - t], [x, h / 2 - t], [x, 0], [0, h / 2], [x, h], [x, h / 2 + t], [w, h / 2 + t]); }
    case 'upArrow': { const t = w * a('adj1', 50000) / 2; const y = m * a('adj2', 50000); return poly([w / 2 - t, h], [w / 2 - t, y], [0, y], [w / 2, 0], [w, y], [w / 2 + t, y], [w / 2 + t, h]); }
    case 'downArrow': { const t = w * a('adj1', 50000) / 2; const y = h - m * a('adj2', 50000); return poly([w / 2 - t, 0], [w / 2 - t, y], [0, y], [w / 2, h], [w, y], [w / 2 + t, y], [w / 2 + t, 0]); }
    case 'leftRightArrow': { const t = h * a('adj1', 50000) / 2; const x = m * a('adj2', 50000); return poly([0, h / 2], [x, 0], [x, h / 2 - t], [w - x, h / 2 - t], [w - x, 0], [w, h / 2], [w - x, h], [w - x, h / 2 + t], [x, h / 2 + t], [x, h]); }
    case 'star5': case 'star4': case 'star6': case 'star7': case 'star8': case 'star10': case 'star12': {
      const n = Number(prst.slice(4));
      const inner = prst === 'star5' ? 0.38 : prst === 'star4' ? 0.25 : 0.5;
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / n;
        const r = i % 2 ? inner : 1;
        pts.push([w / 2 + (w / 2) * r * Math.cos(ang), h / 2 + (h / 2) * r * Math.sin(ang)]);
      }
      return poly(...pts);
    }
    case 'wedgeRectCallout': case 'wedgeRoundRectCallout': case 'cloudCallout': case 'wedgeEllipseCallout': {
      const tx = w / 2 + w * a('adj1', -20833);
      const ty = h / 2 + h * a('adj2', 62500);
      const body = prst === 'wedgeEllipseCallout' || prst === 'cloudCallout' ? presetPath('ellipse', w, h, {}) : prst === 'wedgeRoundRectCallout' ? rr(round(m * 0.16667)) : `M0,0H${w}V${h}H0Z`;
      return `${body}${poly([w * 0.4, h * 0.6], [tx, ty], [w * 0.6, h * 0.6])}`;
    }
    case 'can': case 'flowChartMagneticDisk': { const ry = m * a('adj', 25000) / 2; return `M0,${ry}A${w / 2},${ry} 0 0 1 ${w},${ry}V${h - ry}A${w / 2},${ry} 0 0 1 0,${h - ry}Z M0,${ry}A${w / 2},${ry} 0 0 0 ${w},${ry}`; }
    case 'frame': { const t = m * a('adj1', 12500); return `M0,0H${w}V${h}H0Z M${t},${t}V${h - t}H${w - t}V${t}Z`; }
    case 'blockArc': case 'arc': return `M0,${h / 2}A${w / 2},${h / 2} 0 0 1 ${w},${h / 2}`;
    default: return `M0,0H${round(w)}V${round(h)}H0Z`;
  }
}

const LINES = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/;

function linePath(prst, w, h) {
  if (/^bentConnector/.test(prst)) return `M0,0H${round(w / 2)}V${round(h)}H${round(w)}`;
  if (/^curvedConnector/.test(prst)) return `M0,0C${round(w / 2)},0 ${round(w / 2)},${round(h)} ${round(w)},${round(h)}`;
  return `M0,0L${round(w)},${round(h)}`;
}

// Shape guides (avLst and gdLst formulas) for a shape of ew x eh EMU.
function guides(custGeom, ew, eh) {
  const deg = 60000;
  const v = { w: ew, h: eh, l: 0, t: 0, r: ew, b: eh, hc: ew / 2, vc: eh / 2, wd2: ew / 2, hd2: eh / 2, wd4: ew / 4, hd4: eh / 4, wd8: ew / 8, hd8: eh / 8, ss: Math.min(ew, eh), ls: Math.max(ew, eh), cd2: 180 * deg, cd4: 90 * deg, cd8: 45 * deg, '3cd4': 270 * deg, '3cd8': 135 * deg, '5cd8': 225 * deg, '7cd8': 315 * deg };
  v.ssd2 = v.ss / 2; v.ssd4 = v.ss / 4; v.ssd6 = v.ss / 6; v.ssd8 = v.ss / 8;
  const val = (x) => (x in v ? v[x] : Number(x) || 0);
  const rad = (a) => (a / deg) * (Math.PI / 180);
  for (const gd of [...desc(kid(custGeom, 'avLst'), 'gd'), ...desc(kid(custGeom, 'gdLst'), 'gd')]) {
    const [op, ...a] = (attr(gd, 'fmla') || '').trim().split(/\s+/);
    const [x, y, z] = a.map(val);
    const r = {
      val: x, '*/': (x * y) / (z || 1), '+-': x + y - z, '+/': (x + y) / (z || 1), '?:': x > 0 ? y : z, abs: Math.abs(x), max: Math.max(x, y), min: Math.min(x, y),
      sqrt: Math.sqrt(x), mod: Math.sqrt(x * x + y * y + z * z), pin: y < x ? x : y > z ? z : y, sin: x * Math.sin(rad(y)), cos: x * Math.cos(rad(y)), tan: x * Math.tan(rad(y)),
      at2: (Math.atan2(y, x) * 180 / Math.PI) * deg, cat2: x * Math.cos(Math.atan2(z, y)), sat2: x * Math.sin(Math.atan2(z, y)),
    }[op];
    v[attr(gd, 'name')] = Number.isFinite(r) ? r : 0;
  }
  return val;
}

// Custom geometry paths to SVG path data, scaled from ew x eh EMU to w x h px.
function customPaths(custGeom, ew, eh, w, h) {
  const out = [];
  const g = guides(custGeom, ew, eh);
  const attrNum = (n, a) => g(attr(n, a));
  for (const p of desc(custGeom, 'path')) {
    const pw = num(attr(p, 'w')) || ew;
    const ph = num(attr(p, 'h')) || eh;
    const sx = w / pw;
    const sy = h / ph;
    let d = '';
    let cx = 0;
    let cy = 0;
    const pt = (n) => [attrNum(n, 'x') * sx, attrNum(n, 'y') * sy];
    for (const c of kids(p)) {
      const n = local(c);
      const pts = kids(c, 'pt').map(pt);
      if (n === 'moveTo') { [cx, cy] = pts[0]; d += `M${round(cx)},${round(cy)}`; }
      else if (n === 'lnTo') { [cx, cy] = pts[0]; d += `L${round(cx)},${round(cy)}`; }
      else if (n === 'cubicBezTo') { d += `C${pts.map((q) => q.map(round).join(',')).join(' ')}`; [cx, cy] = pts[2]; }
      else if (n === 'quadBezTo') { d += `Q${pts.map((q) => q.map(round).join(',')).join(' ')}`; [cx, cy] = pts[1]; }
      else if (n === 'arcTo') {
        const wr = attrNum(c, 'wR') * sx;
        const hr = attrNum(c, 'hR') * sy;
        const st = (attrNum(c, 'stAng') / 60000) * (Math.PI / 180);
        const sw = (attrNum(c, 'swAng') / 60000) * (Math.PI / 180);
        const ox = cx - wr * Math.cos(st);
        const oy = cy - hr * Math.sin(st);
        const ex = ox + wr * Math.cos(st + sw);
        const ey = oy + hr * Math.sin(st + sw);
        d += `A${round(wr)},${round(hr)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${round(ex)},${round(ey)}`;
        cx = ex;
        cy = ey;
      } else if (n === 'close') d += 'Z';
    }
    if (d) out.push({ d, fill: attr(p, 'fill') !== 'none', stroke: attr(p, 'stroke') !== '0' });
  }
  return out;
}

let gid = 0;

// The shape's outline and fill as an SVG drawn in its own w x h box.
function shapeSvg(paths, fill, line, w, h, flip) {
  const id = `g${(gid++).toString(36)}`;
  const defs = [];
  let paint = 'none';
  if (fill && !fill.none) {
    if (fill.grad) {
      const stops = fill.grad.stops.map((s) => `<stop offset="${round(s.pos)}%" stop-color="${s.color}"/>`).join('');
      defs.push(fill.grad.radial ? `<radialGradient id="${id}f">${stops}</radialGradient>` : `<linearGradient id="${id}f" gradientTransform="rotate(${round(fill.grad.angle)} .5 .5)">${stops}</linearGradient>`);
      paint = `url(#${id}f)`;
    } else if (fill.image) {
      defs.push(`<pattern id="${id}f" patternUnits="userSpaceOnUse" width="${round(w)}" height="${round(h)}"><image href="${escAttr(fill.image)}" width="${round(w)}" height="${round(h)}" preserveAspectRatio="${fill.tile ? 'xMidYMid' : 'none'}"/></pattern>`);
      paint = `url(#${id}f)`;
    } else paint = fill.color;
  }
  let stroke = 'none';
  let extra = '';
  if (line && line.fill && !line.fill.none) {
    stroke = line.fill.color;
    if (line.fill.grad) {
      const stops = line.fill.grad.stops.map((s) => `<stop offset="${round(s.pos)}%" stop-color="${s.color}"/>`).join('');
      defs.push(`<linearGradient id="${id}s" gradientTransform="rotate(${round(line.fill.grad.angle)} .5 .5)">${stops}</linearGradient>`);
      stroke = `url(#${id}s)`;
    }
    extra += ` stroke-width="${round(line.width || 1)}" vector-effect="non-scaling-stroke" stroke-linejoin="round"`;
    if (line.dash) extra += ` stroke-dasharray="${line.dash.map((v) => round(v * (line.width || 1))).join(' ')}"`;
    for (const [end, k] of [['head', 'start'], ['tail', 'end']]) {
      if (!line[end]) continue;
      const shape = line[end] === 'oval' ? '<circle cx="5" cy="5" r="4"/>' : line[end] === 'diamond' ? '<path d="M0,5L5,0L10,5L5,10Z"/>' : '<path d="M0,0L10,5L0,10Z"/>';
      defs.push(`<marker id="${id}${k}" viewBox="0 0 10 10" refX="${line[end] === 'oval' || line[end] === 'diamond' ? 5 : 8}" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse" fill="${line.fill.color}">${shape}</marker>`);
      extra += ` marker-${k}="url(#${id}${k})"`;
    }
  }
  const tf = flip.h || flip.v ? ` transform="translate(${flip.h ? round(w) : 0} ${flip.v ? round(h) : 0}) scale(${flip.h ? -1 : 1} ${flip.v ? -1 : 1})"` : '';
  const body = paths.map((p) => `<path d="${p.d}" fill="${p.fill ? paint : 'none'}" stroke="${p.stroke ? stroke : 'none'}"${p.stroke ? extra : ''}/>`).join('');
  return `<svg viewBox="0 0 ${round(Math.max(w, 1))} ${round(Math.max(h, 1))}" preserveAspectRatio="none" width="100%" height="100%" overflow="visible">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<g${tf}>${body}</g></svg>`;
}

// ---------- shapes

const xfrmOf = (node) => xfrmData(kid(node, 'xfrm'));

function xfrmData(x) {
  if (!x) return null;
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return {
    x: num(attr(off, 'x')), y: num(attr(off, 'y')), w: num(attr(ext, 'cx')), h: num(attr(ext, 'cy')),
    rot: num(attr(x, 'rot')) / 60000, flipH: attr(x, 'flipH') === '1', flipV: attr(x, 'flipV') === '1',
    chX: num(attr(kid(x, 'chOff'), 'x')), chY: num(attr(kid(x, 'chOff'), 'y')), chW: num(attr(kid(x, 'chExt'), 'cx')), chH: num(attr(kid(x, 'chExt'), 'cy')),
  };
}

const MASTER_TYPE = { ctrTitle: 'title', subTitle: 'body', obj: 'body' };

function phOf(node) {
  const nv = kids(node).find((n) => /^nv/.test(local(n)));
  const ph = desc(nv, 'ph')[0];
  if (!ph) return null;
  return { type: attr(ph, 'type') || 'body', idx: attr(ph, 'idx'), hasType: !!attr(ph, 'type') };
}

function findPh(tree, ph, byIdx) {
  if (!tree || !ph) return null;
  const shapes = desc(tree, 'sp').concat(desc(tree, 'pic'));
  const typeOf = (s) => phOf(s);
  if (byIdx && ph.idx != null) {
    const hit = shapes.find((s) => typeOf(s)?.idx === ph.idx);
    if (hit) return hit;
  }
  const want = MASTER_TYPE[ph.type] || ph.type;
  return shapes.find((s) => typeOf(s) && typeOf(s).type === ph.type) || shapes.find((s) => typeOf(s) && (MASTER_TYPE[typeOf(s).type] || typeOf(s).type) === want) || null;
}

function styleKey(type) {
  if (type === 'title' || type === 'ctrTitle') return 'title';
  if (['dt', 'ftr', 'sldNum', 'hdr'].includes(type)) return 'other';
  return 'body';
}

// Reads one sp/pic/cxnSp/grpSp/graphicFrame (and their SmartArt cousins) into elements.
async function readShape(node, ctx, part, out, tf) {
  const name = local(node);
  if (name === 'AlternateContent') {
    const fallback = kid(node, 'Fallback');
    const choice = kid(node, 'Choice');
    const before = out.length;
    for (const c of kids(fallback)) await readShape(c, ctx, part, out, tf);
    if (out.length === before) for (const c of kids(choice)) await readShape(c, ctx, part, out, tf);
    return;
  }
  if (name === 'grpSp') {
    const x = xfrmOf(kid(node, 'grpSpPr'));
    const groupFill = await fillOf(kid(node, 'grpSpPr'), ctx, part.rels);
    const inner = { ...ctx, groupFill: groupFill || ctx.groupFill };
    const child = x && x.chW && x.chH
      ? (b) => tf({ ...b, x: x.x + ((b.x - x.chX) * x.w) / x.chW, y: x.y + ((b.y - x.chY) * x.h) / x.chH, w: (b.w * x.w) / x.chW, h: (b.h * x.h) / x.chH, rot: b.rot + x.rot })
      : tf;
    for (const c of kids(node)) await readShape(c, inner, part, out, child);
    return;
  }
  if (!['sp', 'pic', 'cxnSp', 'graphicFrame'].includes(name)) return;
  const ph = phOf(node);
  if (ph && part.kind !== 'slide') return; // layout/master placeholders only shape what slides put in them
  if (ph && !part.keepPh && ['dt', 'ftr', 'sldNum', 'hdr'].includes(ph.type) && !desc(node, 't').some((t) => t.textContent)) return;
  const layoutPh = ph && findPh(part.layoutTree, ph, true);
  const masterPh = ph && findPh(part.masterTree, layoutPh ? phOf(layoutPh) || ph : ph, false);
  const spPr = kid(node, 'spPr') || kid(node, 'grpSpPr');
  let box = xfrmOf(spPr) || (name === 'graphicFrame' && xfrmOf(node)) || (layoutPh && xfrmOf(kid(layoutPh, 'spPr'))) || (masterPh && xfrmOf(kid(masterPh, 'spPr')));
  if (!box) return;
  box = tf(box);
  const k = ctx.k;
  const el = { x: round(box.x * k), y: round(box.y * k), w: round(Math.max(1, box.w * k)), h: round(Math.max(1, box.h * k)), style: {} };
  if (box.rot) el.style.rotate = round(box.rot);
  if (ph) el.role = { title: 'title', ctrTitle: 'title', subTitle: 'subtitle' }[ph.type] || 'body';

  if (name === 'graphicFrame') return readFrame(node, el, box, ctx, part, out);

  // p:style references into the theme
  const st = kid(node, 'style');
  const refFill = async (ref, list) => {
    if (!ref) return undefined;
    const idx = num(attr(ref, 'idx'));
    const phClr = colorOf(ref, ctx);
    const item = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : list[idx - 1];
    if (!item) return phClr ? { color: css(phClr), hex: phClr.hex } : undefined;
    const wrap = { childNodes: [item] };
    return fillOf(wrap, { ...ctx, phClr }, part.rels);
  };
  const styleFill = st && num(attr(kid(st, 'fillRef'), 'idx')) ? await refFill(kid(st, 'fillRef'), ctx.theme.fills) : undefined;
  let styleLine;
  const lnRef = st && kid(st, 'lnRef');
  if (lnRef && num(attr(lnRef, 'idx'))) {
    const item = ctx.theme.lines[num(attr(lnRef, 'idx')) - 1];
    styleLine = item ? await lineOf(item, { ...ctx, phClr: colorOf(lnRef, ctx) }, part.rels) : undefined;
  }
  const fontRef = st && kid(st, 'fontRef');
  const fontRefColor = fontRef ? css(colorOf(fontRef, ctx)) : undefined;
  const fontRefFace = fontRef ? (attr(fontRef, 'idx') === 'major' ? ctx.theme.major : attr(fontRef, 'idx') === 'minor' ? ctx.theme.minor : undefined) : undefined;

  const inheritFill = async () => {
    for (const p of [layoutPh, masterPh]) {
      const f = p && (await fillOf(kid(p, 'spPr'), ctx, part.layoutRels));
      if (f) return f;
    }
    return undefined;
  };
  const fill = (await fillOf(spPr, ctx, part.rels)) ?? styleFill ?? (ph ? await inheritFill() : undefined);
  const lnNode = kid(spPr, 'ln');
  let line = styleLine;
  const own = await lineOf(lnNode, ctx, part.rels);
  if (own) line = { ...(line || {}), ...own, fill: own.fill || line?.fill };
  if (!line && ph) {
    for (const p of [layoutPh, masterPh]) {
      const l = p && (await lineOf(kid(kid(p, 'spPr'), 'ln'), ctx, part.layoutRels));
      if (l) { line = l; break; }
    }
  }
  if (line && !line.fill) line = undefined;
  if (line && !line.width) line.width = 0.75 * ctx.pt;

  const geom = kid(spPr, 'prstGeom');
  const prst = geom ? attr(geom, 'prst') : kid(spPr, 'custGeom') ? null : 'rect';
  const av = {};
  for (const gd of desc(kid(geom, 'avLst'), 'gd')) {
    const m = /val\s+(-?\d+)/.exec(attr(gd, 'fmla') || '');
    if (m) av[attr(gd, 'name')] = Number(m[1]);
  }
  const flip = { h: box.flipH, v: box.flipV };

  if (name === 'pic') {
    const blipFill = kid(node, 'blipFill');
    const src = await blipSrc(blipFill, ctx, part.rels);
    if (!src) return;
    el.type = 'image';
    el.src = src;
    const rect = kid(blipFill, 'srcRect');
    if (rect) {
      const c = ['l', 't', 'r', 'b'].map((s) => num(attr(rect, s)) / 100000);
      if (c.some((v) => v)) el.style.crop = c;
    }
    if (prst && prst !== 'rect') el.style.clip = prst === 'ellipse' ? 'ellipse' : prst === 'roundRect' ? 'round' : undefined;
    if (flip.h || flip.v) el.style.flip = [flip.h ? -1 : 1, flip.v ? -1 : 1];
    if (line?.fill?.color) el.style.border = `${round(line.width)}px solid ${line.fill.color}`;
    out.push(el);
    return;
  }

  const isLine = name === 'cxnSp' || (prst && LINES.test(prst));
  const paths = isLine ? [{ d: linePath(prst || 'line', el.w, el.h), fill: false, stroke: true }] : prst ? [{ d: presetPath(prst, el.w, el.h, av), fill: true, stroke: true }] : customPaths(kid(spPr, 'custGeom'), box.w, box.h, el.w, el.h);
  const drawn = (fill && !fill.none) || line;

  // Text
  const txBody = kid(node, 'txBody');
  const key = ph ? styleKey(ph.type) : 'none';
  const fromRef = {};
  for (let l = 1; l <= 9; l++) fromRef[l] = { rPr: { ...(fontRefColor ? { color: fontRefColor } : {}), ...(fontRefFace ? { font: fontRefFace } : {}) } };
  const levels = mergeLevels(
    ph ? null : ctx.defaultText,
    key === 'title' ? ctx.master.title : key === 'body' ? ctx.master.body : key === 'other' ? ctx.master.other : null,
    fromRef,
    masterPh && parseLevels(kid(kid(masterPh, 'txBody'), 'lstStyle'), ctx),
    layoutPh && parseLevels(kid(kid(layoutPh, 'txBody'), 'lstStyle'), ctx),
    parseLevels(kid(txBody, 'lstStyle'), ctx),
  );
  const body = { ...parseBodyPr(kid(kid(masterPh, 'txBody'), 'bodyPr')), ...parseBodyPr(kid(kid(layoutPh, 'txBody'), 'bodyPr')), ...parseBodyPr(kid(txBody, 'bodyPr')) };
  const baseColor = fontRefColor;
  const { html, first } = txBody ? textHtml(txBody, levels, ctx, body.fit, { slideNum: part.slideNum, baseColor }) : { html: '', first: levels[1].rPr };
  if (!drawn && !html && !ph) return;

  el.type = drawn ? 'shape' : 'text';
  el.html = html;
  if (drawn) {
    el.shape = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rightArrow: 'arrow' }[prst] || 'rect';
    if (prst) el.prst = prst;
    el.svg = shapeSvg(paths, fill, line, el.w, el.h, flip);
    if (fill?.hex) el.style.fill = `#${fill.hex}`;
    else el.style.fill = 'transparent';
    if (line?.fill?.hex) {
      el.style.stroke = `#${line.fill.hex}`;
      el.style.strokeWidth = round(line.width / ctx.pt);
    }
    if (isLine) el.line = true;
    if (flip.h || flip.v) el.flip = [flip.h, flip.v];
  }
  const size = (first.sz || 18) * ctx.pt * (body.fit?.scale || 1);
  el.style.fontSize = round(size);
  el.style.color = first.color || baseColor || schemeColor('tx1', ctx) || '#000000';
  el.style.fontFamily = fontName(first.font, ctx) || ctx.theme.minor;
  el.style.bold = !!first.b;
  el.style.align = { ctr: 'center', r: 'right', just: 'justify' }[first.algn] || 'left';
  el.style.valign = { ctr: 'middle', b: 'bottom' }[body.anchor] || 'top';
  const ins = (v, d) => round((v ?? d) * k);
  el.style.pad = [ins(body.tIns, 45720), ins(body.rIns, 91440), ins(body.bIns, 45720), ins(body.lIns, 91440)];
  if (body.wrap === 'none') el.style.nowrap = true;
  if (body.vert && body.vert !== 'horz') el.style.vert = body.vert;
  el.style.free = true;
  const txXfrm = xfrmData(kid(node, 'txXfrm'));
  if (drawn && html && txXfrm) {
    const tb = tf(txXfrm);
    out.push({ ...el, type: 'shape', html: '' });
    Object.assign(el, { type: 'text', x: round(tb.x * k), y: round(tb.y * k), w: round(tb.w * k), h: round(tb.h * k), style: { ...el.style } });
    for (const key2 of ['fill', 'stroke', 'strokeWidth']) delete el.style[key2];
    delete el.svg;
    delete el.shape;
    delete el.prst;
  }
  if (ph && (!html || part.template)) {
    el.html = '';
    el.placeholder = ph.type === 'title' || ph.type === 'ctrTitle' ? 'Click to add title' : 'Click to add text';
    if (levels[1].bu === 'char' && ph.type !== 'subTitle') el.style.bullets = true;
  }
  out.push(el);
}

// graphicFrame: tables, charts, SmartArt and OLE previews.
async function readFrame(node, el, box, ctx, part, out) {
  const data = desc(node, 'graphicData')[0];
  const uri = attr(data, 'uri') || '';
  if (/table$/.test(uri)) {
    const tbl = kid(data, 'tbl');
    if (tbl) out.push(await readTable(tbl, el, ctx, part));
    return;
  }
  if (/chart$/.test(uri)) {
    const id = desc(data, 'chart')[0]?.getAttribute('r:id');
    const rel = id && part.rels[id];
    const doc = rel && (await ctx.pkg.xml(rel.path));
    if (!doc) return;
    const svg = chartSvg(doc, el.w, el.h, { color: (n) => css(colorOf(n, ctx)), accents: [1, 2, 3, 4, 5, 6].map((i) => `#${ctx.scheme[`accent${i}`] || '4472C4'}`), font: ctx.theme.minor, text: `#${ctx.scheme[ctx.clrMap.tx1 || 'dk1'] || '000000'}`, pt: ctx.pt });
    if (svg) out.push({ ...el, type: 'image', src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, chart: true });
    return;
  }
  if (/diagram$/.test(uri)) {
    const dm = desc(data, 'relIds')[0]?.getAttribute('r:dm');
    const dataDoc = dm && part.rels[dm] && (await ctx.pkg.xml(part.rels[dm].path));
    const drawId = attr(desc(dataDoc, 'dataModelExt')[0], 'relId');
    let rel = drawId && part.rels[drawId];
    if (!rel) rel = Object.values(part.rels).find((r) => /diagramDrawing$/.test(r.type));
    const doc = rel && (await ctx.pkg.xml(rel.path));
    const tree = doc && desc(doc, 'spTree')[0];
    if (!tree) return;
    const drawingPart = { ...part, rels: await ctx.pkg.rels(rel.path), kind: 'slide', keepPh: true };
    const move = (b) => ({ ...b, x: b.x + box.x, y: b.y + box.y });
    for (const c of kids(tree)) await readShape(c, ctx, drawingPart, out, move);
    return;
  }
  const pic = desc(node, 'pic')[0];
  if (pic) {
    const before = out.length;
    await readShape(pic, ctx, part, out, () => box);
    if (out.length > before) Object.assign(out[out.length - 1], { x: el.x, y: el.y, w: el.w, h: el.h });
  }
}

async function readTable(tbl, el, ctx, part) {
  const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(attr(c, 'w')));
  const total = cols.reduce((a, b) => a + b, 0) || 1;
  const tPr = kid(tbl, 'tblPr');
  const flags = Object.fromEntries(['firstRow', 'firstCol', 'lastRow', 'lastCol', 'bandRow', 'bandCol'].map((f) => [f, attr(tPr, f) === '1']));
  const styleId = desc(tPr, 'tableStyleId')[0]?.textContent;
  const tstyle = await tableStyle(ctx, styleId);
  const rows = kids(tbl, 'tr');
  const cells = [];
  let height = 0;
  for (const [r, tr] of rows.entries()) {
    const rowH = num(attr(tr, 'h')) * ctx.k;
    height += rowH;
    const row = [];
    for (const [c, tc] of kids(tr, 'tc').entries()) {
      const parts = [];
      if (r === 0 && flags.firstRow) parts.push('firstRow');
      else if (r === rows.length - 1 && flags.lastRow) parts.push('lastRow');
      else if (flags.bandRow && (r - (flags.firstRow ? 1 : 0)) % 2 === 0) parts.push('band1H');
      if (c === 0 && flags.firstCol) parts.push('firstCol');
      const ts = ['wholeTbl', ...parts].reduce((acc, p) => ({ ...acc, ...(tstyle[p] || {}) }), {});
      const tcPr = kid(tc, 'tcPr');
      const fill = (await fillOf(tcPr, ctx, part.rels)) ?? ts.fill;
      const levels = mergeLevels(ctx.defaultText, { 1: { rPr: { ...(ts.b ? { b: true } : {}), ...(ts.color ? { color: ts.color } : {}) } } });
      const { html } = textHtml(kid(tc, 'txBody'), levels, ctx, null, { slideNum: part.slideNum });
      const cell = { html, h: round(rowH) };
      const fc = paintCss(fill);
      if (fc) cell.fill = fc;
      if (attr(tc, 'gridSpan')) cell.colspan = num(attr(tc, 'gridSpan'));
      if (attr(tc, 'rowSpan')) cell.rowspan = num(attr(tc, 'rowSpan'));
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') cell.merged = true;
      const anchor = attr(tcPr, 'anchor');
      if (anchor) cell.valign = { ctr: 'middle', b: 'bottom' }[anchor] || 'top';
      cell.pad = [num(attr(tcPr, 'marT'), 45720), num(attr(tcPr, 'marR'), 91440), num(attr(tcPr, 'marB'), 45720), num(attr(tcPr, 'marL'), 91440)].map((v) => round(v * ctx.k));
      const borders = {};
      for (const [side, tag] of [['top', 'lnT'], ['right', 'lnR'], ['bottom', 'lnB'], ['left', 'lnL']]) {
        const ln = await lineOf(kid(tcPr, tag), ctx, part.rels);
        const b = ln?.fill ? (ln.fill.none ? 'none' : `${round(ln.width || 1)}px solid ${ln.fill.color}`) : ts.borders?.[side];
        if (b) borders[side] = b;
      }
      if (Object.keys(borders).length) cell.borders = borders;
      row.push(cell);
    }
    cells.push(row);
  }
  const text = (html) => html.replace(/<br>/g, ' ').replace(/<\/div>/g, ' ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  return {
    ...el,
    type: 'table',
    h: Math.max(el.h, round(height)),
    cols: cols.map((w) => round((w / total) * 100)),
    cells,
    rows: cells.map((row) => row.map((c) => text(c.html))),
    header: flags.firstRow,
  };
}

// Table style parts (wholeTbl, firstRow, band1H, ...) to { fill, color, b, borders }.
async function tableStyle(ctx, id) {
  ctx.tableStyles ??= await ctx.pkg.xml('ppt/tableStyles.xml');
  const node = desc(ctx.tableStyles, 'tblStyle').find((s) => attr(s, 'styleId') === id);
  const out = {};
  if (!node) {
    if (!id) return out;
    // Built-in style not stored in the file: a header row in accent 1 with light bands.
    const accent = ctx.scheme.accent1 || '4472C4';
    const tint = (v) => `#${[0, 2, 4].map((i) => Math.round(toSrgb(toLinear(parseInt(accent.slice(i, i + 2), 16)) * v + 1 - v)).toString(16).padStart(2, '0')).join('')}`;
    return {
      wholeTbl: { fill: { color: tint(0.2) }, borders: { top: '1px solid #fff', bottom: '1px solid #fff', left: '1px solid #fff', right: '1px solid #fff' } },
      band1H: { fill: { color: tint(0.4) } },
      firstRow: { fill: { color: `#${accent}` }, color: '#FFFFFF', b: true },
      lastRow: { b: true },
      firstCol: { b: true },
    };
  }
  for (const part of kids(node)) {
    const p = {};
    const tcStyle = kid(part, 'tcStyle');
    const fill = await fillOf(kid(tcStyle, 'fill'), ctx, {});
    const fillRef = kid(tcStyle, 'fillRef');
    if (fill) p.fill = fill;
    else if (fillRef) {
      const c = colorOf(fillRef, ctx);
      if (c) p.fill = { color: css(c) };
    }
    const tx = kid(part, 'tcTxStyle');
    if (tx) {
      const c = colorOf(tx, ctx) || colorOf(kid(tx, 'fontRef'), ctx);
      if (c) p.color = css(c);
      if (attr(tx, 'b') === 'on') p.b = true;
    }
    const bd = kid(tcStyle, 'tcBdr');
    if (bd) {
      p.borders = {};
      for (const [side, tag] of [['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'], ['inner', 'insideH'], ['innerV', 'insideV']]) {
        const ln = await lineOf(kid(kid(bd, tag), 'ln'), ctx, {});
        if (ln?.fill && !ln.fill.none) p.borders[side] = `${round(ln.width || 1)}px solid ${ln.fill.color}`;
      }
      if (p.borders.inner) {
        p.borders.top ??= p.borders.inner;
        p.borders.bottom ??= p.borders.inner;
      }
      if (p.borders.innerV) {
        p.borders.left ??= p.borders.innerV;
        p.borders.right ??= p.borders.innerV;
      }
      delete p.borders.inner;
      delete p.borders.innerV;
    }
    out[local(part)] = p;
  }
  return out;
}

// ---------- backgrounds

async function backgroundOf(doc, ctx, rels) {
  const bg = desc(doc, 'bg')[0];
  if (!bg) return null;
  const bgPr = kid(bg, 'bgPr');
  let fill;
  if (bgPr) fill = await fillOf(bgPr, ctx, rels);
  const ref = kid(bg, 'bgRef');
  if (!fill && ref) {
    const idx = num(attr(ref, 'idx'));
    const phClr = colorOf(ref, ctx);
    const item = idx >= 1001 ? ctx.theme.bgFills[idx - 1001] : ctx.theme.fills[idx - 1];
    fill = item ? await fillOf({ childNodes: [item] }, { ...ctx, phClr }, rels) : phClr ? { color: css(phClr), hex: phClr.hex } : null;
  }
  if (!fill || fill.none) return null;
  return { bg: fill.hex ? `#${fill.hex}` : '#FFFFFF', bgCss: paintCss(fill), bgImage: fill.image };
}

// ---------- notes

async function notesOf(pkg, rels) {
  const rel = Object.values(rels).find((r) => /notesSlide$/.test(r.type));
  const doc = rel && (await pkg.xml(rel.path));
  if (!doc) return '';
  return desc(doc, 'sp')
    .filter((sp) => phOf(sp)?.type === 'body')
    .flatMap((sp) => kids(kid(sp, 'txBody'), 'p').map((p) => desc(p, 't').map((t) => t.textContent).join('').trim()))
    .filter(Boolean)
    .join('\n');
}

// ---------- the deck

async function importPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const pkg = new Pkg(zip);
  const pres = await pkg.xml('ppt/presentation.xml');
  if (!pres) throw new Error('This doesn’t look like a PowerPoint file.');
  const presRels = await pkg.rels('ppt/presentation.xml');
  const sz = desc(pres, 'sldSz')[0];
  const cx = num(attr(sz, 'cx'), 12192000);
  const cy = num(attr(sz, 'cy'), 6858000);
  const k = W / cx;
  const size = { w: W, h: Math.round(cy * k) };
  const pt = 12700 * k;
  const layers = {};
  const masters = new Map();
  const slides = [];

  const masterCtx = async (file) => {
    if (masters.has(file)) return masters.get(file);
    const doc = await pkg.xml(file);
    const rels = await pkg.rels(file);
    const themeRel = Object.values(rels).find((r) => /theme$/.test(r.type));
    const theme = await readTheme(pkg, themeRel?.path);
    const ctx = { pkg, k, pt, theme, scheme: theme.scheme, clrMap: clrMapOf(desc(doc, 'clrMap')[0], {}) };
    const tx = desc(doc, 'txStyles')[0];
    ctx.master = { title: parseLevels(kid(tx, 'titleStyle'), ctx), body: parseLevels(kid(tx, 'bodyStyle'), ctx), other: parseLevels(kid(tx, 'otherStyle'), ctx) };
    ctx.defaultText = parseLevels(desc(pres, 'defaultTextStyle')[0], ctx);
    const entry = { ctx, doc, rels, tree: desc(doc, 'spTree')[0], file };
    masters.set(file, entry);
    return entry;
  };

  const layerOf = async (key, doc, rels, ctx) => {
    if (layers[key]) return key;
    const out = [];
    const part = { kind: 'layer', rels };
    for (const c of kids(desc(doc, 'spTree')[0])) await readShape(c, ctx, part, out, (b) => b);
    layers[key] = { elements: out.map((e, i) => ({ ...e, id: `${key.replace(/\W+/g, '')}-${i}` })) };
    return key;
  };

  const showMaster = (d) => attr(d?.documentElement, 'showMasterSp') !== '0';
  let n = 0;
  for (const sid of desc(pres, 'sldId')) {
    const file = presRels[sid.getAttribute('r:id')]?.path;
    const doc = file && (await pkg.xml(file));
    if (!doc) continue;
    n += 1;
    const rels = await pkg.rels(file);
    const layoutFile = Object.values(rels).find((r) => /slideLayout$/.test(r.type))?.path;
    const layoutDoc = await pkg.xml(layoutFile);
    const layoutRels = layoutFile ? await pkg.rels(layoutFile) : {};
    const masterFile = Object.values(layoutRels).find((r) => /slideMaster$/.test(r.type))?.path;
    const master = masterFile ? await masterCtx(masterFile) : await masterCtx(presRels[desc(pres, 'sldMasterId')[0]?.getAttribute('r:id')]?.path);
    const layoutMap = clrMapOf(desc(layoutDoc, 'overrideClrMapping')[0], master.ctx.clrMap);
    const ctx = { ...master.ctx, clrMap: clrMapOf(desc(doc, 'overrideClrMapping')[0], layoutMap) };
    const layoutCtx = { ...master.ctx, clrMap: layoutMap };

    const slideIds = [];
    if (showMaster(doc)) {
      if (!layoutDoc || showMaster(layoutDoc)) slideIds.push(await layerOf(masterFile, master.doc, master.rels, master.ctx));
      if (layoutDoc) slideIds.push(await layerOf(layoutFile, layoutDoc, layoutRels, layoutCtx));
    }
    // backgrounds come from the closest part that sets one, even when its artwork is hidden
    const bg = (await backgroundOf(doc, ctx, rels)) || (layoutDoc && (await backgroundOf(layoutDoc, layoutCtx, layoutRels))) || (await backgroundOf(master.doc, master.ctx, master.rels));

    const out = [];
    const part = { kind: 'slide', rels, layoutRels, layoutTree: desc(layoutDoc, 'spTree')[0], masterTree: master.tree, slideNum: n };
    for (const c of kids(desc(doc, 'spTree')[0])) await readShape(c, ctx, part, out, (b) => b);
    const s = {
      id: `s${n}`,
      layout: 'blank',
      own: true,
      layers: slideIds,
      bg: bg?.bg || '#FFFFFF',
      elements: out.map((e, i) => ({ ...e, id: `s${n}e${i}` })),
      notes: await notesOf(pkg, rels),
    };
    if (bg?.bgCss && bg.bgCss !== bg.bg) s.bgCss = bg.bgCss;
    if (attr(doc.documentElement, 'show') === '0') s.hidden = true;
    slides.push(s);
  }
  // Layouts for new slides, keyed by PowerPoint's layout type (title, obj, twoObj, ...).
  const layouts = {};
  const firstMaster = masters.values().next().value;
  for (const rel of Object.values(firstMaster?.rels || {})) {
    if (!/slideLayout$/.test(rel.type)) continue;
    const doc = await pkg.xml(rel.path);
    const type = attr(doc?.documentElement, 'type');
    if (!doc || !type || layouts[type]) continue;
    const rels = await pkg.rels(rel.path);
    const ctx = { ...firstMaster.ctx, clrMap: clrMapOf(desc(doc, 'overrideClrMapping')[0], firstMaster.ctx.clrMap) };
    const tree = desc(doc, 'spTree')[0];
    const out = [];
    const part = { kind: 'slide', template: true, rels, layoutRels: rels, layoutTree: tree, masterTree: firstMaster.tree };
    for (const c of kids(tree)) if (phOf(c) && !['dt', 'ftr', 'sldNum', 'hdr'].includes(phOf(c).type)) await readShape(c, ctx, part, out, (b) => b);
    const bg = (await backgroundOf(doc, ctx, rels)) || (await backgroundOf(firstMaster.doc, firstMaster.ctx, firstMaster.rels));
    const ids = [];
    if (showMaster(doc)) ids.push(await layerOf(firstMaster.file, firstMaster.doc, firstMaster.rels, firstMaster.ctx));
    ids.push(await layerOf(rel.path, doc, rels, ctx));
    layouts[type] = { layers: ids, bg: bg?.bg || '#FFFFFF', bgCss: bg?.bgCss !== bg?.bg ? bg?.bgCss : undefined, elements: out.filter((e) => e.role && e.type === 'text') };
  }
  return { format: 'rea-slides', version: 1, theme: 'paper', size, layers, layouts, slides };
}

module.exports = { importPptx, presetPath };
