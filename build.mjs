// Bundles each app's renderer code into dist/ with esbuild.
import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const APPS = { home: 'Work', docs: 'Write', sheets: 'Plot', slides: 'Present' };
const watch = process.argv.includes('--watch');

await mkdir(join(here, 'dist'), { recursive: true });
const template = await readFile(join(here, 'src', 'app.html'), 'utf8');
for (const [app, title] of Object.entries(APPS)) {
  await writeFile(join(here, 'dist', `${app}.html`), template.replaceAll('__APP__', app).replaceAll('__TITLE__', title));
}

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

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
