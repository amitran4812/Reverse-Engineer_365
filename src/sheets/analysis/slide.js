// Lays out one Present slide from Plot's charts and an optional table, on
// Present's 960 x 540 canvas. The workspace renders each chart at the size
// planSlide gives it, then buildSlide turns the pictures into slide elements.

export const SLIDE_W = 960;
export const SLIDE_H = 540;
const PAD = 36;
const TOP = 84;
const BOTTOM = 520;
const GAP = 14;
const CAPTION = 26;
const ROW = 1.9; // table row height in font sizes

let seq = 0;
const nid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Columns and rows that give n charts of roughly this aspect the most room.
export function gridFor(n, w, h, aspect = 1.6) {
  let best = { cols: 1, rows: n, area: -1 };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cw = (w - GAP * (cols - 1)) / cols;
    const ch = (h - GAP * (rows - 1)) / rows - CAPTION;
    if (cw <= 0 || ch <= 0) continue;
    const fw = Math.min(cw, ch * aspect);
    const area = fw * (fw / aspect) - (cols * rows - n) * 1e-3;
    if (area > best.area) best = { cols, rows, area };
  }
  return { cols: best.cols, rows: best.rows };
}

// Where the title, each chart and the table go.
export function planSlide({ count, table = null }) {
  const area = { x: PAD, y: TOP, w: SLIDE_W - PAD * 2, h: BOTTOM - TOP };
  let charts = area;
  let tableBox = null;
  if (table) {
    const lines = table.rows.length + 1;
    if (!count) {
      const fontSize = clamp(Math.floor(area.h / (lines * ROW)), 9, 18);
      tableBox = { ...area, h: Math.min(area.h, Math.ceil(lines * fontSize * ROW)), fontSize };
    } else if (table.columns.length <= 4 && count <= 4) {
      const w = Math.round(area.w * 0.36);
      const fontSize = clamp(Math.floor(area.h / (lines * ROW)), 9, 15);
      tableBox = { x: area.x + area.w - w, y: area.y, w, h: Math.min(area.h, Math.ceil(lines * fontSize * ROW)), fontSize };
      charts = { ...area, w: area.w - w - GAP * 2 };
    } else {
      const maxH = Math.round(area.h * 0.42);
      const fontSize = clamp(Math.floor(maxH / (lines * ROW)), 8, 14);
      const h = Math.min(maxH, Math.ceil(lines * fontSize * ROW));
      tableBox = { x: area.x, y: area.y + area.h - h, w: area.w, h, fontSize };
      charts = { ...area, h: area.h - h - GAP };
    }
  }
  const cells = [];
  if (count) {
    const { cols, rows } = gridFor(count, charts.w, charts.h);
    const cw = (charts.w - GAP * (cols - 1)) / cols;
    const ch = (charts.h - GAP * (rows - 1)) / rows;
    for (let i = 0; i < count; i += 1) {
      const r = Math.floor(i / cols);
      // The last row is centred when it isn't full.
      const inRow = r === rows - 1 ? count - r * cols : cols;
      const offset = ((cols - inRow) * (cw + GAP)) / 2;
      const x = charts.x + offset + (i % cols) * (cw + GAP);
      const y = charts.y + r * (ch + GAP);
      cells.push({ x: Math.round(x), y: Math.round(y), w: Math.round(cw), h: Math.round(ch), image: { w: Math.round(cw), h: Math.round(ch - CAPTION) } });
    }
  }
  return { title: { x: PAD, y: 18, w: SLIDE_W - PAD * 2, h: 56 }, cells, table: tableBox };
}

// The slide in Present's model. charts: [{ src, caption }] in plan order.
export function buildSlide({ title, plan, charts, table = null }) {
  const elements = [
    { id: nid(), type: 'text', role: 'title', ...plan.title, html: esc(title), placeholder: 'Click to add title', style: { fontSize: 30, align: 'left' } },
  ];
  charts.forEach((c, i) => {
    const cell = plan.cells[i];
    if (!cell) return;
    if (c.caption) elements.push({ id: nid(), type: 'text', x: cell.x, y: cell.y, w: cell.w, h: CAPTION, html: esc(c.caption), style: { fontSize: 13, align: 'center', bold: true } });
    elements.push({ id: nid(), type: 'image', src: c.src, x: cell.x, y: cell.y + CAPTION, w: cell.image.w, h: cell.image.h });
  });
  if (table && plan.table) {
    const { fontSize, ...box } = plan.table;
    elements.push({ id: nid(), type: 'table', ...box, header: true, rows: [table.columns, ...table.rows], style: { fontSize } });
  }
  return { id: nid(), layout: 'blank', notes: '', elements };
}
