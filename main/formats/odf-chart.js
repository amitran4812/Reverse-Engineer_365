'use strict';

// Draws an OpenDocument chart object (chart:chart with its own data table)
// as an SVG picture. The chart is rewritten as the equivalent DrawingML
// chart part so the .pptx chart painter draws it the same way.

const { kids, kid, all, attr, esc, parseXml, Styles, cssColor } = require('./odf');
const { chartSvg } = require('./pptx-chart');

const KIND = { 'chart:bar': 'bar', 'chart:line': 'line', 'chart:area': 'area', 'chart:circle': 'pie', 'chart:ring': 'doughnut', 'chart:scatter': 'scatter', 'chart:bubble': 'scatter', 'chart:radar': 'line', 'chart:filled-radar': 'area', 'chart:stock': 'line' };

// The chart's local table as rows of cell values.
function tableRows(chart) {
  const table = kid(chart, 'table:table');
  const rows = [];
  for (const tr of all(table, 'table:table-row')) {
    const row = [];
    for (const tc of kids(tr).filter((n) => /^table:(covered-)?table-cell$/.test(n.nodeName))) {
      const v = attr(tc, 'office:value') ?? tc.textContent;
      for (let i = 0; i < Number(attr(tc, 'table:number-columns-repeated') || 1); i++) row.push(v);
    }
    rows.push(row);
  }
  return rows;
}

const colIndex = (s) => s.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// "local-table.$B$2:.$B$5" -> the values in that range, read down or across.
function range(rows, ref) {
  const cells = [...String(ref || '').matchAll(/\$?([A-Z]+)\$?(\d+)/g)].map((m) => [colIndex(m[1]), Number(m[2]) - 1]);
  if (!cells.length) return [];
  const [[c0, r0], [c1, r1] = cells[0]] = cells;
  const out = [];
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) out.push(rows[r]?.[c] ?? '');
  return out;
}

const pts = (vals, tag) => `<c:${tag}><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:${tag}>`;
const fill = (hex) => (hex ? `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>` : '');

function chartXml(doc) {
  const chart = all(doc, 'chart:chart')[0];
  if (!chart) return null;
  const styles = new Styles([doc]);
  const g = (node) => {
    const p = styles.props('chart', attr(node, 'chart:style-name'));
    return { ...p.graphic, ...(p.chart || {}), ...p.text };
  };
  const chartProps = (node) => {
    const s = styles.byKey.get(`chart:${attr(node, 'chart:style-name')}`);
    const p = kid(s, 'style:chart-properties');
    return p ? Object.fromEntries(Array.from(p.attributes).map((a) => [a.name, a.value])) : {};
  };
  const rows = tableRows(chart);
  const plot = kid(chart, 'chart:plot-area');
  const kind0 = KIND[attr(chart, 'chart:class')] || 'bar';
  const pp = chartProps(plot);
  const catAxis = all(plot, 'chart:axis').find((a) => attr(a, 'chart:dimension') === 'x');
  const catRef = attr(kid(catAxis, 'chart:categories'), 'table:cell-range-address');
  const series = kids(plot, 'chart:series');
  let cats = catRef ? range(rows, catRef) : [];
  const groups = new Map();
  for (const [i, s] of series.entries()) {
    const kind = KIND[attr(s, 'chart:class')] || kind0;
    const vals = range(rows, attr(s, 'chart:values-cell-range-address'));
    if (!cats.length) cats = rows.slice(1).map((r) => r[0] ?? '');
    const name = range(rows, attr(s, 'chart:label-cell-address'))[0] || `Series ${i + 1}`;
    const hex = cssColor(g(s)['draw:fill-color'])?.slice(1);
    const lineHex = cssColor(g(s)['svg:stroke-color'])?.slice(1);
    const points = [];
    let idx = 0;
    for (const dp of kids(s, 'chart:data-point')) {
      const n = Number(attr(dp, 'chart:repeated') || 1);
      const c = cssColor(g(dp)['draw:fill-color'])?.slice(1);
      for (let j = 0; j < n; j++, idx++) if (c && attr(dp, 'chart:style-name')) points.push(`<c:dPt><c:idx val="${idx}"/>${fill(c)}</c:dPt>`);
    }
    const color = kind === 'line' || kind === 'scatter' ? lineHex || hex : hex;
    const xml = `<c:ser><c:idx val="${i}"/><c:tx>${pts([name], 'strCache')}</c:tx>${fill(color)}${points.join('')}<c:cat>${pts(cats, 'strCache')}</c:cat><c:val>${pts(vals.map((v) => (v === '' ? '' : Number(v))), 'numCache')}</c:val></c:ser>`;
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push(xml);
  }
  if (!groups.size) return null;
  const grouping = pp['chart:percentage'] === 'true' ? 'percentStacked' : pp['chart:stacked'] === 'true' ? 'stacked' : kind0 === 'line' ? 'standard' : 'clustered';
  const tag = { bar: 'barChart', line: 'lineChart', area: 'areaChart', pie: 'pieChart', doughnut: 'doughnutChart', scatter: 'scatterChart' };
  const body = [...groups].map(([kind, sers]) => `<c:${tag[kind]}>${kind === 'bar' ? `<c:barDir val="${pp['chart:vertical'] === 'true' ? 'bar' : 'col'}"/>` : ''}<c:grouping val="${grouping}"/>${sers.join('')}</c:${tag[kind]}>`).join('');
  const titleText = all(kid(chart, 'chart:title'), 'text:p').map((p) => p.textContent).join(' ');
  const title = titleText ? `<c:title><c:tx><c:rich><a:p><a:r><a:t>${esc(titleText)}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : '<c:autoTitleDeleted val="1"/>';
  const legend = kid(chart, 'chart:legend');
  const sizeOf = (n) => n && /pt$/.test(g(n)['fo:font-size'] || '') && parseFloat(g(n)['fo:font-size']);
  const sz = sizeOf(catAxis) || sizeOf(legend) || sizeOf(chart) || 10;
  const pos = { start: 'l', end: 'r', top: 't', bottom: 'b' }[attr(legend, 'chart:legend-position')] || 'r';
  return `<c:chartSpace xmlns:c="c" xmlns:a="a"><c:txPr><a:p><a:pPr><a:defRPr sz="${Math.round(sz * 100)}"/></a:pPr></a:p></c:txPr><c:chart>${title}<c:plotArea>${body}<c:catAx/><c:valAx/></c:plotArea>${legend ? `<c:legend><c:legendPos val="${pos}"/></c:legend>` : ''}</c:chart></c:chartSpace>`;
}

// Chart object content.xml -> SVG data URL sized w x h px.
function odfChartImage(doc, w, h, pt) {
  const xml = chartXml(doc);
  if (!xml) return null;
  const accents = ['004586', 'FF420E', 'FFD320', '579D1C', '7E0021', '83CAFF', '314004', 'AECF00'].map((c) => `#${c}`);
  const svg = chartSvg(parseXml(xml), w, h, {
    color: (n) => {
      const c = n && Array.from(n.getElementsByTagName('a:srgbClr'))[0];
      return c ? `#${c.getAttribute('val')}` : undefined;
    },
    accents,
    font: 'Liberation Sans',
    text: '#000000',
    pt,
  });
  return svg ? `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` : null;
}

module.exports = { odfChartImage, chartXml };
