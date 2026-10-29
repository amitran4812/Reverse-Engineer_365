// Scales, ticks (numbers, logs and dates) and colours for the plots.

import { niceStep } from './engine.js';

export const PALETTE = ['#2a6fdb', '#e8743b', '#19a979', '#d64e7a', '#8c62c9', '#c9a227', '#3fb7c9', '#7a8b99', '#a3484e', '#5f9e3c', '#e05fb0', '#2f4b7c'];
export const MARK = '#14171c';

// Sequential colour ramp (dark blue -> teal -> green -> yellow).
const RAMP = [[32, 26, 84], [37, 92, 141], [24, 146, 140], [86, 196, 98], [241, 226, 61]];
export function ramp(t) {
  if (!Number.isFinite(t)) return [200, 200, 200];
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
}
export const rampCss = (t) => `rgb(${ramp(t).join(',')})`;
export const paletteColor = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

export class Scale {
  constructor(d0, d1, r0, r1, log = false) {
    this.log = log && d0 > 0 && d1 > 0;
    this.d0 = d0;
    this.d1 = d1;
    this.r0 = r0;
    this.r1 = r1;
    this.t0 = this.tf(d0);
    this.k = (r1 - r0) / (this.tf(d1) - this.t0 || 1);
  }

  tf(v) {
    return this.log ? Math.log10(v) : v;
  }

  map(v) {
    return this.r0 + (this.tf(v) - this.t0) * this.k;
  }

  invert(px) {
    const t = this.t0 + (px - this.r0) / this.k;
    return this.log ? 10 ** t : t;
  }
}

export function padRange([lo, hi], frac = 0.04, log = false) {
  if (log && lo > 0 && hi > 0) {
    const a = Math.log10(lo);
    const b = Math.log10(hi);
    const p = (b - a || 1) * frac;
    return [10 ** (a - p), 10 ** (b + p)];
  }
  if (!(hi > lo)) {
    const p = Math.abs(lo) * 0.1 || 1;
    return [lo - p, hi + p];
  }
  const p = (hi - lo) * frac;
  return [lo - p, hi + p];
}

export function formatTick(v, step) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + Math.floor(Math.log10(a))))).replace(/\.?0+e/, 'e');
  const dec = Math.max(0, Math.min(10, -Math.floor(Math.log10(step) + 1e-9)));
  return v.toFixed(dec).replace(/^-0(\.0*)?$/, '0');
}

export function numberTicks(d0, d1, count = 6) {
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const step = niceStep(hi - lo || 1, count);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push({ v: Number(v.toPrecision(12)), label: formatTick(Number(v.toPrecision(12)), step) });
  return out;
}

export function logTicks(d0, d1) {
  const out = [];
  const a = Math.floor(Math.log10(d0));
  const b = Math.ceil(Math.log10(d1));
  const every = Math.max(1, Math.ceil((b - a) / 8));
  for (let e = a; e <= b; e += every) {
    const v = 10 ** e;
    if (v >= d0 && v <= d1) out.push({ v, label: e >= -3 && e <= 5 ? String(Number(v.toPrecision(6))) : `1e${e}` });
  }
  if (out.length < 2) return numberTicks(d0, d1);
  return out;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const STEPS = [
  [SEC, 's'], [5 * SEC, 's'], [15 * SEC, 's'], [30 * SEC, 's'], [MIN, 'm'], [5 * MIN, 'm'], [15 * MIN, 'm'], [30 * MIN, 'm'],
  [HOUR, 'h'], [3 * HOUR, 'h'], [6 * HOUR, 'h'], [12 * HOUR, 'h'], [DAY, 'd'], [2 * DAY, 'd'], [7 * DAY, 'w'],
  [30 * DAY, 'M1'], [91 * DAY, 'M3'], [182 * DAY, 'M6'], [365 * DAY, 'Y1'], [5 * 365 * DAY, 'Y5'], [10 * 365 * DAY, 'Y10'],
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

export function dateTicks(d0, d1, count = 6) {
  const span = Math.abs(d1 - d0) || DAY;
  const [step, unit] = STEPS.find(([s]) => span / s <= count) || STEPS[STEPS.length - 1];
  const out = [];
  const d = new Date(Math.min(d0, d1));
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const label = (t) => {
    const x = new Date(t);
    if (unit === 's' || unit === 'm') return `${pad2(x.getUTCHours())}:${pad2(x.getUTCMinutes())}${unit === 's' ? `:${pad2(x.getUTCSeconds())}` : ''}`;
    if (unit === 'h') return x.getUTCHours() === 0 ? `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}` : `${pad2(x.getUTCHours())}:00`;
    if (unit === 'd' || unit === 'w') return `${MONTHS[x.getUTCMonth()]} ${x.getUTCDate()}`;
    if (unit.startsWith('M')) return x.getUTCMonth() === 0 ? String(x.getUTCFullYear()) : MONTHS[x.getUTCMonth()];
    return String(x.getUTCFullYear());
  };
  if (unit.startsWith('M') || unit.startsWith('Y')) {
    const months = unit.startsWith('M') ? Number(unit.slice(1)) : 12 * Number(unit.slice(1));
    let y = d.getUTCFullYear();
    let m = Math.floor(d.getUTCMonth() / months) * months;
    if (unit.startsWith('Y')) {
      const yrs = months / 12;
      y = Math.floor(y / yrs) * yrs;
      m = 0;
    }
    for (let k = 0; k < 400; k += 1) {
      const t = Date.UTC(y, m, 1);
      if (t > hi) break;
      if (t >= lo) out.push({ v: t, label: label(t) });
      m += months;
      if (m >= 12) {
        y += Math.floor(m / 12);
        m %= 12;
      }
    }
  } else {
    const start = Math.ceil(lo / step) * step;
    for (let t = start; t <= hi && out.length < 400; t += step) out.push({ v: t, label: label(t) });
  }
  return out;
}

export function ticksFor(scale, type, count = 6) {
  const lo = Math.min(scale.d0, scale.d1);
  const hi = Math.max(scale.d0, scale.d1);
  if (type === 'date') return dateTicks(lo, hi, count);
  if (scale.log) return logTicks(lo, hi);
  return numberTicks(lo, hi, count);
}

export function formatValue(v, type) {
  if (!Number.isFinite(v)) return '';
  if (type === 'date') {
    const s = new Date(v).toISOString();
    return s.endsWith('T00:00:00.000Z') ? s.slice(0, 10) : s.slice(0, 19).replace('T', ' ');
  }
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e9 || a < 1e-4)) return v.toExponential(4).replace(/\.?0+e/, 'e');
  return String(Number(v.toPrecision(7)));
}
