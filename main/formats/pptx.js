'use strict';

// Exports the slides model to .pptx with pptxgenjs.
//
// The renderer flattens each text box into paragraphs before export:
//   { paragraphs: [{ align, bullet, runs: [{ text, bold, italic, underline, color, size }] }] }
// Coordinates are in a 960x540 canvas, which maps to the 10in x 5.625in 16:9 layout.

const crypto = require('crypto');
const JSZip = require('jszip');
const PptxGenJS = require('pptxgenjs');
const { hex } = require('./docx');
const { firstFamily } = require('../../common/fonts');

// Present also keeps its own copy of the deck inside the .pptx (themes,
// template layers and shapes PowerPoint has no match for). It is used on
// open only while the slides are unchanged since Work saved them.
const DECK_PART = 'work/deck.json';

const PX_PER_IN = 96;
const inch = (px) => Number((px / PX_PER_IN).toFixed(3));

const PRESETS = new Set(Object.values(new PptxGenJS().ShapeType));
const SHAPES = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow', line: 'line' };

function textRuns(el) {
  const runs = [];
  const paragraphs = el.paragraphs?.length ? el.paragraphs : [{ runs: [{ text: '' }] }];
  paragraphs.forEach((p, pi) => {
    const pruns = p.runs.length ? p.runs : [{ text: '' }];
    pruns.forEach((r, ri) => {
      const options = {
        bold: !!r.bold,
        italic: !!r.italic,
        underline: r.underline ? { style: 'sng' } : undefined,
        color: hex(r.color) || hex(el.style?.color),
        fontSize: r.size || el.style?.fontSize ? Math.round((r.size || el.style.fontSize) * 0.75) : undefined,
        fontFace: firstFamily(r.font) || undefined,
      };
      if (ri === 0) {
        options.align = p.align || el.style?.align || 'left';
        if (p.bullet) options.bullet = p.bullet === 'number' ? { type: 'number' } : typeof p.bullet === 'string' && p.bullet !== '•' ? { characterCode: p.bullet.codePointAt(0).toString(16).padStart(4, '0') } : true;
      }
      if (ri === pruns.length - 1 && pi < paragraphs.length - 1) options.breakLine = true;
      runs.push({ text: r.text, options });
    });
  });
  return runs;
}

function tableRows(el) {
  const accent = hex(el.style?.fill) || '444444';
  if (el.cells) {
    return el.cells.map((row, r) => row.filter((c) => !c.merged).map((c, i) => ({
      text: String(el.rows?.[r]?.[i] ?? ''),
      options: { fill: hex(c.fill) ? { color: hex(c.fill) } : undefined, colspan: c.colspan, rowspan: c.rowspan, valign: c.valign },
    })));
  }
  return el.rows.map((row, r) => row.map((v) => {
    const head = r === 0 && el.header !== false;
    return { text: String(v ?? ''), options: head ? { bold: true, color: 'FFFFFF', fill: { color: accent } } : {} };
  }));
}

async function exportPptx(model, native) {
  const pptx = new PptxGenJS();
  const size = model.size || { w: 960, h: 540 };
  if (size.w === 960 && size.h === 540) pptx.layout = 'LAYOUT_16x9';
  else {
    pptx.defineLayout({ name: 'WORK', width: 10, height: inch((size.h * 960) / size.w) });
    pptx.layout = 'WORK';
  }
  pptx.author = 'Work';
  pptx.title = model.title || 'Presentation';
  const theme = model.themeColors || {};
  // An uploaded template: its background picture and the master's pictures
  // and boxes go on a slide master that every slide uses.
  const master = model.master;
  if (master) {
    const objects = [];
    for (const d of master.decor || []) {
      const box = { x: inch(d.x), y: inch(d.y), w: inch(d.w), h: inch(d.h) };
      if (d.type === 'image' && d.src?.startsWith('data:')) objects.push({ image: { ...box, data: d.src.slice(5) } });
      else if (d.type === 'shape' && hex(d.fill)) objects.push({ rect: { ...box, fill: { color: hex(d.fill) } } });
    }
    pptx.defineSlideMaster({
      title: 'TEMPLATE',
      background: master.bgImage?.startsWith('data:') ? { data: master.bgImage.slice(5) } : { color: hex(master.bg) || 'FFFFFF' },
      objects,
    });
  }
  for (const s of model.slides || []) {
    const slide = master ? pptx.addSlide({ masterName: 'TEMPLATE' }) : pptx.addSlide();
    const bg = hex(s.bg || (master ? null : theme.bg));
    if (s.bgImage) slide.background = { data: s.bgImage.slice(5) };
    else if (bg) slide.background = { color: bg };
    if (s.notes) slide.addNotes(s.notes);
    for (const el of s.elements || []) {
      const box = { x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h), ...(el.style?.rotate ? { rotate: el.style.rotate } : {}) };
      const fill = hex(el.style?.fill);
      if (el.type === 'text') {
        slide.addText(textRuns(el), {
          ...box,
          fontFace: firstFamily(el.style?.fontFamily || theme.font) || 'Calibri',
          fontSize: Math.round((el.style?.fontSize || 24) * 0.75),
          color: hex(el.style?.color) || hex(theme.text) || '222222',
          valign: el.style?.valign || 'top',
          fill: fill ? { color: fill } : undefined,
          margin: 6,
        });
      } else if (el.type === 'shape' && el.svg && !el.prst) {
        // custom outlines from .pptx go back as pictures of themselves
        slide.addImage({ ...box, data: `data:image/svg+xml;base64,${Buffer.from(el.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')).toString('base64')}` });
      } else if (el.type === 'shape') {
        slide.addShape(el.line ? 'line' : PRESETS.has(el.prst) ? el.prst : SHAPES[el.shape] || 'rect', {
          ...box,
          fill: fill ? { color: fill } : { type: 'none' },
          line: hex(el.style?.stroke) ? { color: hex(el.style.stroke), width: el.style.strokeWidth || 1 } : undefined,
          rectRadius: el.shape === 'roundRect' ? 0.15 : undefined,
          flipH: el.flip?.[0] || undefined,
          flipV: el.flip?.[1] || undefined,
        });
        if (el.paragraphs?.some((p) => p.runs.some((r) => r.text))) {
          slide.addText(textRuns(el), { ...box, fontSize: Math.round((el.style?.fontSize || 20) * 0.75), color: hex(el.style?.color) || 'FFFFFF', valign: 'middle', align: 'center' });
        }
      } else if (el.type === 'image' && el.src?.startsWith('data:')) {
        slide.addImage({ ...box, data: el.src });
      } else if (el.type === 'table' && el.rows?.length) {
        slide.addTable(tableRows(el), {
          ...box,
          rowH: Number((box.h / el.rows.length).toFixed(3)),
          fontFace: firstFamily(el.style?.fontFamily || theme.font) || 'Calibri',
          fontSize: Math.round((el.style?.fontSize || 14) * 0.75),
          color: hex(el.style?.color) || hex(theme.text) || '222222',
          border: { type: 'solid', pt: 0.5, color: 'C8CCD2' },
          margin: 0.04,
          valign: 'middle',
        });
      }
    }
  }
  const buffer = await withTransitions(await pptx.write({ outputType: 'nodebuffer' }), model.slides || []);
  return native ? withDeckPart(buffer, native) : buffer;
}

// Slide transitions go in each slide's XML, where PowerPoint and others read them.
const TRANSITION_XML = { fade: '<p:fade/>', push: '<p:push dir="l"/>', wipe: '<p:wipe dir="l"/>', cover: '<p:cover dir="l"/>', zoom: '<p:zoom/>', split: '<p:split orient="vert" dir="out"/>' };

async function withTransitions(buffer, slides) {
  if (!slides.some((s) => TRANSITION_XML[s.transition?.type])) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  for (const [i, s] of slides.entries()) {
    const effect = TRANSITION_XML[s.transition?.type];
    const file = zip.file(`ppt/slides/slide${i + 1}.xml`);
    if (!effect || !file) continue;
    const speed = ['fast', 'med', 'slow'].includes(s.transition.speed) ? s.transition.speed : 'med';
    const xml = (await file.async('string')).replace(/<p:transition\b[\s\S]*?(<\/p:transition>|\/>)/, '');
    const tr = `<p:transition spd="${speed}">${effect}</p:transition>`;
    zip.file(file.name, /<p:timing\b/.test(xml) ? xml.replace(/<p:timing\b/, `${tr}<p:timing`) : xml.replace(/<\/p:sld>\s*$/, `${tr}</p:sld>`));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function slidesHash(zip) {
  const names = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort();
  const hash = crypto.createHash('sha256');
  for (const f of names) hash.update(`${f}\n${await zip.file(f).async('string')}\n`);
  return hash.digest('hex');
}

async function withDeckPart(buffer, native) {
  const zip = await JSZip.loadAsync(buffer);
  zip.file(DECK_PART, JSON.stringify({ version: 1, slidesHash: await slidesHash(zip), deck: native }));
  const types = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="json"/.test(types)) zip.file('[Content_Types].xml', types.replace(/<Types[^>]*>/, '$&<Default Extension="json" ContentType="application/json"/>'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Present's own copy of a deck Work saved, when the slides still match it.
async function workDeck(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const part = await zip.file(DECK_PART)?.async('string');
    if (!part) return null;
    const saved = JSON.parse(part);
    return Array.isArray(saved?.deck?.slides) && saved.slidesHash === (await slidesHash(zip)) ? saved.deck : null;
  } catch {
    return null;
  }
}

module.exports = { exportPptx, workDeck };
