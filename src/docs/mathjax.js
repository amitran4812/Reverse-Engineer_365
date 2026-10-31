// TeX to SVG for equations in Write. Bundled on its own and loaded the first
// time an equation is made, so documents without math don't pay for it.

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js';
import 'mathjax-full/js/input/tex/braket/BraketConfiguration.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({ packages: ['base', 'ams', 'newcommand', 'noundefined', 'boldsymbol', 'color', 'cancel', 'mhchem', 'braket'], formatError: (_jax, err) => { throw err; } });
const doc = mathjax.document('', { InputJax: tex, OutputJax: new SVG({ fontCache: 'none' }) });

// Returns { svg, width, height } in CSS pixels at the given font size, or throws
// with MathJax's message when the TeX has a mistake.
export function texToSvg(latex, { display = true, fontSize = 18 } = {}) {
  const node = doc.convert(latex, { display, em: fontSize, ex: fontSize / 2, containerWidth: 1200 });
  let svg = adaptor.innerHTML(node);
  const ex = (attr) => Number.parseFloat(new RegExp(`${attr}="([\\d.]+)ex"`).exec(svg)?.[1] || 0) * (fontSize / 2);
  const width = ex('width');
  const height = ex('height');
  if (!width || !height) throw new Error('That equation came out empty.');
  svg = svg.replace(/width="[\d.]+ex"/, `width="${width}"`).replace(/height="[\d.]+ex"/, `height="${height}"`).replace(/style="[^"]*"/, '');
  if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  return { svg, width, height };
}
