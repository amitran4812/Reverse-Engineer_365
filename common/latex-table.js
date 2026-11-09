'use strict';

// Tables for the LaTeX table builder: reads a tabular (inside a table float or
// not) into rows of cells, and writes rows of cells back as LaTeX.

const RULES = /\\(?:hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\}|cmidrule\s*(?:\([^)]*\))?\s*\{[^}]*\}|addlinespace(?:\[[^\]]*\])?)/g;

// Splits on a separator that isn't escaped and isn't inside braces.
function splitTop(s, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (sep === '\\\\' && s[i + 1] === '\\' && depth === 0) {
        out.push(cur);
        cur = '';
        i += 1;
        // Skip an optional [2pt] after \\.
        const m = /^\s*\[[^\]]*\]/.exec(s.slice(i + 1));
        if (m) i += m[0].length;
        continue;
      }
      cur += c + (s[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}') depth = Math.max(0, depth - 1);
    if (c === sep && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// Reads a column spec like "|l|c|p{3cm}|" into ['l', 'c', 'l'] and whether it has rules.
function readSpec(spec) {
  const align = [];
  let bars = 0;
  for (let i = 0; i < spec.length; i++) {
    const c = spec[i];
    if (c === '|') bars += 1;
    else if ('lcr'.includes(c)) align.push(c);
    else if ('pmbXS'.includes(c)) {
      align.push(c === 'S' ? 'c' : 'l');
      if (spec[i + 1] === '{') i = skipGroup(spec, i + 1);
    } else if ('@!><'.includes(c) && spec[i + 1] === '{') i = skipGroup(spec, i + 1);
    else if (c === '*' && spec[i + 1] === '{') {
      const end = skipGroup(spec, i + 1);
      const n = Number(spec.slice(i + 2, end)) || 1;
      const groupEnd = skipGroup(spec, end + 1);
      const inner = readSpec(spec.slice(end + 2, groupEnd));
      for (let k = 0; k < n; k++) align.push(...inner.align);
      bars += inner.bars * n;
      i = groupEnd;
    }
  }
  return { align, bars };
}

function skipGroup(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return s.length - 1;
}

const argAfter = (src, cmd) => {
  const m = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\])?\\s*\\{`).exec(src);
  if (!m) return '';
  const start = m.index + m[0].length - 1;
  return src.slice(start + 1, skipGroup(src, start));
};

function parseTable(src) {
  const m = /\\begin\{(tabularx?|tabular\*|longtable)\}/.exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  if (m[1] === 'tabularx' || m[1] === 'tabular*') {
    const open = src.indexOf('{', i);
    i = skipGroup(src, open) + 1;
  }
  while (/\s/.test(src[i])) i += 1;
  if (src[i] === '[') i = src.indexOf(']', i) + 1;
  while (/\s/.test(src[i])) i += 1;
  if (src[i] !== '{') return null;
  const specEnd = skipGroup(src, i);
  const spec = readSpec(src.slice(i + 1, specEnd));
  const end = src.indexOf(`\\end{${m[1]}}`, specEnd);
  const body = src.slice(specEnd + 1, end < 0 ? src.length : end);
  const booktabs = /\\(?:toprule|midrule|bottomrule)/.test(body);
  const hlines = (body.match(/\\hline/g) || []).length;
  let rows = splitTop(body.replace(/(^|[^\\])%[^\n]*/gm, '$1'), '\\\\')
    .map((r) => r.replace(RULES, '').trim())
    .filter((r, idx, all) => r || idx < all.length - 1)
    .filter((r) => r !== '')
    .map((r) => splitTop(r, '&').map((c) => c.trim()));
  const cols = Math.max(spec.align.length, ...rows.map((r) => r.length), 1);
  rows = rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
  const align = [...spec.align, ...Array(Math.max(0, cols - spec.align.length)).fill('l')].slice(0, cols);
  const placement = /\\begin\{table\*?\}\s*\[([^\]]*)\]/.exec(src)?.[1] || '';
  return {
    rows: rows.length ? rows : [Array(cols).fill('')],
    align,
    spec: spec.align.length === cols ? src.slice(i + 1, specEnd) : '',
    style: booktabs ? 'booktabs' : spec.bars || hlines > 2 ? 'grid' : 'plain',
    caption: argAfter(src, 'caption'),
    label: argAfter(src, 'label'),
    placement,
    float: /\\begin\{table\*?\}/.test(src),
    header: booktabs ? /\\midrule/.test(body) : hlines > 0,
  };
}

// Escapes characters LaTeX treats specially, for text pasted from a spreadsheet.
function escapeCell(s) {
  return String(s)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// Rows from text copied out of a spreadsheet (tab separated) or a CSV file.
function parsePasted(text) {
  const t = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const sep = t.includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

// spec, when given, is an original column spec to keep (such as p{3cm} widths).
function makeTable({ rows, align, style = 'booktabs', header = true, caption = '', label = '', placement = 'htbp', float = true, spec: keep = '' }) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const al = Array.from({ length: cols }, (_, i) => align?.[i] || 'l');
  const spec = keep || (style === 'grid' ? `|${al.join('|')}|` : al.join(''));
  const ind = float ? '\t' : '';
  const line = (r) => `${ind}\t${Array.from({ length: cols }, (_, i) => r[i] ?? '').join(' & ')} \\\\`;
  const out = [];
  if (float) out.push(`\\begin{table}${placement ? `[${placement}]` : ''}`, '\t\\centering');
  out.push(`${ind}\\begin{tabular}{${spec}}`);
  if (style === 'booktabs') out.push(`${ind}\t\\toprule`);
  if (style === 'grid') out.push(`${ind}\t\\hline`);
  rows.forEach((r, i) => {
    out.push(line(r));
    if (style === 'grid') out.push(`${ind}\t\\hline`);
    else if (style === 'booktabs' && header && i === 0 && rows.length > 1) out.push(`${ind}\t\\midrule`);
    else if (style === 'plain' && header && i === 0 && rows.length > 1) out.push(`${ind}\t\\hline`);
  });
  if (style === 'booktabs') out.push(`${ind}\t\\bottomrule`);
  out.push(`${ind}\\end{tabular}`);
  if (float) {
    if (caption) out.push(`\t\\caption{${caption}}`);
    if (label) out.push(`\t\\label{${label}}`);
    out.push('\\end{table}');
  }
  return `${out.join('\n')}\n`;
}

// The table or tabular around a position, as { from, to, text }.
function tableAround(text, pos) {
  for (const env of ['table\\*?', 'tabularx', 'tabular\\*?', 'longtable']) {
    const re = new RegExp(`\\\\begin\\{(${env})\\}`, 'g');
    let best = null;
    for (const m of text.matchAll(re)) {
      if (m.index > pos) break;
      const close = `\\end{${m[1]}}`;
      const end = text.indexOf(close, m.index);
      if (end >= 0 && end + close.length >= pos) best = { from: m.index, to: end + close.length };
    }
    if (best) return { ...best, text: text.slice(best.from, best.to) };
  }
  return null;
}

module.exports = { parseTable, makeTable, parsePasted, escapeCell, tableAround, splitTop };
