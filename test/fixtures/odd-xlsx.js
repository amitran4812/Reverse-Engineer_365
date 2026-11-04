'use strict';

// Rewrites a normal .xlsx into the shapes other tools write, which Excel opens
// fine: tags with an x: namespace prefix (Open XML SDK, report exporters), and
// the workbook part at a path other than xl/workbook.xml.
const JSZip = require('jszip');

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function prefixed(xml) {
  if (!xml.includes(`xmlns="${MAIN}"`)) return xml;
  return xml
    .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s>/])/g, (m, slash, tag) => (tag.includes(':') ? m : `<${slash}x:${tag}`))
    .replace(`xmlns="${MAIN}"`, `xmlns:x="${MAIN}"`);
}

async function reshape(buffer, { prefix = false, bookPath = null } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.xml') || !prefix) continue;
    zip.file(entry.name, prefixed(await entry.async('string')));
  }
  if (bookPath) {
    const name = bookPath.split('/').pop();
    zip.file(bookPath, await zip.file('xl/workbook.xml').async('string'));
    zip.file(`xl/_rels/${name}.rels`, await zip.file('xl/_rels/workbook.xml.rels').async('string'));
    zip.remove('xl/workbook.xml');
    zip.remove('xl/_rels/workbook.xml.rels');
    for (const f of ['_rels/.rels', '[Content_Types].xml']) {
      zip.file(f, (await zip.file(f).async('string')).replace(/xl\/workbook\.xml/g, bookPath));
    }
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { reshape };
