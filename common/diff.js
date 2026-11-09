'use strict';

// Text differences for LaTeX projects: line hunks for version history, and
// word-level changes (as character ranges) for track changes.

const MAX_D = 4000;

// Myers' O(ND) diff of two arrays. Returns runs of { op: '=', '-', '+', a, b, n }
// where a and b are start indexes and n the run length.
function myers(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const runs = [];
  const push = (op, i, j, n) => {
    if (!n) return;
    const last = runs[runs.length - 1];
    if (last && last.op === op && last.a + (op === '+' ? 0 : last.n) === i && last.b + (op === '-' ? 0 : last.n) === j) last.n += n;
    else runs.push({ op, a: i, b: j, n });
  };
  push('=', 0, 0, start);
  const N = endA - start;
  const M = endB - start;
  if (N === 0 || M === 0) {
    push('-', start, start, N);
    push('+', endA, start, M);
  } else {
    const max = N + M;
    const off = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= Math.min(max, MAX_D); d++) {
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a[start + x] === b[start + y]) {
          x += 1;
          y += 1;
        }
        v[off + k] = x;
        if (x >= N && y >= M) {
          found = d;
          break;
        }
      }
      if (found >= 0) break;
    }
    if (found < 0) {
      push('-', start, start, N);
      push('+', endA, start, M);
    } else {
      const steps = [];
      let x = N;
      let y = M;
      for (let d = found; d > 0; d--) {
        const pv = trace[d];
        const k = x - y;
        const prevK = k === -d || (k !== d && pv[off + k - 1] < pv[off + k + 1]) ? k + 1 : k - 1;
        const px = pv[off + prevK];
        const py = px - prevK;
        while (x > px && y > py) {
          steps.push(['=', x - 1, y - 1]);
          x -= 1;
          y -= 1;
        }
        if (x === px) steps.push(['+', x, y - 1]);
        else steps.push(['-', x - 1, y]);
        x = px;
        y = py;
      }
      while (x > 0 && y > 0) {
        steps.push(['=', x - 1, y - 1]);
        x -= 1;
        y -= 1;
      }
      steps.reverse();
      for (const [op, i, j] of steps) push(op, start + i, start + j, 1);
    }
  }
  push('=', endA, endB, a.length - endA);
  return runs;
}

const splitLines = (s) => (s === '' ? [] : s.split('\n'));

// Line hunks for showing two versions side by side: [{ type: 'same'|'del'|'add', lines, aLine, bLine }].
function lineDiff(a, b) {
  const A = splitLines(a);
  const B = splitLines(b);
  return myers(A, B).map((r) => ({
    type: r.op === '=' ? 'same' : r.op === '-' ? 'del' : 'add',
    lines: (r.op === '+' ? B.slice(r.b, r.b + r.n) : A.slice(r.a, r.a + r.n)),
    aLine: r.a + 1,
    bLine: r.b + 1,
  }));
}

// How many lines were added and removed.
function lineStats(a, b) {
  let added = 0;
  let removed = 0;
  for (const h of lineDiff(a, b)) {
    if (h.type === 'add') added += h.lines.length;
    if (h.type === 'del') removed += h.lines.length;
  }
  return { added, removed };
}

const tokens = (s) => s.match(/\\[a-zA-Z@]+\*?|[\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]/gu) || [];

// Word-level changes from a to b as character ranges:
// [{ from, to, insert, aFrom, aTo }] where from/to are in b and aFrom/aTo in a.
// "insert" is the text in a that b replaced (empty for a pure insertion).
function wordChanges(a, b) {
  if (a === b) return [];
  const A = splitKeep(a);
  const B = splitKeep(b);
  const lineRuns = myers(A, B);
  const out = [];
  const aPos = offsets(A);
  const bPos = offsets(B);
  for (let i = 0; i < lineRuns.length; i++) {
    const r = lineRuns[i];
    if (r.op === '=') continue;
    // Pair a deletion with the insertion right after it.
    let del = '';
    let ins = '';
    let aStart = aPos[r.a];
    let bStart = bPos[r.b];
    if (r.op === '-') {
      del = A.slice(r.a, r.a + r.n).join('');
      const next = lineRuns[i + 1];
      if (next && next.op === '+') {
        ins = B.slice(next.b, next.b + next.n).join('');
        i += 1;
      }
    } else {
      ins = B.slice(r.b, r.b + r.n).join('');
    }
    for (const c of fineChanges(del, ins)) out.push({ from: bStart + c.bFrom, to: bStart + c.bTo, aFrom: aStart + c.aFrom, aTo: aStart + c.aTo, deleted: del.slice(c.aFrom, c.aTo) });
  }
  return out;
}

function splitKeep(s) {
  const parts = s.split(/(?<=\n)/);
  return parts.length === 1 && parts[0] === '' ? [] : parts;
}

function offsets(parts) {
  const out = [0];
  for (const p of parts) out.push(out[out.length - 1] + p.length);
  return out;
}

function fineChanges(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (A.length * B.length > 4e6) return [{ aFrom: 0, aTo: a.length, bFrom: 0, bTo: b.length }];
  const aPos = offsets(A);
  const bPos = offsets(B);
  const out = [];
  let cur = null;
  for (const r of myers(A, B)) {
    if (r.op === '=') {
      // A lone space between two changes joins them, so "a b" → "c d" is one change.
      if (cur && r.n === 1 && /^[ \t]+$/.test(A[r.a])) {
        cur.pending = { aTo: aPos[r.a + 1], bTo: bPos[r.b + 1] };
        continue;
      }
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { aFrom: aPos[r.a], aTo: aPos[r.a], bFrom: bPos[r.b], bTo: bPos[r.b] };
    if (cur.pending) {
      cur.aTo = cur.pending.aTo;
      cur.bTo = cur.pending.bTo;
      delete cur.pending;
    }
    if (r.op === '-') cur.aTo = aPos[r.a + r.n];
    else cur.bTo = bPos[r.b + r.n];
  }
  if (cur) {
    delete cur.pending;
    out.push(cur);
  }
  return out.map(({ aFrom, aTo, bFrom, bTo }) => ({ aFrom, aTo, bFrom, bTo }));
}

// Applies one change from wordChanges to a, giving the "accepted" base text.
function acceptChange(a, b, c) {
  return a.slice(0, c.aFrom) + b.slice(c.from, c.to) + a.slice(c.aTo);
}

// Undoes one change in b, giving the "rejected" text.
function rejectChange(a, b, c) {
  return b.slice(0, c.from) + a.slice(c.aFrom, c.aTo) + b.slice(c.to);
}

module.exports = { myers, lineDiff, lineStats, wordChanges, acceptChange, rejectChange };
