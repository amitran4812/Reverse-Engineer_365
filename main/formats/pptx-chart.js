'use strict';

// Draws a chart part (c:chartSpace) from its cached values as an SVG picture:
// column, bar, line, area, scatter, pie and doughnut, with title, axes,
// gridlines and legend.

const local = (n) => n.localName || n.nodeName.replace(/^.*:/, '');
const kids = (node, name) => (node ? Array.from(node.childNodes || []).filter((n) => n.nodeType === 1 && (!name || local(n) === name)) : []);
const kid = (node, ...names) => names.reduce((n, name) => kids(n, name)[0], node);
const desc = (node, name) => (node ? Array.from(node.getElementsByTagName('*')).filter((n) => local(n) === name) : []);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = (n) => Math.round(n * 10) / 10;

function cache(ref) {
  const c = desc(ref, 'strCache')[0] || desc(ref, 'numCache')[0];
  if (c) {
    const out = [];
    for (const p of kids(c, 'pt')) out[Number(p.getAttribute('idx'))] = kid(p, 'v')?.textContent ?? '';
    return Array.from(out, (v) => v ?? '');
  }
  const lit = desc(ref, 'v');
  return lit.map((v) => v.textContent);
}

function niceStep(range) {
  const raw = range / 5 || 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
}

const fmt = (v) => (Math.abs(v) >= 1000 ? v.toLocaleString('en-US') : String(Math.round(v * 100) / 100));

function chartSvg(doc, w, h, theme) {
  const plot = desc(doc, 'plotArea')[0];
  if (!plot) return null;
  const types = kids(plot).filter((n) => /Chart$/.test(local(n)));
  if (!types.length) return null;
  const baseSz = Number(kids(doc.documentElement, 'txPr').flatMap((t) => desc(t, 'defRPr'))[0]?.getAttribute('sz') || 1000) / 100;
  const fontPx = Math.max(8, Math.round(baseSz * theme.pt * 0.9));
  const series = [];
  for (const t of types) {
    const kind = local(t).replace(/3D/, '').replace(/Chart$/, '');
    for (const s of kids(t, 'ser')) {
      const color = theme.color(kid(s, 'spPr', 'solidFill')) || theme.color(kid(s, 'spPr', 'ln', 'solidFill'));
      series.push({
        kind,
        dir: kid(t, 'barDir')?.getAttribute('val') || 'col',
        grouping: kid(t, 'grouping')?.getAttribute('val') || 'clustered',
        hole: kind === 'doughnut' ? Number(kid(t, 'holeSize')?.getAttribute('val') || 50) / 100 : 0,
        name: cache(kid(s, 'tx')).join(' ') || `Series ${series.length + 1}`,
        cats: cache(kid(s, 'cat') || kid(s, 'xVal')),
        vals: cache(kid(s, 'val') || kid(s, 'yVal')).map(Number),
        color,
        points: kids(s, 'dPt').map((d) => ({ i: Number(kid(d, 'idx')?.getAttribute('val')), color: theme.color(kid(d, 'spPr', 'solidFill')) })),
      });
    }
  }
  if (!series.length) return null;
  series.forEach((s, i) => { s.color ||= theme.accents[i % theme.accents.length]; });
  const out = [];
  const text = (x, y, s, anchor = 'middle', size = fontPx, extra = '') => out.push(`<text x="${r1(x)}" y="${r1(y)}" text-anchor="${anchor}" font-size="${size}"${extra}>${esc(s)}</text>`);
  let top = 6;
  const titleNode = kid(desc(doc, 'chart')[0], 'title');
  const deleted = desc(doc, 'autoTitleDeleted')[0]?.getAttribute('val') === '1';
  const title = (titleNode && desc(titleNode, 't').map((t) => t.textContent).join('')) || ((titleNode || !deleted) && series.length === 1 ? series[0].name : '');
  if (title) {
    text(w / 2, top + fontPx * 1.2, title, 'middle', Math.round(fontPx * 1.2), ' font-weight="700"');
    top += fontPx * 2;
  }
  const pie = ['pie', 'doughnut', 'ofPie'].includes(series[0].kind);
  const legend = !!desc(doc, 'legend')[0];
  const legendItems = pie ? series[0].cats.map((c, i) => ({ name: c, color: series[0].points.find((p) => p.i === i)?.color || theme.accents[i % theme.accents.length] })) : series.map((s) => ({ name: s.name, color: s.color }));
  let bottom = h - 6;
  let right = w;
  const legendPos = desc(doc, 'legendPos')[0]?.getAttribute('val') || 'r';
  if (legend && legendPos === 'r') {
    const lw = Math.max(...legendItems.map((l) => String(l.name).length)) * fontPx * 0.55 + fontPx * 2;
    right = w - lw - 6;
    const y0 = (top + bottom) / 2 - (legendItems.length * fontPx * 1.5) / 2;
    legendItems.forEach((l, i) => {
      const y = y0 + i * fontPx * 1.5;
      out.push(`<rect x="${r1(right + 8)}" y="${r1(y + fontPx * 0.2)}" width="${r1(fontPx * 0.8)}" height="${r1(fontPx * 0.8)}" fill="${l.color}"/>`);
      text(right + 8 + fontPx * 1.1, y + fontPx * 0.95, l.name, 'start');
    });
  } else if (legend) {
    bottom -= fontPx * 1.8;
    const widths = legendItems.map((l) => String(l.name).length * fontPx * 0.55 + fontPx * 1.8);
    let x = (w - widths.reduce((a, b) => a + b, 0)) / 2;
    legendItems.forEach((l, i) => {
      out.push(`<rect x="${r1(x)}" y="${r1(bottom + fontPx * 0.5)}" width="${r1(fontPx * 0.8)}" height="${r1(fontPx * 0.8)}" fill="${l.color}"/>`);
      text(x + fontPx * 1.1, bottom + fontPx * 1.25, l.name, 'start');
      x += widths[i];
    });
  }
  if (pie) {
    const s = series[0];
    const total = s.vals.reduce((a, b) => a + (b > 0 ? b : 0), 0) || 1;
    const R = Math.max(10, Math.min(right - 20, bottom - top - 10) / 2);
    const cx = right / 2;
    const cy = (top + bottom) / 2;
    let a = -Math.PI / 2;
    s.vals.forEach((v, i) => {
      if (!(v > 0)) return;
      const b = a + (v / total) * Math.PI * 2;
      const color = s.points.find((p) => p.i === i)?.color || theme.accents[i % theme.accents.length];
      const large = b - a > Math.PI ? 1 : 0;
      const p = (ang, r) => `${r1(cx + r * Math.cos(ang))},${r1(cy + r * Math.sin(ang))}`;
      const d = v === total ? `M${cx - R},${cy}A${R},${R} 0 1 1 ${cx + R},${cy}A${R},${R} 0 1 1 ${cx - R},${cy}Z` : `M${cx},${cy}L${p(a, R)}A${R},${R} 0 ${large} 1 ${p(b, R)}Z`;
      out.push(`<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1"/>`);
      a = b;
    });
    if (s.hole) out.push(`<circle cx="${cx}" cy="${cy}" r="${r1(R * s.hole)}" fill="#fff"/>`);
  } else {
    const cats = series.reduce((m, s) => (s.cats.length > m.length ? s.cats : m), []);
    const n = Math.max(cats.length, ...series.map((s) => s.vals.length));
    const stacked = series.some((s) => /stacked/i.test(s.grouping));
    const percent = series.some((s) => s.grouping === 'percentStacked');
    const sums = Array.from({ length: n }, (_, i) => series.reduce((a, s) => a + (s.vals[i] || 0), 0));
    let vals = series.map((s) => s.vals);
    if (percent) vals = vals.map((v) => v.map((x, i) => (sums[i] ? (x / sums[i]) * 100 : 0)));
    const tops = stacked ? Array.from({ length: n }, (_, i) => vals.reduce((a, v) => a + Math.max(0, v[i] || 0), 0)) : vals.flat();
    let max = Math.max(0, ...tops.filter(Number.isFinite));
    const min = Math.min(0, ...vals.flat().filter(Number.isFinite));
    if (max === min) max = min + 1;
    const step = niceStep(max - min);
    const hi = Math.ceil(max / step) * step;
    const lo = Math.floor(min / step) * step;
    const horiz = series[0].kind === 'bar' && series[0].dir === 'bar';
    const labelW = Math.max(...[hi, lo].map((v) => fmt(v).length)) * fontPx * 0.6 + 8;
    const catW = horiz ? Math.min(w * 0.3, Math.max(...cats.map((c) => String(c).length)) * fontPx * 0.55 + 8) : 0;
    const L = horiz ? catW : labelW;
    const B = bottom - fontPx * 1.6;
    const T = top + 4;
    const R = right - 10;
    const scale = (v) => (horiz ? L + ((v - lo) / (hi - lo)) * (R - L) : B - ((v - lo) / (hi - lo)) * (B - T));
    for (let v = lo; v <= hi + step / 2; v += step) {
      const p = scale(v);
      out.push(horiz ? `<line x1="${r1(p)}" y1="${T}" x2="${r1(p)}" y2="${r1(B)}" stroke="#d9d9d9"/>` : `<line x1="${r1(L)}" y1="${r1(p)}" x2="${R}" y2="${r1(p)}" stroke="#d9d9d9"/>`);
      if (horiz) text(p, B + fontPx * 1.2, fmt(v));
      else text(L - 4, p + fontPx * 0.35, fmt(v), 'end');
    }
    const band = ((horiz ? B - T : R - L) / Math.max(1, n));
    cats.forEach((c, i) => {
      const mid = (horiz ? T : L) + band * (i + 0.5);
      if (horiz) text(L - 4, mid + fontPx * 0.35, c, 'end');
      else if (i % Math.ceil((n * String(c).length * fontPx * 0.55) / (R - L) || 1) === 0) text(mid, B + fontPx * 1.2, c);
    });
    const bars = series.map((s, i) => ({ s, i })).filter((x) => x.s.kind === 'bar');
    const base = Array.from({ length: n }, () => 0);
    bars.forEach(({ s, i }, j) => {
      const gap = band * 0.2;
      const bw = stacked ? band - gap * 2 : (band - gap * 2) / bars.length;
      vals[i].forEach((v, k) => {
        if (!Number.isFinite(v)) return;
        const start = stacked ? base[k] : 0;
        const end = start + v;
        if (stacked) base[k] = end;
        const pos = (horiz ? T : L) + band * k + gap + (stacked ? 0 : j * bw);
        const a = scale(start);
        const b = scale(end);
        const color = s.points.find((p) => p.i === k)?.color || s.color;
        out.push(horiz
          ? `<rect x="${r1(Math.min(a, b))}" y="${r1(pos)}" width="${r1(Math.abs(b - a))}" height="${r1(bw)}" fill="${color}"/>`
          : `<rect x="${r1(pos)}" y="${r1(Math.min(a, b))}" width="${r1(bw)}" height="${r1(Math.abs(b - a))}" fill="${color}"/>`);
      });
    });
    const acc = Array.from({ length: n }, () => 0);
    series.forEach((s, i) => {
      if (s.kind === 'bar') return;
      const pts = vals[i].map((v, k) => {
        const y = stacked ? (acc[k] += v || 0) : v;
        return Number.isFinite(y) ? [L + band * (k + 0.5), scale(y)] : null;
      }).filter(Boolean);
      if (!pts.length) return;
      const d = `M${pts.map((p) => p.map(r1).join(',')).join('L')}`;
      if (s.kind === 'area') out.push(`<path d="${d}L${r1(pts[pts.length - 1][0])},${r1(scale(0))}L${r1(pts[0][0])},${r1(scale(0))}Z" fill="${s.color}" fill-opacity=".85"/>`);
      else if (s.kind === 'scatter') pts.forEach((p) => out.push(`<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="3" fill="${s.color}"/>`));
      else out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round"/>`);
    });
    out.push(horiz ? `<line x1="${r1(L)}" y1="${T}" x2="${r1(L)}" y2="${r1(B)}" stroke="#bfbfbf"/>` : `<line x1="${r1(L)}" y1="${r1(scale(0))}" x2="${R}" y2="${r1(scale(0))}" stroke="#bfbfbf"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(w)}" height="${r1(h)}" viewBox="0 0 ${r1(w)} ${r1(h)}" font-family="${esc(theme.font)}, sans-serif" fill="${theme.text}">${out.join('')}</svg>`;
}

module.exports = { chartSvg };
