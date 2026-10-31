'use strict';

// Reads a PowerPoint template (.pptx, .potx, .pptm, .potm) into a Present
// template: the theme's colours and fonts, the slide master's background
// (a colour or a picture) and the master's own pictures and filled boxes,
// which show on every slide. Placeholder positions and effects don't come
// across.

const path = require('path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const W = 960; // Present's slide canvas
const H = 540;
const MAX_DECOR = 16;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };

const parseXml = (text) => new DOMParser({ onError: () => {} }).parseFromString(text, 'application/xml');
const list = (l) => Array.from({ length: l?.length || 0 }, (_, i) => l[i]);
const kids = (node, name) => list(node?.childNodes).filter((n) => n.nodeType === 1 && (!name || n.nodeName === name));
const kid = (node, name) => kids(node, name)[0] || null;
const all = (node, name) => (node ? list(node.getElementsByTagName(name)) : []);

async function zipXml(zip, file) {
  const f = file && zip.file(file);
  return f ? parseXml(await f.async('string')) : null;
}

function relTargets(rels, base) {
  const out = {};
  for (const r of all(rels, 'Relationship')) {
    const t = r.getAttribute('Target');
    if (r.getAttribute('TargetMode') === 'External') continue;
    out[r.getAttribute('Id')] = { type: r.getAttribute('Type'), path: t.startsWith('/') ? t.slice(1) : new URL(t, `http://x/${base}`).pathname.slice(1) };
  }
  return out;
}

const relsOf = async (zip, file) => relTargets(await zipXml(zip, file.replace(/([^/]+)$/, '_rels/$1.rels')), file);

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
const fromHex = (hex) => [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16));

// lumMod / lumOff / tint / shade, close enough for picking text colours.
function adjust(hex, node) {
  let rgb = fromHex(hex);
  for (const m of kids(node)) {
    const v = Number(m.getAttribute('val')) / 100000;
    if (!Number.isFinite(v)) continue;
    if (m.nodeName === 'a:lumMod') rgb = rgb.map((c) => c * v);
    else if (m.nodeName === 'a:lumOff') rgb = rgb.map((c) => c + 255 * v);
    else if (m.nodeName === 'a:tint') rgb = rgb.map((c) => c + (255 - c) * (1 - v));
    else if (m.nodeName === 'a:shade') rgb = rgb.map((c) => c * v);
  }
  return toHex(rgb);
}

// The colour inside a fill or colour node, with scheme colours resolved.
function colorOf(node, scheme, map) {
  if (!node) return null;
  const c = kids(node).find((n) => /^a:(srgbClr|schemeClr|sysClr|prstClr)$/.test(n.nodeName));
  if (!c) return null;
  let hex = null;
  if (c.nodeName === 'a:srgbClr') hex = `#${c.getAttribute('val')}`;
  else if (c.nodeName === 'a:sysClr') hex = `#${c.getAttribute('lastClr') || (c.getAttribute('val') === 'window' ? 'FFFFFF' : '000000')}`;
  else if (c.nodeName === 'a:prstClr') hex = { white: '#FFFFFF', black: '#000000' }[c.getAttribute('val')] || null;
  else {
    const v = c.getAttribute('val');
    hex = scheme[map[v] || v] || null;
  }
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? adjust(hex.toLowerCase(), c) : null;
}

function themeColors(theme) {
  const out = {};
  const cs = all(theme, 'a:clrScheme')[0];
  for (const n of kids(cs)) {
    const c = kids(n)[0];
    if (!c) continue;
    const v = c.nodeName === 'a:sysClr' ? c.getAttribute('lastClr') : c.getAttribute('val');
    if (/^[0-9a-f]{6}$/i.test(v || '')) out[n.nodeName.replace(/^a:/, '')] = `#${v.toLowerCase()}`;
  }
  return out;
}

function themeFonts(theme) {
  const face = (name) => kid(all(theme, name)[0], 'a:latin')?.getAttribute('typeface') || '';
  return { major: face('a:majorFont'), minor: face('a:minorFont') };
}

function clrMap(master) {
  const m = all(master, 'p:clrMap')[0];
  const out = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  for (const a of list(m?.attributes)) out[a.name] = a.value;
  return out;
}

function pictureAt(zip, rels, id) {
  const rel = id && rels[id];
  if (!rel) return null;
  const ext = path.extname(rel.path).slice(1).toLowerCase();
  const mime = MIME[ext];
  const file = zip.file(rel.path);
  return mime && file ? { mime, file } : null;
}

async function dataUrl(pic) {
  return `data:${pic.mime};base64,${await pic.file.async('base64')}`;
}

// The background of a slide master or layout: { color } or { picture }.
async function backgroundOf(doc, zip, rels, ctx) {
  const bg = all(doc, 'p:bg')[0];
  if (!bg) return null;
  const pr = kid(bg, 'p:bgPr');
  if (pr) {
    const blip = all(kid(pr, 'a:blipFill'), 'a:blip')[0];
    const pic = blip && pictureAt(zip, rels, blip.getAttribute('r:embed'));
    if (pic) return { picture: pic };
    const solid = kid(pr, 'a:solidFill');
    if (solid) return { color: colorOf(solid, ctx.scheme, ctx.map) };
    const stop = all(kid(pr, 'a:gradFill'), 'a:gs')[0];
    if (stop) return { color: colorOf(stop, ctx.scheme, ctx.map) };
    return null;
  }
  const ref = kid(bg, 'p:bgRef');
  return ref ? { color: colorOf(ref, ctx.scheme, ctx.map) } : null;
}

function boxOf(node, size) {
  const xfrm = all(node, 'a:xfrm')[0];
  const off = kid(xfrm, 'a:off');
  const ext = kid(xfrm, 'a:ext');
  if (!off || !ext) return null;
  const sx = W / size.cx;
  const sy = H / size.cy;
  const box = { x: Number(off.getAttribute('x')) * sx, y: Number(off.getAttribute('y')) * sy, w: Number(ext.getAttribute('cx')) * sx, h: Number(ext.getAttribute('cy')) * sy };
  if (![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w < 1 || box.h < 1) return null;
  return Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 10) / 10]));
}

// Pictures and solid-filled shapes drawn on the master itself (not placeholders).
function decorOf(doc, zip, rels, size, ctx) {
  const tree = all(doc, 'p:spTree')[0];
  const out = [];
  for (const n of kids(tree)) {
    if (n.nodeName === 'p:pic') {
      const box = boxOf(n, size);
      const blip = all(n, 'a:blip')[0];
      const pic = blip && pictureAt(zip, rels, blip.getAttribute('r:embed'));
      if (box && pic) out.push({ type: 'image', ...box, pic });
    } else if (n.nodeName === 'p:sp') {
      if (all(n, 'p:ph').length) continue;
      if (all(n, 'a:t').some((t) => t.textContent.trim())) continue;
      const spPr = kid(n, 'p:spPr');
      const geom = kid(spPr, 'a:prstGeom')?.getAttribute('prst');
      const fill = colorOf(kid(spPr, 'a:solidFill'), ctx.scheme, ctx.map);
      const box = boxOf(n, size);
      if (box && fill && geom === 'rect') out.push({ type: 'shape', shape: geom, ...box, fill });
    }
  }
  return out.slice(0, MAX_DECOR);
}

function textStyle(master, name, scheme, map, fonts) {
  const lvl = all(all(master, name)[0], 'a:lvl1pPr')[0];
  const rpr = kid(lvl, 'a:defRPr');
  const color = colorOf(kid(rpr, 'a:solidFill'), scheme, map);
  const face = kid(rpr, 'a:latin')?.getAttribute('typeface') || '';
  const font = face === '+mj-lt' ? fonts.major : face === '+mn-lt' ? fonts.minor : face;
  return { color, font };
}

const luminance = (hex) => {
  const [r, g, b] = fromHex(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

async function readTemplate(buffer, fileName = 'Template.pptx') {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error('This isn’t a .pptx or .potx file. Older .ppt files need saving as .pptx in PowerPoint first.');
  }
  const pres = await zipXml(zip, 'ppt/presentation.xml');
  if (!pres) throw new Error('This doesn’t look like a PowerPoint template.');
  const sz = all(pres, 'p:sldSz')[0];
  const size = { cx: Number(sz?.getAttribute('cx')) || 12192000, cy: Number(sz?.getAttribute('cy')) || 6858000 };
  const presRels = relTargets(await zipXml(zip, 'ppt/_rels/presentation.xml.rels'), 'ppt/presentation.xml');
  const masterId = all(pres, 'p:sldMasterId')[0]?.getAttribute('r:id');
  const masterFile = presRels[masterId]?.path || Object.values(presRels).find((r) => /slideMaster$/.test(r.type))?.path;
  const master = await zipXml(zip, masterFile);
  if (!master) throw new Error('This template has no slide master.');
  const masterRels = await relsOf(zip, masterFile);
  const themeFile = Object.values(masterRels).find((r) => /\/theme$/.test(r.type))?.path;
  const theme = await zipXml(zip, themeFile);
  const scheme = theme ? themeColors(theme) : {};
  const fonts = theme ? themeFonts(theme) : { major: '', minor: '' };
  const map = clrMap(master);
  const ctx = { scheme, map };

  // Present's content slides look like the template's "Title and Content"
  // layout, so its background wins over the master's.
  let layout = null;
  for (const r of Object.values(masterRels).filter((x) => /slideLayout$/.test(x.type))) {
    const doc = await zipXml(zip, r.path);
    if (all(doc, 'p:sldLayout')[0]?.getAttribute('type') === 'obj') {
      layout = { doc, rels: await relsOf(zip, r.path) };
      break;
    }
  }
  const back = (layout && (await backgroundOf(layout.doc, zip, layout.rels, ctx))) || (await backgroundOf(master, zip, masterRels, ctx));
  const hideMaster = layout && all(layout.doc, 'p:sldLayout')[0].getAttribute('showMasterSp') === '0';
  const decor = [
    ...(hideMaster ? [] : decorOf(master, zip, masterRels, size, ctx)),
    ...(layout ? decorOf(layout.doc, zip, layout.rels, size, ctx) : []),
  ].slice(0, MAX_DECOR);

  // A picture that covers the whole slide is the background.
  let bgPic = back?.picture || null;
  const full = decor.findIndex((d) => d.type === 'image' && d.x <= 8 && d.y <= 8 && d.x + d.w >= W - 8 && d.y + d.h >= H - 8);
  if (!bgPic && full >= 0) bgPic = decor.splice(full, 1)[0].pic;

  const bg = back?.color || scheme[map.bg1] || '#ffffff';
  const title = textStyle(master, 'p:titleStyle', scheme, map, fonts);
  const body = textStyle(master, 'p:bodyStyle', scheme, map, fonts);
  const dark = luminance(bg) < 0.45;
  const fallbackText = dark ? scheme[map.bg1] || '#ffffff' : scheme[map.tx1] || '#222222';
  const text = body.color || fallbackText;
  const accent = scheme.accent1 || '#1c64c4';

  const core = await zipXml(zip, 'docProps/core.xml');
  const named = (all(core, 'dc:title')[0]?.textContent || '').trim();
  const label = (named && !/^PowerPoint Presentation$/i.test(named) ? named : path.basename(fileName, path.extname(fileName))).slice(0, 40) || 'My template';

  return {
    label,
    bg,
    text,
    title: title.color || text,
    accent,
    font: body.font || fonts.minor || 'Calibri',
    titleFont: title.font || fonts.major || '',
    bgImage: bgPic ? await dataUrl(bgPic) : null,
    decor: await Promise.all(decor.map(async ({ pic, ...d }) => (pic ? { ...d, src: await dataUrl(pic) } : d))),
  };
}

module.exports = { readTemplate };
