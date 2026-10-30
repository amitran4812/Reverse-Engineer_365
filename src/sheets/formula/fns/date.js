// Dates and times as serial numbers (days since 1899-12-30, fraction = time of day).

import {
  E, dateSerial, err, flat, nowSerial, parseDate, serialDate, toInt, toNum, toStr,
} from '../core.js';
import { libCall } from './lib.js';
import { R, S } from './util.js';

const day = (v) => {
  const n = toNum(v);
  if (n < 0) throw err('#NUM!', 'Dates before 1899-12-30 aren\'t supported.');
  return n;
};
const parts = (v) => {
  const d = serialDate(Math.floor(day(v) + 1e-9));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() };
};
const secs = (v) => Math.round((day(v) % 1) * 86400) % 86400;
const dates = (v) => (v === undefined || v === null ? undefined : flat(v).filter((x) => x != null && x !== '').map((x) => [toNum(x)]));

function weekday(v, type) {
  const wd = parts(v).wd;
  const t = type === undefined ? 1 : toInt(type);
  if (t === 1 || t === 17) return wd + 1;
  if (t === 2 || t === 11) return ((wd + 6) % 7) + 1;
  if (t === 3) return (wd + 6) % 7;
  if (t >= 12 && t <= 16) return ((wd + 7 - (t - 10)) % 7) + 1;
  throw err('#NUM!', `WEEKDAY type ${t} isn't valid.`);
}

function edate(start, months) {
  const p = parts(start);
  const m = p.m + Math.trunc(toNum(months));
  const last = new Date(Date.UTC(p.y, m, 0)).getUTCDate();
  return dateSerial(p.y, m, Math.min(p.d, last));
}

export default {
  DATE: S((y, m, d) => {
    let yr = toInt(y);
    if (yr < 1900) yr += 1900;
    const v = dateSerial(yr, toInt(m), toInt(d));
    if (v < 0) throw E.NUM;
    return v;
  }, { min: 3, max: 3 }),
  TIME: S((h, m, s) => {
    const t = toInt(h) * 3600 + toInt(m) * 60 + toInt(s);
    if (t < 0) throw E.NUM;
    return (t % 86400) / 86400;
  }, { min: 3, max: 3 }),
  DATEVALUE: S((t) => {
    if (typeof t === 'number') return Math.floor(t);
    const v = parseDate(toStr(t));
    if (v == null) throw err('#VALUE!', `DATEVALUE parameter "${t}" can't be parsed to date/time.`);
    return Math.floor(v);
  }, { min: 1, max: 1 }),
  TIMEVALUE: S((t) => {
    const v = typeof t === 'number' ? t : parseDate(toStr(t));
    if (v == null) throw err('#VALUE!', `TIMEVALUE parameter "${t}" can't be parsed to date/time.`);
    return v - Math.floor(v);
  }, { min: 1, max: 1 }),
  TO_DATE: S((v) => (typeof v === 'number' ? v : toNum(v)), { min: 1, max: 1 }),
  TODAY: R(() => Math.floor(nowSerial()), { max: 0 }),
  NOW: R(() => nowSerial(), { max: 0 }),
  YEAR: S((v) => parts(v).y, { min: 1, max: 1 }),
  MONTH: S((v) => parts(v).m, { min: 1, max: 1 }),
  DAY: S((v) => parts(v).d, { min: 1, max: 1 }),
  HOUR: S((v) => Math.floor(secs(v) / 3600), { min: 1, max: 1 }),
  MINUTE: S((v) => Math.floor((secs(v) % 3600) / 60), { min: 1, max: 1 }),
  SECOND: S((v) => secs(v) % 60, { min: 1, max: 1 }),
  WEEKDAY: S(weekday, { min: 1, max: 2 }),
  WEEKNUM: S((v, t) => libCall('WEEKNUM', day(v), t === undefined ? undefined : toInt(t)), { min: 1, max: 2 }),
  ISOWEEKNUM: S((v) => libCall('ISOWEEKNUM', day(v)), { min: 1, max: 1 }),
  DAYS: S((end, start) => Math.floor(day(end)) - Math.floor(day(start)), { min: 2, max: 2 }),
  DAYS360: S((a, b, m) => libCall('DAYS360', day(a), day(b), m === undefined ? undefined : Boolean(toNum(m))), { min: 2, max: 3 }),
  DATEDIF: S((a, b, unit) => {
    const s = Math.floor(day(a));
    const e = Math.floor(day(b));
    if (e < s) throw err('#NUM!', 'DATEDIF start date is after the end date.');
    const u = toStr(unit).toUpperCase();
    const p = parts(s);
    const q = parts(e);
    let months = (q.y - p.y) * 12 + q.m - p.m - (q.d < p.d ? 1 : 0);
    switch (u) {
      case 'D': return e - s;
      case 'M': return months;
      case 'Y': return Math.floor(months / 12);
      case 'YM': return months % 12;
      case 'MD': {
        if (q.d >= p.d) return q.d - p.d;
        const prevMonthDays = new Date(Date.UTC(q.y, q.m - 1, 0)).getUTCDate();
        return prevMonthDays - p.d + q.d < 0 ? q.d : prevMonthDays - p.d + q.d;
      }
      case 'YD': {
        let anchor = dateSerial(q.y, p.m, p.d);
        if (anchor > e) anchor = dateSerial(q.y - 1, p.m, p.d);
        months = 0;
        return e - anchor;
      }
      default: throw err('#NUM!', `DATEDIF unit "${u}" isn't valid.`);
    }
  }, { min: 3, max: 3 }),
  EDATE: S((s, m) => Math.floor(edate(s, m)), { min: 2, max: 2 }),
  EOMONTH: S((s, m) => {
    const p = parts(s);
    return dateSerial(p.y, p.m + Math.trunc(toNum(m)) + 1, 0);
  }, { min: 2, max: 2 }),
  EPOCHTODATE: S((ts, unit) => {
    const u = unit === undefined ? 1 : toInt(unit);
    const div = { 1: 1, 2: 1e3, 3: 1e6 }[u];
    if (!div) throw E.NUM;
    return toNum(ts) / div / 86400 + 25569;
  }, { min: 1, max: 2 }),
  YEARFRAC: S((a, b, basis) => libCall('YEARFRAC', day(a), day(b), basis === undefined ? undefined : toInt(basis)), { min: 2, max: 3 }),
  NETWORKDAYS: S((a, b, h) => libCall('NETWORKDAYS', day(a), day(b), dates(h)), { arrays: [2], min: 2, max: 3 }),
  'NETWORKDAYS.INTL': S((a, b, w, h) => libCall('NETWORKDAYS.INTL', day(a), day(b), w === undefined ? 1 : w, dates(h)), { arrays: [3], min: 2, max: 4 }),
  WORKDAY: S((a, n, h) => libCall('WORKDAY', day(a), toNum(n), dates(h)), { arrays: [2], min: 2, max: 3 }),
  'WORKDAY.INTL': S((a, n, w, h) => libCall('WORKDAY.INTL', day(a), toNum(n), w === undefined ? 1 : w, dates(h)), { arrays: [3], min: 2, max: 4 }),
};
