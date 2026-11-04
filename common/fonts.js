'use strict';

// The fonts Work ships (open-licence faces bundled into dist/fonts by
// build.mjs, so they look the same on every computer and work offline) and
// the font stacks the apps use. Fonts installed on the computer are listed
// at run time by src/shared/fonts.js.

const GROUPS = [
  ['sans', 'Sans serif'],
  ['serif', 'Serif'],
  ['mono', 'Monospace'],
  ['display', 'Display'],
  ['hand', 'Handwriting'],
  ['world', 'World scripts'],
];

// id is the @fontsource package; family is the name documents use.
const BUNDLED = [
  ['inter', 'Inter', 'sans'],
  ['roboto', 'Roboto', 'sans'],
  ['open-sans', 'Open Sans', 'sans'],
  ['lato', 'Lato', 'sans'],
  ['montserrat', 'Montserrat', 'sans'],
  ['poppins', 'Poppins', 'sans'],
  ['source-sans-3', 'Source Sans 3', 'sans'],
  ['noto-sans', 'Noto Sans', 'sans'],
  ['nunito', 'Nunito', 'sans'],
  ['raleway', 'Raleway', 'sans'],
  ['work-sans', 'Work Sans', 'sans'],
  ['ibm-plex-sans', 'IBM Plex Sans', 'sans'],
  ['fira-sans', 'Fira Sans', 'sans'],
  ['pt-sans', 'PT Sans', 'sans'],
  ['dm-sans', 'DM Sans', 'sans'],
  ['rubik', 'Rubik', 'sans'],
  ['carlito', 'Carlito', 'sans'],
  ['arimo', 'Arimo', 'sans'],
  ['comic-neue', 'Comic Neue', 'sans'],
  ['merriweather', 'Merriweather', 'serif'],
  ['lora', 'Lora', 'serif'],
  ['playfair-display', 'Playfair Display', 'serif'],
  ['eb-garamond', 'EB Garamond', 'serif'],
  ['cormorant-garamond', 'Cormorant Garamond', 'serif'],
  ['libre-baskerville', 'Libre Baskerville', 'serif'],
  ['crimson-pro', 'Crimson Pro', 'serif'],
  ['source-serif-4', 'Source Serif 4', 'serif'],
  ['noto-serif', 'Noto Serif', 'serif'],
  ['pt-serif', 'PT Serif', 'serif'],
  ['roboto-slab', 'Roboto Slab', 'serif'],
  ['gelasio', 'Gelasio', 'serif'],
  ['caladea', 'Caladea', 'serif'],
  ['tinos', 'Tinos', 'serif'],
  ['fira-code', 'Fira Code', 'mono'],
  ['jetbrains-mono', 'JetBrains Mono', 'mono'],
  ['source-code-pro', 'Source Code Pro', 'mono'],
  ['ibm-plex-mono', 'IBM Plex Mono', 'mono'],
  ['roboto-mono', 'Roboto Mono', 'mono'],
  ['inconsolata', 'Inconsolata', 'mono'],
  ['cousine', 'Cousine', 'mono'],
  ['oswald', 'Oswald', 'display'],
  ['bebas-neue', 'Bebas Neue', 'display'],
  ['anton', 'Anton', 'display'],
  ['abril-fatface', 'Abril Fatface', 'display'],
  ['lobster', 'Lobster', 'display'],
  ['caveat', 'Caveat', 'hand'],
  ['dancing-script', 'Dancing Script', 'hand'],
  ['pacifico', 'Pacifico', 'hand'],
  ['great-vibes', 'Great Vibes', 'hand'],
  ['sacramento', 'Sacramento', 'hand'],
  ['allura', 'Allura', 'hand'],
  ['satisfy', 'Satisfy', 'hand'],
  ['kalam', 'Kalam', 'hand'],
  ['patrick-hand', 'Patrick Hand', 'hand'],
  ['indie-flower', 'Indie Flower', 'hand'],
  ['noto-sans-devanagari', 'Noto Sans Devanagari', 'world'],
  ['noto-serif-devanagari', 'Noto Serif Devanagari', 'world'],
  ['noto-sans-bengali', 'Noto Sans Bengali', 'world'],
  ['noto-sans-tamil', 'Noto Sans Tamil', 'world'],
  ['noto-sans-arabic', 'Noto Sans Arabic', 'world'],
  ['noto-sans-hebrew', 'Noto Sans Hebrew', 'world'],
].map(([id, family, group]) => ({ id, family, group }));

// Common fonts that documents from other apps ask for. When the computer
// doesn't have one, a bundled face with the same letter widths stands in,
// so pages and slides keep their layout.
const STAND_INS = {
  Calibri: 'carlito',
  Cambria: 'caladea',
  Arial: 'arimo',
  Helvetica: 'arimo',
  'Helvetica Neue': 'arimo',
  'Liberation Sans': 'arimo',
  'Times New Roman': 'tinos',
  Times: 'tinos',
  'Liberation Serif': 'tinos',
  'Courier New': 'cousine',
  Courier: 'cousine',
  'Liberation Mono': 'cousine',
};

// Fonts most computers have, offered by name in the picker when the list of
// installed fonts can't be read.
const COMMON = [
  'Calibri', 'Cambria', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Segoe UI', 'Garamond', 'Helvetica', 'Consolas', 'Candara', 'Constantia', 'Corbel', 'Century Gothic',
  'Book Antiqua', 'Palatino Linotype', 'Franklin Gothic Medium', 'Impact', 'Lucida Console', 'Comic Sans MS',
];

const GENERIC = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', display: 'sans-serif', hand: 'cursive', world: 'sans-serif' };
const MONO = /mono|code|consol|courier|menlo|cousine|inconsolata|terminal|typewriter/i;
const SERIF = /serif|times|georgia|garamond|cambria|caladea|tinos|baskerville|palatino|antiqua|constantia|merriweather|lora|playfair|crimson|cormorant|gelasio|slab|bodoni|didot|minion/i;

const byFamily = new Map(BUNDLED.map((f) => [f.family.toLowerCase(), f]));
const bundled = (name) => byFamily.get(String(name || '').toLowerCase()) || null;

// The first family named in a CSS font-family value, without quotes.
function firstFamily(value) {
  return String(value || '').split(',')[0].replace(/["']/g, '').trim();
}

function genericFor(name) {
  const f = bundled(name);
  if (f) return GENERIC[f.group];
  if (/sans/i.test(name)) return 'sans-serif';
  if (MONO.test(name)) return 'monospace';
  if (SERIF.test(name)) return 'serif';
  return 'sans-serif';
}

// A CSS font-family value for a font name: quoted, with a fitting fallback.
function fontStack(name) {
  const n = firstFamily(name);
  if (!n) return '';
  return `"${n.replace(/"/g, '')}", ${genericFor(n)}`;
}

module.exports = { BUNDLED, COMMON, GROUPS, STAND_INS, bundled, firstFamily, fontStack, genericFor };
