// Bundles each app's renderer code into dist/ with esbuild.
import { build, context } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// latex is Write's LaTeX mode: its own page, opened for .tex projects.
const APPS = { home: 'Work', docs: 'Write', sheets: 'Plot', slides: 'Present', latex: 'Write' };
const watch = process.argv.includes('--watch');

await mkdir(join(here, 'dist'), { recursive: true });
const template = await readFile(join(here, 'src', 'app.html'), 'utf8');
for (const [app, title] of Object.entries(APPS)) {
  await writeFile(join(here, 'dist', `${app}.html`), template.replaceAll('__APP__', app).replaceAll('__TITLE__', title));
}
// The PDF preview's worker runs as its own script next to the bundles.
await copyFile(join(here, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.min.mjs'), join(here, 'dist', 'pdf.worker.js'));

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

// Plot's analysis data engine runs in a classic worker of its own.
const worker = {
  ...options,
  entryPoints: { 'analysis-worker': join(here, 'src', 'sheets', 'analysis', 'worker.js') },
  format: 'iife',
};

if (watch) {
  for (const o of [options, worker]) await (await context(o)).watch();
} else {
  await Promise.all([build(options), build(worker)]);
}
