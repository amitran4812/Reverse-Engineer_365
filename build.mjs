// Bundles each app's renderer code into dist/ with esbuild.
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// latex is Write's LaTeX mode: its own page, opened for .tex projects.
const APPS = { home: 'Work', docs: 'Write', sheets: 'Plot', slides: 'Present', latex: 'Write', pdf: 'Read' };
const watch = process.argv.includes('--watch');

await mkdir(join(here, 'dist'), { recursive: true });
const template = await readFile(join(here, 'src', 'app.html'), 'utf8');
for (const [app, title] of Object.entries(APPS)) {
  await writeFile(join(here, 'dist', `${app}.html`), template.replaceAll('__APP__', app).replaceAll('__TITLE__', title));
}
// The PDF preview's worker runs as its own script next to the bundles.
await copyFile(join(here, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'), join(here, 'dist', 'pdf.worker.js'));

// The bundled fonts: regular, bold and their italics of each family, split
// by script so a page only loads the files for the letters it shows.
async function bundleFonts() {
  const { BUNDLED, STAND_INS } = createRequire(import.meta.url)('./common/fonts.js');
  const out = join(here, 'dist', 'fonts');
  await mkdir(out, { recursive: true });
  const css = [];
  const licences = [];
  const faces = {};
  for (const f of BUNDLED) {
    const pkg = join(here, 'node_modules', '@fontsource', f.id);
    const meta = JSON.parse(await readFile(join(pkg, 'metadata.json'), 'utf8'));
    const ranges = JSON.parse(await readFile(join(pkg, 'unicode.json'), 'utf8'));
    const near = (w) => meta.weights.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
    const weights = [...new Set([near(400), near(700)])];
    faces[f.id] = [];
    for (const style of meta.styles) {
      for (const weight of weights) {
        for (const subset of meta.subsets) {
          const file = `${f.id}-${subset}-${weight}-${style}.woff2`;
          try {
            await copyFile(join(pkg, 'files', file), join(out, file));
          } catch {
            continue;
          }
          faces[f.id].push({ style, weight, file, range: ranges[subset] });
        }
      }
    }
    for (const x of faces[f.id]) css.push(face(f.family, x, []));
    licences.push(`${meta.family} (${meta.license.type}): ${meta.license.attribution || ''}\n${meta.license.url || ''}`);
  }
  // Stand-ins: the computer's own font when it has one, else the bundled face.
  for (const [name, id] of Object.entries(STAND_INS)) {
    for (const x of faces[id]) {
      const bold = x.weight >= 600;
      const it = x.style === 'italic';
      const names = it ? [`${name}${bold ? ' Bold' : ''} Italic`, `${name}${bold ? ' Bold' : ''} Oblique`] : [bold ? `${name} Bold` : name];
      css.push(face(name, x, names));
    }
  }
  await writeFile(join(here, 'dist', 'fonts.css'), css.join('\n'));
  await writeFile(join(out, 'LICENSES.txt'), `Fonts included with Work. Each is used under its own licence.\n\n${licences.join('\n\n')}\n`);
}

function face(family, x, local) {
  const src = [...local.map((n) => `local("${n}")`), `url("fonts/${x.file}") format("woff2")`].join(', ');
  return `@font-face{font-family:"${family}";font-style:${x.style};font-weight:${x.weight};font-display:swap;src:${src};unicode-range:${x.range}}`;
}

await bundleFonts();

const options = {
  entryPoints: Object.fromEntries(Object.keys(APPS).map((a) => [a, join(here, 'src', a, `${a}.js`)])),
  outdir: join(here, 'dist'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome128',
  sourcemap: true,
  minify: !watch,
  legalComments: 'linked',
  loader: { '.svg': 'text' },
  logLevel: 'info',
};

// Equations load their TeX engine on first use, from a bundle of its own.
const math = { ...options, entryPoints: { mathjax: join(here, 'src', 'docs', 'mathjax.js') } };

// The Cite dialog reads PDFs with pdf.js, also from a bundle of its own.
const pdfText = { ...options, entryPoints: { pdftext: join(here, 'src', 'shared', 'pdf-text.js') } };

// Plot's analysis data engine runs in a classic worker of its own.
const worker = {
  ...options,
  entryPoints: { 'analysis-worker': join(here, 'src', 'sheets', 'analysis', 'worker.js') },
  format: 'iife',
};

if (watch) {
  for (const o of [options, math, pdfText, worker]) await (await context(o)).watch();
} else {
  await Promise.all([build(options), build(math), build(pdfText), build(worker)]);
}
