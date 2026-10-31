// Fill & Sign: draw, type or upload a signature (or initials). Saved ones are
// kept for this account, encrypted, and picked from a menu next time.

import { icon } from '../shared/icons.js';
import { escapeHtml, h, toast } from '../shared/shell.js';

const FONTS = ['Segoe Script', 'Ink Free', 'Lucida Handwriting', 'Brush Script MT', 'Bradley Hand', 'Snell Roundhand', 'Segoe Print'];
const INKS = { Black: '#111111', Blue: '#1d3f9a', Red: '#9b1c1c' };

// Crops a canvas to what was drawn on it, with a little margin.
function trimmed(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const m = 6;
  x0 = Math.max(0, x0 - m);
  y0 = Math.max(0, y0 - m);
  x1 = Math.min(width - 1, x1 + m);
  y1 = Math.min(height - 1, y1 + m);
  const out = h('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), w: out.width, h: out.height };
}

function drawPad(ink) {
  const canvas = h('canvas', 'sg-pad');
  canvas.width = 1200;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let last = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height, e.pressure || 0.5];
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = pos(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last) return;
    const p = pos(e);
    ctx.strokeStyle = ink();
    // Pens get a pressure-sensitive line; a mouse a steady one.
    ctx.lineWidth = e.pointerType === 'pen' ? 3 + p[2] * 7 : 5;
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.quadraticCurveTo(last[0], last[1], (last[0] + p[0]) / 2, (last[1] + p[1]) / 2);
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    last = p;
  });
  const end = () => {
    last = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return { canvas, clear: () => ctx.clearRect(0, 0, canvas.width, canvas.height) };
}

function typed(textValue, font, ink) {
  const c = h('canvas');
  c.width = 1400;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ink;
  ctx.textBaseline = 'middle';
  let size = 150;
  ctx.font = `${size}px "${font}", cursive`;
  while (ctx.measureText(textValue).width > c.width - 40 && size > 30) {
    size -= 8;
    ctx.font = `${size}px "${font}", cursive`;
  }
  ctx.fillText(textValue, 20, c.height / 2);
  return trimmed(c);
}

// Loads a picture and makes a near-white background see-through.
async function fromImage(file, clearWhite) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1400 / img.naturalWidth, 600 / img.naturalHeight);
    const c = h('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (clearWhite) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
        if (lum > 225) d.data[i + 3] = 0;
        else if (lum > 180) d.data[i + 3] = Math.round(d.data[i + 3] * (225 - lum) / 45);
      }
      ctx.putImageData(d, 0, 0);
    }
    return trimmed(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Asks for a new signature. Resolves to { src, w, h, kind } or null.
export function createSignature(kind = 'signature', name = '') {
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('div', 'modal wide sg-modal');
    const label = kind === 'initials' ? 'initials' : 'signature';
    box.innerHTML = `<div class="modal-title">Create your ${label}</div>
      <div class="sg-tabs"><button data-tab="type" class="on">Type</button><button data-tab="draw">Draw</button><button data-tab="image">Picture</button></div>
      <div class="sg-body"></div>
      <div class="sg-row"><span class="muted">Ink</span>${Object.entries(INKS).map(([n, c], i) => `<button class="sg-ink${i === 0 ? ' on' : ''}" data-ink="${c}" title="${n}" style="--ink:${c}"></button>`).join('')}
        <label class="sg-save"><input type="checkbox" checked> Save it for next time</label></div>
      <div class="modal-actions"><button class="btn primary" data-ok>Use it</button><button class="btn" data-cancel>Cancel</button></div>`;
    back.append(box);
    document.body.append(back);
    const body = box.querySelector('.sg-body');
    let ink = INKS.Black;
    let tab = 'type';
    const pad = drawPad(() => ink);
    const nameIn = h('input', 'sg-name');
    nameIn.placeholder = kind === 'initials' ? 'Your initials' : 'Your name';
    nameIn.value = kind === 'initials' ? name.split(/\s+/).map((w) => w[0] || '').join('').toUpperCase() : name;
    const fonts = h('div', 'sg-fonts');
    let font = FONTS[0];
    const drawFonts = () => {
      fonts.innerHTML = '';
      for (const f of FONTS) {
        const b = h('button', `sg-font${f === font ? ' on' : ''}`, escapeHtml(nameIn.value || 'Your name'));
        b.style.fontFamily = `"${f}", cursive`;
        b.style.color = ink;
        b.onclick = () => {
          font = f;
          drawFonts();
        };
        fonts.append(b);
      }
    };
    nameIn.oninput = drawFonts;
    let picked = null;
    const fileIn = h('input');
    fileIn.type = 'file';
    fileIn.accept = 'image/png,image/jpeg';
    const clearWhite = h('label', 'sg-save', '<input type="checkbox" checked> Remove the white background');
    const preview = h('div', 'sg-preview muted', 'Pick a photo or scan of your signature.');
    const loadPicked = async () => {
      if (!fileIn.files[0]) return;
      picked = await fromImage(fileIn.files[0], clearWhite.querySelector('input').checked);
      preview.innerHTML = picked ? `<img src="${picked.src}" alt="">` : 'That picture looks empty.';
    };
    fileIn.onchange = loadPicked;
    clearWhite.querySelector('input').onchange = loadPicked;
    const show = () => {
      body.innerHTML = '';
      box.querySelectorAll('.sg-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      if (tab === 'type') {
        body.append(nameIn, fonts);
        drawFonts();
        nameIn.focus();
      } else if (tab === 'draw') {
        const clear = h('button', 'btn sg-clear', 'Clear');
        clear.onclick = pad.clear;
        body.append(h('div', 'sg-pad-wrap'), clear);
        body.firstChild.append(pad.canvas, h('div', 'sg-line'));
      } else {
        const pick = h('button', 'btn', `${icon('image', 16)} Choose a picture…`);
        pick.onclick = () => fileIn.click();
        body.append(pick, clearWhite, preview);
      }
    };
    box.querySelectorAll('.sg-tabs button').forEach((b) => {
      b.onclick = () => {
        tab = b.dataset.tab;
        show();
      };
    });
    box.querySelectorAll('.sg-ink').forEach((b) => {
      b.onclick = () => {
        ink = b.dataset.ink;
        box.querySelectorAll('.sg-ink').forEach((x) => x.classList.toggle('on', x === b));
        if (tab === 'type') drawFonts();
      };
    });
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    box.querySelector('[data-cancel]').onclick = () => done(null);
    back.addEventListener('keydown', (e) => e.key === 'Escape' && done(null));
    box.querySelector('[data-ok]').onclick = async () => {
      let out = null;
      if (tab === 'type') out = nameIn.value.trim() ? typed(nameIn.value.trim(), font, ink) : null;
      else if (tab === 'draw') out = trimmed(pad.canvas);
      else out = picked;
      if (!out) {
        toast(tab === 'type' ? 'Type your name first' : tab === 'draw' ? 'Draw your signature first' : 'Pick a picture first', 'error');
        return;
      }
      out.kind = kind;
      if (box.querySelector('.sg-row .sg-save input').checked) {
        const list = (await window.office.pdf.signatures()) || [];
        await window.office.pdf.setSignatures([{ ...out, id: `${Date.now()}` }, ...list].slice(0, 12));
      }
      done(out);
    };
    show();
  });
}
