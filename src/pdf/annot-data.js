// Plain helpers for Read's annotations: colours, rectangles, text-to-markdown
// and table guesses. No DOM or pdf.js here, so the tests can load it.
//
// Annotation geometry is kept in PDF user space (points, origin bottom-left):
//   highlight | underline | strike  { rects: [[x0, y0, x1, y1]…] }
//   ink                             { paths: [[x, y, x, y…]…], width }
//   rect | ellipse                  { rect: [x0, y0, x1, y1], width, fill }
//   line | arrow                    { line: [x1, y1, x2, y2], width }
//   note (sticky note)              { at: [x, y] }  top-left corner
//   text (text box)                 { rect, text, size, rot }  rot: page turn when placed
//   image (signature, stamp)        { rect, src, rot }  drawn into the page on save
// Every annotation also has id, type, page (0-based), color, opacity, note,
// author and modified.

export const MARKUPS = ['highlight', 'underline', 'strike'];
export const RECT_TYPES = ['rect', 'ellipse', 'text', 'image'];

export const TYPE_LABELS = {
  highlight: 'Highlight',
  underline: 'Underline',
  strike: 'Strikethrough',
  ink: 'Drawing',
  rect: 'Rectangle',
  ellipse: 'Oval',
  line: 'Line',
  arrow: 'Arrow',
  note: 'Sticky note',
  text: 'Text box',
  image: 'Signature or picture',
};

let seq = 0;
export const newId = () => `work-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(c) {
  if (!Array.isArray(c) || !c.length) return '#000000';
  // One number is grey, four are CMYK.
  let [r, g, b] = c;
  if (c.length === 1) r = g = b = c[0];
  if (c.length === 4) {
    const k = c[3];
    [r, g, b] = [(1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k)];
  }
  const to = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function normRect([x0, y0, x1, y1]) {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

// Joins the boxes a text selection gives (one per span) into one box per line.
export function mergeLineRects(rects) {
  const list = rects.map(normRect).filter((r) => r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5).sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  const out = [];
  for (const r of list) {
    const h = r[3] - r[1];
    const line = out.find((o) => {
      const oh = o[3] - o[1];
      const overlap = Math.min(o[3], r[3]) - Math.max(o[1], r[1]);
      return overlap > 0.6 * Math.min(h, oh) && r[0] <= o[2] + Math.max(h, oh) * 0.6 && r[2] >= o[0] - Math.max(h, oh) * 0.6;
    });
    if (line) {
      line[0] = Math.min(line[0], r[0]);
      line[1] = Math.min(line[1], r[1]);
      line[2] = Math.max(line[2], r[2]);
      line[3] = Math.max(line[3], r[3]);
    } else {
      out.push([...r]);
    }
  }
  return out;
}

// QuadPoints in the order other readers write them: top-left, top-right,
// bottom-left, bottom-right.
export function rectsToQuads(rects) {
  return rects.flatMap(([x0, y0, x1, y1]) => [x0, y1, x1, y1, x0, y0, x1, y0]);
}

export function quadsToRects(q) {
  const out = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
    const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return out;
}

// The box around an annotation, in user space.
export function bounds(a) {
  const pad = (r, p) => [r[0] - p, r[1] - p, r[2] + p, r[3] + p];
  switch (a.type) {
    case 'highlight':
    case 'underline':
    case 'strike': {
      const r = a.rects;
      return [Math.min(...r.map((x) => x[0])), Math.min(...r.map((x) => x[1])), Math.max(...r.map((x) => x[2])), Math.max(...r.map((x) => x[3]))];
    }
    case 'ink': {
      const xs = a.paths.flatMap((p) => p.filter((_, i) => i % 2 === 0));
      const ys = a.paths.flatMap((p) => p.filter((_, i) => i % 2 === 1));
      return pad([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (a.width || 1) / 2 + 1);
    }
    case 'line':
    case 'arrow':
      return pad(normRect(a.line), (a.width || 1) * 3 + 2);
    case 'note':
      return [a.at[0], a.at[1] - 20, a.at[0] + 20, a.at[1]];
    default:
      return pad(normRect(a.rect), a.type === 'rect' || a.type === 'ellipse' ? (a.width || 1) / 2 : 0);
  }
}

export function moveAnnot(a, dx, dy) {
  const shift = (arr) => arr.map((v, i) => v + (i % 2 ? dy : dx));
  const b = { ...a };
  if (a.rects) b.rects = a.rects.map(shift);
  if (a.paths) b.paths = a.paths.map(shift);
  if (a.rect) b.rect = shift(a.rect);
  if (a.line) b.line = shift(a.line);
  if (a.at) b.at = shift(a.at);
  return b;
}

// Simple smoothing so pen strokes don't look jagged: drops points closer than
// `min` to the last kept one.
export function thinPath(points, min = 0.8) {
  const out = points.slice(0, 2);
  for (let i = 2; i + 1 < points.length; i += 2) {
    const dx = points[i] - out[out.length - 2];
    const dy = points[i + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= min * min) out.push(points[i], points[i + 1]);
  }
  if (points.length > 2 && (out[out.length - 2] !== points[points.length - 2] || out[out.length - 1] !== points[points.length - 1])) out.push(points[points.length - 2], points[points.length - 1]);
  return out;
}

// Splits text into lines that fit `width`, measuring with `measure(str)`.
export function wrapText(text, width, measure) {
  const lines = [];
  for (const para of String(text || '').split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && measure(next.trimEnd()) > width) {
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

// --- Text layout from pdf.js text content --------------------------------

// Groups text items ({ str, x, y, w, h }) into lines, top to bottom.
export function textLines(items) {
  const sorted = items.filter((i) => i.str && i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.h, it.h) * 0.45));
    if (line) {
      line.items.push(it);
      line.h = Math.max(line.h, it.h);
    } else {
      lines.push({ y: it.y, h: it.h, items: [it] });
    }
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x = l.items[0].x;
    let text = '';
    let end = null;
    for (const it of l.items) {
      if (end != null && it.x - end > it.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      text += it.str;
      end = it.x + it.w;
    }
    l.text = text.replace(/\s+/g, ' ').trim();
  }
  return lines.sort((a, b) => b.y - a.y);
}

const md = (s) => s.replace(/([\\`*_[\]#<>])/g, '\\$1');

// Markdown for a page's lines: bigger text becomes headings, lines close
// together join into paragraphs, and bullet characters become lists.
export function pagesToMarkdown(pages) {
  const all = pages.flat();
  const sizes = all.map((l) => l.h).sort((a, b) => a - b);
  const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10;
  const out = [];
  for (const lines of pages) {
    let para = [];
    let table = [];
    const flush = () => {
      if (para.length) out.push(para.join(' ').replace(/(\w)- (\w)/g, '$1$2'));
      para = [];
    };
    const flushTable = () => {
      if (table.length >= 2) {
        const grid = linesToTable(table);
        const width = Math.max(...grid.map((r) => r.length));
        const row = (r) => `| ${Array.from({ length: width }, (_, i) => md(r[i] || '').replace(/\|/g, '\\|')).join(' | ')} |`;
        out.push([row(grid[0]), `|${' --- |'.repeat(width)}`, ...grid.slice(1).map(row)].join('\n'));
      } else if (table.length) {
        para.push(md(table[0].text));
      }
      table = [];
    };
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const gap = prev ? prev.y - l.y : 0;
      if (cellCount(l) >= 2) {
        if (!table.length) flush();
        table.push(l);
        return;
      }
      flushTable();
      if (l.h >= body * 1.5 && l.text.length < 120) {
        flush();
        out.push(`${l.h >= body * 2 ? '#' : '##'} ${md(l.text)}`);
        return;
      }
      if (l.h >= body * 1.25 && l.text.length < 100) {
        flush();
        out.push(`### ${md(l.text)}`);
        return;
      }
      const bullet = /^[•●▪◦‣\-–*]\s*(.+)$/.exec(l.text);
      if (bullet) {
        flush();
        out.push(`- ${md(bullet[1])}`);
        return;
      }
      if (prev && gap > Math.max(l.h, prev.h) * 1.7) flush();
      para.push(md(l.text));
    });
    flushTable();
    flush();
  }
  return out.join('\n\n');
}

// How many separate cells a line's text falls into (wide gaps split cells).
function cellCount(line) {
  let n = 0;
  let end = null;
  for (const it of line.items) {
    if (end == null || it.x - end > Math.max(8, it.h * 1.5)) n += 1;
    end = it.x + it.w;
  }
  return n;
}

// Rows and columns guessed from where text sits: items on one line are cells,
// and column edges come from x positions that line up across lines.
export function linesToTable(lines) {
  const rows = lines.map((l) => {
    const cells = [];
    let cur = null;
    for (const it of l.items) {
      if (cur && it.x - (cur.x + cur.w) < Math.max(3, it.h * 0.9)) {
        cur.str += (it.x - (cur.x + cur.w) > it.h * 0.15 ? ' ' : '') + it.str;
        cur.w = it.x + it.w - cur.x;
      } else {
        cur = { x: it.x, w: it.w, str: it.str };
        cells.push(cur);
      }
    }
    return cells.map((c) => ({ x: c.x, text: c.str.trim() })).filter((c) => c.text);
  }).filter((r) => r.length);
  const starts = [];
  for (const r of rows) {
    for (const c of r) {
      const near = starts.find((s) => Math.abs(s.x - c.x) < 12);
      if (near) near.n += 1;
      else starts.push({ x: c.x, n: 1 });
    }
  }
  const cols = starts.filter((s) => s.n >= Math.max(2, rows.length * 0.2)).map((s) => s.x).sort((a, b) => a - b);
  if (!cols.length) return rows.map((r) => r.map((c) => c.text));
  return rows.map((r) => {
    const out = new Array(cols.length).fill('');
    for (const c of r) {
      let k = 0;
      for (let j = 0; j < cols.length; j++) if (c.x >= cols[j] - 12) k = j;
      out[k] = out[k] ? `${out[k]} ${c.text}` : c.text;
    }
    return out;
  });
}

// --- Paper details for references ----------------------------------------

export function findDoi(text) {
  const m = /\b(10\.\d{4,9}\/[^\s"<>]+)/i.exec(text || '');
  return m ? m[1].replace(/[.,;)\]]+$/, '') : null;
}

export function findArxiv(text) {
  const m = /arXiv:\s*(\d{4}\.\d{4,5}(v\d+)?|[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?)/i.exec(text || '');
  return m ? m[1] : null;
}
