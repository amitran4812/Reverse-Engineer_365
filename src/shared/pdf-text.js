// Reads the first pages of a PDF for the Cite dialog: its text, its
// document info and its XMP metadata. A bundle of its own, loaded on first use.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.js';

export async function readPdf(data, pages = 2) {
  const task = pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false });
  try {
    const doc = await task.promise;
    const meta = await doc.getMetadata().catch(() => null);
    const parts = [];
    for (let i = 1; i <= Math.min(pages, doc.numPages); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      parts.push(content.items.map((t) => (t.str || '') + (t.hasEOL ? '\n' : ' ')).join(''));
    }
    return { text: parts.join('\n'), info: meta?.info || {}, metadata: meta?.metadata?.getRaw?.() || '' };
  } finally {
    task.destroy();
  }
}
