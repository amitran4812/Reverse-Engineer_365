'use strict';

// Plain helpers for Write's headings and comments, shared by the editor and the .docx converter.

const textOf = (node) => (node.type === 'text' ? node.text || '' : (node.content || []).map(textOf).join(''));

// Every heading in the document, in order: { index, level, text }.
function headingOutline(json) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'heading') {
      out.push({ index: out.length, level: node.attrs?.level || 1, text: textOf(node).trim() });
      return;
    }
    (node.content || []).forEach(walk);
  };
  walk(json);
  return out;
}

// Comments in a document: { id: { text, author, date, resolved, firstNode, lastNode } }, where the
// nodes are the first and last text nodes it covers, so a converter knows where it starts and ends.
// Text in code blocks is skipped, since converters write those as plain lines.
function commentSpans(json) {
  const out = {};
  const walk = (node) => {
    if (!node || node.type === 'codeBlock') return;
    if (node.type === 'text') {
      for (const m of node.marks || []) {
        if (m.type !== 'comment' || !m.attrs?.id) continue;
        const c = out[m.attrs.id] || (out[m.attrs.id] = { ...m.attrs, firstNode: node });
        c.lastNode = node;
      }
      return;
    }
    (node.content || []).forEach(walk);
  };
  walk(json);
  return out;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BLOCK = /⟦(\/?)c(\d+)⟧|<\/(p|h[1-6]|li|td|th)>|<(p|h[1-6]|li|td|th)\b[^>]*>/g;

// Turns ⟦cN⟧ … ⟦/cN⟧ markers (put in the Word text before conversion) into comment spans,
// closing and reopening them at paragraph edges so the HTML stays well formed.
function applyCommentMarkers(html, comments) {
  const open = [];
  const span = (id) => {
    const c = comments[id];
    return `<span data-comment-id="w${id}" data-comment-text="${esc(c.text)}" data-comment-author="${esc(c.author)}" data-comment-date="${esc(c.date)}">`;
  };
  const closeAll = () => '</span>'.repeat(open.length);
  const reopen = () => open.map(span).join('');
  return html.replace(BLOCK, (m, slash, id, endTag, startTag) => {
    if (id != null) {
      if (!comments[id]) return '';
      if (!slash) {
        if (open.includes(id)) return '';
        open.push(id);
        return span(id);
      }
      const at = open.indexOf(id);
      if (at < 0) return '';
      const out = closeAll();
      open.splice(at, 1);
      return out + reopen();
    }
    if (endTag) return closeAll() + m;
    if (startTag) return m + reopen();
    return m;
  });
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// word/comments.xml as { id: { text, author, date } }.
function readCommentsXml(xml) {
  const out = {};
  for (const [, attrs, body] of String(xml || '').matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = /w:id="(\d+)"/.exec(attrs)?.[1];
    if (id == null) continue;
    const text = [...body.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
      .map(([p]) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => decode(t[1])).join(''))
      .join('\n').trim();
    out[id] = { text, author: decode(/w:author="([^"]*)"/.exec(attrs)?.[1] || ''), date: /w:date="([^"]*)"/.exec(attrs)?.[1] || '' };
  }
  return out;
}

// Puts ⟦cN⟧ markers where Word comment ranges start and end, as plain runs the converter keeps.
function markCommentRanges(documentXml) {
  return String(documentXml)
    .replace(/<w:commentRangeStart\b[^>]*w:id="(\d+)"[^>]*\/>/g, '<w:r><w:t>⟦c$1⟧</w:t></w:r>')
    .replace(/<w:commentRangeEnd\b[^>]*w:id="(\d+)"[^>]*\/>/g, '<w:r><w:t>⟦/c$1⟧</w:t></w:r>');
}

module.exports = { headingOutline, commentSpans, applyCommentMarkers, readCommentsXml, markCommentRanges };
