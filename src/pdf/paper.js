// What Read knows about the open paper, for making references (Cite).
// Shape: { text, info, metadata, fileName, filePath, doi, arxiv, pages }.

import { findArxiv, findDoi } from './annot-data.js';

export async function paperInfo(reader, { fileName = '', filePath = null } = {}) {
  let info = {};
  let metadata = null;
  try {
    const meta = await reader.doc.getMetadata();
    info = meta.info || {};
    metadata = meta.metadata?.getAll?.() || null;
  } catch {
    /* no metadata */
  }
  const parts = [];
  for (let i = 0; i < Math.min(2, reader.pageCount); i++) parts.push((await reader.text(i)).str);
  const text = parts.join('\n\n');
  return {
    text,
    info,
    metadata,
    fileName,
    filePath,
    doi: findDoi(text) || findDoi(String(info.Subject || '')) || findDoi(JSON.stringify(metadata || {})),
    arxiv: findArxiv(text),
    pages: reader.pageCount,
  };
}
