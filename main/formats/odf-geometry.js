'use strict';

// Draws OpenDocument custom shapes (draw:enhanced-geometry): evaluates the
// shape's equations and turns its enhanced path into SVG path data in a
// w x h pixel box. Shapes with no path fall back to a matching preset.

const { presetPath } = require('./pptx-import');
const { all, attr } = require('./odf');

const round = (n) => Math.round(n * 100) / 100;

// ---------- formulas

function tokenize(src) {
  const out = [];
  const re = /\s*(\?[a-z_]\w*|\$\d+|[a-z_]\w*|\d*\.?\d+(?:e-?\d+)?|[-+*/(),])/giy;
  let m;
  while ((m = re.exec(src)) && m[1] !== undefined) out.push(m[1]);
  return out;
}

const FN = {
  abs: Math.abs, sqrt: (x) => Math.sqrt(Math.max(0, x)), sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, atan2: Math.atan2,
  min: Math.min, max: Math.max, if: (c, a, b) => (c > 0 ? a : b),
};

// A small recursive-descent evaluator (no eval): + - * / unary minus, calls, names.
function evaluate(src, lookup) {
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const next = () => t[i++];
  const primary = () => {
    const tok = next();
    if (tok === undefined) return 0;
    if (tok === '(') {
      const v = expr();
      if (peek() === ')') next();
      return v;
    }
    if (tok === '-') return -primary();
    if (tok === '+') return primary();
    if (/^[\d.]/.test(tok)) return Number(tok);
    const name = tok.toLowerCase();
    if (FN[name] && peek() === '(') {
      next();
      const args = [];
      while (peek() !== undefined && peek() !== ')') {
        args.push(expr());
        if (peek() === ',') next();
      }
      next();
      return FN[name](...args);
    }
    return lookup(tok);
  };
  const term = () => {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = next();
      const r = primary();
      v = op === '*' ? v * r : r ? v / r : 0;
    }
    return v;
  };
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term();
    return v;
  }
  const v = expr();
  return Number.isFinite(v) ? v : 0;
}

// ---------- paths

const ARGS = { M: 2, L: 2, C: 6, Q: 4, T: 6, U: 6, A: 8, B: 8, W: 8, V: 8, X: 2, Y: 2, G: 4, Z: 0, N: 0, F: 0, S: 0 };

// Shape types LibreOffice and others write, for shapes saved without a path.
const TYPE = {
  rectangle: 'rect', 'round-rectangle': 'roundRect', ellipse: 'ellipse', circle: 'ellipse', 'isosceles-triangle': 'triangle', 'right-triangle': 'rtTriangle',
  diamond: 'diamond', parallelogram: 'parallelogram', trapezoid: 'trapezoid', hexagon: 'hexagon', octagon: 'octagon', pentagon: 'pentagon',
  star4: 'star4', star5: 'star5', star6: 'star6', star8: 'star8', star12: 'star12', star24: 'star12', 'right-arrow': 'rightArrow', 'left-arrow': 'leftArrow',
  'up-arrow': 'upArrow', 'down-arrow': 'downArrow', 'left-right-arrow': 'leftRightArrow', chevron: 'chevron', 'pentagon-right': 'homePlate', cross: 'plus',
  can: 'can', frame: 'frame', 'flowchart-process': 'rect', 'flowchart-decision': 'diamond', 'flowchart-terminator': 'flowChartTerminator', 'round-rectangular-callout': 'wedgeRoundRectCallout', 'rectangular-callout': 'wedgeRectCallout',
};

// enhanced-geometry -> [{ d, fill, stroke }] in a w x h box; box is the shape size in cm.
function enhancedPaths(geo, w, h, boxCm) {
  const type = attr(geo, 'draw:type') || '';
  const src = attr(geo, 'drawooo:enhanced-path') || attr(geo, 'draw:enhanced-path');
  const mods = (attr(geo, 'draw:modifiers') || '').trim().split(/\s+/).filter(Boolean).map(Number);
  if (!src) {
    const prst = TYPE[type] || (type.startsWith('ooxml-') ? type.slice(6) : 'rect');
    return [{ d: presetPath(prst, w, h, mods.length ? { adj: mods[0], adj1: mods[0], adj2: mods[1] } : {}), fill: true, stroke: true }];
  }
  let [vx, vy, vw, vh] = (attr(geo, 'svg:viewBox') || '0 0 21600 21600').trim().split(/\s+/).map(Number);
  const logW = boxCm.w * 1000;
  const logH = boxCm.h * 1000;
  if (!vw || !vh) [vx, vy, vw, vh] = [0, 0, logW || 1, logH || 1];
  const eqs = {};
  for (const e of all(geo, 'draw:equation')) eqs[attr(e, 'draw:name')] = attr(e, 'draw:formula') || '0';
  const memo = {};
  const consts = { pi: Math.PI, left: vx, top: vy, right: vx + vw, bottom: vy + vh, width: vw, height: vh, logwidth: logW || vw, logheight: logH || vh, xstretch: 1, ystretch: 1, hasstroke: 1, hasfill: 1 };
  const busy = new Set();
  const lookup = (tok) => {
    if (tok[0] === '$') return mods[Number(tok.slice(1))] || 0;
    if (tok[0] === '?') {
      const n = tok.slice(1);
      if (n in memo) return memo[n];
      if (busy.has(n) || !(n in eqs)) return 0;
      busy.add(n);
      memo[n] = evaluate(eqs[n], lookup);
      busy.delete(n);
      return memo[n];
    }
    return consts[tok.toLowerCase()] ?? 0;
  };
  const sx = w / vw;
  const sy = h / vh;
  const X = (v) => (v - vx) * sx;
  const Y = (v) => (v - vy) * sy;
  const tokens = src.match(/[A-Za-z]+|\?\w+|\$\d+|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const out = [];
  let d = '';
  let fill = true;
  let stroke = true;
  let cx = 0;
  let cy = 0;
  let sxp = 0;
  let syp = 0;
  const val = (tok) => (/^-?[\d.]/.test(tok) ? Number(tok) : lookup(tok));
  const pt = (x, y) => `${round(x)},${round(y)}`;
  const flush = () => {
    if (d) out.push({ d, fill, stroke });
    d = '';
    fill = true;
    stroke = true;
  };
  // Arc around a centre (px) from angle a0 to a1 (radians, y down), in pieces of at most 90 degrees.
  const arc = (ccx, ccy, rx, ry, a0, a1, move) => {
    const p0 = [ccx + rx * Math.cos(a0), ccy + ry * Math.sin(a0)];
    d += `${move || !d ? 'M' : 'L'}${pt(...p0)}`;
    const steps = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
    for (let s = 1; s <= steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps;
      d += `A${round(rx)},${round(ry)} 0 0 ${a1 > a0 ? 1 : 0} ${pt(ccx + rx * Math.cos(a), ccy + ry * Math.sin(a))}`;
    }
    cx = ccx + rx * Math.cos(a1);
    cy = ccy + ry * Math.sin(a1);
  };
  let cmd = 'M';
  let quad = 'X';
  for (let i = 0; i < tokens.length; ) {
    if (/^[A-Za-z]$/.test(tokens[i]) && tokens[i] in ARGS) {
      cmd = tokens[i++];
      quad = cmd;
      if (cmd === 'Z') {
        d += 'Z';
        cx = sxp;
        cy = syp;
        continue;
      }
      if (cmd === 'N') {
        flush();
        continue;
      }
      if (cmd === 'F') {
        fill = false;
        continue;
      }
      if (cmd === 'S') {
        stroke = false;
        continue;
      }
    } else if (/^[A-Za-z]/.test(tokens[i]) && !(tokens[i].toLowerCase() in consts)) {
      i += 1; // unknown command
      continue;
    }
    const n = ARGS[cmd];
    if (!n) {
      i += 1;
      continue;
    }
    const a = [];
    for (let j = 0; j < n && i < tokens.length && !(/^[A-Za-z]$/.test(tokens[i]) && tokens[i] in ARGS); j++) a.push(val(tokens[i++]));
    if (a.length < n) continue;
    switch (cmd) {
      case 'M':
        [cx, cy] = [X(a[0]), Y(a[1])];
        [sxp, syp] = [cx, cy];
        d += `M${pt(cx, cy)}`;
        cmd = 'L';
        break;
      case 'L':
        [cx, cy] = [X(a[0]), Y(a[1])];
        d += `${d ? 'L' : 'M'}${pt(cx, cy)}`;
        break;
      case 'C':
        d += `C${pt(X(a[0]), Y(a[1]))} ${pt(X(a[2]), Y(a[3]))} ${pt(X(a[4]), Y(a[5]))}`;
        [cx, cy] = [X(a[4]), Y(a[5])];
        break;
      case 'Q':
        d += `Q${pt(X(a[0]), Y(a[1]))} ${pt(X(a[2]), Y(a[3]))}`;
        [cx, cy] = [X(a[2]), Y(a[3])];
        break;
      case 'T':
      case 'U': {
        // angle-ellipse: centre, radii, start and end angle in degrees, counter-clockwise on screen
        const rad = (g) => (-g * Math.PI) / 180;
        let a0 = rad(a[4]);
        let a1 = rad(a[5]);
        if (a1 > a0) a1 -= 2 * Math.PI;
        if (Math.abs(a[5] - a[4]) >= 360) a1 = a0 - 2 * Math.PI;
        arc(X(a[0]), Y(a[1]), a[2] * sx, a[3] * sy, a0, a1, cmd === 'U');
        if (cmd === 'U') [sxp, syp] = [X(a[0]) + a[2] * sx * Math.cos(a0), Y(a[1]) + a[3] * sy * Math.sin(a0)];
        break;
      }
      case 'A':
      case 'B':
      case 'W':
      case 'V': {
        const [x1, y1, x2, y2] = [X(a[0]), Y(a[1]), X(a[2]), Y(a[3])];
        const ccx = (x1 + x2) / 2;
        const ccy = (y1 + y2) / 2;
        const rx = Math.abs(x2 - x1) / 2 || 1;
        const ry = Math.abs(y2 - y1) / 2 || 1;
        const ang = (px, py) => Math.atan2((py - ccy) / ry, (px - ccx) / rx);
        let a0 = ang(X(a[4]), Y(a[5]));
        let a1 = ang(X(a[6]), Y(a[7]));
        const clockwise = cmd === 'W' || cmd === 'V';
        if (clockwise && a1 <= a0) a1 += 2 * Math.PI;
        if (!clockwise && a1 >= a0) a1 -= 2 * Math.PI;
        arc(ccx, ccy, rx, ry, a0, a1, cmd === 'B' || cmd === 'V');
        break;
      }
      case 'X':
      case 'Y': {
        const [ex, ey] = [X(a[0]), Y(a[1])];
        const xFirst = quad === 'X';
        const ccx = xFirst ? cx : ex;
        const ccy = xFirst ? ey : cy;
        const a0 = Math.atan2(cy - ccy, cx - ccx);
        let a1 = Math.atan2(ey - ccy, ex - ccx);
        if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
        if (a0 - a1 > Math.PI) a1 += 2 * Math.PI;
        const rx = Math.abs(ex - cx) || 0.01;
        const ry = Math.abs(ey - cy) || 0.01;
        d += `A${round(rx)},${round(ry)} 0 0 ${a1 > a0 ? 1 : 0} ${pt(ex, ey)}`;
        [cx, cy] = [ex, ey];
        quad = xFirst ? 'Y' : 'X';
        break;
      }
      case 'G': {
        // arcangleto, as in OOXML: radii, start and sweep angles in degrees
        const wr = a[0] * sx;
        const hr = a[1] * sy;
        const st = (a[2] * Math.PI) / 180;
        const sw = (a[3] * Math.PI) / 180;
        const ox = cx - wr * Math.cos(st);
        const oy = cy - hr * Math.sin(st);
        if (!d) d = `M${pt(cx, cy)}`;
        const steps = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2)));
        for (let s = 1; s <= steps; s++) {
          const t = st + (sw * s) / steps;
          d += `A${round(wr)},${round(hr)} 0 0 ${sw > 0 ? 1 : 0} ${pt(ox + wr * Math.cos(t), oy + hr * Math.sin(t))}`;
        }
        cx = ox + wr * Math.cos(st + sw);
        cy = oy + hr * Math.sin(st + sw);
        break;
      }
      default:
        break;
    }
  }
  flush();
  return out.length ? out : [{ d: `M0,0H${round(w)}V${round(h)}H0Z`, fill: true, stroke: true }];
}

module.exports = { enhancedPaths, evaluate };
