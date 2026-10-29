// Streaming CSV/TSV reader. Reads the file in chunks straight from bytes, so
// files with tens of millions of rows load without ever holding the text.
// reader: { size, read(offset, length) -> Promise<Uint8Array> }

import { ColumnBuilder, isMissingText, parseDate, uniqueNames } from './columns.js';

const CHUNK = 8 * 1024 * 1024;
const QUOTE = 34;
const LF = 10;
const CR = 13;

// Fast exact path for plain decimals; anything unusual goes through Number().
function parseNum(buf, s, e) {
  while (s < e && buf[s] === 32) s += 1;
  while (e > s && buf[e - 1] === 32) e -= 1;
  if (s >= e) return NaN;
  let i = s;
  let neg = false;
  if (buf[i] === 45 || buf[i] === 43) {
    neg = buf[i] === 45;
    i += 1;
  }
  let mant = 0;
  let digits = 0;
  let scale = 0;
  let dot = false;
  for (; i < e; i += 1) {
    const ch = buf[i];
    if (ch >= 48 && ch <= 57) {
      mant = mant * 10 + (ch - 48);
      digits += 1;
      if (dot) scale += 1;
    } else if (ch === 46 && !dot) {
      dot = true;
    } else break;
  }
  if (!digits) return NaN;
  if (i === e && digits <= 15 && scale <= 22) {
    const v = scale ? mant / 10 ** scale : mant;
    return neg ? -v : v;
  }
  if (i < e && buf[i] !== 101 && buf[i] !== 69) return NaN;
  let text = '';
  for (let k = s; k < e; k += 1) text += String.fromCharCode(buf[k]);
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text) ? Number(text) : NaN;
}

export function detectDelimiter(text, hint) {
  if (hint === 'tsv' || hint === 'tab') return '\t';
  const lines = text.split(/\r?\n/).slice(0, 30).filter((l) => l.trim());
  let best = ',';
  let bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => {
      let n = 0;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === d && !q) n += 1;
      }
      return n;
    });
    if (!counts.length || !counts[0]) continue;
    const same = counts.filter((n) => n === counts[0]).length;
    const score = same * 1000 + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export async function parseDelimited(reader, { ext = 'csv', onProgress } = {}) {
  const decoder = new TextDecoder();
  const first = await reader.read(0, Math.min(reader.size, 64 * 1024));
  const delim = detectDelimiter(decoder.decode(first), ext).charCodeAt(0);

  let builders = null;
  let header = null;
  let rows = 0;
  let width = 0;
  let fs = new Int32Array(64);
  let fe = new Int32Array(64);
  let fq = new Uint8Array(64);

  const text = (buf, s, e, quoted) => {
    const t = decoder.decode(buf.subarray(s, e));
    return quoted && t.includes('""') ? t.replaceAll('""', '"') : t;
  };

  const addColumn = (name) => {
    const b = new ColumnBuilder(name, rows);
    builders.push(b);
    return b;
  };

  const emitRow = (buf, n) => {
    if (n === 1 && fe[0] === fs[0]) return; // blank line
    if (!builders) {
      const firstRow = Array.from({ length: n }, (_, k) => text(buf, fs[k], fe[k], fq[k]));
      const isHeader = firstRow.some((t) => t.trim() && Number.isNaN(Number(t)) && Number.isNaN(parseDate(t)) && !isMissingText(t));
      width = n;
      builders = [];
      if (isHeader) {
        header = uniqueNames(firstRow);
        header.forEach((name) => addColumn(name));
        return;
      }
      header = uniqueNames(firstRow.map(() => ''));
      header.forEach((name) => addColumn(name));
    }
    while (n > builders.length) {
      const name = uniqueNames([...header, ''])[header.length];
      header.push(name);
      addColumn(name);
    }
    for (let k = 0; k < builders.length; k += 1) {
      const b = builders[k];
      if (k >= n) {
        b.pushMissing();
        continue;
      }
      const s = fs[k];
      const e = fe[k];
      if (b.kind !== 'string') {
        const v = parseNum(buf, s, e);
        if (!Number.isNaN(v) && b.kind !== 'date') {
          b.pushNumber(v);
          continue;
        }
      }
      const t = text(buf, s, e, fq[k]);
      if (isMissingText(t)) {
        b.pushMissing();
        continue;
      }
      if (b.kind !== 'string' && b.kind !== 'number') {
        const d = parseDate(t);
        if (!Number.isNaN(d)) {
          b.pushNumber(d, 'date');
          continue;
        }
      }
      b.pushString(t);
    }
    rows += 1;
  };

  let carry = new Uint8Array(0);
  let offset = 0;
  while (offset < reader.size) {
    const chunk = await reader.read(offset, Math.min(CHUNK, reader.size - offset));
    offset += chunk.length;
    const last = offset >= reader.size;
    let buf;
    if (carry.length) {
      buf = new Uint8Array(carry.length + chunk.length);
      buf.set(carry);
      buf.set(chunk, carry.length);
    } else buf = chunk;
    let i = 0;
    if (rows === 0 && !builders && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
    let rowStart = i;
    let n = 0;
    let fieldStart = i;
    let quoted = false;
    let inQuotes = false;
    const len = buf.length;
    const pushField = (end) => {
      if (n >= fs.length) {
        const grow = (a) => {
          const x = new a.constructor(a.length * 2);
          x.set(a);
          return x;
        };
        fs = grow(fs);
        fe = grow(fe);
        fq = grow(fq);
      }
      let s = fieldStart;
      let e = end;
      if (quoted) {
        s += 1;
        if (e > s && buf[e - 1] === QUOTE) e -= 1;
      }
      fs[n] = s;
      fe[n] = e;
      fq[n] = quoted ? 1 : 0;
      n += 1;
    };
    while (i < len) {
      const ch = buf[i];
      if (inQuotes) {
        if (ch === QUOTE) {
          if (buf[i + 1] === QUOTE) i += 2;
          else {
            inQuotes = false;
            i += 1;
          }
          if (i >= len && !last) break;
          continue;
        }
        i += 1;
        continue;
      }
      if (ch === QUOTE && i === fieldStart) {
        quoted = true;
        inQuotes = true;
        i += 1;
      } else if (ch === delim) {
        pushField(i);
        i += 1;
        fieldStart = i;
        quoted = false;
      } else if (ch === LF) {
        pushField(i > fieldStart && buf[i - 1] === CR ? i - 1 : i);
        emitRow(buf, n);
        i += 1;
        rowStart = i;
        fieldStart = i;
        n = 0;
        quoted = false;
      } else i += 1;
    }
    if (last) {
      if (rowStart < len) {
        n = 0;
        fieldStart = rowStart;
        quoted = false;
        inQuotes = false;
        // Re-scan the final unterminated row as a whole.
        for (let k = rowStart; k < len; k += 1) {
          const ch = buf[k];
          if (inQuotes) {
            if (ch === QUOTE) {
              if (buf[k + 1] === QUOTE) k += 1;
              else inQuotes = false;
            }
          } else if (ch === QUOTE && k === fieldStart) {
            quoted = true;
            inQuotes = true;
          } else if (ch === delim) {
            pushField(k);
            fieldStart = k + 1;
            quoted = false;
          }
        }
        let end = len;
        if (end > fieldStart && buf[end - 1] === CR) end -= 1;
        pushField(end);
        emitRow(buf, n);
      }
      carry = new Uint8Array(0);
    } else {
      carry = buf.slice(rowStart);
    }
    onProgress?.(offset / reader.size, rows);
  }
  if (!builders) return { columns: [], rows: 0 };
  return { columns: builders.map((b) => b.finish(rows)), rows };
}
