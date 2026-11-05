'use strict';

// Plain helpers for projects: what kind a file is, which files a folder walk
// skips, and how a project's text budget is shared between its files.

const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const TEXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'tab', 'json', 'html', 'htm', 'xml', 'log', 'rtf', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'tex', 'bib', 'sty', 'cls', 'bst', 'bbx', 'cbx', 'ltx', 'dtx', 'ins', 'rmd', 'qmd', 'org', 'rst',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'r', 'm', 'jl', 'c', 'h', 'cpp', 'hpp', 'cc', 'java', 'kt', 'rs', 'go', 'rb', 'php', 'swift',
  'cs', 'sh', 'bat', 'ps1', 'sql', 'css', 'scss', 'svg', 'ipynb', 'do', 'sas', 'f90', 'f',
]);
const KINDS = {
  pdf: 'pdf', docx: 'document', odt: 'document', xlsx: 'spreadsheet', xlsm: 'spreadsheet', xls: 'spreadsheet', ods: 'spreadsheet',
  pptx: 'presentation', odp: 'presentation', reaslides: 'presentation', workplot: 'spreadsheet',
};
const BUILD = /\.(aux|log|synctex(\.gz)?|fls|fdb_latexmk|out|toc|lof|lot|bbl|blg|bcf|run\.xml|nav|snm|vrb|xdv|dvi|idx|ilg|ind|exe|dll|so|dylib|o|obj|pyc|class|lock|DS_Store)$/i;

// About 4 characters a token: 600k ≈ 150k tokens; the large setting is for 1M-token models.
const BUDGET = 600000;
const BUDGET_LARGE = 2400000;

function kindOf(ext) {
  ext = String(ext || '').toLowerCase();
  if (IMAGE[ext]) return 'image';
  if (KINDS[ext]) return KINDS[ext];
  if (TEXT.has(ext)) return ext === 'tex' || ext === 'bib' || ext === 'sty' || ext === 'cls' ? 'latex' : 'text';
  return 'other';
}

const isBuildOutput = (name) => BUILD.test(name) || /^(Thumbs\.db|desktop\.ini)$/i.test(name);

// Splits budget between texts of the given lengths: short texts go in whole,
// the rest share what's left equally.
function share(lengths, budget) {
  const out = new Array(lengths.length).fill(0);
  const order = lengths.map((n, i) => i).sort((a, b) => lengths[a] - lengths[b]);
  let left = budget;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const fair = Math.floor(left / (order.length - k));
    out[i] = Math.min(lengths[i], fair);
    left -= out[i];
  }
  return out;
}

function size(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const attr = (s) => String(s || '').replace(/["<>]/g, "'");

// Text from an XML part (Office Open XML or OpenDocument): paragraphs on lines.
function xmlText(xml) {
  return String(xml)
    .replace(/<(a:p|w:p|text:p|text:h|table:table-row)[\s>][^]*?<\/\1>/g, (m) => `${m}\n`)
    .replace(/<(a:br|w:br|text:line-break|text:tab|w:tab|table:table-cell)\b[^>]*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Readable strings from a JSON document (a Present deck or a Plot workspace), skipping pictures.
function jsonStrings(value, out = [], depth = 0) {
  if (out.length > 20000 || depth > 40) return out;
  if (typeof value === 'string') {
    if (value.length > 1 && value.length < 20000 && !/^data:/.test(value) && !/^#?[0-9a-f]{3,8}$/i.test(value)) out.push(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  } else if (Array.isArray(value)) {
    for (const v of value) jsonStrings(v, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) jsonStrings(v, out, depth + 1);
  }
  return out.filter(Boolean);
}

module.exports = { IMAGE, BUDGET, BUDGET_LARGE, kindOf, isBuildOutput, share, size, attr, xmlText, jsonStrings };
