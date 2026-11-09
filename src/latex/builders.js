// Table and figure builders for LaTeX mode: fill in a grid or pick pictures,
// and the LaTeX is written for you.

import tables from '../../common/latex-table.js';
import { escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

const { makeTable, parsePasted, escapeCell } = tables;

function modal(title, cls) {
  const back = h('div', 'modal-back');
  const box = h('div', `modal wide ${cls}`);
  box.append(h('div', 'modal-title', escapeHtml(title)));
  back.append(box);
  document.body.append(back);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  return { box, close };
}

const field = (label, input) => {
  const l = h('label', 'bx-field');
  l.append(h('span', '', escapeHtml(label)), input);
  return l;
};

const input = (value = '', placeholder = '') => {
  const i = h('input');
  i.value = value;
  i.placeholder = placeholder;
  return i;
};

function select(options, value) {
  const s = h('select');
  for (const [v, label] of options) {
    const o = h('option', '', escapeHtml(label));
    o.value = v;
    s.append(o);
  }
  s.value = value;
  return s;
}

const PLACEMENTS = [['htbp', 'Best fit (htbp)'], ['h', 'Here (h)'], ['t', 'Top of page (t)'], ['b', 'Bottom of page (b)'], ['p', 'Own page (p)'], ['H', 'Exactly here (H, float package)']];
const slug = (s) => String(s).toLowerCase().replace(/\\[a-z]+/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

// initial: a parsed table (from parseTable) or null. onInsert(latex, { packages }).
export function tableBuilder({ initial, onInsert }) {
  const { box, close } = modal(initial ? 'Edit table' : 'Table builder', 'bx bx-table');
  const t = initial ? JSON.parse(JSON.stringify(initial)) : { rows: [['Header 1', 'Header 2', 'Header 3'], ['', '', ''], ['', '', '']], align: ['l', 'c', 'c'], style: 'booktabs', header: true, caption: '', label: '', placement: 'htbp', float: true };
  const origAlign = initial ? initial.align.join('') : null;
  const cols = () => Math.max(1, ...t.rows.map((r) => r.length));

  const tools = h('div', 'bx-tools');
  const btn = (label, ic, run, title) => {
    const b = h('button', 'btn', `${icon(ic, 14)} ${escapeHtml(label)}`);
    b.type = 'button';
    if (title) b.title = title;
    b.onclick = run;
    tools.append(b);
    return b;
  };
  let focus = { r: 0, c: 0 };
  btn('Row', 'insertRow', () => {
    t.rows.splice(focus.r + 1, 0, Array(cols()).fill(''));
    draw();
  }, 'Add a row below');
  btn('Column', 'insertCol', () => {
    t.rows.forEach((r) => r.splice(focus.c + 1, 0, ''));
    t.align.splice(focus.c + 1, 0, 'c');
    draw();
  }, 'Add a column to the right');
  btn('Row', 'deleteRow', () => {
    if (t.rows.length > 1) t.rows.splice(focus.r, 1);
    focus.r = Math.min(focus.r, t.rows.length - 1);
    draw();
  }, 'Delete this row');
  btn('Column', 'deleteCol', () => {
    if (cols() > 1) {
      t.rows.forEach((r) => r.splice(focus.c, 1));
      t.align.splice(focus.c, 1);
    }
    focus.c = Math.min(focus.c, cols() - 1);
    draw();
  }, 'Delete this column');
  const style = select([['booktabs', 'Clean lines (booktabs)'], ['grid', 'All borders'], ['plain', 'No borders']], t.style);
  style.onchange = () => (t.style = style.value);
  const header = h('label', 'bx-check', `<input type="checkbox"${t.header ? ' checked' : ''}> Header row`);
  header.querySelector('input').onchange = (e) => (t.header = e.target.checked);
  tools.append(style, header, h('span', 'bx-hint', 'Paste cells from a spreadsheet straight into the grid.'));

  const gridWrap = h('div', 'bx-grid-wrap');
  const grid = h('table', 'bx-grid');
  gridWrap.append(grid);

  function draw() {
    grid.innerHTML = '';
    const n = cols();
    t.rows = t.rows.map((r) => [...r, ...Array(n - r.length).fill('')]);
    t.align = Array.from({ length: n }, (_, i) => t.align[i] || 'l');
    const head = h('tr', 'bx-align-row');
    for (let c = 0; c < n; c++) {
      const td = h('th');
      const seg = h('div', 'bx-seg');
      for (const [a, label] of [['l', 'Left'], ['c', 'Center'], ['r', 'Right']]) {
        const b = h('button', t.align[c] === a ? 'on' : '', icon({ l: 'alignLeft', c: 'alignCenter', r: 'alignRight' }[a], 14));
        b.type = 'button';
        b.title = `${label} align column ${c + 1}`;
        b.onclick = () => {
          t.align[c] = a;
          draw();
        };
        seg.append(b);
      }
      td.append(seg);
      head.append(td);
    }
    grid.append(head);
    t.rows.forEach((row, r) => {
      const tr = h('tr', r === 0 && t.header ? 'bx-head' : '');
      row.forEach((cell, c) => {
        const td = h('td');
        const inp = h('input');
        inp.value = cell;
        inp.style.textAlign = { l: 'left', c: 'center', r: 'right' }[t.align[c]];
        inp.oninput = () => (t.rows[r][c] = inp.value);
        inp.onfocus = () => (focus = { r, c });
        inp.onpaste = (e) => {
          const text = e.clipboardData.getData('text/plain');
          if (!/[\t\n]/.test(text)) return;
          e.preventDefault();
          const pasted = parsePasted(text);
          pasted.forEach((pr, i) => {
            while (t.rows.length <= r + i) t.rows.push(Array(cols()).fill(''));
            pr.forEach((v, j) => {
              while (t.rows[r + i].length <= c + j) t.rows.forEach((x) => x.push(''));
              t.rows[r + i][c + j] = escapeCell(v);
            });
          });
          draw();
        };
        inp.onkeydown = (e) => {
          const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], Enter: [1, 0] }[e.key];
          if (!move) return;
          e.preventDefault();
          if (e.key === 'Enter' && r === t.rows.length - 1) {
            t.rows.push(Array(cols()).fill(''));
            focus = { r: r + 1, c };
            draw();
            return;
          }
          grid.querySelector(`[data-cell="${r + move[0]}-${c}"]`)?.focus();
        };
        inp.dataset.cell = `${r}-${c}`;
        td.append(inp);
        tr.append(td);
      });
      grid.append(tr);
    });
    grid.querySelector(`[data-cell="${focus.r}-${focus.c}"]`)?.focus();
  }

  const opts = h('div', 'bx-opts');
  const caption = input(t.caption, 'Caption');
  const label = input(t.label, 'tab:results');
  caption.oninput = () => {
    if (!label.dataset.touched && !initial?.label) label.value = caption.value ? `tab:${slug(caption.value)}` : '';
  };
  label.oninput = () => (label.dataset.touched = '1');
  const place = select(PLACEMENTS, t.placement || 'htbp');
  const asFloat = h('label', 'bx-check', `<input type="checkbox"${t.float !== false ? ' checked' : ''}> As a numbered table (with caption)`);
  opts.append(field('Caption', caption), field('Label', label), field('Placement', place), asFloat);

  const preview = h('details', 'bx-code', '<summary>LaTeX</summary><pre></pre>');
  preview.ontoggle = () => {
    preview.querySelector('pre').textContent = build();
  };

  function build() {
    const float = asFloat.querySelector('input').checked;
    const keep = initial && t.align.join('') === origAlign && cols() === initial.align.length ? initial.spec : '';
    return makeTable({ ...t, style: style.value, caption: caption.value.trim(), label: label.value.trim(), placement: place.value, float, spec: keep });
  }

  const actions = h('div', 'modal-actions');
  const ok = h('button', 'btn primary', initial ? 'Update table' : 'Insert table');
  ok.onclick = () => {
    const code = build();
    const packages = [];
    if (style.value === 'booktabs') packages.push('booktabs');
    if (place.value === 'H') packages.push('float');
    close();
    onInsert(code, { packages });
  };
  const cancel = h('button', 'btn', 'Cancel');
  cancel.onclick = close;
  actions.append(ok, cancel);
  box.append(tools, gridWrap, opts, preview, actions);
  draw();
}

// images: [{ path }]; readImage(path) -> data URL; upload() -> [paths].
export function figureBuilder({ images, readImage, upload, onInsert }) {
  const { box, close } = modal('Figure builder', 'bx bx-figure');
  const picked = [];
  const subCaps = new Map();
  const gallery = h('div', 'bx-gallery');
  const sel = h('div', 'bx-picked');

  function drawGallery() {
    gallery.innerHTML = '';
    if (!images.length) gallery.append(h('div', 'tex-empty-small', 'No pictures in this project yet. Add one from your computer.'));
    for (const im of images) {
      const card = h('button', `bx-pic${picked.includes(im.path) ? ' on' : ''}`, `<div class="bx-thumb"></div><span>${escapeHtml(im.path.split('/').pop())}</span>`);
      card.type = 'button';
      card.title = im.path;
      readImage(im.path).then((src) => {
        if (src) {
          const img = h('img');
          img.src = src;
          img.alt = '';
          card.querySelector('.bx-thumb').append(img);
        }
        else card.querySelector('.bx-thumb').append(h('span', 'bx-noprev', escapeHtml(im.path.split('.').pop().toUpperCase())));
      });
      card.onclick = () => {
        const i = picked.indexOf(im.path);
        if (i >= 0) picked.splice(i, 1);
        else picked.push(im.path);
        drawGallery();
        drawPicked();
      };
      gallery.append(card);
    }
    const add = h('button', 'bx-pic bx-add', `<div class="bx-thumb">${icon('upload', 28)}</div><span>From this computer…</span>`);
    add.type = 'button';
    add.onclick = async () => {
      const added = (await upload()) || [];
      for (const p of added) {
        if (!images.some((x) => x.path === p)) images.push({ path: p });
        if (!picked.includes(p)) picked.push(p);
      }
      drawGallery();
      drawPicked();
    };
    gallery.append(add);
  }

  function drawPicked() {
    sel.innerHTML = '';
    if (picked.length < 2) return;
    sel.append(h('div', 'bx-sub-head', `${picked.length} pictures side by side. Give each its own caption if you like:`));
    for (const p of picked) {
      const i = input(subCaps.get(p) || '', `Caption for ${p.split('/').pop()}`);
      i.oninput = () => subCaps.set(p, i.value);
      sel.append(i);
    }
  }

  const width = h('input');
  width.type = 'range';
  width.min = 20;
  width.max = 100;
  width.value = 80;
  const wLabel = h('span', 'bx-w', '80% of the text width');
  width.oninput = () => (wLabel.textContent = `${width.value}% of the text width${picked.length > 1 ? ', shared between the pictures' : ''}`);
  const wRow = h('div', 'bx-wrow');
  wRow.append(width, wLabel);
  const caption = input('', 'Caption');
  const label = input('', 'fig:results');
  caption.oninput = () => {
    if (!label.dataset.touched) label.value = caption.value ? `fig:${slug(caption.value)}` : '';
  };
  label.oninput = () => (label.dataset.touched = '1');
  const place = select(PLACEMENTS, 'htbp');
  const opts = h('div', 'bx-opts');
  opts.append(field('Width', wRow), field('Caption', caption), field('Label', label), field('Placement', place));

  function build() {
    const w = Number(width.value) / 100;
    const cap = caption.value.trim();
    const lab = label.value.trim();
    const lines = [`\\begin{figure}[${place.value}]`, '\t\\centering'];
    if (picked.length <= 1) {
      lines.push(`\t\\includegraphics[width=${w === 1 ? '' : w}\\linewidth]{${picked[0] || 'figure'}}`);
    } else {
      const each = Math.max(0.1, Math.floor((w / picked.length - 0.02) * 100) / 100);
      picked.forEach((p, i) => {
        const sub = (subCaps.get(p) || '').trim();
        lines.push(`\t\\begin{subfigure}[b]{${each}\\linewidth}`, '\t\t\\centering', `\t\t\\includegraphics[width=\\linewidth]{${p}}`);
        if (sub) lines.push(`\t\t\\caption{${sub}}`, `\t\t\\label{${lab || 'fig:figure'}-${String.fromCharCode(97 + i)}}`);
        lines.push('\t\\end{subfigure}');
        if (i < picked.length - 1) lines.push('\t\\hfill');
      });
    }
    if (cap) lines.push(`\t\\caption{${cap}}`);
    if (lab) lines.push(`\t\\label{${lab}}`);
    lines.push('\\end{figure}');
    return `${lines.join('\n')}\n`;
  }

  const actions = h('div', 'modal-actions');
  const ok = h('button', 'btn primary', 'Insert figure');
  ok.onclick = () => {
    if (!picked.length) return toast('Pick a picture first.');
    const packages = ['graphicx'];
    if (picked.length > 1) packages.push('subcaption');
    if (place.value === 'H') packages.push('float');
    const code = build();
    close();
    onInsert(code, { packages });
  };
  const cancel = h('button', 'btn', 'Cancel');
  cancel.onclick = close;
  actions.append(ok, cancel);
  box.append(h('div', 'bx-sub-head', 'Pick one picture, or several to put side by side.'), gallery, sel, opts, actions);
  drawGallery();
}
