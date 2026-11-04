'use strict';

// Opens an OpenDocument text file (.odt from LibreOffice, Google Docs and
// others, or flat .fodt) as Write HTML: headings, run formatting (fonts,
// sizes, colours, highlight), alignment and indents, bullet and numbered
// lists, tables, pictures, links, footnotes and page breaks.

const { mergeText, kids, kid, all, attr, esc, escAttr, cm, openOdf, imageSrc, Styles, fontPt, cssColor, ALIGN } = require('./odf');

const PX_PER_CM = 96 / 2.54;
const round = (n) => Math.round(n * 100) / 100;

function headingLevel(p, styles) {
  if (p.nodeName === 'text:h') return Math.min(6, Math.max(1, Number(attr(p, 'text:outline-level') || 1)));
  for (let n = attr(p, 'text:style-name'), i = 0; n && i < 10; i++) {
    const s = styles.byKey.get(`paragraph:${n}`);
    const shown = (attr(s, 'style:display-name') || n).replace(/_20_/g, ' ');
    if (/^title$/i.test(shown)) return 1;
    const m = /^heading (\d)$/i.exec(shown);
    if (m) return Math.min(6, Number(m[1]));
    if (attr(s, 'style:default-outline-level') && attr(s, 'style:family') === 'paragraph' && attr(s, 'style:parent-style-name') === 'Heading') return Math.min(6, Number(attr(s, 'style:default-outline-level')));
    n = attr(s, 'style:parent-style-name');
  }
  return 0;
}

// The named (not automatic) style a paragraph style is based on.
function namedBase(styles, name, autos) {
  let n = name;
  while (n && autos.has(n)) n = attr(styles.byKey.get(`paragraph:${n}`), 'style:parent-style-name');
  return n;
}

// Wraps text in the tags and span its formatting needs, leaving out what the base already has.
function wrap(html, tp, base, styles) {
  if (!html) return '';
  const diff = (k) => tp[k] !== undefined && tp[k] !== base[k];
  const css = [];
  const font = styles.font(tp);
  if (font && font !== styles.font(base)) css.push(`font-family:${/\s/.test(font) ? `'${font.replace(/'/g, '')}'` : font}`);
  const size = fontPt(tp, 12);
  if (diff('fo:font-size') && size) css.push(`font-size:${round(size)}pt`);
  if (diff('fo:color') && cssColor(tp['fo:color']) && tp['style:use-window-font-color'] !== 'true' && !/^#0{6}$/.test(tp['fo:color'])) css.push(`color:${tp['fo:color']}`);
  let out = css.length ? `<span style="${css.join(';')}">${html}</span>` : html;
  const bg = tp['fo:background-color'];
  if (diff('fo:background-color') && cssColor(bg)) out = `<mark data-color="${bg}" style="background-color:${bg}">${out}</mark>`;
  const on = (k) => diff(k) && tp[k] && tp[k] !== 'none';
  if (on('style:text-line-through-style')) out = `<s>${out}</s>`;
  if (on('style:text-underline-style')) out = `<u>${out}</u>`;
  if (diff('fo:font-style') && /italic|oblique/.test(tp['fo:font-style'])) out = `<em>${out}</em>`;
  if (diff('fo:font-weight') && (tp['fo:font-weight'] === 'bold' || Number(tp['fo:font-weight']) >= 600)) out = `<strong>${out}</strong>`;
  const pos = /^(super|sub|-?[\d.]+%)/.exec(tp['style:text-position'] || '');
  if (pos && pos[1] !== '0%') out = pos[1] === 'super' || parseFloat(pos[1]) > 0 ? `<sup>${out}</sup>` : `<sub>${out}</sub>`;
  return out;
}

class OdtReader {
  constructor(pkg, styles, autos) {
    Object.assign(this, { pkg, styles, autos, notes: [] });
  }

  async inline(node, tp, base) {
    let s = '';
    for (const n of Array.from(node.childNodes || [])) {
      if (n.nodeType === 3) {
        s += wrap(esc(n.nodeValue), tp, base, this.styles);
        continue;
      }
      if (n.nodeType !== 1) continue;
      const name = n.nodeName;
      if (name === 'text:span') s += await this.inline(n, mergeText(tp, this.styles.props('text', attr(n, 'text:style-name')).text), base);
      else if (name === 'text:a') {
        const href = attr(n, 'xlink:href') || '';
        const inner = await this.inline(n, tp, base);
        s += /^(https?:|mailto:)/i.test(href) ? `<a href="${escAttr(href)}">${inner}</a>` : inner;
      } else if (name === 'text:s') s += '&nbsp;'.repeat(Number(attr(n, 'text:c') || 1));
      else if (name === 'text:tab') s += '&emsp;';
      else if (name === 'text:line-break') s += '<br>';
      else if (name === 'text:note') {
        const body = kid(n, 'text:note-body');
        const mark = kid(n, 'text:note-citation')?.textContent || String(this.notes.length + 1);
        this.notes.push({ mark, html: body ? await this.blocks(body) : '' });
        s += `<sup>${esc(mark)}</sup>`;
      } else if (name === 'draw:frame') s += await this.frame(n);
      else if (name === 'draw:a') {
        for (const f of kids(n, 'draw:frame')) s += await this.frame(f);
      } else if (['office:annotation', 'office:annotation-end', 'text:bookmark', 'text:bookmark-start', 'text:bookmark-end', 'text:reference-mark', 'text:reference-mark-start', 'text:reference-mark-end', 'text:soft-page-break', 'text:sequence-decls', 'text:tracked-changes', 'text:change', 'text:change-start', 'text:change-end', 'draw:custom-shape', 'draw:rect', 'draw:ellipse', 'draw:line', 'draw:g'].includes(name)) continue;
      else s += await this.inline(n, tp, base);
    }
    return s;
  }

  // Pictures (and text boxes) anchored in a paragraph.
  async frame(f) {
    const img = kids(f, 'draw:image');
    for (const im of img) {
      const src = await imageSrc(im, this.pkg);
      if (!src) continue;
      const w = Math.round(cm(attr(f, 'svg:width')) * PX_PER_CM);
      const h = Math.round(cm(attr(f, 'svg:height')) * PX_PER_CM);
      const alt = kid(f, 'svg:title')?.textContent || kid(f, 'svg:desc')?.textContent || attr(f, 'draw:name') || '';
      return `<img src="${src}" alt="${escAttr(alt)}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`;
    }
    const box = kid(f, 'draw:text-box');
    return box ? `</p>${await this.blocks(box)}<p>` : '';
  }

  async paragraph(p, extraStyle = '') {
    const name = attr(p, 'text:style-name');
    const ps = this.styles.props('paragraph', name);
    const level = headingLevel(p, this.styles);
    const base = level ? this.styles.props('paragraph', namedBase(this.styles, name, this.autos)).text : {};
    let html = await this.inline(p, ps.text, base);
    html = html.replace(/<p><\/p>/g, '');
    const style = [];
    const align = ALIGN[ps.paragraph['fo:text-align']];
    if (align && align !== 'left') style.push(`text-align:${align}`);
    else if (level === 1 && /title/i.test(name || '')) style.push('text-align:center');
    const ml = cm(ps.paragraph['fo:margin-left']);
    if (ml > 0.05 && !extraStyle) style.push(`margin-left:${round(ml * PX_PER_CM)}px`);
    const ti = cm(ps.paragraph['fo:text-indent']);
    if (Math.abs(ti) > 0.05 && !extraStyle) style.push(`text-indent:${round(ti * PX_PER_CM)}px`);
    const st = style.length ? ` style="${style.join(';')}"` : '';
    const tag = level ? `h${level}` : 'p';
    const brk = ps.paragraph['fo:break-before'] === 'page' ? '<div data-page-break></div>' : '';
    const after = ps.paragraph['fo:break-after'] === 'page' ? '<div data-page-break></div>' : '';
    return `${brk}<${tag}${st}>${html}</${tag}>${after}`.replace(/<(p|h\d)([^>]*)><\/p>/g, '').replace(/<p><\/(p|h\d)>/g, '');
  }

  listOrdered(listStyle, level) {
    const levels = kids(listStyle).filter((n) => /^text:list-level-style-/.test(n.nodeName));
    const lvl = levels.find((l) => Number(attr(l, 'text:level')) === level) || levels[0];
    return lvl?.nodeName === 'text:list-level-style-number' && !!attr(lvl, 'style:num-format');
  }

  async list(node, level, inherited) {
    const own = attr(node, 'text:style-name');
    let ls = (own && this.styles.lists.get(own)) || inherited;
    if (!ls) {
      const p = all(node, 'text:p')[0];
      ls = p && this.styles.props('paragraph', attr(p, 'text:style-name')).list;
    }
    const ordered = ls ? this.listOrdered(ls, level) : false;
    let items = '';
    for (const li of kids(node).filter((n) => n.nodeName === 'text:list-item' || n.nodeName === 'text:list-header')) {
      let inner = '';
      for (const c of kids(li)) {
        if (c.nodeName === 'text:list') inner += await this.list(c, level + 1, ls);
        else inner += await this.block(c, true);
      }
      items += `<li>${inner || '<p></p>'}</li>`;
    }
    const start = Number(attr(node, 'text:start-value') || 0);
    return ordered ? `<ol${start > 1 ? ` start="${start}"` : ''}>${items}</ol>` : `<ul>${items}</ul>`;
  }

  async table(t) {
    let rows = '';
    for (const tr of all(t, 'table:table-row')) {
      let cells = '';
      const header = tr.parentNode?.nodeName === 'table:table-header-rows';
      for (const tc of kids(tr, 'table:table-cell')) {
        const span = [];
        if (Number(attr(tc, 'table:number-columns-spanned')) > 1) span.push(` colspan="${attr(tc, 'table:number-columns-spanned')}"`);
        if (Number(attr(tc, 'table:number-rows-spanned')) > 1) span.push(` rowspan="${attr(tc, 'table:number-rows-spanned')}"`);
        const cp = this.styles.props('table-cell', attr(tc, 'table:style-name')).cell;
        const bg = cssColor(cp['fo:background-color']);
        const tag = header ? 'th' : 'td';
        cells += `<${tag}${span.join('')}${bg ? ` style="background-color:${bg}"` : ''}>${(await this.blocks(tc)) || '<p></p>'}</${tag}>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    return `<table><tbody>${rows}</tbody></table>`;
  }

  async block(n, inList = false) {
    switch (n.nodeName) {
      case 'text:p':
      case 'text:h':
        return this.paragraph(n, inList ? 'list' : '');
      case 'text:list':
        return this.list(n, 1, null);
      case 'table:table':
        return this.table(n);
      case 'text:section':
      case 'text:index-body':
      case 'text:soft-page-break':
        return this.blocks(n);
      case 'text:table-of-content':
      case 'text:alphabetical-index':
      case 'text:illustration-index':
      case 'text:bibliography':
        return this.blocks(kid(n, 'text:index-body'));
      case 'text:index-title':
        return this.blocks(n);
      default:
        return '';
    }
  }

  async blocks(node) {
    let html = '';
    for (const c of kids(node)) html += await this.block(c);
    return html;
  }
}

async function importOdt(buffer) {
  const pkg = await openOdf(buffer);
  const body = all(pkg.content, 'office:text')[0];
  if (!body) throw new Error('This doesn’t look like an OpenDocument text file.');
  const styles = new Styles([pkg.styles, pkg.content]);
  const autos = new Set(all(kid(pkg.content.documentElement, 'office:automatic-styles'), 'style:style').map((s) => attr(s, 'style:name')));
  const reader = new OdtReader(pkg, styles, autos);
  let html = await reader.blocks(body);
  if (reader.notes.length) html += `<hr>${reader.notes.map((n) => n.html.replace(/^<p>/, `<p><sup>${esc(n.mark)}</sup> `)).join('')}`;
  return { html: html || '<p></p>' };
}

module.exports = { importOdt };
