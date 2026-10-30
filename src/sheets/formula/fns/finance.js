// Financial functions: loans and annuities, cash flows, depreciation, bonds and bills.

import {
  E, dateSerial, err, flat, isErr, nums, serialDate, toBool, toInt, toNum,
} from '../core.js';
import { libCall } from './lib.js';
import { S } from './util.js';

const n = (v, d) => (v === undefined || v === null ? d : toNum(v));
const due = (t) => (t === undefined || t === null ? 0 : toNum(t) ? 1 : 0);

function fv(r, nper, pmt, pv, type) {
  if (r === 0) return -(pv + pmt * nper);
  const p = (1 + r) ** nper;
  return -(pv * p + (pmt * (1 + r * type) * (p - 1)) / r);
}
function pv(r, nper, pmt, f, type) {
  if (r === 0) return -(f + pmt * nper);
  const p = (1 + r) ** nper;
  return -(f + (pmt * (1 + r * type) * (p - 1)) / r) / p;
}
function pmt(r, nper, p, f, type) {
  if (nper === 0) throw E.NUM;
  if (r === 0) return -(p + f) / nper;
  const q = (1 + r) ** nper;
  return -(r * (p * q + f)) / ((1 + r * type) * (q - 1));
}
function ipmt(r, per, nper, p, f, type) {
  if (per < 1 || per > nper) throw err('#NUM!', 'The period is out of range.');
  const pay = pmt(r, nper, p, f, type);
  if (per === 1 && type === 1) return 0;
  const balance = fv(r, per - 1, pay, p, type);
  const i = balance * r;
  return type === 1 ? i / (1 + r) : i;
}

// Newton's method with a bisection fallback.
function solve(f, guess, lo = -0.9999999, hi = 1e10) {
  let x = guess;
  for (let i = 0; i < 100; i += 1) {
    const y = f(x);
    if (Math.abs(y) < 1e-10) return x;
    const h = Math.max(Math.abs(x) * 1e-7, 1e-9);
    const d = (f(x + h) - y) / h;
    if (!Number.isFinite(d) || d === 0) break;
    const next = x - y / d;
    if (!Number.isFinite(next) || next <= lo) break;
    if (Math.abs(next - x) < 1e-12) return next;
    x = next;
  }
  let a = lo;
  let b = Math.min(hi, 10);
  let fa = f(a);
  let fb = f(b);
  if (!(fa * fb < 0)) {
    for (const t of [0.5, 1, 2, 5, 100]) {
      b = t;
      fb = f(b);
      if (fa * fb < 0) break;
    }
  }
  if (!(fa * fb < 0)) throw err('#NUM!', "The calculation didn't converge.");
  for (let i = 0; i < 300; i += 1) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (Math.abs(fm) < 1e-10 || b - a < 1e-14) return m;
    if (fa * fm < 0) {
      b = m;
      fb = fm;
    } else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

const npv = (r, flows) => flows.reduce((s, cf, i) => s + cf / (1 + r) ** (i + 1), 0);

function xFlows(values, dates) {
  const v = flat(values).map(toNum);
  const d = flat(dates).map(toNum);
  if (v.length !== d.length) throw err('#NUM!', 'Values and dates must be the same size.');
  if (!v.some((x) => x > 0) || !v.some((x) => x < 0)) throw err('#NUM!', 'The cash flows need both a payment and a receipt.');
  return { v, d };
}
const xnpv = (r, v, d) => v.reduce((s, cf, i) => s + cf / (1 + r) ** ((d[i] - d[0]) / 365), 0);

function ddbAt(cost, salvage, life, period, factor) {
  let book = cost;
  let dep = 0;
  for (let i = 1; i <= period; i += 1) {
    dep = Math.min(book * (factor / life), Math.max(book - salvage, 0));
    book -= dep;
  }
  return dep;
}

function vdb(cost, salvage, life, start, end, factor, noSwitch) {
  let total = 0;
  let book = cost;
  const steps = Math.ceil(end);
  for (let p = 0; p < steps; p += 1) {
    const ddb = book * (factor / life);
    const sl = (book - salvage) / (life - p);
    let dep = !noSwitch && sl > ddb ? sl : ddb;
    dep = Math.max(Math.min(dep, book - salvage), 0);
    const from = Math.max(start, p);
    const to = Math.min(end, p + 1);
    if (to > from) total += dep * (to - from);
    book -= dep;
  }
  return total;
}

// Bond coupon schedule helpers.
const ymd = (s) => {
  const d = serialDate(Math.floor(s));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
};
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addMonths(s, months, eom) {
  const [y, m, d] = ymd(s);
  const nm = m + months;
  const last = lastDay(y, nm);
  return dateSerial(y, nm, eom ? last : Math.min(d, last));
}
function coupons(settle, maturity, freq) {
  const f = toInt(freq);
  if (![1, 2, 4].includes(f)) throw err('#NUM!', 'Frequency must be 1, 2 or 4.');
  const s = Math.floor(toNum(settle));
  const m = Math.floor(toNum(maturity));
  if (s >= m) throw err('#NUM!', 'Settlement must be before maturity.');
  const [my, mm, md] = ymd(m);
  const eom = md === lastDay(my, mm);
  const step = 12 / f;
  let k = 1;
  let pcd = addMonths(m, -step, eom);
  while (pcd > s) {
    k += 1;
    pcd = addMonths(m, -step * k, eom);
  }
  return { s, m, f, pcd, ncd: addMonths(m, -step * (k - 1), eom), num: k };
}
function days360(a, b, euro) {
  let [y1, m1, d1] = ymd(a);
  let [y2, m2, d2] = ymd(b);
  if (euro) {
    d1 = Math.min(d1, 30);
    d2 = Math.min(d2, 30);
  } else {
    if (d1 === 31 || (m1 === 2 && d1 === lastDay(y1, 2))) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
  }
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}
const basisOf = (b) => {
  const k = b === undefined || b === null ? 0 : toInt(b);
  if (k < 0 || k > 4) throw err('#NUM!', 'Basis must be 0 to 4.');
  return k;
};
const dayCount = (a, b, basis) => (basis === 0 ? days360(a, b, false) : basis === 4 ? days360(a, b, true) : b - a);
function couponInfo(settle, maturity, freq, basis) {
  const c = coupons(settle, maturity, freq);
  const bs = basisOf(basis);
  const E2 = bs === 1 ? c.ncd - c.pcd : (bs === 3 ? 365 : 360) / c.f;
  const A = dayCount(c.pcd, c.s, bs);
  const DSC = bs === 0 || bs === 4 ? E2 - A : c.ncd - c.s;
  return { ...c, E: E2, A, DSC, basis: bs };
}
const yf = (a, b, basis) => libCall('YEARFRAC', Math.floor(toNum(a)), Math.floor(toNum(b)), basisOf(basis));

function price(settle, maturity, rate, yld, redemption, freq, basis) {
  const { num: N, E: e, A, DSC, f } = couponInfo(settle, maturity, freq, basis);
  const r = toNum(rate);
  const y = toNum(yld);
  const red = toNum(redemption);
  const c = (100 * r) / f;
  if (N === 1) return (red + c) / (1 + (DSC / e) * (y / f)) - c * (A / e);
  let p = red / (1 + y / f) ** (N - 1 + DSC / e);
  for (let k = 1; k <= N; k += 1) p += c / (1 + y / f) ** (k - 1 + DSC / e);
  return p - c * (A / e);
}

function duration(settle, maturity, coupon, yld, freq, basis) {
  const { num: N, E: e, DSC, f } = couponInfo(settle, maturity, freq, basis);
  const c = (100 * toNum(coupon)) / f;
  const y = toNum(yld);
  let pvSum = 0;
  let tw = 0;
  for (let k = 1; k <= N; k += 1) {
    const t = k - 1 + DSC / e;
    const cf = c + (k === N ? 100 : 0);
    const d = cf / (1 + y / f) ** t;
    pvSum += d;
    tw += (t / f) * d;
  }
  return tw / pvSum;
}

function tbill(settle, maturity) {
  const s = Math.floor(toNum(settle));
  const m = Math.floor(toNum(maturity));
  const dsm = m - s;
  if (dsm <= 0 || dsm > 366) throw err('#NUM!', 'Maturity must be within a year after settlement.');
  return dsm;
}

function amorlinc(cost, purchase, first, salvage, period, rate, basis) {
  const c = toNum(cost);
  const r = toNum(rate);
  const s = toNum(salvage);
  const p = toInt(period);
  const firstDep = c * r * yf(purchase, first, basis);
  let book = c;
  for (let i = 0; i <= p; i += 1) {
    const dep = Math.min(i === 0 ? firstDep : c * r, Math.max(book - s, 0));
    if (i === p) return dep;
    book -= dep;
  }
  return 0;
}

export default {
  PMT: S((r, np, p, f, t) => pmt(toNum(r), toNum(np), toNum(p), n(f, 0), due(t)), { min: 3, max: 5 }),
  PV: S((r, np, p, f, t) => pv(toNum(r), toNum(np), n(p, 0), n(f, 0), due(t)), { min: 3, max: 5 }),
  FV: S((r, np, p, v, t) => fv(toNum(r), toNum(np), n(p, 0), n(v, 0), due(t)), { min: 3, max: 5 }),
  NPER: S((r, p, v, f, t) => {
    const rate = toNum(r);
    const pay = toNum(p);
    const pres = toNum(v);
    const fut = n(f, 0);
    const ty = due(t);
    if (rate === 0) {
      if (pay === 0) throw E.NUM;
      return -(pres + fut) / pay;
    }
    const a = pay * (1 + rate * ty) - fut * rate;
    const b = pres * rate + pay * (1 + rate * ty);
    if (a / b <= 0) throw E.NUM;
    return Math.log(a / b) / Math.log(1 + rate);
  }, { min: 3, max: 5 }),
  RATE: S((np, p, v, f, t, g) => {
    const N = toNum(np);
    const pay = toNum(p);
    const pres = toNum(v);
    const fut = n(f, 0);
    const ty = due(t);
    return solve((r) => (Math.abs(r) < 1e-12 ? pres + pay * N + fut : pres * (1 + r) ** N + pay * (1 + r * ty) * (((1 + r) ** N - 1) / r) + fut), n(g, 0.1));
  }, { min: 3, max: 6 }),
  IPMT: S((r, per, np, p, f, t) => ipmt(toNum(r), toNum(per), toNum(np), toNum(p), n(f, 0), due(t)), { min: 4, max: 6 }),
  PPMT: S((r, per, np, p, f, t) => {
    const rate = toNum(r);
    const N = toNum(np);
    return pmt(rate, N, toNum(p), n(f, 0), due(t)) - ipmt(rate, toNum(per), N, toNum(p), n(f, 0), due(t));
  }, { min: 4, max: 6 }),
  CUMIPMT: S((r, np, p, a, b, t) => {
    const s = toInt(a);
    const e = toInt(b);
    if (s < 1 || e < s) throw E.NUM;
    let total = 0;
    for (let k = s; k <= e; k += 1) total += ipmt(toNum(r), k, toNum(np), toNum(p), 0, due(t));
    return total;
  }, { min: 6, max: 6 }),
  CUMPRINC: S((r, np, p, a, b, t) => {
    const s = toInt(a);
    const e = toInt(b);
    if (s < 1 || e < s) throw E.NUM;
    const pay = pmt(toNum(r), toNum(np), toNum(p), 0, due(t));
    let total = 0;
    for (let k = s; k <= e; k += 1) total += pay - ipmt(toNum(r), k, toNum(np), toNum(p), 0, due(t));
    return total;
  }, { min: 6, max: 6 }),
  ISPMT: S((r, per, np, p) => toNum(p) * toNum(r) * (toNum(per) / toNum(np) - 1), { min: 4, max: 4 }),
  NPV: S((r, ...flows) => npv(toNum(r), nums(flows)), { arrays: (i) => i > 0, min: 2 }),
  XNPV: S((r, v, d) => {
    const x = xFlows(v, d);
    return xnpv(toNum(r), x.v, x.d);
  }, { arrays: [1, 2], min: 3, max: 3 }),
  IRR: S((v, g) => {
    const flows = nums([v]);
    if (!flows.some((x) => x > 0) || !flows.some((x) => x < 0)) throw err('#NUM!', 'IRR needs both positive and negative cash flows.');
    return solve((r) => flows.reduce((s, cf, i) => s + cf / (1 + r) ** i, 0), n(g, 0.1));
  }, { arrays: [0], min: 1, max: 2 }),
  XIRR: S((v, d, g) => {
    const x = xFlows(v, d);
    return solve((r) => xnpv(r, x.v, x.d), n(g, 0.1));
  }, { arrays: [0, 1], min: 2, max: 3 }),
  MIRR: S((v, fr, rr) => {
    const flows = nums([v]);
    const f = toNum(fr);
    const r = toNum(rr);
    const N = flows.length;
    const pos = flows.reduce((s, cf, i) => s + (cf > 0 ? cf * (1 + r) ** (N - 1 - i) : 0), 0);
    const neg = flows.reduce((s, cf, i) => s + (cf < 0 ? cf / (1 + f) ** i : 0), 0);
    if (!pos || !neg) throw E.DIV0;
    return (-pos / neg) ** (1 / (N - 1)) - 1;
  }, { arrays: [0], min: 3, max: 3 }),
  EFFECT: S((r, k) => {
    const p = Math.trunc(toNum(k));
    if (toNum(r) <= 0 || p < 1) throw E.NUM;
    return (1 + toNum(r) / p) ** p - 1;
  }, { min: 2, max: 2 }),
  NOMINAL: S((r, k) => {
    const p = Math.trunc(toNum(k));
    if (toNum(r) <= 0 || p < 1) throw E.NUM;
    return p * ((1 + toNum(r)) ** (1 / p) - 1);
  }, { min: 2, max: 2 }),
  PDURATION: S((r, p, f) => {
    if (toNum(r) <= 0 || toNum(p) <= 0 || toNum(f) <= 0) throw E.NUM;
    return (Math.log(toNum(f)) - Math.log(toNum(p))) / Math.log(1 + toNum(r));
  }, { min: 3, max: 3 }),
  RRI: S((np, p, f) => {
    if (toNum(np) <= 0) throw E.NUM;
    return (toNum(f) / toNum(p)) ** (1 / toNum(np)) - 1;
  }, { min: 3, max: 3 }),
  FVSCHEDULE: S((p, rates) => nums([rates]).reduce((s, r) => s * (1 + r), toNum(p)), { arrays: [1], min: 2, max: 2 }),
  SLN: S((c, s, l) => {
    if (toNum(l) === 0) throw E.DIV0;
    return (toNum(c) - toNum(s)) / toNum(l);
  }, { min: 3, max: 3 }),
  SYD: S((c, s, l, per) => {
    const life = toNum(l);
    return ((toNum(c) - toNum(s)) * (life - toNum(per) + 1) * 2) / (life * (life + 1));
  }, { min: 4, max: 4 }),
  DB: S((c, s, l, per, mo) => {
    const cost = toNum(c);
    const life = toNum(l);
    const p = toInt(per);
    const m = n(mo, 12);
    if (cost <= 0 || life <= 0 || p < 1 || p > life + 1) throw E.NUM;
    const rate = Math.round((1 - (toNum(s) / cost) ** (1 / life)) * 1000) / 1000;
    let total = 0;
    let dep = 0;
    for (let i = 1; i <= p; i += 1) {
      if (i === 1) dep = (cost * rate * m) / 12;
      else if (i === life + 1) dep = ((cost - total) * rate * (12 - m)) / 12;
      else dep = (cost - total) * rate;
      total += dep;
    }
    return dep;
  }, { min: 4, max: 5 }),
  DDB: S((c, s, l, per, f) => ddbAt(toNum(c), toNum(s), toNum(l), toInt(per), n(f, 2)), { min: 4, max: 5 }),
  VDB: S((c, s, l, a, b, f, ns) => vdb(toNum(c), toNum(s), toNum(l), toNum(a), toNum(b), n(f, 2), ns !== undefined && toBool(ns)), { min: 5, max: 7 }),
  DOLLARDE: S((v, f) => {
    const x = toNum(v);
    const fr = Math.trunc(toNum(f));
    if (fr <= 0) throw E.DIV0;
    const i = Math.trunc(x);
    return i + ((x - i) * 10 ** Math.ceil(Math.log10(fr))) / fr;
  }, { min: 2, max: 2 }),
  DOLLARFR: S((v, f) => {
    const x = toNum(v);
    const fr = Math.trunc(toNum(f));
    if (fr <= 0) throw E.DIV0;
    const i = Math.trunc(x);
    return i + ((x - i) * fr) / 10 ** Math.ceil(Math.log10(fr));
  }, { min: 2, max: 2 }),
  TBILLPRICE: S((s, m, d) => 100 * (1 - (toNum(d) * tbill(s, m)) / 360), { min: 3, max: 3 }),
  TBILLYIELD: S((s, m, p) => ((100 - toNum(p)) / toNum(p)) * (360 / tbill(s, m)), { min: 3, max: 3 }),
  TBILLEQ: S((s, m, d) => {
    const dsm = tbill(s, m);
    const disc = toNum(d);
    if (dsm <= 182) return (365 * disc) / (360 - disc * dsm);
    const pr = 100 * (1 - (disc * dsm) / 360);
    const t = dsm / 365;
    return (-2 * t + 2 * Math.sqrt(t * t - (2 * t - 1) * (1 - 100 / pr))) / (2 * t - 1);
  }, { min: 3, max: 3 }),
  DISC: S((s, m, p, r, b) => (toNum(r) - toNum(p)) / toNum(r) / yf(s, m, b), { min: 4, max: 5 }),
  INTRATE: S((s, m, i, r, b) => (toNum(r) - toNum(i)) / toNum(i) / yf(s, m, b), { min: 4, max: 5 }),
  RECEIVED: S((s, m, i, d, b) => toNum(i) / (1 - toNum(d) * yf(s, m, b)), { min: 4, max: 5 }),
  PRICEDISC: S((s, m, d, r, b) => toNum(r) - toNum(d) * toNum(r) * yf(s, m, b), { min: 4, max: 5 }),
  YIELDDISC: S((s, m, p, r, b) => (toNum(r) - toNum(p)) / toNum(p) / yf(s, m, b), { min: 4, max: 5 }),
  PRICEMAT: S((s, m, iss, r, y, b) => {
    const rate = toNum(r);
    return (100 + yf(iss, m, b) * rate * 100) / (1 + yf(s, m, b) * toNum(y)) - yf(iss, s, b) * rate * 100;
  }, { min: 5, max: 6 }),
  YIELDMAT: S((s, m, iss, r, p, b) => {
    const rate = toNum(r);
    const pr = toNum(p) / 100;
    const a = 1 + yf(iss, m, b) * rate;
    const c = pr + yf(iss, s, b) * rate;
    return (a - c) / c / yf(s, m, b);
  }, { min: 5, max: 6 }),
  ACCRINT: S((iss, first, s, r, par, f, b) => n(par, 1000) * toNum(r) * yf(iss, s, b), { min: 4, max: 8 }),
  ACCRINTM: S((iss, m, r, par, b) => n(par, 1000) * toNum(r) * yf(iss, m, b), { min: 3, max: 5 }),
  COUPPCD: S((s, m, f) => coupons(s, m, f).pcd, { min: 3, max: 4 }),
  COUPNCD: S((s, m, f) => coupons(s, m, f).ncd, { min: 3, max: 4 }),
  COUPNUM: S((s, m, f) => coupons(s, m, f).num, { min: 3, max: 4 }),
  COUPDAYBS: S((s, m, f, b) => couponInfo(s, m, f, b).A, { min: 3, max: 4 }),
  COUPDAYS: S((s, m, f, b) => couponInfo(s, m, f, b).E, { min: 3, max: 4 }),
  COUPDAYSNC: S((s, m, f, b) => couponInfo(s, m, f, b).DSC, { min: 3, max: 4 }),
  PRICE: S(price, { min: 6, max: 7 }),
  YIELD: S((s, m, r, pr, red, f, b) => solve((y) => price(s, m, r, y, red, f, b) - toNum(pr), 0.05, -0.99), { min: 6, max: 7 }),
  DURATION: S(duration, { min: 5, max: 6 }),
  MDURATION: S((s, m, c, y, f, b) => duration(s, m, c, y, f, b) / (1 + toNum(y) / toInt(f)), { min: 5, max: 6 }),
  AMORLINC: S(amorlinc, { min: 6, max: 7 }),
};

export { isErr };
