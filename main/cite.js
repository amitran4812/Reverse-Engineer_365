'use strict';

// Looks up the reference for a paper: a DOI goes to doi.org (Crossref and
// DataCite records as CSL-JSON), an arXiv id to arXiv's API, an ISBN to Open
// Library, and anything else is a Crossref search by title.

const fs = require('fs/promises');
const path = require('path');
const cite = require('../common/cite');

const MOCK = process.env.REA_CITE_MOCK;
const DOI = MOCK ? `${MOCK}/doi/` : 'https://doi.org/';
const CROSSREF = MOCK ? `${MOCK}/crossref/works` : 'https://api.crossref.org/works';
const ARXIV = MOCK ? `${MOCK}/arxiv/query` : 'https://export.arxiv.org/api/query';
const OPENLIBRARY = MOCK ? `${MOCK}/openlibrary/books` : 'https://openlibrary.org/api/books';
const TIMEOUT = 15000;

function agent() {
  let version = '';
  try {
    version = require('electron').app.getVersion();
  } catch {}
  // Crossref asks API users to say who they are.
  return `Work/${version || 'dev'} (https://github.com/amitran4812/Reverse-Engineer_365)`;
}

async function get(url, { accept = 'application/json', what = 'The lookup' } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { accept, 'user-agent': agent() }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    const e = new Error(err?.name === 'TimeoutError' ? `${what} took too long. Check your connection and try again.` : `Couldn’t reach ${what.replace(/^The /, 'the ')}. Check your internet connection.`);
    e.offline = true;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(res.status === 404 ? 'Not found.' : `${what} returned ${res.status}.`);
    e.status = res.status;
    throw e;
  }
  return res;
}

async function byDoi(doi) {
  const res = await get(`${DOI}${doi.split('/').map(encodeURIComponent).join('/')}`, { accept: 'application/vnd.citationstyles.csl+json, application/json;q=0.5', what: 'doi.org' });
  return cite.normalize(await res.json(), 'doi.org');
}

async function byArxiv(id) {
  const res = await get(`${ARXIV}?id_list=${encodeURIComponent(id)}`, { accept: 'application/atom+xml', what: 'arXiv' });
  return cite.fromArxivAtom(await res.text());
}

async function byIsbn(isbn) {
  const res = await get(`${OPENLIBRARY}?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, { what: 'Open Library' });
  const j = await res.json();
  return cite.fromOpenLibrary(j[`ISBN:${isbn}`], isbn);
}

// Crossref's best matches for a title or a pasted reference, best first.
async function searchCrossref(query, rows = 5) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!q) return [];
  const res = await get(`${CROSSREF}?query.bibliographic=${encodeURIComponent(q)}&rows=${rows}`, { what: 'Crossref' });
  const j = await res.json();
  return (j?.message?.items || [])
    .map((w) => ({ ...cite.normalize(w, 'Crossref'), score: cite.titleScore(q, first(w.title)) }))
    .filter((x) => x.title);
}

const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

// One paper, from whatever is known about it. Returns { items, match, ids, note }:
// match is 'id' when an identifier settled it, 'search' for title matches the
// user should pick from, and 'file' when only the file's own details were used.
async function lookup(req = {}) {
  const seen = [req.doi, req.arxiv, req.isbn, req.metadata, ...Object.values(req.info || {}).filter((v) => typeof v === 'string'), req.text].filter(Boolean).join('\n');
  const found = cite.findIds(seen);
  const ids = {
    doi: cite.cleanDoi(req.doi) || found.doi,
    arxiv: cite.cleanArxiv(req.arxiv) || found.arxiv,
    isbn: cite.cleanIsbn(req.isbn) || found.isbn,
  };
  const errors = [];
  const items = [];
  const attempt = async (fn) => {
    try {
      const item = await fn();
      if (item?.title) items.push(item);
    } catch (err) {
      errors.push(err);
    }
  };
  if (ids.arxiv && (!ids.doi || /^10\.48550\//i.test(ids.doi))) {
    await attempt(() => byArxiv(ids.arxiv));
    // A preprint that has since been published: offer the published version too.
    if (items[0]?.journalDoi) await attempt(() => byDoi(items[0].journalDoi));
  } else if (ids.doi) {
    await attempt(() => byDoi(ids.doi));
    if (!items.length && ids.arxiv) await attempt(() => byArxiv(ids.arxiv));
  }
  if (!items.length && ids.isbn) await attempt(() => byIsbn(ids.isbn));
  if (items.length) return { items, match: 'id', ids };

  const title = [req.title, req.info?.Title].find((t) => cite.usefulTitle(t)) || cite.guessTitle(req.text);
  if (title && !errors.some((e) => e.offline)) {
    try {
      const hits = await searchCrossref(title);
      const good = hits.filter((x) => x.score >= 0.5);
      if (good.length) return { items: good, match: 'search', guessed: true, ids, query: title };
    } catch (err) {
      errors.push(err);
    }
  }
  const local = cite.fromFileInfo({ info: req.info, title, fileName: req.fileName });
  const offline = errors.some((e) => e.offline);
  return {
    items: local.title ? [local] : [],
    match: 'file',
    ids,
    query: title,
    note: offline ? 'You seem to be offline, so this reference was built from the file’s own details. Check it, or try again when you’re online.' : 'No match online, so this reference was built from the file’s own details. Check it, or search by title or DOI.',
  };
}

// The search box: a DOI, arXiv id, ISBN, link or words.
async function search(text) {
  const q = cite.parseQuery(text);
  if (q.doi || q.arxiv || q.isbn) return lookup(q);
  if (q.url) {
    const ids = cite.findIds(q.url);
    if (ids.doi || ids.arxiv) return lookup(ids);
  }
  const items = await searchCrossref(q.query || q.url, 8);
  return { items, match: 'search', query: q.query || q.url };
}

// A paper picked from disk: Word and text files are read here, PDFs go back
// to the page as bytes for pdf.js to read.
async function readFile(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const fileName = path.basename(file);
  const buf = await fs.readFile(file);
  if (ext === 'pdf') {
    if (buf.length > 200 * 1024 * 1024) throw new Error(`${fileName} is too large.`);
    return { fileName, filePath: file, kind: 'pdf', data: new Uint8Array(buf) };
  }
  if (ext === 'docx') {
    const { value } = await require('mammoth').extractRawText({ buffer: buf });
    let info = {};
    try {
      const zip = await require('jszip').loadAsync(buf);
      const core = await zip.file('docProps/core.xml')?.async('string');
      const tag = (t) => (new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(core || '') || [])[1] || '';
      info = { Title: tag('dc:title'), Author: tag('dc:creator'), Subject: tag('dc:subject'), Keywords: tag('cp:keywords'), CreationDate: tag('dcterms:created') };
    } catch {}
    return { fileName, filePath: file, kind: 'text', text: value.slice(0, 20000), info };
  }
  return { fileName, filePath: file, kind: 'text', text: buf.toString('utf8').slice(0, 20000), info: {} };
}

module.exports = { lookup, search, readFile, searchCrossref };
