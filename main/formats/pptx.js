'use strict';

// Exports the slides model to .pptx with pptxgenjs.
//
// The renderer flattens each text box into paragraphs before export:
//   { paragraphs: [{ align, bullet, runs: [{ text, bold, italic, underline, color, size }] }] }
// Coordinates are in a 960x540 canvas, which maps to the 10in x 5.625in 16:9 layout.

const PptxGenJS = require('pptxgenjs');
const { hex } = require('./docx');

const PX_PER_IN = 96;
const inch = (px) => Number((px / PX_PER_IN).toFixed(3));

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
      };
      if (ri === 0) {
        options.align = p.align || el.style?.align || 'left';
        if (p.bullet) options.bullet = p.bullet === 'number' ? { type: 'number' } : true;
      }
      if (ri === pruns.length - 1 && pi < paragraphs.length - 1) options.breakLine = true;
      runs.push({ text: r.text, options });
    });
  });
  return runs;
}

async function exportPptx(model) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'Work';
  pptx.title = model.title || 'Presentation';
  const theme = model.theme || {};
  for (const s of model.slides || []) {
    const slide = pptx.addSlide();
    const bg = hex(s.bg || theme.bg);
    if (bg) slide.background = { color: bg };
    if (s.notes) slide.addNotes(s.notes);
    for (const el of s.elements || []) {
      const box = { x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h) };
      const fill = hex(el.style?.fill);
      if (el.type === 'text') {
        slide.addText(textRuns(el), {
          ...box,
          fontFace: el.style?.fontFamily || theme.font || 'Calibri',
          fontSize: Math.round((el.style?.fontSize || 24) * 0.75),
          color: hex(el.style?.color) || hex(theme.text) || '222222',
          valign: el.style?.valign || 'top',
          fill: fill ? { color: fill } : undefined,
          margin: 6,
        });
      } else if (el.type === 'shape') {
        slide.addShape(SHAPES[el.shape] || 'rect', {
          ...box,
          fill: fill ? { color: fill } : { type: 'none' },
          line: hex(el.style?.stroke) ? { color: hex(el.style.stroke), width: el.style.strokeWidth || 1 } : undefined,
          rectRadius: el.shape === 'roundRect' ? 0.15 : undefined,
        });
        if (el.paragraphs?.some((p) => p.runs.some((r) => r.text))) {
          slide.addText(textRuns(el), { ...box, fontSize: Math.round((el.style?.fontSize || 20) * 0.75), color: hex(el.style?.color) || 'FFFFFF', valign: 'middle', align: 'center' });
        }
      } else if (el.type === 'image' && el.src?.startsWith('data:')) {
        slide.addImage({ ...box, data: el.src });
      }
    }
  }
  return pptx.write({ outputType: 'nodebuffer' });
}

module.exports = { exportPptx };
