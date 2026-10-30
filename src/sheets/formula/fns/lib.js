// Statistical distributions, engineering and number-format functions come
// from fast-formula-parser's library, called with its argument shape.

import FormulaParser from 'fast-formula-parser';
import { err, isArr, isErr } from '../core.js';
import { S } from './util.js';

const lib = new FormulaParser().functions;

const param = (v) => (v === undefined ? undefined : { value: v === null ? 0 : v, isArray: isArr(v), isRangeRef: isArr(v), isCellRef: false });

export function libCall(name, ...args) {
  while (args.length && args[args.length - 1] === undefined) args.pop();
  const res = lib[name](...args.map(param));
  if (res === undefined) throw err('#N/A', `${name} couldn't be calculated.`);
  if (typeof res === 'number' && !Number.isFinite(res)) throw err('#NUM!', `${name} result is out of range.`);
  if (res && typeof res === 'object' && !isArr(res) && !isErr(res) && 'value' in res) return res.value;
  return res;
}

// arrays: argument positions that take whole ranges.
export const L = (name, opts = {}) => S((...a) => libCall(name, ...a), opts);
