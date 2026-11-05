'use strict';

// Opens Rich Text Format (.rtf, from WordPad, TextEdit, Word, LibreOffice
// and others) as Write HTML: fonts, sizes, colours, bold/italic/underline,
// highlight, alignment, headings, bullets and numbering, tables and
// PNG/JPEG pictures.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Windows-1252 bytes 0x80-0x9f that differ from Latin-1.
const CP1252 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
const SKIP = new Set(['info', 'stylesheet', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf', 'pntext', 'pntxta', 'pntxtb', 'listtext', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'fldinst', 'bkmkstart', 'bkmkend', 'object', 'nonshppict', 'filetbl', 'mmathPr', 'pgdsctbl', 'operator', 'author', 'company', 'title', 'subject', 'comment', 'doccomm', 'keywords', 'userprops', 'xe', 'tc']);
const HIGHLIGHT = ['', '#000000', '#0000ff', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#ffff00', '', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#c0c0c0'];

function tokens(src) {
  const out = [];
  const re = /\\([a-zA-Z]+)(-?\d+)? ?|\\'([0-9a-fA-F]{2})|\\([^a-zA-Z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) out.push({ word: m[1], n: m[2] === undefined ? null : Number(m[2]) });
    else if (m[3]) out.push({ hex: parseInt(m[3], 16) });
    else if (m[4]) out.push({ sym: m[4] });
    else if (m[5]) out.push({ brace: m[5] });
    else if (m[6]) out.push({ text: m[6] });
  }
  return out;
}

const charOf = (b) => String.fromCharCode(CP1252[b] || b);

function importRtf(buffer) {
  const src = buffer.toString('latin1');
  if (!/^\s*\{\\rtf/.test(src)) throw new Error('This doesn’t look like a Rich Text file.');
  const toks = tokens(src);
  // \lsN -> numbered or bulleted, from the list table (\levelnfc 23 is a bullet)
  const listKind = {};
  const byId = {};
  for (const m of src.matchAll(/\{\\list\b([\s\S]*?)\\listid(-?\d+)/g)) {
    const nfc = /\\levelnfc(\d+)/.exec(m[1]);
    byId[m[2]] = nfc && nfc[1] !== '23' && nfc[1] !== '255' ? 'ol' : 'ul';
  }
  for (const m of src.matchAll(/\\listoverride\b[^{}]*?\\listid(-?\d+)[^{}]*?\\ls(\d+)/g)) listKind[m[2]] = byId[m[1]] || 'ul';
  const fonts = {};
  const colors = [];
  const styleNames = {};
  const blocks = [];
  let para = { runs: [], align: null, list: false, heading: 0 };
  let table = null; // { rows: [[cell]] }
  let row = null;
  let cell = null;
  const base = () => ({ b: false, i: false, u: false, s: false, f: null, fs: 24, cf: 0, hl: 0, sup: 0, uc: 1 });
  let st = base();
  const stack = [];
  let dest = null; // 'skip' | 'fonttbl' | 'colortbl' | 'pict' | 'stylesheet-entry'
  let destDepth = 0;
  let depth = 0;
  let pict = null;
  let skipChars = 0;
  let fontName = '';
  let fontNum = null;
  let color = { r: 0, g: 0, b: 0, set: false };
  let ignorable = false;

  const addText = (t) => {
    if (!t) return;
    if (skipChars > 0) {
      const drop = Math.min(skipChars, t.length);
      skipChars -= drop;
      t = t.slice(drop);
      if (!t) return;
    }
    const last = para.runs[para.runs.length - 1];
    if (last?.text !== undefined && JSON.stringify(last.st) === JSON.stringify(st)) last.text += t;
    else para.runs.push({ text: t, st: { ...st } });
  };
  const endPara = () => {
    const p = para;
    para = { runs: [], align: p.align, list: p.list, heading: p.heading, intbl: p.intbl };
    if (p.intbl && table) {
      cell ??= [];
      cell.push(p);
    } else blocks.push({ p });
  };
  const resetPara = () => {
    para.align = null;
    para.list = false;
    para.heading = 0;
    para.intbl = false;
  };

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.brace === '{') {
      stack.push({ st: { ...st }, dest, ignorable });
      depth += 1;
      ignorable = false;
      continue;
    }
    if (t.brace === '}') {
      if (dest === 'fonttbl' && fontNum != null && fontName) {
        fonts[fontNum] = fontName.replace(/;\s*$/, '').trim();
        fontName = '';
      }
      if (dest === 'pict' && depth === destDepth && pict) {
        const hex = pict.hex.join('').replace(/[^0-9a-f]/gi, '');
        if (pict.type && hex.length > 16) {
          const w = pict.goalW ? Math.round(((pict.goalW / 15) * (pict.sx || 100)) / 100) : null;
          const h = pict.goalH ? Math.round(((pict.goalH / 15) * (pict.sy || 100)) / 100) : null;
          para.runs.push({ img: `data:${pict.type};base64,${Buffer.from(hex, 'hex').toString('base64')}`, w, h });
        }
        pict = null;
      }
      const prev = stack.pop() || { st: base(), dest: null };
      if (dest === 'stylesheet' && prev.dest === 'stylesheet' && fontNum != null) fontNum = null;
      st = prev.st;
      dest = prev.dest;
      ignorable = prev.ignorable;
      depth -= 1;
      continue;
    }
    if (dest === 'skip') continue;
    if (t.sym === '*') {
      ignorable = true;
      continue;
    }
    if (t.word) {
      const { word, n } = t;
      if (ignorable && dest === 'pict') {
        dest = 'skip';
        continue;
      }
      if (word === 'shppict') {
        ignorable = false;
        continue;
      }
      if (SKIP.has(word) && word !== 'stylesheet') {
        dest = 'skip';
        continue;
      }
      if (word === 'fonttbl') { dest = 'fonttbl'; continue; }
      if (word === 'colortbl') { dest = 'colortbl'; color = { r: 0, g: 0, b: 0, set: false }; continue; }
      if (word === 'stylesheet') { dest = 'stylesheet'; continue; }
      if (word === 'pict') {
        dest = 'pict';
        destDepth = depth;
        pict = { hex: [], type: null };
        continue;
      }
      if (dest === 'pict') {
        if (word === 'pngblip') pict.type = 'image/png';
        else if (word === 'jpegblip') pict.type = 'image/jpeg';
        else if (word === 'picwgoal') pict.goalW = n;
        else if (word === 'pichgoal') pict.goalH = n;
        else if (word === 'picscalex') pict.sx = n;
        else if (word === 'picscaley') pict.sy = n;
        continue;
      }
      if (dest === 'fonttbl') {
        if (word === 'f') fontNum = n;
        continue;
      }
      if (dest === 'colortbl') {
        if (word === 'red') { color.r = n; color.set = true; } else if (word === 'green') { color.g = n; color.set = true; } else if (word === 'blue') { color.b = n; color.set = true; }
        continue;
      }
      if (dest === 'stylesheet') {
        if (word === 's') fontNum = n;
        continue;
      }
      if (ignorable) {
        dest = 'skip';
        continue;
      }
      switch (word) {
        case 'par': endPara(); break;
        case 'line': para.runs.push({ br: true }); break;
        case 'tab': addText('\t'); break;
        case 'page': blocks.push({ pageBreak: true }); break;
        case 'pard': resetPara(); break;
        case 'plain': st = { ...base(), uc: st.uc }; break;
        case 'b': st.b = n !== 0; break;
        case 'i': st.i = n !== 0; break;
        case 'ul': st.u = n !== 0; break;
        case 'ulnone': st.u = false; break;
        case 'strike': st.s = n !== 0; break;
        case 'f': st.f = n; break;
        case 'fs': st.fs = n; break;
        case 'cf': st.cf = n; break;
        case 'highlight': case 'cb': case 'chcbpat': st.hl = word === 'highlight' ? -n : n; break;
        case 'super': st.sup = 1; break;
        case 'sub': st.sup = -1; break;
        case 'nosupersub': st.sup = 0; break;
        case 'qc': para.align = 'center'; break;
        case 'qr': para.align = 'right'; break;
        case 'qj': para.align = 'justify'; break;
        case 'ql': para.align = null; break;
        case 'ls': para.list = listKind[n] || true; break;
        case 'pnlvlblt': para.list = true; break;
        case 'pnlvlbody': para.list = 'ol'; break;
        case 's': if (styleNames[n]) para.heading = styleNames[n]; break;
        case 'outlinelevel': para.heading = Math.min(6, n + 1); break;
        case 'uc': st.uc = n; break;
        case 'u': addText(String.fromCharCode(n < 0 ? n + 65536 : n)); skipChars = st.uc; break;
        case 'intbl': para.intbl = true; if (!table) table = { rows: [] }; break;
        case 'trowd': if (!table) table = { rows: [] }; row = row || []; break;
        case 'cell': endPara(); row = row || []; row.push(cell || []); cell = null; break;
        case 'row': if (table) { table.rows.push(row || []); row = null; } break;
        case 'emdash': addText('—'); break;
        case 'endash': addText('–'); break;
        case 'bullet': addText('•'); break;
        case 'lquote': addText('‘'); break;
        case 'rquote': addText('’'); break;
        case 'ldblquote': addText('“'); break;
        case 'rdblquote': addText('”'); break;
        default: break;
      }
      // a table ends at the first paragraph outside it
      if (table && word === 'pard') {
        const next = toks.slice(i + 1, i + 40).find((x) => x.word && ['intbl', 'par', 'trowd'].includes(x.word));
        if (!next || next.word === 'par') {
          blocks.push({ table });
          table = null;
        }
      }
      continue;
    }
    if (t.sym) {
      if (t.sym === '~') addText(' ');
      else if (t.sym === '-' || t.sym === '_') addText(t.sym === '_' ? '-' : '');
      else if (['\\', '{', '}'].includes(t.sym) && dest !== 'fonttbl') addText(t.sym);
      else if (t.sym === '\n' || t.sym === '\r') endPara();
      continue;
    }
    const text = t.hex !== undefined ? charOf(t.hex) : t.text;
    if (text === undefined) continue;
    if (dest === 'fonttbl') {
      fontName += text;
      if (fontName.includes(';') && fontNum != null) {
        fonts[fontNum] = fontName.split(';')[0].trim();
        fontName = '';
        fontNum = null;
      }
    }
    else if (dest === 'colortbl') {
      for (const ch of text) {
        if (ch === ';') {
          colors.push(color.set ? `#${[color.r, color.g, color.b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : null);
          color = { r: 0, g: 0, b: 0, set: false };
        }
      }
    } else if (dest === 'stylesheet') {
      const name = text.replace(/;\s*$/, '').trim().toLowerCase();
      const m = /^heading (\d)$/.exec(name);
      if (fontNum != null && m) styleNames[fontNum] = Number(m[1]);
      else if (fontNum != null && name === 'title') styleNames[fontNum] = 1;
    } else if (dest === 'pict') pict?.hex.push(text);
    else if (!dest) addText(text);
  }
  if (para.runs.length) endPara();
  if (table) blocks.push({ table });

  const runHtml = (runs) => runs.map((r) => {
    if (r.br) return '<br>';
    if (r.img) return `<img src="${r.img}"${r.w ? ` width="${r.w}"` : ''}${r.h ? ` height="${r.h}"` : ''}>`;
    const s = r.st;
    let html = esc(r.text).replace(/\t/g, '&emsp;');
    const css = [];
    if (s.f != null && fonts[s.f]) css.push(`font-family:${/\s/.test(fonts[s.f]) ? `'${fonts[s.f].replace(/'/g, '')}'` : fonts[s.f]}`);
    if (s.fs && s.fs !== 24) css.push(`font-size:${s.fs / 2}pt`);
    const c = colors[s.cf];
    if (s.cf && c && c !== '#000000') css.push(`color:${c}`);
    if (css.length) html = `<span style="${css.join(';')}">${html}</span>`;
    const hl = s.hl < 0 ? HIGHLIGHT[-s.hl] : s.hl ? colors[s.hl] : null;
    if (hl && hl !== '#ffffff') html = `<mark data-color="${hl}" style="background-color:${hl}">${html}</mark>`;
    if (s.s) html = `<s>${html}</s>`;
    if (s.u) html = `<u>${html}</u>`;
    if (s.i) html = `<em>${html}</em>`;
    if (s.b) html = `<strong>${html}</strong>`;
    if (s.sup) html = s.sup > 0 ? `<sup>${html}</sup>` : `<sub>${html}</sub>`;
    return html;
  }).join('');
  const paraHtml = (p) => {
    const tag = p.heading ? `h${p.heading}` : 'p';
    return `<${tag}${p.align ? ` style="text-align:${p.align}"` : ''}>${runHtml(p.runs)}</${tag}>`;
  };
  let html = '';
  let list = null;
  for (const b of blocks) {
    const isList = b.p && b.p.list && !b.p.heading;
    if (list && !isList) {
      html += `</${list}>`;
      list = null;
    }
    if (b.pageBreak) html += '<div data-page-break></div>';
    else if (b.table) html += `<table><tbody>${b.table.rows.filter((r) => r.length).map((r) => `<tr>${r.map((c) => `<td>${c.map(paraHtml).join('') || '<p></p>'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    else if (isList) {
      const kind = b.p.list === 'ol' ? 'ol' : 'ul';
      if (list !== kind) {
        if (list) html += `</${list}>`;
        html += `<${kind}>`;
        list = kind;
      }
      html += `<li>${paraHtml(b.p)}</li>`;
    } else html += paraHtml(b.p);
  }
  if (list) html += `</${list}>`;
  return { html: html || '<p></p>' };
}

module.exports = { importRtf };
