// Curve fitting: linear and polynomial least squares (streamed normal
// equations, so millions of points are fine) and Levenberg–Marquardt for
// nonlinear models, with the usual statistics (standard errors, t and p
// values, confidence intervals, R², adjusted R², RMSE, F test).

import { evaluate, parse, references } from './expr.js';

// ---------- distributions ----------
function logGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}

// Continued fraction for the regularised incomplete beta function.
function betaCf(a, b, x) {
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

export function incBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaCf(a, b, x)) / a : 1 - (front * betaCf(b, a, 1 - x)) / b;
}

// Two-sided p value for Student's t with df degrees of freedom.
export function tPValue(t, df) {
  if (!Number.isFinite(t)) return Number.isNaN(t) ? NaN : 0;
  if (df > 1e7) return erfc(Math.abs(t) / Math.SQRT2);
  return incBeta(df / (df + t * t), df / 2, 0.5);
}

export function fPValue(f, d1, d2) {
  if (!(f >= 0)) return NaN;
  return incBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

// t such that the two-sided p value is 1 - level.
export function tCritical(df, level = 0.95) {
  const p = 1 - level;
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (tPValue(mid, df) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------- linear algebra ----------
function cholSolve(A, b) {
  const n = b.length;
  const L = A.map((r) => r.slice());
  for (let j = 0; j < n; j += 1) {
    let s = L[j][j];
    for (let k = 0; k < j; k += 1) s -= L[j][k] ** 2;
    if (!(s > 0)) return null;
    L[j][j] = Math.sqrt(s);
    for (let i = j + 1; i < n; i += 1) {
      let t = L[i][j];
      for (let k = 0; k < j; k += 1) t -= L[i][k] * L[j][k];
      L[i][j] = t / L[j][j];
    }
  }
  const y = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let k = 0; k < i; k += 1) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i];
    for (let k = i + 1; k < n; k += 1) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

function invert(A) {
  const n = A.length;
  const out = [];
  for (let j = 0; j < n; j += 1) {
    const e = Array.from({ length: n }, (_, i) => (i === j ? 1 : 0));
    const col = cholSolve(A, e);
    if (!col) return null;
    out.push(col);
  }
  return A.map((_, i) => out.map((c) => c[i]));
}

// ---------- models ----------
export const MODELS = {
  linear: { label: 'Linear', equation: 'y = a + b·x', params: ['a', 'b'] },
  poly: { label: 'Polynomial', equation: 'y = a0 + a1·x + … + an·xⁿ' },
  exp: {
    label: 'Exponential growth', equation: 'y = a·exp(b·x)', params: ['a', 'b'],
    f: (x, [a, b]) => a * Math.exp(b * x), expr: ([a, b]) => `${a}*exp(${b}*X)`,
    guess: (d) => {
      const l = logLinear(d, (x) => x, Math.log);
      return l ? [Math.exp(l[0]), l[1]] : [d.yMean || 1, 1 / (d.xRange || 1)];
    },
  },
  expdecay: {
    label: 'Exponential decay', equation: 'y = y0 + A·exp(−x/t)', params: ['y0', 'A', 't'],
    f: (x, [y0, A, t]) => y0 + A * Math.exp(-x / t), expr: ([y0, A, t]) => `${y0}+${A}*exp(-X/${t})`,
    guess: (d) => [d.yAtXMax, d.yAtXMin - d.yAtXMax, (d.xRange || 1) / 3],
  },
  power: {
    label: 'Power', equation: 'y = a·x^b', params: ['a', 'b'],
    f: (x, [a, b]) => a * x ** b, expr: ([a, b]) => `${a}*X^${b}`,
    guess: (d) => logLinear(d, Math.log, Math.log)?.map((v, i) => (i ? v : Math.exp(v))) || [1, 1],
  },
  log: {
    label: 'Logarithmic', equation: 'y = a + b·ln(x)', params: ['a', 'b'],
    f: (x, [a, b]) => a + b * Math.log(x), expr: ([a, b]) => `${a}+${b}*ln(X)`,
    guess: (d) => logLinear(d, Math.log, (y) => y) || [0, 1],
  },
  gauss: {
    label: 'Gaussian', equation: 'y = y0 + A·exp(−(x−xc)²/(2w²))', params: ['y0', 'A', 'xc', 'w'],
    f: (x, [y0, A, xc, w]) => y0 + A * Math.exp(-((x - xc) ** 2) / (2 * w * w)), expr: ([y0, A, xc, w]) => `${y0}+${A}*exp(-((X-${xc})^2)/(2*${w}^2))`,
    guess: (d) => [d.yMin, d.yMax - d.yMin, d.xAtYMax, (d.fwhm || d.xRange / 4 || 1) / 2.3548],
  },
  lorentz: {
    label: 'Lorentzian', equation: 'y = y0 + (2A/π)·w/(4(x−xc)² + w²)', params: ['y0', 'A', 'xc', 'w'],
    f: (x, [y0, A, xc, w]) => y0 + ((2 * A) / Math.PI) * (w / (4 * (x - xc) ** 2 + w * w)), expr: ([y0, A, xc, w]) => `${y0}+(2*${A}/pi)*(${w}/(4*(X-${xc})^2+${w}^2))`,
    guess: (d) => {
      const w = d.fwhm || d.xRange / 4 || 1;
      return [d.yMin, ((d.yMax - d.yMin) * Math.PI * w) / 2, d.xAtYMax, w];
    },
  },
  boltzmann: {
    label: 'Sigmoid (Boltzmann)', equation: 'y = A2 + (A1 − A2)/(1 + exp((x − x0)/dx))', params: ['A1', 'A2', 'x0', 'dx'],
    f: (x, [A1, A2, x0, dx]) => A2 + (A1 - A2) / (1 + Math.exp((x - x0) / dx)), expr: ([A1, A2, x0, dx]) => `${A2}+(${A1}-${A2})/(1+exp((X-${x0})/${dx}))`,
    guess: (d) => [d.yAtXMin, d.yAtXMax, d.xMid, (d.xRange || 1) / 10],
  },
  logistic: {
    label: 'Logistic (4 parameter)', equation: 'y = d + (a − d)/(1 + (x/c)^b)', params: ['a', 'b', 'c', 'd'],
    f: (x, [a, b, c, dd]) => dd + (a - dd) / (1 + (x / c) ** b), expr: ([a, b, c, dd]) => `${dd}+(${a}-${dd})/(1+(X/${c})^${b})`,
    guess: (d) => [d.yAtXMin, 1, d.xMid > 0 ? d.xMid : 1, d.yAtXMax],
  },
  michaelis: {
    label: 'Michaelis–Menten', equation: 'y = Vmax·x/(Km + x)', params: ['Vmax', 'Km'],
    f: (x, [V, K]) => (V * x) / (K + x), expr: ([V, K]) => `${V}*X/(${K}+X)`,
    guess: (d) => [d.yMax, d.xAtHalfMax || d.xMid || 1],
  },
  custom: { label: 'Custom equation', equation: 'y = f(x; a, b, …)' },
};

function logLinear(d, fx, fy) {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < d.x.length; i += 1) {
    const x = fx(d.x[i]);
    const y = fy(d.y[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (n < 2 || !den) return null;
  const b = (n * sxy - sx * sy) / den;
  return [(sy - b * sx) / n, b];
}

// Shape of the data, used for starting values.
function describe(x, y) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let yAtXMin = 0;
  let yAtXMax = 0;
  let xAtYMax = 0;
  let sy = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (x[i] < xMin) {
      xMin = x[i];
      yAtXMin = y[i];
    }
    if (x[i] > xMax) {
      xMax = x[i];
      yAtXMax = y[i];
    }
    if (y[i] < yMin) yMin = y[i];
    if (y[i] > yMax) {
      yMax = y[i];
      xAtYMax = x[i];
    }
    sy += y[i];
  }
  const half = (yMax + yMin) / 2;
  let lo = Infinity;
  let hi = -Infinity;
  let xHalf = Infinity;
  let best = Infinity;
  for (let i = 0; i < x.length; i += 1) {
    if (y[i] >= half) {
      lo = Math.min(lo, x[i]);
      hi = Math.max(hi, x[i]);
    }
    const dist = Math.abs(y[i] - yMax / 2);
    if (dist < best) {
      best = dist;
      xHalf = x[i];
    }
  }
  return {
    x, y, xMin, xMax, yMin, yMax, yAtXMin, yAtXMax, xAtYMax, yMean: sy / x.length, xRange: xMax - xMin, xMid: (xMin + xMax) / 2,
    fwhm: hi > lo ? hi - lo : 0, xAtHalfMax: xHalf,
  };
}

function finishStats(res, n, p, sse, sst) {
  const dof = n - p;
  const mse = dof > 0 ? sse / dof : NaN;
  res.n = n;
  res.dof = dof;
  res.sse = sse;
  res.r2 = sst > 0 ? 1 - sse / sst : NaN;
  res.adjR2 = sst > 0 && dof > 0 ? 1 - (sse / dof) / (sst / (n - 1)) : NaN;
  res.rmse = Math.sqrt(mse);
  res.redChi2 = mse;
  if (p > 1 && dof > 0 && sst > 0) {
    res.f = ((sst - sse) / (p - 1)) / mse;
    res.fP = fPValue(res.f, p - 1, dof);
  }
  return res;
}

function paramTable(names, values, cov, dof) {
  const tc = dof > 0 ? tCritical(dof) : NaN;
  return names.map((name, i) => {
    const se = cov ? Math.sqrt(Math.max(0, cov[i][i])) : NaN;
    const t = values[i] / se;
    return { name, value: values[i], se, t, p: dof > 0 ? tPValue(t, dof) : NaN, lo: values[i] - tc * se, hi: values[i] + tc * se };
  });
}

// Polynomial (degree 1 = linear) through streamed normal equations on a
// centred and scaled x, then mapped back to coefficients of plain x.
export function polyFit(x, y, degree = 1) {
  const m = degree + 1;
  let n = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  for (let i = 0; i < x.length; i += 1) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      n += 1;
      if (x[i] < xMin) xMin = x[i];
      if (x[i] > xMax) xMax = x[i];
    }
  }
  if (n < m + 1) throw new Error(`A degree ${degree} fit needs at least ${m + 1} points with values`);
  const c = (xMin + xMax) / 2;
  const s = (xMax - xMin) / 2 || 1;
  const A = Array.from({ length: m }, () => new Array(m).fill(0));
  const b = new Array(m).fill(0);
  const pw = new Array(2 * m).fill(0);
  let sy = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i += 1) {
    const yi = y[i];
    if (!Number.isFinite(x[i]) || !Number.isFinite(yi)) continue;
    const u = (x[i] - c) / s;
    let t = 1;
    for (let k = 0; k < 2 * m - 1; k += 1) {
      pw[k] += t;
      if (k < m) b[k] += t * yi;
      t *= u;
    }
    sy += yi;
    syy += yi * yi;
  }
  for (let i = 0; i < m; i += 1) for (let j = 0; j < m; j += 1) A[i][j] = pw[i + j];
  const beta = cholSolve(A, b);
  if (!beta) throw new Error('The fit is singular: x needs more distinct values');
  let sse = syy;
  for (let i = 0; i < m; i += 1) sse -= beta[i] * b[i];
  let sseExact = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    const u = (x[i] - c) / s;
    let f = 0;
    for (let k = m - 1; k >= 0; k -= 1) f = f * u + beta[k];
    sseExact += (y[i] - f) ** 2;
  }
  sse = sseExact;
  const sst = syy - (sy * sy) / n;
  // T maps scaled coefficients to raw-x coefficients: (u)^k = ((x - c)/s)^k.
  const T = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let k = 0; k < m; k += 1) {
    for (let j = 0; j <= k; j += 1) T[j][k] = binom(k, j) * (-c) ** (k - j) / s ** k;
  }
  const coef = T.map((row) => row.reduce((acc, v, k) => acc + v * beta[k], 0));
  const dof = n - m;
  const inv = invert(A);
  const mse = dof > 0 ? sse / dof : NaN;
  const cov = inv && T.map((ri) => T.map((rj) => {
    let acc = 0;
    for (let a = 0; a < m; a += 1) for (let bb = 0; bb < m; bb += 1) acc += ri[a] * inv[a][bb] * rj[bb];
    return acc * mse;
  }));
  const names = degree === 1 ? ['a (intercept)', 'b (slope)'] : coef.map((_, k) => `a${k}`);
  const res = {
    model: degree === 1 ? 'linear' : 'poly', degree, coef, params: paramTable(names, coef, cov, dof),
    equation: polyEquation(coef),
  };
  finishStats(res, n, m, sse, sst);
  if (degree === 1) res.pearson = Math.sign(coef[1]) * Math.sqrt(Math.max(0, res.r2));
  return res;
}

function binom(n, k) {
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}

const fmt = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v));

function polyEquation(coef) {
  const terms = coef.map((v, k) => (k === 0 ? fmt(v) : `${v < 0 ? '−' : '+'} ${fmt(Math.abs(v))}${k === 1 ? '·x' : `·x${'⁰¹²³⁴⁵⁶⁷⁸⁹'[k] || `^${k}`}`}`));
  return `y = ${terms.join(' ')}`.replace('y = -', 'y = −');
}

// Builds f(x, params) for a custom equation such as "a*exp(-x/b) + c".
export function customModel(equation, initial = {}) {
  const src = String(equation).replace(/^\s*y\s*=/i, '');
  const ast = parse(src);
  const refs = references(ast);
  const xName = [...refs.ids].find((id) => id.toLowerCase() === 'x') || 'x';
  const reserved = new Set(['x', 'pi', 'e', 'true', 'false', 'null', 'nan']);
  const params = [...refs.ids].filter((id) => !reserved.has(id.toLowerCase()));
  if (!params.length) throw new Error('The equation needs at least one parameter, such as a or b');
  if (refs.cols.size) throw new Error('Use x for the X values in a fit equation, not a column name');
  const run = (xs, p) => {
    const vars = { [xName]: xs };
    params.forEach((name, i) => {
      vars[name] = p[i];
    });
    const out = evaluate(ast, { n: xs.length, vars, column: () => undefined });
    return typeof out === 'number' ? new Float64Array(xs.length).fill(out) : out;
  };
  return {
    label: 'Custom equation', equation: `y = ${src.trim()}`, params, custom: true,
    fv: run,
    f: (x, p) => run(Float64Array.of(x), p)[0],
    expr: (p) => params.reduce((s, name, i) => s.replace(new RegExp(`\\b${name}\\b`, 'g'), `(${p[i]})`), src).replace(new RegExp(`\\b${xName}\\b`, 'g'), 'X'),
    guess: () => params.map((name) => (Number.isFinite(Number(initial[name])) ? Number(initial[name]) : 1)),
  };
}

// Levenberg–Marquardt with a forward-difference Jacobian.
export function nonlinearFit(xIn, yIn, modelId, opts = {}) {
  const model = modelId === 'custom' ? customModel(opts.equation, opts.initial) : MODELS[modelId];
  if (!model?.params) throw new Error(`Unknown fit model ${modelId}`);
  const xs = [];
  const ys = [];
  for (let i = 0; i < xIn.length; i += 1) {
    if (Number.isFinite(xIn[i]) && Number.isFinite(yIn[i])) {
      xs.push(xIn[i]);
      ys.push(yIn[i]);
    }
  }
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const n = x.length;
  const pn = model.params.length;
  if (n <= pn) throw new Error(`This model needs more than ${pn} points with values`);
  const d = describe(x, y);
  let p = opts.start?.length === pn ? opts.start.slice() : model.guess(d).map((v) => (Number.isFinite(v) ? v : 1));
  const evalAll = (params) => {
    if (model.fv) return model.fv(x, params);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i += 1) out[i] = model.f(x[i], params);
    return out;
  };
  const sseOf = (f) => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += (y[i] - f[i]) ** 2;
    return Number.isFinite(s) ? s : Infinity;
  };
  let f = evalAll(p);
  let sse = sseOf(f);
  let lambda = 1e-3;
  let iterations = 0;
  let converged = false;
  let J = null;
  const jac = () => {
    const cols = [];
    for (let k = 0; k < pn; k += 1) {
      const h = 1e-7 * Math.max(Math.abs(p[k]), 1e-4);
      const q = p.slice();
      q[k] += h;
      const fk = evalAll(q);
      const col = new Float64Array(n);
      for (let i = 0; i < n; i += 1) col[i] = (fk[i] - f[i]) / h;
      cols.push(col);
    }
    return cols;
  };
  const normal = (cols) => {
    const A = Array.from({ length: pn }, () => new Array(pn).fill(0));
    const g = new Array(pn).fill(0);
    for (let a = 0; a < pn; a += 1) {
      const ca = cols[a];
      for (let i = 0; i < n; i += 1) g[a] += ca[i] * (y[i] - f[i]);
      for (let b = a; b < pn; b += 1) {
        const cb = cols[b];
        let s = 0;
        for (let i = 0; i < n; i += 1) s += ca[i] * cb[i];
        A[a][b] = s;
        A[b][a] = s;
      }
    }
    return { A, g };
  };
  const maxIter = opts.maxIter || 400;
  while (iterations < maxIter) {
    iterations += 1;
    J = jac();
    const { A, g } = normal(J);
    let improved = false;
    for (let tries = 0; tries < 30; tries += 1) {
      const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const delta = cholSolve(M, g);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const q = p.map((v, i) => v + delta[i]);
      const fq = evalAll(q);
      const sq = sseOf(fq);
      if (sq < sse) {
        const rel = (sse - sq) / Math.max(sse, 1e-300);
        const step = Math.max(...delta.map((v, i) => Math.abs(v) / (Math.abs(p[i]) + 1e-12)));
        p = q;
        f = fq;
        sse = sq;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (rel < 1e-12 || step < 1e-10) converged = true;
        break;
      }
      lambda *= 10;
      if (lambda > 1e16) break;
    }
    if (!improved) {
      converged = true;
      break;
    }
    if (converged) break;
  }
  J = jac();
  const { A } = normal(J);
  const dof = n - pn;
  const inv = invert(A);
  const mse = dof > 0 ? sse / dof : NaN;
  const cov = inv && inv.map((r) => r.map((v) => v * mse));
  let sy = 0;
  for (let i = 0; i < n; i += 1) sy += y[i];
  let sst = 0;
  for (let i = 0; i < n; i += 1) sst += (y[i] - sy / n) ** 2;
  const res = {
    model: modelId, label: model.label, coef: p, params: paramTable(model.params, p, cov, dof), iterations, converged,
    equation: model.equation, paramNames: model.params, ...(modelId === 'custom' ? { custom: opts.equation } : {}),
  };
  if (!Number.isFinite(sse)) throw new Error('The fit did not converge. Try another model or starting values.');
  return finishStats(res, n, pn, sse, sst);
}

export function fit(x, y, spec) {
  if (spec.model === 'linear') return polyFit(x, y, 1);
  if (spec.model === 'poly') return polyFit(x, y, Math.max(1, Math.min(9, Math.round(spec.degree || 2))));
  return nonlinearFit(x, y, spec.model, spec);
}

// Curve value at x for a finished fit result.
export function curveFn(res) {
  if (res.model === 'linear' || res.model === 'poly') {
    const c = res.coef;
    return (x) => {
      let v = 0;
      for (let k = c.length - 1; k >= 0; k -= 1) v = v * x + c[k];
      return v;
    };
  }
  const model = res.model === 'custom' ? customModel(res.custom) : MODELS[res.model];
  return (x) => model.f(x, res.coef);
}

// The fitted curve as a calculated-column formula over column X.
export function fitExpression(res, xRef) {
  let body;
  if (res.model === 'linear' || res.model === 'poly') body = res.coef.map((v, k) => (k === 0 ? `${v}` : `${v}*X^${k}`)).join('+');
  else body = (res.model === 'custom' ? customModel(res.custom) : MODELS[res.model]).expr(res.coef);
  return body.replace(/\bX\b/g, xRef).replace(/\+-/g, '-');
}
