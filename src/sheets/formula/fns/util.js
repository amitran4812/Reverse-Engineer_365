// Ways of calling a function: S lifts scalar parameters over arrays (so every
// function works inside ARRAYFORMULA), R passes values as they are, X gets the
// syntax nodes for functions that decide what to evaluate.

import { Lambda, Ref, attempt, broadcast, err, isArr, isErr } from '../core.js';

const arity = (name, n, min, max) => {
  if (n < min || n > max) {
    const want = min === max ? `${min}` : max === Infinity ? `at least ${min}` : `between ${min} and ${max}`;
    throw err('#N/A', `Wrong number of arguments to ${name}. Expected ${want} arguments, but got ${n} arguments.`);
  }
};

const argsOf = (ev, ctx, nodes) => nodes.map((n) => (n.k === 'omit' ? undefined : ev.deref(ev.eval(n, ctx))));

// Results that are arrays themselves (SPLIT inside ARRAYFORMULA) are laid side by side per row.
function joinRows(grid) {
  if (!grid.some((row) => row.some(isArr))) return grid;
  const out = [];
  for (const row of grid) {
    const parts = row.map((v) => (isArr(v) ? v : [[v]]));
    const h = Math.max(...parts.map((p) => p.length));
    for (let i = 0; i < h; i += 1) out.push(parts.flatMap((p) => p[i] || Array(p[0].length).fill(null)));
  }
  const w = Math.max(...out.map((r) => r.length));
  return out.map((r) => (r.length < w ? [...r, ...Array(w - r.length).fill(null)] : r));
}

export function S(impl, { arrays = [], errors = false, min = 0, max = Infinity } = {}) {
  const keep = typeof arrays === 'function' ? arrays : (i) => arrays.includes(i);
  return (ev, ctx, nodes, name) => {
    arity(name, nodes.length, min, max);
    const args = argsOf(ev, ctx, nodes);
    const one = (vals) => {
      if (!errors) for (let i = 0; i < vals.length; i += 1) if (!keep(i) && isErr(vals[i])) return vals[i];
      return attempt(() => impl(...vals));
    };
    const lifted = [];
    args.forEach((a, i) => {
      if (isArr(a) && !keep(i)) lifted.push(i);
    });
    if (!lifted.length) return one(args);
    const grid = broadcast(lifted.map((i) => args[i]), (...els) => {
      const vals = [...args];
      lifted.forEach((i, k) => {
        vals[i] = els[k];
      });
      return one(vals);
    });
    return joinRows(grid);
  };
}

export function R(impl, { min = 0, max = Infinity, lambdas = false } = {}) {
  return (ev, ctx, nodes, name) => {
    arity(name, nodes.length, min, max);
    const args = argsOf(ev, ctx, nodes);
    return lambdas ? impl.call(ev, ...args) : impl(...args);
  };
}

// Values plus the evaluator, for functions that call LAMBDAs or read the sheet.
export function V(impl, { min = 0, max = Infinity } = {}) {
  return (ev, ctx, nodes, name) => {
    arity(name, nodes.length, min, max);
    return impl(ev, ctx, ...argsOf(ev, ctx, nodes));
  };
}

// Like V but ranges stay ranges (ROW, OFFSET, CELL…).
export function F(impl, { min = 0, max = Infinity } = {}) {
  return (ev, ctx, nodes, name) => {
    arity(name, nodes.length, min, max);
    return impl(ev, ctx, ...nodes.map((n) => (n.k === 'omit' ? undefined : ev.eval(n, ctx))));
  };
}

export function X(impl, { min = 0, max = Infinity } = {}) {
  return (ev, ctx, nodes, name) => {
    arity(name, nodes.length, min, max);
    return impl(ev, ctx, nodes);
  };
}

export const call = (ev, fn, ...values) => {
  if (!(fn instanceof Lambda)) throw err('#VALUE!', 'Argument must be a LAMBDA.');
  return ev.deref(ev.invoke(fn, values));
};

export const isRef = (v) => v instanceof Ref;
export const opt = (v, d) => (v === undefined || v === null ? d : v);
