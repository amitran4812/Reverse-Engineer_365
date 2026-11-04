'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { exportPptx } = require('../main/formats/pptx');
const { importPptx } = require('../main/formats/pptx-import');

test('.pptx keeps slide transitions', async () => {
  const slides = [
    { elements: [], transition: { type: 'push', speed: 'fast' } },
    { elements: [] },
    { elements: [], transition: { type: 'zoom', speed: 'slow' } },
  ];
  const buf = await exportPptx({ slides });
  const zip = await JSZip.loadAsync(buf);
  assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /<p:transition spd="fast"><p:push dir="l"\/><\/p:transition><\/p:sld>/);
  assert.doesNotMatch(await zip.file('ppt/slides/slide2.xml').async('string'), /p:transition/);
  const back = await importPptx(buf);
  assert.deepEqual(back.slides.map((s) => s.transition), [{ type: 'push', speed: 'fast' }, undefined, { type: 'zoom', speed: 'slow' }]);
});
