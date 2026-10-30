// Plain helpers for Write's notes mode: the chart spec the AI fills in, and
// tidying what comes back so the chart drawing never has to guess.

export const CHART_TYPES = ['bar', 'line', 'area', 'scatter', 'pie'];

// JSON schema for "insert a plot". Every field is required (strict mode);
// x_values is empty when the x axis is categories.
export const CHART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'type', 'x_label', 'y_label', 'labels', 'x_values', 'series'],
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: CHART_TYPES },
    x_label: { type: 'string' },
    y_label: { type: 'string' },
    labels: { type: 'array', items: { type: 'string' } },
    x_values: { type: 'array', items: { type: 'number' } },
    series: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'values'],
        properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } },
      },
    },
  },
};

// JSON schema for a picture drawn as SVG, for AIs without an image model.
export const SVG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'svg'],
  properties: { title: { type: 'string' }, svg: { type: 'string' } },
};

const num = (v) => (typeof v === 'number' ? v : Number.parseFloat(v));

// Cleans an AI chart spec: drops non-numbers, lines series up with the
// labels or x values, and caps sizes. Returns null when nothing is plottable.
export function normalizeChart(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = CHART_TYPES.includes(raw.type) ? raw.type : 'bar';
  let series = (Array.isArray(raw.series) ? raw.series : [])
    .map((s, i) => ({ name: String(s?.name || `Series ${i + 1}`).slice(0, 60), values: (Array.isArray(s?.values) ? s.values : []).map(num).slice(0, 5000) }))
    .filter((s) => s.values.some(Number.isFinite))
    .slice(0, 12);
  if (!series.length) return null;
  const n = Math.max(...series.map((s) => s.values.length));
  const xv = (Array.isArray(raw.x_values) ? raw.x_values : []).map(num);
  const numericX = xv.length >= n && xv.slice(0, n).every(Number.isFinite) && type !== 'bar' && type !== 'pie';
  let labels = (Array.isArray(raw.labels) ? raw.labels : []).map((l) => String(l ?? '').slice(0, 40)).slice(0, n);
  while (labels.length < n) labels.push(numericX ? String(xv[labels.length]) : String(labels.length + 1));
  if (type === 'pie') series = [series[0]];
  return {
    title: String(raw.title || '').slice(0, 120),
    type,
    xLabel: String(raw.x_label || '').slice(0, 60),
    yLabel: String(raw.y_label || '').slice(0, 60),
    labels,
    x: numericX ? xv.slice(0, n) : null,
    series: series.map((s) => ({ ...s, values: Array.from({ length: n }, (_, i) => (Number.isFinite(s.values[i]) ? s.values[i] : NaN)) })),
  };
}

// Keeps only a safe, self-contained SVG: no scripts, event handlers or
// outside references, and a viewBox so it scales.
export function cleanSvg(text) {
  const m = /<svg[\s\S]*<\/svg>/i.exec(String(text || ''));
  if (!m) return null;
  let svg = m[0]
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '');
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return svg;
}

// The width and height an SVG asks for, from width/height or its viewBox.
export function svgSize(svg, fallback = { width: 800, height: 600 }) {
  const open = /<svg[^>]*>/i.exec(svg)?.[0] || '';
  const attr = (name) => num(new RegExp(`\\s${name}\\s*=\\s*["']?([\\d.]+)`, 'i').exec(open)?.[1]);
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(open);
  const width = attr('width') || num(vb?.[1]);
  const height = attr('height') || num(vb?.[2]);
  return width > 0 && height > 0 ? { width, height } : fallback;
}

// Web links in a piece of text, in order, without repeats.
export function findLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

// "/" menu filtering: items whose label or keywords start with the query.
export function matchCommands(items, query) {
  const q = String(query || '').toLowerCase();
  if (!q) return items;
  return items.filter((it) => [it.label, ...(it.keys || [])].some((k) => k.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || k.toLowerCase().startsWith(q)));
}
