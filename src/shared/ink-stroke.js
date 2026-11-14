// Pen strokes shared by Notes' drawing pad and Read: how hard the pen presses
// sets the width, a pressure stroke is split into runs of one width so it can
// be drawn as plain lines (on screen and in a PDF), and the eraser rubs out
// parts of a stroke. No DOM here, so the tests can load it.
//
// A path is flat [x, y, x, y…]; its pressure (or null) has one value, 0 to 1,
// per point.

export const PEN_COLORS = ['#1f2328', '#2a6fdb', '#d13b3b', '#19a979', '#e8a317', '#8c62c9'];

// 0.5 (a mouse, or a pen pressing normally) keeps the chosen width.
export const pressureScale = (p) => 0.35 + 1.3 * p;

// The pressure of a pointer event, or 0.5 when the device doesn't report one.
export function pointerPressure(e) {
  if (e.pointerType === 'pen' || (e.pressure > 0 && e.pressure !== 0.5)) return e.pressure > 0 ? e.pressure : 0.5;
  return 0.5;
}

// The pen, and its eraser end or eraser button.
export const isPenEraser = (e) => e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);

// Drops points closer than `min` to the last kept one, keeping pressure in step.
export function thinStroke(path, pressure, min = 0.6) {
  const out = path.slice(0, 2);
  const pr = pressure ? [pressure[0]] : null;
  const n = path.length / 2;
  for (let i = 1; i < n; i++) {
    const dx = path[i * 2] - out[out.length - 2];
    const dy = path[i * 2 + 1] - out[out.length - 1];
    if (dx * dx + dy * dy >= min * min || i === n - 1) {
      out.push(path[i * 2], path[i * 2 + 1]);
      pr?.push(pressure[i]);
    }
  }
  return { path: out, pressure: pr };
}

const round = (v, k = 100) => Math.round(v * k) / k;

// Splits a stroke into runs of points drawn with one line width each. Widths
// step in quarters of the pen width so a stroke is only a few lines; neighbour
// runs share their end point and round caps hide the joins.
export function pressureRuns(path, pressure, width) {
  const n = path.length / 2;
  if (!pressure || pressure.length !== n || n < 2) return [{ w: width, pts: path }];
  const step = Math.max(0.1, width / 4);
  const smooth = pressure.map((p, i) => ((pressure[i - 1] ?? p) + 2 * p + (pressure[i + 1] ?? p)) / 4);
  const at = (i) => Math.max(0.3, Math.round((width * pressureScale(smooth[i])) / step) * step);
  const runs = [];
  let cur = null;
  for (let i = 1; i < n; i++) {
    const w = round(Math.max(0.3, Math.round(((at(i - 1) + at(i)) / 2) / step) * step));
    if (!cur || cur.w !== w) {
      cur = { w, pts: [path[(i - 1) * 2], path[(i - 1) * 2 + 1]] };
      runs.push(cur);
    }
    cur.pts.push(path[i * 2], path[i * 2 + 1]);
  }
  return runs;
}

// How close (x, y) comes to a path, as the distance to its nearest segment.
export function pathDistance(path, x, y) {
  let best = Infinity;
  const n = path.length / 2;
  if (n === 1) return Math.hypot(path[0] - x, path[1] - y);
  for (let i = 1; i < n; i++) {
    const ax = path[i * 2 - 2];
    const ay = path[i * 2 - 1];
    const bx = path[i * 2];
    const by = path[i * 2 + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return best;
}

// Adds points so none are further apart than `step`, so the eraser can cut a
// long straight line in the middle.
function resample(path, pressure, step) {
  const out = path.slice(0, 2);
  const pr = pressure ? [pressure[0]] : null;
  for (let i = 1; i < path.length / 2; i++) {
    const ax = path[i * 2 - 2];
    const ay = path[i * 2 - 1];
    const bx = path[i * 2];
    const by = path[i * 2 + 1];
    const k = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let j = 1; j <= k; j++) {
      const t = j / k;
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      pr?.push(pressure[i - 1] + (pressure[i] - pressure[i - 1]) * t);
    }
  }
  return { path: out, pressure: pr };
}

// Rubs out the part of a stroke within r of (x, y). Returns null when the
// eraser missed, else the pieces left (maybe none).
export function erasePath(path, pressure, x, y, r) {
  if (pathDistance(path, x, y) > r) return null;
  const fine = resample(path, pressure, Math.max(0.25, r / 3));
  const pieces = [];
  let cur = null;
  for (let i = 0; i < fine.path.length / 2; i++) {
    const px = fine.path[i * 2];
    const py = fine.path[i * 2 + 1];
    if (Math.hypot(px - x, py - y) <= r) {
      cur = null;
      continue;
    }
    if (!cur) {
      cur = { path: [], pressure: fine.pressure ? [] : null };
      pieces.push(cur);
    }
    cur.path.push(round(px), round(py));
    cur.pressure?.push(round(fine.pressure[i]));
  }
  return pieces.filter((p) => p.path.length >= 4).map((p) => thinStroke(p.path, p.pressure, 0.6));
}
