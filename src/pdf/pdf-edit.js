// Reads and writes Read's annotations as real PDF annotations with pdf-lib, so
// other PDF readers show them too. Signatures and pictures are drawn into the
// page when the file is saved. Page tools (rotate, delete, move, insert) work
// on the same pdf-lib document.

import {
  PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString, StandardFonts, degrees,
  appendBezierCurve, beginText, closePath, concatTransformationMatrix, endText, fill, lineTo, moveTo, moveText,
  popGraphicsState, pushGraphicsState, rectangle, setFillingRgbColor, setFontAndSize, setGraphicsState,
  setLineCap, setLineJoin, setLineWidth, setStrokingRgbColor, showText, stroke, LineCapStyle, LineJoinStyle,
} from 'pdf-lib';
import { hexToRgb, normRect, quadsToRects, rectsToQuads, rgbToHex, newId } from './annot-data.js';

const SUBTYPES = { Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strike', Ink: 'ink', Square: 'rect', Circle: 'ellipse', Line: 'line', Text: 'note', FreeText: 'text' };
const N = (s) => PDFName.of(s);

// --- Reading ---------------------------------------------------------------

function num(v) {
  return v instanceof PDFNumber ? v.asNumber() : Number(v?.asNumber?.() ?? v?.value?.() ?? NaN);
}

function nums(doc, arr) {
  if (!(arr instanceof PDFArray)) return null;
  return arr.asArray().map((x) => num(doc.context.lookup(x)));
}

function text(v) {
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';
}

function date(v) {
  const s = text(v);
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], (+m[2] || 1) - 1, +m[3] || 1, +m[4] || 0, +m[5] || 0, +m[6] || 0)).toISOString();
}

// Turns one annotation dictionary into Read's model, or null to leave it alone.
function readAnnot(doc, dict, page, rotation = 0) {
  const sub = dict.lookup(N('Subtype'));
  const type = sub && SUBTYPES[sub.decodeText()];
  if (!type) return null;
  // Replies, callouts and hidden annotations stay as they are.
  if (dict.get(N('IRT')) || dict.get(N('CL')) || (num(dict.lookup(N('F'))) & 2)) return null;
  const rect = nums(doc, dict.lookup(N('Rect')));
  if (!rect || rect.length < 4 || rect.some((v) => !Number.isFinite(v))) return null;
  const color = nums(doc, dict.lookup(N('C')));
  const ca = dict.lookup(N('CA'));
  const bs = dict.lookup(N('BS'));
  const border = nums(doc, dict.lookup(N('Border')));
  const width = (bs && num(bs.lookup?.(N('W')))) || (border && border[2]) || 1;
  const base = {
    id: text(dict.lookup(N('NM'))) || newId(),
    type,
    page,
    color: color?.length ? rgbToHex(color) : '#ffd400',
    opacity: ca ? num(ca) : 1,
    note: text(dict.lookup(N('Contents'))),
    author: text(dict.lookup(N('T'))),
    modified: date(dict.lookup(N('M'))) || date(dict.lookup(N('CreationDate'))),
  };
  const r = normRect(rect);
  switch (type) {
    case 'highlight':
    case 'underline':
    case 'strike': {
      const q = nums(doc, dict.lookup(N('QuadPoints')));
      return { ...base, rects: q?.length >= 8 ? quadsToRects(q) : [r] };
    }
    case 'ink': {
      const list = dict.lookup(N('InkList'));
      if (!(list instanceof PDFArray)) return null;
      const paths = list.asArray().map((p) => nums(doc, doc.context.lookup(p))).filter((p) => p?.length >= 2);
      return paths.length ? { ...base, paths, width } : null;
    }
    case 'rect':
    case 'ellipse': {
      const rd = nums(doc, dict.lookup(N('RD')));
      const ins = rd?.length === 4 ? rd : [width / 2, width / 2, width / 2, width / 2];
      const fillC = nums(doc, dict.lookup(N('IC')));
      return { ...base, rect: [r[0] + ins[0], r[1] + ins[3], r[2] - ins[2], r[3] - ins[1]], width, fill: fillC?.length ? rgbToHex(fillC) : null };
    }
    case 'line': {
      const l = nums(doc, dict.lookup(N('L')));
      if (!l || l.length < 4) return null;
      const le = dict.lookup(N('LE'));
      const arrow = le instanceof PDFArray && /Arrow/.test(String(le.asArray()[1] || ''));
      return { ...base, type: arrow ? 'arrow' : 'line', line: l.slice(0, 4), width };
    }
    case 'note':
      return { ...base, at: [r[0], r[3]] };
    case 'text': {
      const da = text(dict.lookup(N('DA'))) || String(dict.lookup(N('DA'))?.asString?.() || '');
      const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1]) || 12;
      const rgb = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
      return { ...base, rect: r, text: base.note, note: '', size, rot: rotation, color: rgb ? rgbToHex([+rgb[1], +rgb[2], +rgb[3]]) : '#000000', opacity: 1 };
    }
    default:
      return null;
  }
}

// Opens a PDF for editing: takes out the annotations Read can edit (they are
// drawn by Read on top of the page and written back on save) and returns the
// bytes pdf.js should render.
export async function openForEditing(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = [];
  let stripped = 0;
  doc.getPages().forEach((page, i) => {
    const list = page.node.Annots();
    if (!list) return;
    const refs = list.asArray();
    // An annotation someone replied to stays, with its replies.
    const replied = new Set(refs.map((ref) => doc.context.lookup(ref)?.get?.(N('IRT'))).filter((r) => r instanceof PDFRef));
    const drop = new Set();
    for (const ref of refs) {
      if (replied.has(ref)) continue;
      const dict = doc.context.lookup(ref);
      const a = dict?.lookup ? readAnnot(doc, dict, i, page.getRotation().angle) : null;
      if (!a) continue;
      annots.push(a);
      drop.add(ref);
      const popup = dict.get(N('Popup'));
      if (popup instanceof PDFRef) drop.add(popup);
    }
    if (!drop.size) return;
    page.node.set(N('Annots'), doc.context.obj(refs.filter((ref) => !drop.has(ref))));
    for (const ref of drop) if (ref instanceof PDFRef) doc.context.delete(ref);
    stripped += drop.size;
  });
  return { doc, annots, viewBytes: stripped ? await doc.save() : bytes };
}

// --- Writing ---------------------------------------------------------------

const rgb = (hex) => hexToRgb(hex);

function gstate(ctx, opacity, multiply) {
  const gs = { Type: 'ExtGState', CA: opacity, ca: opacity };
  if (multiply) gs.BM = 'Multiply';
  return { ExtGState: { GS0: ctx.obj(gs) } };
}

function ellipseOps(x0, y0, x1, y1) {
  const k = 0.5523;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  return [
    moveTo(cx + rx, cy),
    appendBezierCurve(cx + rx, cy + ry * k, cx + rx * k, cy + ry, cx, cy + ry),
    appendBezierCurve(cx - rx * k, cy + ry, cx - rx, cy + ry * k, cx - rx, cy),
    appendBezierCurve(cx - rx, cy - ry * k, cx - rx * k, cy - ry, cx, cy - ry),
    appendBezierCurve(cx + rx * k, cy - ry, cx + rx, cy - ry * k, cx + rx, cy),
    closePath(),
  ];
}

function arrowHead(x1, y1, x2, y2, w) {
  const len = Math.max(6, w * 4);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (d) => [x2 - len * Math.cos(a + d), y2 - len * Math.sin(a + d)];
  const [l, r] = [p(0.45), p(-0.45)];
  return [moveTo(...l), lineTo(x2, y2), lineTo(...r)];
}

// The transform that draws a box written upright on screen into a page that
// is shown rotated, as [a b c d e f] from box space (w × h) to user space.
function uprightMatrix(rect, rotation) {
  const [x0, y0, x1, y1] = rect;
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { m: [0, 1, -1, 0, x1, y0], w: y1 - y0, h: x1 - x0 };
    case 180: return { m: [-1, 0, 0, -1, x1, y1], w: x1 - x0, h: y1 - y0 };
    case 270: return { m: [0, -1, 1, 0, x0, y1], w: y1 - y0, h: x1 - x0 };
    default: return { m: [1, 0, 0, 1, x0, y0], w: x1 - x0, h: y1 - y0 };
  }
}

function safeText(font, s) {
  try {
    font.encodeText(s);
    return s;
  } catch {
    return [...s].map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return '?';
      }
    }).join('');
  }
}

function wrapLines(font, textValue, size, width) {
  const lines = [];
  for (const para of String(textValue || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && font.widthOfTextAtSize(next.trimEnd(), size) > width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function appearance(ctx, ops, bbox, resources) {
  return ctx.register(ctx.formXObject(ops, { BBox: bbox, Resources: resources || {} }));
}

function writeAnnot(doc, page, a, font) {
  const ctx = doc.context;
  const c = rgb(a.color);
  const opacity = a.opacity ?? 1;
  const common = {
    Type: 'Annot',
    F: 4,
    NM: PDFString.of(a.id),
    M: PDFString.fromDate(a.modified ? new Date(a.modified) : new Date()),
    C: c,
    CA: opacity,
  };
  if (a.author) common.T = PDFHexString.fromText(a.author);
  if (a.note) common.Contents = PDFHexString.fromText(a.note);
  let dict;
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strike': {
      const xs = a.rects.flatMap((r) => [r[0], r[2]]);
      const ys = a.rects.flatMap((r) => [r[1], r[3]]);
      const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const ops = [pushGraphicsState(), setGraphicsState('GS0')];
      if (a.type === 'highlight') {
        ops.push(setFillingRgbColor(...c));
        for (const [x0, y0, x1, y1] of a.rects) ops.push(rectangle(x0, y0, x1 - x0, y1 - y0));
        ops.push(fill());
      } else {
        ops.push(setStrokingRgbColor(...c));
        for (const [x0, y0, x1, y1] of a.rects) {
          const hgt = y1 - y0;
          const y = a.type === 'underline' ? y0 + hgt * 0.1 : y0 + hgt * 0.45;
          ops.push(setLineWidth(Math.max(0.6, hgt * 0.07)), moveTo(x0, y), lineTo(x1, y), stroke());
        }
      }
      ops.push(popGraphicsState());
      const sub = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut' }[a.type];
      dict = { ...common, Subtype: sub, Rect: bbox, QuadPoints: rectsToQuads(a.rects), AP: { N: appearance(ctx, ops, bbox, gstate(ctx, opacity, a.type === 'highlight')) } };
      break;
    }
    case 'ink': {
      const w = a.width || 1;
      const xs = a.paths.flatMap((p) => p.filter((_, i) => i % 2 === 0));
      const ys = a.paths.flatMap((p) => p.filter((_, i) => i % 2 === 1));
      const bbox = [Math.min(...xs) - w, Math.min(...ys) - w, Math.max(...xs) + w, Math.max(...ys) + w];
      const ops = [pushGraphicsState(), setGraphicsState('GS0'), setStrokingRgbColor(...c), setLineWidth(w), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)];
      for (const p of a.paths) {
        ops.push(moveTo(p[0], p[1]));
        if (p.length === 2) ops.push(lineTo(p[0] + 0.01, p[1]));
        for (let i = 2; i + 1 < p.length; i += 2) ops.push(lineTo(p[i], p[i + 1]));
        ops.push(stroke());
      }
      ops.push(popGraphicsState());
      dict = { ...common, Subtype: 'Ink', Rect: bbox, InkList: a.paths, BS: { W: w }, AP: { N: appearance(ctx, ops, bbox, gstate(ctx, opacity)) } };
      break;
    }
    case 'rect':
    case 'ellipse': {
      const w = a.width || 1;
      const [x0, y0, x1, y1] = normRect(a.rect);
      const bbox = [x0 - w / 2, y0 - w / 2, x1 + w / 2, y1 + w / 2];
      const shape = a.type === 'rect' ? [rectangle(x0, y0, x1 - x0, y1 - y0)] : ellipseOps(x0, y0, x1, y1);
      const ops = [pushGraphicsState(), setGraphicsState('GS0'), setLineWidth(w), setStrokingRgbColor(...c)];
      if (a.fill) ops.push(setFillingRgbColor(...rgb(a.fill)), ...shape, fill());
      ops.push(...shape, stroke(), popGraphicsState());
      dict = { ...common, Subtype: a.type === 'rect' ? 'Square' : 'Circle', Rect: bbox, RD: [w / 2, w / 2, w / 2, w / 2], BS: { W: w }, AP: { N: appearance(ctx, ops, bbox, gstate(ctx, opacity)) } };
      if (a.fill) dict.IC = rgb(a.fill);
      break;
    }
    case 'line':
    case 'arrow': {
      const w = a.width || 1;
      const [x1, y1, x2, y2] = a.line;
      const pad = w * 4 + 2;
      const bbox = [Math.min(x1, x2) - pad, Math.min(y1, y2) - pad, Math.max(x1, x2) + pad, Math.max(y1, y2) + pad];
      const ops = [pushGraphicsState(), setGraphicsState('GS0'), setLineWidth(w), setStrokingRgbColor(...c), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round), moveTo(x1, y1), lineTo(x2, y2), stroke()];
      if (a.type === 'arrow') ops.push(...arrowHead(x1, y1, x2, y2, w), stroke());
      ops.push(popGraphicsState());
      dict = { ...common, Subtype: 'Line', Rect: bbox, L: a.line, BS: { W: w }, LE: [N('None'), N(a.type === 'arrow' ? 'OpenArrow' : 'None')], AP: { N: appearance(ctx, ops, bbox, gstate(ctx, opacity)) } };
      break;
    }
    case 'note': {
      const [x, y] = a.at;
      const bbox = [x, y - 20, x + 20, y];
      const ops = [
        pushGraphicsState(), setFillingRgbColor(...c), setStrokingRgbColor(0.25, 0.25, 0.25), setLineWidth(0.8),
        moveTo(x + 2, y - 2), lineTo(x + 18, y - 2), lineTo(x + 18, y - 14), lineTo(x + 9, y - 14), lineTo(x + 5, y - 18), lineTo(x + 5, y - 14), lineTo(x + 2, y - 14), closePath(), fill(),
        moveTo(x + 2, y - 2), lineTo(x + 18, y - 2), lineTo(x + 18, y - 14), lineTo(x + 9, y - 14), lineTo(x + 5, y - 18), lineTo(x + 5, y - 14), lineTo(x + 2, y - 14), closePath(), stroke(),
        moveTo(x + 5, y - 6), lineTo(x + 15, y - 6), moveTo(x + 5, y - 10), lineTo(x + 12, y - 10), stroke(),
        popGraphicsState(),
      ];
      dict = { ...common, Subtype: 'Text', Name: 'Comment', Rect: bbox, Open: false, AP: { N: appearance(ctx, ops, bbox) } };
      break;
    }
    case 'text': {
      const size = a.size || 12;
      const r = normRect(a.rect);
      const { m, w, h: boxH } = uprightMatrix(r, a.rot ?? page.getRotation().angle);
      const lines = wrapLines(font, safeText(font, a.text || ''), size, Math.max(4, w - 4));
      const ops = [pushGraphicsState(), concatTransformationMatrix(...m), beginText(), setFillingRgbColor(...c), setFontAndSize('Helv', size)];
      let y = boxH - 2 - size * 0.9;
      ops.push(moveText(2, y));
      lines.forEach((ln, i) => {
        if (i) ops.push(moveText(0, -size * 1.2));
        y -= size * 1.2;
        ops.push(showText(font.encodeText(ln)));
      });
      ops.push(endText(), popGraphicsState());
      const da = `/Helv ${size} Tf ${c.map((v) => v.toFixed(3)).join(' ')} rg`;
      dict = { ...common, Subtype: 'FreeText', Rect: r, DA: PDFString.of(da), Contents: PDFHexString.fromText(a.text || ''), BS: { W: 0 }, Border: [0, 0, 0], CA: 1, AP: { N: appearance(ctx, ops, r, { Font: { Helv: font.ref } }) } };
      break;
    }
    default:
      return;
  }
  // ctx.obj turns plain strings into names, so text values above are PDF strings already.
  page.node.addAnnot(ctx.register(ctx.obj(dict)));
}

function dataUrlBytes(src) {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src || '');
  if (!m) return null;
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { png: m[1].toLowerCase() === 'png', bytes: out };
}

async function drawImage(doc, page, a, cache) {
  let img = cache.get(a.src);
  if (!img) {
    const data = dataUrlBytes(a.src);
    if (!data) return;
    img = data.png ? await doc.embedPng(data.bytes) : await doc.embedJpg(data.bytes);
    cache.set(a.src, img);
  }
  const [x0, y0, x1, y1] = normRect(a.rect);
  const rot = (((a.rot ?? page.getRotation().angle) % 360) + 360) % 360;
  const at = { 0: [x0, y0], 90: [x1, y0], 180: [x1, y1], 270: [x0, y1] }[rot] || [x0, y0];
  const sideways = rot === 90 || rot === 270;
  page.drawImage(img, { x: at[0], y: at[1], width: sideways ? y1 - y0 : x1 - x0, height: sideways ? x1 - x0 : y1 - y0, rotate: degrees(rot), opacity: a.opacity ?? 1 });
}

// Builds the PDF to save: the page bytes plus every annotation.
export async function buildPdf(viewBytes, annots, { title } = {}) {
  const doc = await PDFDocument.load(viewBytes, { updateMetadata: false });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const images = new Map();
  for (const a of annots) {
    const page = pages[a.page];
    if (!page) continue;
    if (a.type === 'image') await drawImage(doc, page, a, images);
    else writeAnnot(doc, page, a, font);
  }
  doc.setModificationDate(new Date());
  if (title && !doc.getTitle()) doc.setTitle(title);
  return doc.save();
}

// --- Pages -----------------------------------------------------------------

export async function rotatePages(doc, indexes, by) {
  for (const i of indexes) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + by) % 360) + 360) % 360));
  }
}

export function deletePages(doc, indexes) {
  for (const i of [...indexes].sort((a, b) => b - a)) doc.removePage(i);
}

export async function movePage(doc, from, to) {
  const [copy] = await doc.copyPages(doc, [from]);
  doc.removePage(from);
  doc.insertPage(to, copy);
}

export async function insertPdf(doc, bytes, at) {
  const src = await PDFDocument.load(bytes, { updateMetadata: false });
  const copies = await doc.copyPages(src, src.getPageIndices());
  copies.forEach((p, k) => doc.insertPage(at + k, p));
  return copies.length;
}

export async function blankPage(doc, at) {
  const ref = doc.getPage(Math.max(0, Math.min(at, doc.getPageCount()) - 1));
  const { width, height } = ref ? ref.getSize() : { width: 612, height: 792 };
  doc.insertPage(at, [width, height]);
}

// A new PDF with just these pages (and their annotations), for Extract.
export async function extractPages(viewBytes, annots, indexes) {
  const full = await PDFDocument.load(await buildPdf(viewBytes, annots), { updateMetadata: false });
  const out = await PDFDocument.create();
  const copies = await out.copyPages(full, indexes);
  copies.forEach((p) => out.addPage(p));
  return out.save();
}

export { PDFDocument };
