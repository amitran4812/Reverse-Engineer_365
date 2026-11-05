// Plain helpers for Plot's conditional formatting and header filters (tested in test/grid-rules.test.mjs).
// A rule: { ref: 'B2:B40', kind, a?, b?, text?, n?, color? }
//   kind: gt | lt | between | eq | text | dup | unique | top | bottom | above | below | scale | bars
// A filter: { ref: 'A1:D40', hide: { [colIndex]: [shown text, …] } }, where ref's first row holds the headers.

import cellref from '../../common/cellref.js';

const { parseRef, refName } = cellref;

export const RULE_KINDS = [
  { value: 'gt', label: 'Greater than', args: 1 },
  { value: 'lt', label: 'Less than', args: 1 },
  { value: 'between', label: 'Between', args: 2 },
  { value: 'eq', label: 'Equal to', args: 1 },
  { value: 'text', label: 'Text that contains', args: 1 },
  { value: 'dup', label: 'Duplicate values', args: 0 },
  { value: 'unique', label: 'Unique values', args: 0 },
  { value: 'top', label: 'Top N items', args: 1 },
  { value: 'bottom', label: 'Bottom N items', args: 1 },
  { value: 'above', label: 'Above average', args: 0 },
  { value: 'below', label: 'Below average', args: 0 },
  { value: 'scale', label: 'Color scale (red to green)', args: 0 },
  { value: 'bars', label: 'Data bars', args: 0 },
];

export const RULE_COLORS = [
  { value: '#ffc7ce|#9c0006', label: 'Light red fill, dark red text' },
  { value: '#ffeb9c|#9c5700', label: 'Yellow fill, dark yellow text' },
  { value: '#c6efce|#006100', label: 'Green fill, dark green text' },
  { value: '#ddebf7|#1f4e79', label: 'Blue fill, dark blue text' },
  { value: '#ffc7ce|', label: 'Light red fill' },
  { value: '|#c00000', label: 'Red text' },
];

export function parseRange(ref) {
  const [a, b] = String(ref || '').toUpperCase().split(':');
  const pa = parseRef(a);
  const pb = b ? parseRef(b) : pa;
  if (!pa || !pb) return null;
  return { r0: Math.min(pa.row, pb.row), r1: Math.max(pa.row, pb.row), c0: Math.min(pa.col, pb.col), c1: Math.max(pa.col, pb.col) };
}

export function rangeRefs(ref) {
  const g = parseRange(ref);
  if (!g) return [];
  const out = [];
  for (let r = g.r0; r <= g.r1; r += 1) for (let c = g.c0; c <= g.c1; c += 1) out.push(refName(r, c));
  return out;
}

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const key = (v) => (v == null ? '' : String(typeof v === 'object' ? v.message || '' : v).trim().toLowerCase());

function mix(a, b, t) {
  const p = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function scaleColor(t) {
  return t < 0.5 ? mix('#f8696b', '#ffeb84', t * 2) : mix('#ffeb84', '#63be7b', (t - 0.5) * 2);
}

// Map of ref -> { bg?, color?, bar? } for every cell a rule touches; later rules win.
export function ruleStyles(rules, valueOf) {
  const out = new Map();
  for (const rule of rules || []) {
    const refs = rangeRefs(rule.ref);
    const vals = refs.map((ref) => valueOf(ref));
    const nums = vals.map(num);
    const present = nums.filter((n) => n != null);
    const [bg, color] = String(rule.color || RULE_COLORS[0].value).split('|');
    const paint = { ...(bg ? { bg } : {}), ...(color ? { color } : {}) };
    const lo = Math.min(...present);
    const hi = Math.max(...present);
    const avg = present.reduce((s, n) => s + n, 0) / (present.length || 1);
    const counts = new Map();
    if (rule.kind === 'dup' || rule.kind === 'unique') for (const v of vals) if (key(v)) counts.set(key(v), (counts.get(key(v)) || 0) + 1);
    let cut = null;
    if (rule.kind === 'top' || rule.kind === 'bottom') {
      const n = Math.max(1, Math.round(num(rule.a) ?? 10));
      const sorted = [...present].sort((x, y) => (rule.kind === 'top' ? y - x : x - y));
      cut = sorted[Math.min(n, sorted.length) - 1];
    }
    const a = num(rule.a);
    const b = num(rule.b);
    refs.forEach((ref, i) => {
      const n = nums[i];
      const v = vals[i];
      let hit = false;
      switch (rule.kind) {
        case 'gt': hit = n != null && a != null && n > a; break;
        case 'lt': hit = n != null && a != null && n < a; break;
        case 'between': hit = n != null && a != null && b != null && n >= Math.min(a, b) && n <= Math.max(a, b); break;
        case 'eq': hit = a != null && n != null ? n === a : key(v) !== '' && key(v) === key(rule.a); break;
        case 'text': hit = key(rule.a) !== '' && key(v).includes(key(rule.a)); break;
        case 'dup': hit = counts.get(key(v)) > 1; break;
        case 'unique': hit = counts.get(key(v)) === 1; break;
        case 'top': hit = n != null && cut != null && n >= cut; break;
        case 'bottom': hit = n != null && cut != null && n <= cut; break;
        case 'above': hit = n != null && present.length > 1 && n > avg; break;
        case 'below': hit = n != null && present.length > 1 && n < avg; break;
        case 'scale':
          if (n != null) out.set(ref, { ...out.get(ref), bg: scaleColor(hi > lo ? (n - lo) / (hi - lo) : 0.5) });
          return;
        case 'bars':
          if (n != null) out.set(ref, { ...out.get(ref), bar: hi > 0 ? Math.max(0, n) / hi : 0, barColor: bg || '#638ec6' });
          return;
        default:
      }
      if (hit) out.set(ref, { ...out.get(ref), ...paint });
    });
  }
  return out;
}

export function describeRule(rule) {
  const kind = RULE_KINDS.find((k) => k.value === rule.kind);
  const args = rule.kind === 'between' ? ` ${rule.a} and ${rule.b}` : kind?.args ? ` ${rule.a}` : '';
  return `${kind?.label || rule.kind}${args} in ${rule.ref}`;
}

// Rows a filter hides: those whose text in a filtered column isn't among the shown values.
export function hiddenRows(filter, textOf) {
  const g = parseRange(filter?.ref);
  const out = new Set();
  if (!g) return out;
  const cols = Object.entries(filter.hide || {}).filter(([, shown]) => Array.isArray(shown));
  if (!cols.length) return out;
  for (let r = g.r0 + 1; r <= g.r1; r += 1) {
    for (const [c, shown] of cols) {
      if (!shown.includes(textOf(r, Number(c)))) {
        out.add(r);
        break;
      }
    }
  }
  return out;
}

// The distinct values under a header, in first-seen order, with how many rows have each.
export function columnValues(filter, col, textOf) {
  const g = parseRange(filter?.ref);
  const seen = new Map();
  if (!g) return [];
  for (let r = g.r0 + 1; r <= g.r1; r += 1) {
    const t = textOf(r, col);
    seen.set(t, (seen.get(t) || 0) + 1);
  }
  return [...seen.entries()].map(([text, count]) => ({ text, count }));
}

// Keep rules and filters pointing at the same cells when rows or columns are inserted or deleted.
export function shiftRange(ref, axis, at, delta) {
  const g = parseRange(ref);
  if (!g) return ref;
  const [lo, hi] = axis === 'row' ? ['r0', 'r1'] : ['c0', 'c1'];
  const k = -delta;
  const end = at + k;
  const n = { ...g };
  if (delta > 0) {
    if (g[lo] >= at) n[lo] += delta;
    if (g[hi] >= at) n[hi] += delta;
  } else {
    n[lo] = g[lo] < at ? g[lo] : g[lo] >= end ? g[lo] - k : at;
    n[hi] = g[hi] < at ? g[hi] : g[hi] >= end ? g[hi] - k : at - 1;
  }
  if (n[hi] < n[lo]) return null;
  return `${refName(n.r0, n.c0)}:${refName(n.r1, n.c1)}`;
}
