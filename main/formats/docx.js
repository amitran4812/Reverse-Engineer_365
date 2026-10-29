'use strict';

// Converts between the word processor's document model (TipTap/ProseMirror
// JSON) and .docx files. Export is hand-mapped with the `docx` library;
// import goes through mammoth, which produces HTML the editor understands.

const {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require('docx');
const mammoth = require('mammoth');
const { imageSize } = require('./imageSize');

const MARGINS = { narrow: 720, normal: 1440, wide: 2160 };
const HEADINGS = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };

function hex(color) {
  if (!color) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (m) return m[1].toUpperCase();
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color);
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const short = /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (short) return short[1].split('').map((c) => c + c).join('').toUpperCase();
  return undefined;
}

// "16px" / "12pt" -> half-points, which is what docx expects.
function halfPoints(size) {
  if (!size) return undefined;
  const m = /^([\d.]+)\s*(px|pt)?$/.exec(String(size).trim());
  if (!m) return undefined;
  const pt = m[2] === 'pt' ? Number(m[1]) : Number(m[1]) * 0.75;
  return Math.round(pt * 2);
}

function runOptions(marks = []) {
  const opts = {};
  for (const mark of marks) {
    switch (mark.type) {
      case 'bold': opts.bold = true; break;
      case 'italic': opts.italics = true; break;
      case 'underline': opts.underline = {}; break;
      case 'strike': opts.strike = true; break;
      case 'subscript': opts.subScript = true; break;
      case 'superscript': opts.superScript = true; break;
      case 'code': opts.font = 'Consolas'; break;
      case 'highlight': {
        const fill = hex(mark.attrs?.color) || 'FFF59D';
        opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill };
        break;
      }
      case 'textStyle': {
        const a = mark.attrs || {};
        if (hex(a.color)) opts.color = hex(a.color);
        if (a.fontFamily) opts.font = a.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        if (halfPoints(a.fontSize)) opts.size = halfPoints(a.fontSize);
        if (hex(a.backgroundColor)) opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: hex(a.backgroundColor) };
        break;
      }
      default: break;
    }
  }
  return opts;
}

function dataUrlImage(src, attrs = {}) {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,(.+)$/i.exec(src || '');
  if (!m) return null;
  const type = m[1].toLowerCase().replace('jpeg', 'jpg');
  const data = Buffer.from(m[2], 'base64');
  const natural = imageSize(data) || { width: 400, height: 300 };
  let width = Number.parseInt(attrs.width, 10) || natural.width;
  let height = Number.parseInt(attrs.height, 10) || Math.round((width / natural.width) * natural.height);
  const max = 620;
  if (width > max) {
    height = Math.round((height * max) / width);
    width = max;
  }
  return new ImageRun({ type, data, transformation: { width, height } });
}

function inlineChildren(node, extraMarks = []) {
  const out = [];
  for (const child of node.content || []) {
    if (child.type === 'text') {
      const marks = [...extraMarks, ...(child.marks || [])];
      const link = marks.find((m) => m.type === 'link');
      const run = new TextRun({ text: child.text, ...runOptions(marks), ...(link ? { style: 'Hyperlink' } : {}) });
      out.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
    } else if (child.type === 'hardBreak') {
      out.push(new TextRun({ break: 1 }));
    } else if (child.type === 'image') {
      const img = dataUrlImage(child.attrs?.src, child.attrs);
      if (img) out.push(img);
    }
  }
  return out;
}

class Converter {
  constructor() {
    this.listInstance = 0;
  }

  blocks(nodes, ctx = {}) {
    return (nodes || []).flatMap((n) => this.block(n, ctx));
  }

  paragraphProps(node, ctx) {
    const props = {};
    const align = ALIGN[node.attrs?.textAlign];
    if (align) props.alignment = align;
    if (ctx.list === 'bullet') props.bullet = { level: ctx.level };
    if (ctx.list === 'ordered') props.numbering = { reference: 'rea-numbered', level: ctx.level, instance: ctx.instance };
    if (ctx.quote) {
      props.indent = { left: 720 };
      props.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'B0B7C3', space: 8 } };
    }
    return props;
  }

  block(node, ctx) {
    switch (node.type) {
      case 'paragraph':
        return [new Paragraph({ ...this.paragraphProps(node, ctx), children: inlineChildren(node) })];
      case 'heading':
        return [new Paragraph({ ...this.paragraphProps(node, ctx), heading: HEADINGS[node.attrs?.level || 1], children: inlineChildren(node) })];
      case 'bulletList':
      case 'orderedList': {
        const level = ctx.list ? ctx.level + 1 : 0;
        const list = node.type === 'bulletList' ? 'bullet' : 'ordered';
        const instance = list === 'ordered' && !ctx.list ? ++this.listInstance : ctx.instance;
        return (node.content || []).flatMap((item) => this.blocks(item.content, { ...ctx, list, level: Math.min(level, 8), instance }));
      }
      case 'blockquote':
        return this.blocks(node.content, { ...ctx, quote: true });
      case 'codeBlock': {
        const lines = (node.content || []).map((t) => t.text).join('').split('\n');
        return lines.map((line) => new Paragraph({
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F3F4F6' },
          children: [new TextRun({ text: line, font: 'Consolas', size: 20 })],
        }));
      }
      case 'horizontalRule':
        if (node.attrs?.pageBreak) return [new Paragraph({ children: [new PageBreak()] })];
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B0B7C3', space: 1 } }, children: [] })];
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'image': {
        const img = dataUrlImage(node.attrs?.src, node.attrs);
        return img ? [new Paragraph({ children: [img] })] : [];
      }
      case 'table':
        return [this.table(node), new Paragraph({ children: [] })];
      default:
        return node.content ? this.blocks(node.content, ctx) : [];
    }
  }

  table(node) {
    const rows = (node.content || []).map((row) => new TableRow({
      tableHeader: (row.content || []).every((c) => c.type === 'tableHeader'),
      children: (row.content || []).map((cell) => {
        const children = this.blocks(cell.content, {});
        return new TableCell({
          columnSpan: cell.attrs?.colspan > 1 ? cell.attrs.colspan : undefined,
          rowSpan: cell.attrs?.rowspan > 1 ? cell.attrs.rowspan : undefined,
          shading: cell.type === 'tableHeader' ? { type: ShadingType.CLEAR, color: 'auto', fill: 'EEF1F6' } : undefined,
          children: children.length ? children : [new Paragraph({ children: [] })],
        });
      }),
    }));
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }
}

function numberingConfig() {
  const formats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  return {
    config: [{
      reference: 'rea-numbered',
      levels: Array.from({ length: 9 }, (_, level) => ({
        level,
        format: formats[level % 3],
        text: `%${level + 1}.`,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
      })),
    }],
  };
}

async function exportDocx({ json, title, page = {} }) {
  const margin = MARGINS[page.margins] || MARGINS.normal;
  const landscape = page.orientation === 'landscape';
  const children = new Converter().blocks(json?.content);
  const doc = new Document({
    title: title || 'Document',
    creator: 'Work',
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    numbering: numberingConfig(),
    sections: [{
      properties: {
        page: {
          margin: { top: margin, bottom: margin, left: margin, right: margin },
          size: landscape ? { width: 15840, height: 12240, orientation: 'landscape' } : { width: 12240, height: 15840 },
        },
      },
      children: children.length ? children : [new Paragraph({ children: [] })],
    }],
  });
  return Packer.toBuffer(doc);
}

async function importDocx(buffer) {
  const result = await mammoth.convertToHtml({ buffer });
  return { html: result.value, warnings: result.messages.map((m) => m.message) };
}

module.exports = { exportDocx, importDocx, hex, halfPoints };
