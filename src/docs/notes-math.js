// Equations in Write: typed as TeX with a live preview, or described in words
// for the connected AI to write. An equation is a picture whose alt text is
// its TeX and whose title is "Equation", so it saves to every format and
// double-clicking it opens it for editing again.

import { escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import { svgToPng } from './notes-chart.js';

export const EQUATION_TITLE = 'Equation';
export const LATEX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['latex'],
  properties: { latex: { type: 'string' } },
};

const SNIPPETS = [
  ['a/b', '\\frac{a}{b}'],
  ['√', '\\sqrt{x}'],
  ['xⁿ', 'x^{n}'],
  ['xᵢ', 'x_{i}'],
  ['Σ', '\\sum_{i=1}^{n} '],
  ['∫', '\\int_{a}^{b} f(x)\\,dx'],
  ['lim', '\\lim_{x \\to \\infty} '],
  ['( )', '\\left( x \\right)'],
  ['[ ]', '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}'],
  ['α', '\\alpha'],
  ['β', '\\beta'],
  ['π', '\\pi'],
  ['θ', '\\theta'],
  ['Δ', '\\Delta'],
  ['≤', '\\le '],
  ['≠', '\\ne '],
  ['±', '\\pm '],
  ['×', '\\times '],
  ['→', '\\rightarrow '],
  ['H₂O', '\\ce{H2O}'],
];

let engine = null;
// The TeX engine is a bundle of its own, loaded on first use.
function loadEngine() {
  const url = './mathjax.js';
  engine ||= import(url).catch((err) => {
    engine = null;
    throw err;
  });
  return engine;
}

export async function equationPng(latex, color = '#1f2328') {
  const { texToSvg } = await loadEngine();
  const r = texToSvg(latex);
  const svg = r.svg.replaceAll('currentColor', color);
  return { src: await svgToPng(svg, r.width, r.height, 3), width: Math.round(r.width), height: Math.round(r.height) };
}

// The equation editor. Resolves to { latex, src, width, height } or null.
export function equationDialog({ latex = '', onAsk } = {}) {
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('form', 'modal wide eq-modal');
    box.append(h('div', 'modal-title', latex ? 'Edit equation' : 'Insert an equation'));
    const pads = h('div', 'eq-snippets');
    const input = h('textarea', 'eq-input');
    input.rows = 3;
    input.spellcheck = false;
    input.placeholder = 'Type TeX, like E = mc^2 or \\frac{a}{b}';
    input.value = latex;
    for (const [label, snippet] of SNIPPETS) {
      const b = h('button', 'eq-snip', escapeHtml(label));
      b.type = 'button';
      b.title = snippet;
      b.onclick = () => {
        input.setRangeText(snippet, input.selectionStart, input.selectionEnd, 'end');
        input.focus();
        preview();
      };
      pads.append(b);
    }
    const view = h('div', 'eq-preview');
    const error = h('div', 'eq-error');
    const ask = h('div', 'eq-ask');
    const words = h('input');
    words.placeholder = 'Or describe it, like “area of a circle” or “quadratic formula”';
    const askBtn = h('button', 'btn', `${icon('sparkle', 14)}<span>Write it for me</span>`);
    askBtn.type = 'button';
    askBtn.onclick = () => {
      if (!words.value.trim()) return words.focus();
      done(null);
      onAsk?.(words.value.trim());
    };
    words.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        askBtn.click();
      }
    });
    ask.append(words, askBtn);
    const actions = h('div', 'modal-actions');
    const okBtn = h('button', 'btn primary', latex ? 'Update' : 'Insert');
    okBtn.type = 'submit';
    const cancel = h('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => done(null);
    actions.append(okBtn, cancel);
    box.append(pads, input, view, error, ...(onAsk ? [ask] : []), actions);
    back.append(box);
    document.body.append(back);
    input.focus();

    let last = null;
    let timer = 0;
    async function preview() {
      clearTimeout(timer);
      const text = input.value.trim();
      if (!text) {
        view.innerHTML = '<span class="muted">The equation shows here as you type.</span>';
        error.textContent = '';
        last = null;
        return;
      }
      try {
        const { texToSvg } = await loadEngine();
        const r = texToSvg(text);
        last = { latex: text, ...r };
        view.innerHTML = r.svg;
        error.textContent = '';
      } catch (err) {
        last = null;
        error.textContent = err.message || 'That TeX has a mistake.';
      }
    }
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(preview, 180);
    });
    preview();

    function done(v) {
      back.remove();
      resolve(v);
    }
    box.onsubmit = async (e) => {
      e.preventDefault();
      await preview();
      if (!last) return input.focus();
      try {
        done({ latex: last.latex, ...(await equationPng(last.latex)) });
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
    });
  });
}

export const isEquation = (img) => img?.getAttribute?.('title') === EQUATION_TITLE;
