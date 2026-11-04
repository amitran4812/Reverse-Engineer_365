'use strict';

// Converts between the word processor's document model (TipTap/ProseMirror
// JSON) and .docx files. Export is hand-mapped with the `docx` library;
// import goes through mammoth, which produces HTML the editor understands.

const {
  AlignmentType,
  Bookmark,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
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
const JSZip = require('jszip');
const crypto = require('crypto');
const { imageSize } = require('./imageSize');
const { commentSpans, headingOutline, applyCommentMarkers, readCommentsXml, markCommentRanges } = require('../../common/outline');

// Notes saved from Write's notes mode carry this keyword, so they reopen as notes.
const NOTES_KEYWORD = 'Work notes';
const BOX = { true: '☑', false: '☐' };
// Notes also keep the editor's own copy of the page (voice notes, attachments
// and write-anywhere boxes have no Word equivalent). It is used on open only
// while the Word text is unchanged since Work saved it.
const NOTES_PART = 'work/notes.json';
const EQUATION = 'Equation';

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
  // Equations keep their TeX in the alt text, so they stay editable when reopened.
  const altText = attrs.title === EQUATION ? { name: EQUATION, title: EQUATION, description: `${EQUATION}: ${attrs.alt || ''}` } : attrs.alt ? { name: 'Picture', title: '', description: String(attrs.alt) } : undefined;
  return new ImageRun({ type, data, transformation: { width, height }, ...(altText ? { altText } : {}) });
}

// Set while one document converts: its comments (with the text nodes where each starts and ends).
let current = { comments: {}, ids: new Map(), headings: 0, toc: false };

function inlineChildren(node, extraMarks = []) {
  const out = [];
  for (const child of node.content || []) {
    if (child.type === 'text') {
      const marks = [...extraMarks, ...(child.marks || [])];
      const link = marks.find((m) => m.type === 'link');
      const notes = (child.marks || []).filter((m) => m.type === 'comment' && current.ids.has(m.attrs?.id));
      for (const m of notes) if (current.comments[m.attrs.id].firstNode === child) out.push(new CommentRangeStart(current.ids.get(m.attrs.id)));
      const run = new TextRun({ text: child.text, ...runOptions(marks), ...(link ? { style: 'Hyperlink' } : {}) });
      out.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
      for (const m of notes) {
        if (current.comments[m.attrs.id].lastNode !== child) continue;
        const n = current.ids.get(m.attrs.id);
        out.push(new CommentRangeEnd(n), new TextRun({ children: [new CommentReference(n)] }));
      }
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
    if (ctx.task) props.indent = { left: 360 * (ctx.level + 1) };
    if (ctx.quote) {
      props.indent = { left: 720 };
      props.border = { left: { style: BorderStyle.SINGLE, size: 12, color: 'B0B7C3', space: 8 } };
    }
    return props;
  }

  block(node, ctx) {
    switch (node.type) {
      case 'paragraph': {
        const children = inlineChildren(node);
        if (ctx.task) children.unshift(new TextRun(`${ctx.task} `));
        return [new Paragraph({ ...this.paragraphProps(node, ctx), children })];
      }
      case 'heading': {
        // With a table of contents, each heading carries a bookmark its entry links to.
        const children = inlineChildren(node);
        const id = `_Toc_w${current.headings++}`;
        return [new Paragraph({ ...this.paragraphProps(node, ctx), heading: HEADINGS[node.attrs?.level || 1], children: current.toc ? [new Bookmark({ id, children })] : children })];
      }
      case 'tableOfContents':
        return [
          new Paragraph({ style: TOC_TITLE, children: [new TextRun('Contents')] }),
          ...current.outline.map((it) => new Paragraph({
            style: TOC_STYLE,
            indent: { left: 360 * (Math.min(it.level, 4) - 1) },
            children: [new InternalHyperlink({ anchor: `_Toc_w${it.index}`, children: [new TextRun({ text: it.text || ' ', style: 'Hyperlink' })] })],
          })),
        ];
      case 'bulletList':
      case 'orderedList': {
        const level = ctx.list || ctx.task ? ctx.level + 1 : 0;
        const list = node.type === 'bulletList' ? 'bullet' : 'ordered';
        const instance = list === 'ordered' && !ctx.list ? ++this.listInstance : ctx.instance;
        return (node.content || []).flatMap((item) => this.blocks(item.content, { ...ctx, task: null, list, level: Math.min(level, 8), instance }));
      }
      case 'taskList': {
        // Checklists save as ☐ / ☑ lines, which Work turns back into checklists on open.
        const level = ctx.task || ctx.list ? Math.min(ctx.level + 1, 8) : 0;
        return (node.content || []).flatMap((item) => this.blocks(item.content, { ...ctx, list: null, task: BOX[!!item.attrs?.checked], level }));
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
      case 'noteFile': {
        const a = node.attrs || {};
        const label = a.kind === 'audio' ? `🎙 Voice note ${duration(a.duration)}` : `📎 ${a.name || 'Attachment'}${a.size ? ` (${bytes(a.size)})` : ''}`;
        const out = [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })];
        if (a.transcript) out.push(...String(a.transcript).split('\n').filter(Boolean).map((line) => new Paragraph({ indent: { left: 360 }, children: [new TextRun({ text: line, italics: true })] })));
        return out;
      }
      case 'noteBoard':
        // Free-placed boxes read top to bottom, left to right.
        return boardItems(node).flatMap((item) => boxLines(item.html).map((line) => new Paragraph({ children: [new TextRun(line)] })));
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

function duration(secs) {
  const t = Math.max(0, Math.round(Number(secs) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function bytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${Math.round(v / 1024)} KB`;
  return `${(v / 1048576).toFixed(1)} MB`;
}

function boardItems(node) {
  let items = node.attrs?.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  return (Array.isArray(items) ? items : []).slice().sort((a, b) => (Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y));
}

// A box's HTML as lines of plain text.
function boxLines(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(div|p|li)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((l) => l.trim()).filter(Boolean);
}

const hashOf = (text) => crypto.createHash('sha256').update(text).digest('hex');

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

// Table of contents lines use their own paragraph styles, so they come back as a table of contents.
const TOC_STYLE = 'WorkContents';
const TOC_TITLE = 'WorkContentsTitle';

function hasToc(node) {
  return node?.type === 'tableOfContents' || (node?.content || []).some(hasToc);
}

function commentList(json) {
  const spans = commentSpans(json);
  const ids = new Map();
  const out = [];
  for (const [id, c] of Object.entries(spans)) {
    ids.set(id, out.length);
    const date = new Date(c.date);
    out.push({ id: out.length, author: c.author || 'Author', initials: (c.author || 'A').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase(), ...(Number.isNaN(date.getTime()) ? {} : { date }), children: String(c.text || '').split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] })) });
  }
  return { spans, ids, out };
}

async function exportDocx({ json, title, page = {}, notes = false }) {
  const margin = MARGINS[page.margins] || MARGINS.normal;
  const landscape = page.orientation === 'landscape';
  const cm = commentList(json);
  current = { comments: cm.spans, ids: cm.ids, headings: 0, toc: hasToc(json), outline: headingOutline(json) };
  let children;
  try {
    children = new Converter().blocks(json?.content);
  } finally {
    current = { comments: {}, ids: new Map(), headings: 0, toc: false };
  }
  const doc = new Document({
    title: title || 'Document',
    creator: 'Work',
    ...(notes ? { keywords: NOTES_KEYWORD } : {}),
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: TOC_TITLE, name: 'Work Contents Title', basedOn: 'Normal', next: 'Normal', run: { size: 32, color: '2F5496' }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: TOC_STYLE, name: 'Work Contents', basedOn: 'Normal', next: 'Normal', paragraph: { spacing: { after: 60 } } },
      ],
    },
    ...(cm.out.length ? { comments: { children: cm.out } } : {}),
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
  const buffer = await Packer.toBuffer(doc);
  return notes ? withNotesPart(buffer, json) : buffer;
}

async function withNotesPart(buffer, json) {
  const zip = await JSZip.loadAsync(buffer);
  const body = await zip.file('word/document.xml').async('string');
  zip.file(NOTES_PART, JSON.stringify({ version: 1, documentHash: hashOf(body), doc: json }));
  const types = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="json"/.test(types)) zip.file('[Content_Types].xml', types.replace(/<Types[^>]*>/, '$&<Default Extension="json" ContentType="application/json"/>'));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// The editor copy saved with notes, when the Word text still matches it.
async function notesPart(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const part = await zip.file(NOTES_PART)?.async('string');
    if (!part) return null;
    const saved = JSON.parse(part);
    const body = await zip.file('word/document.xml').async('string');
    return saved?.doc?.type === 'doc' && saved.documentHash === hashOf(body) ? saved.doc : null;
  } catch {
    return null;
  }
}

// Pictures saved as equations come back as editable equations.
function equations(html) {
  return html.replace(/<img([^>]*?) alt="Equation: ([^"]*)"/g, '<img$1 alt="$2" title="Equation"');
}

// Runs of "☐ text" / "☑ text" paragraphs become a checklist again.
function checklists(html) {
  return html.replace(/(?:<p>[☐☑]\s?[\s\S]*?<\/p>)+/g, (run) => {
    const items = [...run.matchAll(/<p>([☐☑])\s?([\s\S]*?)<\/p>/g)].map(([, box, text]) => `<li data-type="taskItem" data-checked="${box === '☑'}"><p>${text}</p></li>`);
    return `<ul data-type="taskList">${items.join('')}</ul>`;
  });
}

async function isNotes(buffer) {
  try {
    const core = await (await JSZip.loadAsync(buffer)).file('docProps/core.xml')?.async('string');
    return new RegExp(`<cp:keywords>[^<]*${NOTES_KEYWORD}`).test(core || '');
  } catch {
    return false;
  }
}

// Word comments become comment marks: their ranges are marked in the text before conversion.
async function withCommentMarkers(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/comments.xml')?.async('string');
    if (!xml) return { buffer, comments: {} };
    const comments = readCommentsXml(xml);
    const doc = await zip.file('word/document.xml').async('string');
    zip.file('word/document.xml', markCommentRanges(doc));
    return { buffer: await zip.generateAsync({ type: 'nodebuffer' }), comments };
  } catch {
    return { buffer, comments: {} };
  }
}

const tocBack = (html) => html.replace(/(?:<p class="work-toc">[\s\S]*?<\/p>)+/g, '<div data-toc=""></div>');

async function importDocx(original) {
  const { buffer, comments } = await withCommentMarkers(original);
  const converted = await mammoth.convertToHtml({ buffer }, { styleMap: ["p[style-name='Work Contents Title'] => p.work-toc:fresh", "p[style-name='Work Contents'] => p.work-toc:fresh"] });
  const result = { ...converted, value: tocBack(applyCommentMarkers(converted.value, comments)) };
  const notes = await isNotes(original);
  const json = notes ? await notesPart(original) : null;
  return { html: equations(checklists(result.value)), ...(json ? { json } : {}), notes, warnings: result.messages.map((m) => m.message) };
}

module.exports = { exportDocx, importDocx, hex, halfPoints, boxLines, boardItems, equations };
