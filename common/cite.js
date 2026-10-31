'use strict';

// References for papers, shared by the main process and the Cite dialog:
// finding a DOI, arXiv id or ISBN in a paper's text, turning Crossref, arXiv
// and Open Library records into one CSL-JSON shape, and writing that record
// out in the common citation styles.

const STYLES = [
  { id: 'apa', label: 'APA 7' },
  { id: 'mla', label: 'MLA 9' },
  { id: 'chicago', label: 'Chicago' },
  { id: 'harvard', label: 'Harvard' },
  { id: 'ieee', label: 'IEEE' },
  { id: 'vancouver', label: 'Vancouver' },
  { id: 'bibtex', label: 'BibTeX' },
  { id: 'ris', label: 'RIS' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

// ---------- identifiers ----------

function cleanDoi(s) {
  let d = String(s || '').trim().replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  d = d.replace(/[.,;:'"\]>}]+$/, '');
  // Keep a closing bracket only when the DOI opened one, as in 10.1016/S0140-6736(20)30183-5.
  while (/[)]$/.test(d) && (d.match(/\(/g) || []).length < (d.match(/\)/g) || []).length) d = d.slice(0, -1).replace(/[.,;:]+$/, '');
  return /^10\.\d{4,9}\/\S+$/.test(d) ? d : '';
}

function isbnValid(digits) {
  if (digits.length === 10) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (digits[i] === 'X' ? 10 : Number(digits[i])) * (10 - i);
    return sum % 11 === 0;
  }
  if (digits.length === 13 && /^\d+$/.test(digits)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  return false;
}

function cleanIsbn(s) {
  const d = String(s || '').toUpperCase().replace(/[^0-9X]/g, '');
  return isbnValid(d) ? d : '';
}

function cleanArxiv(s) {
  const m = /(?:arxiv(?:\.org\/(?:abs|pdf)\/|:\s*)|^)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i.exec(String(s || '').trim());
  return m ? m[1] : '';
}

// The paper's own identifier: a DOI on the first pages wins over one in the
// references, since references come later; arXiv ids and ISBNs come next.
function findIds(text) {
  const t = String(text || '').replace(/\u00ad/g, '').replace(/doi\s*:\s*/gi, 'doi:');
  const out = { doi: '', arxiv: '', isbn: '' };
  const doiRe = /(?:doi\.org\/|doi:|\b)(10\.\d{4,9}\/[^\s"<>]+)/gi;
  let m;
  const dois = [];
  while ((m = doiRe.exec(t))) {
    const d = cleanDoi(m[1]);
    if (d) dois.push(d);
  }
  if (dois.length) {
    // arXiv's own DOI is a stand-in; a journal DOI printed on the paper is better.
    out.doi = dois.find((d) => !/^10\.48550\//i.test(d)) || dois[0];
  }
  const ax = /arxiv(?:\.org\/(?:abs|pdf)\/|\s*:\s*)(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i.exec(t)
    || /10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i.exec(t);
  if (ax) out.arxiv = ax[1];
  const isbnRe = /ISBN(?:-1[03])?\s*:?\s*((?:97[89][\s-]?)?\d[\d\s-]{8,14}[\dXx])/g;
  while ((m = isbnRe.exec(t))) {
    const d = cleanIsbn(m[1]);
    if (d) {
      out.isbn = d;
      break;
    }
  }
  return out;
}

// What a search box holds: a DOI, arXiv id, ISBN or URL, or words to search for.
function parseQuery(q) {
  const s = String(q || '').trim();
  const doi = cleanDoi((/10\.\d{4,9}\/\S+/.exec(s) || [''])[0]);
  if (doi) return { doi };
  const arxiv = /arxiv/i.test(s) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(s) ? cleanArxiv(s.replace(/^.*?(arxiv)/i, '$1')) || cleanArxiv(s) : '';
  if (arxiv) return { arxiv };
  if (/^(?:ISBN[\s:-]*)?[\d\s-]{9,17}[\dXx]$/i.test(s)) {
    const isbn = cleanIsbn(s.replace(/^ISBN/i, ''));
    if (isbn) return { isbn };
  }
  if (/^https?:\/\//i.test(s)) return { url: s };
  return { query: s };
}

// ---------- records ----------

const first = (v) => (Array.isArray(v) ? v[0] : v) || '';
const squash = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function person(p) {
  if (!p) return null;
  if (typeof p === 'string') return splitName(p);
  if (p.family || p.given) return { family: squash(p.family), given: squash(p.given) };
  if (p.literal || p.name) return { literal: squash(p.literal || p.name) };
  return null;
}

// "Ada Lovelace", "Lovelace, Ada" or an organization.
function splitName(s) {
  const n = squash(s);
  if (!n) return null;
  if (n.includes(',')) {
    const [family, ...rest] = n.split(',');
    return { family: family.trim(), given: rest.join(',').trim() };
  }
  const parts = n.split(' ');
  if (parts.length === 1) return { literal: n };
  // Particles stay with the family name: "Ludwig van Beethoven".
  let i = parts.length - 1;
  while (i > 1 && /^(van|von|der|den|de|del|della|di|da|le|la|du|dos|das|ten|ter|bin|al)$/i.test(parts[i - 1])) i -= 1;
  return { family: parts.slice(i).join(' '), given: parts.slice(0, i).join(' ') };
}

function dateParts(d) {
  if (!d) return null;
  if (d['date-parts']?.[0]?.[0]) return d['date-parts'][0].map(Number).filter((x) => !Number.isNaN(x));
  if (d.raw || typeof d === 'string') {
    const m = /(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(d.raw || d);
    return m ? [m[1], m[2], m[3]].filter(Boolean).map(Number) : null;
  }
  return null;
}

const TYPE_ALIASES = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  'edited-book': 'book',
  monograph: 'book',
  'reference-book': 'book',
  'posted-content': 'article',
  dissertation: 'thesis',
  'report-component': 'report',
  dataset: 'dataset',
};

// A CSL-JSON record from doi.org, or a Crossref work, in one tidy shape.
function normalize(rec, source = '') {
  const r = rec || {};
  const type = TYPE_ALIASES[r.type] || r.type || 'article-journal';
  const item = {
    type,
    title: squash(first(r.title)),
    author: (r.author || []).map(person).filter(Boolean),
    editor: (r.editor || []).map(person).filter(Boolean),
    'container-title': squash(first(r['container-title'])),
    'container-title-short': squash(first(r['container-title-short'] || r['short-container-title'] || r['journalAbbreviation'])),
    'collection-title': squash(first(r['collection-title'])),
    publisher: squash(r.publisher),
    'publisher-place': squash(r['publisher-place']),
    volume: squash(r.volume),
    issue: squash(r.issue),
    page: squash(r.page),
    'article-number': squash(r['article-number'] || r.number),
    edition: squash(r.edition),
    issued: dateParts(r.issued) || dateParts(r['published-print']) || dateParts(r['published-online']) || dateParts(r.published) || dateParts(r.created),
    DOI: cleanDoi(r.DOI),
    URL: squash(r.URL),
    ISBN: cleanIsbn(first(r.ISBN)) || squash(first(r.ISBN)),
    ISSN: squash(first(r.ISSN)),
    arxiv: squash(r.arxiv),
    genre: squash(r.genre || r.subtype),
    source,
  };
  if (item.DOI && /^10\.48550\/arxiv\./i.test(item.DOI)) {
    item.arxiv ||= item.DOI.replace(/^10\.48550\/arxiv\./i, '');
    item.type = 'article';
  }
  if (!item.publisher && item.arxiv) item.publisher = 'arXiv';
  if (item.URL && item.DOI && /doi\.org/i.test(item.URL)) item.URL = '';
  return item;
}

// An arXiv Atom feed entry; the XML is read with plain patterns.
function fromArxivAtom(xml) {
  const entry = (/<entry>([\s\S]*?)<\/entry>/.exec(String(xml || '')) || [])[1];
  if (!entry) return null;
  const tag = (name) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(entry);
    return m ? unxml(m[1]).replace(/\s+/g, ' ').trim() : '';
  };
  const id = tag('id');
  if (!id || /api\/errors/.test(id)) return null;
  const arxiv = cleanArxiv(id);
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => splitName(unxml(m[1])));
  const published = tag('published');
  return {
    type: 'article',
    title: tag('title'),
    author: authors.filter(Boolean),
    editor: [],
    'container-title': '',
    publisher: 'arXiv',
    issued: dateParts(published),
    DOI: `10.48550/arXiv.${arxiv}`,
    URL: `https://arxiv.org/abs/${arxiv}`,
    arxiv,
    journalDoi: cleanDoi(tag('arxiv:doi')),
    abstract: tag('summary'),
    source: 'arXiv',
  };
}

function unxml(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}

// Open Library's books API (jscmd=data).
function fromOpenLibrary(rec, isbn) {
  if (!rec?.title) return null;
  const d = /(\d{4})/.exec(rec.publish_date || '');
  return {
    type: 'book',
    title: [rec.title, rec.subtitle].filter(Boolean).join(': '),
    author: (rec.authors || []).map((a) => splitName(a.name)).filter(Boolean),
    editor: [],
    publisher: squash(rec.publishers?.[0]?.name),
    'publisher-place': squash(rec.publish_places?.[0]?.name),
    issued: d ? [Number(d[1])] : null,
    ISBN: isbn,
    URL: rec.url || '',
    source: 'Open Library',
  };
}

// A record from what the file itself says, when nothing online matches.
function fromFileInfo({ info, title, fileName } = {}) {
  const i = info || {};
  let t = squash(title || i.Title);
  if (!usefulTitle(t)) t = String(fileName || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim();
  const who = squash(i.Author);
  const authors = who ? who.split(/\s*(?:;|\band\b|&|,(?=\s*[A-Z][a-z]+\s+[A-Z]))\s*/).map(splitName).filter(Boolean) : [];
  const date = /D:(\d{4})(\d{2})?(\d{2})?/.exec(i.CreationDate || '') || /(\d{4})-(\d{2})?-?(\d{2})?/.exec(i.CreationDate || '');
  return {
    type: 'article',
    title: t,
    author: authors,
    editor: [],
    issued: date ? [date[1], date[2], date[3]].filter(Boolean).map(Number) : null,
    source: 'file',
  };
}

// PDF titles are often a file name or the tool that made the file.
function usefulTitle(t) {
  const s = squash(t);
  if (s.length < 8 || s.split(' ').length < 2) return false;
  return !/^(microsoft word|untitled|document\d*|slide \d|title)\b|\.(docx?|pdf|tex|dvi|indd)$|^[\w-]+\.\w+$/i.test(s);
}

// A best guess at the title from the first page's text, for a search.
function guessTitle(text) {
  const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).slice(0, 40);
  const skip = /^(arxiv|doi|https?:|www\.|received|accepted|published|copyright|©|journal|vol\.|volume|proceedings|abstract|keywords|preprint|original (article|research)|research article|review|letter|article|page \d|\d+$)/i;
  for (const l of lines) {
    if (l.length < 15 || l.length > 250 || skip.test(l) || /@/.test(l)) continue;
    if ((l.match(/,/g) || []).length > 3) continue; // author lists
    return l;
  }
  return '';
}

// How alike two titles are, 0 to 1, by shared words.
function titleScore(a, b) {
  const words = (s) => new Set(String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 2));
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common += 1;
  return (2 * common) / (x.size + y.size);
}

// ---------- formatting ----------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const it = (s) => (s ? `<i>${esc(s)}</i>` : '');
const dash = (p) => String(p || '').replace(/\s*[-‐‑‒–—]+\s*/g, '–');
const endWith = (s, ch) => (!s ? s : /[.?!]$/.test(s.replace(/<[^>]+>/g, '').trim()) ? s : s + ch);

function initials(given, { dots = true, space = true } = {}) {
  return String(given || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.split('-').map((p) => (p ? p[0].toUpperCase() + (dots ? '.' : '') : '')).join('-'))
    .join(dots && space ? ' ' : '');
}

const year = (item) => (item.issued?.[0] ? String(item.issued[0]) : '');
const doiUrl = (item) => (item.DOI ? `https://doi.org/${item.DOI}` : item.URL || '');
const pages = (item) => dash(item.page) || '';
const isJournal = (item) => item.type === 'article-journal' || item.type === 'article-magazine' || item.type === 'article-newspaper' || item.type === 'review';
const isPreprint = (item) => item.type === 'article' && (item.arxiv || /preprint|posted/i.test(item.genre || '') || !item['container-title']);
const isChapter = (item) => item.type === 'chapter' || item.type === 'entry-encyclopedia' || item.type === 'entry-dictionary';

function joinList(names, last, { serial = true } = {}) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]}${serial && last === '&' ? ',' : ''} ${last} ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}${serial ? ',' : ''} ${last} ${names[names.length - 1]}`;
}

const familyOf = (p) => p.literal || p.family || '';

const NAMES = {
  apa(list) {
    const n = list.map((p) => (p.literal ? p.literal : `${p.family}${p.given ? `, ${initials(p.given)}` : ''}`));
    if (n.length > 20) return `${n.slice(0, 19).join(', ')}, … ${n[n.length - 1]}`;
    return n.length === 2 ? `${n[0]}, & ${n[1]}` : joinList(n, '&');
  },
  mla(list) {
    const p = list[0];
    const lead = p.literal || `${p.family}${p.given ? `, ${p.given}` : ''}`;
    if (list.length === 1) return lead;
    if (list.length === 2) return `${lead}, and ${list[1].literal || [list[1].given, list[1].family].filter(Boolean).join(' ')}`;
    return `${lead}, et al`;
  },
  chicago(list) {
    const n = list.map((p, i) => (p.literal ? p.literal : i === 0 ? `${p.family}${p.given ? `, ${p.given}` : ''}` : [p.given, p.family].filter(Boolean).join(' ')));
    if (n.length > 10) return `${n.slice(0, 7).join(', ')}, et al`;
    return n.length === 2 && !list[0].literal ? `${n[0]}, and ${n[1]}` : joinList(n, 'and');
  },
  harvard(list) {
    const n = list.map((p) => (p.literal ? p.literal : `${p.family}${p.given ? `, ${initials(p.given, { space: false })}` : ''}`));
    return joinList(n, 'and', { serial: false });
  },
  ieee(list) {
    const n = list.map((p) => (p.literal ? p.literal : [initials(p.given), p.family].filter(Boolean).join(' ')));
    if (n.length > 6) return `${n[0]} et al.`;
    return joinList(n, 'and', { serial: n.length > 2 });
  },
  vancouver(list) {
    const n = list.map((p) => (p.literal ? p.literal : `${p.family}${p.given ? ` ${initials(p.given, { dots: false })}` : ''}`));
    return n.length > 6 ? `${n.slice(0, 6).join(', ')}, et al` : n.join(', ');
  },
};

function authorsOf(item, style) {
  const list = item.author?.length ? item.author : item.editor || [];
  if (!list.length) return '';
  const s = NAMES[style](list);
  return !item.author?.length && list.length ? `${s}${style === 'apa' || style === 'harvard' ? ` (${list.length > 1 ? 'Eds' : 'Ed'}.)` : `, ${list.length > 1 ? 'editors' : 'editor'}`}` : s;
}

function editorsInline(item, style) {
  const list = item.editor || [];
  if (!list.length || !item.author?.length) return '';
  const n = list.map((p) => p.literal || (style === 'apa' ? `${initials(p.given)} ${p.family}` : style === 'harvard' ? `${p.family}, ${initials(p.given, { space: false })}` : [p.given, p.family].filter(Boolean).join(' ')));
  return joinList(n, style === 'apa' ? '&' : 'and');
}

const FORMAT = {
  apa(item) {
    const who = authorsOf(item, 'apa');
    const y = `(${year(item) || 'n.d.'}).`;
    const ed = item.edition && item.edition !== '1' ? ` (${esc(ordinal(item.edition))} ed.)` : '';
    let title;
    let source;
    if (isJournal(item)) {
      const vol = item.volume ? `, ${it(item.volume)}${item.issue ? `(${esc(item.issue)})` : ''}` : '';
      const pg = pages(item) || item['article-number'];
      title = esc(endWith(item.title, '.'));
      source = item['container-title'] ? `${it(item['container-title'])}${vol}${pg ? `, ${esc(pg)}` : ''}.` : '';
    } else if (isChapter(item) || item.type === 'paper-conference') {
      const eds = editorsInline(item, 'apa');
      title = esc(endWith(item.title, '.'));
      source = [
        item['container-title'] ? `In ${eds ? `${esc(eds)} (${item.editor.length > 1 ? 'Eds.' : 'Ed.'}), ` : ''}${it(item['container-title'])}${pages(item) ? ` (pp. ${esc(pages(item))})` : ''}.` : '',
        item.publisher ? `${esc(item.publisher)}.` : '',
      ].filter(Boolean).join(' ');
    } else if (isPreprint(item)) {
      title = `${it(item.title)} [Preprint].`;
      source = `${esc(item.publisher || 'arXiv')}.`;
    } else {
      title = `${it(item.title)}${ed}.`;
      source = item.publisher ? `${esc(item.publisher)}.` : '';
    }
    const lead = who ? `${esc(endWith(who, '.'))} ${y} ${title}` : `${title} ${y}`;
    return [lead, source, esc(doiUrl(item))].filter(Boolean).join(' ');
  },
  mla(item) {
    const who = authorsOf(item, 'mla');
    const parts = [];
    const titled = isJournal(item) || isChapter(item) || item.type === 'paper-conference' || (item['container-title'] && !isPreprint(item));
    const t = titled ? `“${esc(endWith(item.title, '.'))}”` : `${it(item.title)}.`;
    if (item['container-title'] && titled) parts.push(it(item['container-title']));
    const eds = editorsInline(item, 'mla');
    if (eds) parts.push(`edited by ${esc(eds)}`);
    if (item.volume) parts.push(`vol. ${esc(item.volume)}`);
    if (item.issue) parts.push(`no. ${esc(item.issue)}`);
    if (!isJournal(item) && item.publisher) parts.push(esc(item.publisher));
    const mon = item.issued?.[1] && !isJournal(item) ? `${MONTH_ABBR[item.issued[1] - 1]} ` : '';
    if (year(item)) parts.push(`${mon}${year(item)}`);
    if (pages(item)) parts.push(`${/[–]/.test(pages(item)) ? 'pp.' : 'p.'} ${esc(pages(item))}`);
    const link = item.DOI ? `https://doi.org/${item.DOI}` : item.URL;
    if (link) parts.push(esc(link));
    return `${who ? `${esc(endWith(who, '.'))} ` : ''}${t}${parts.length ? ` ${parts.join(', ')}.` : ''}`;
  },
  chicago(item) {
    const who = authorsOf(item, 'chicago');
    const y = year(item) || 'n.d.';
    const link = doiUrl(item);
    let body;
    if (isJournal(item)) {
      const vol = item.volume ? ` ${esc(item.volume)}${item.issue ? ` (${esc(item.issue)})` : ''}` : '';
      body = `“${esc(endWith(item.title, '.'))}” ${it(item['container-title'])}${vol}${pages(item) ? `: ${esc(pages(item))}` : ''}.`;
    } else if (isChapter(item) || item.type === 'paper-conference') {
      const eds = editorsInline(item, 'chicago');
      body = `“${esc(endWith(item.title, '.'))}” ${item['container-title'] ? `In ${it(item['container-title'])}${eds ? `, edited by ${esc(eds)}` : ''}${pages(item) ? `, ${esc(pages(item))}` : ''}. ` : ''}${place(item)}`.trim();
    } else if (isPreprint(item)) {
      body = `“${esc(endWith(item.title, '.'))}” ${esc(item.publisher || 'arXiv')}${item.arxiv ? `, arXiv:${esc(item.arxiv)}` : ''}.`;
    } else {
      body = `${it(item.title)}. ${place(item)}`.trim();
    }
    return `${who ? `${esc(endWith(who, '.'))} ` : ''}${y}. ${body}${link ? ` ${esc(link)}.` : ''}`.replace(/\.\./g, '.');
  },
  harvard(item) {
    const who = authorsOf(item, 'harvard');
    const y = `(${year(item) || 'no date'})`;
    const link = doiUrl(item);
    let body;
    if (isJournal(item)) {
      const vol = item.volume ? `, ${esc(item.volume)}${item.issue ? `(${esc(item.issue)})` : ''}` : '';
      body = `‘${esc(item.title)}’, ${it(item['container-title'])}${vol}${pages(item) ? `, pp. ${esc(pages(item))}` : ''}.`;
    } else if (isChapter(item) || item.type === 'paper-conference') {
      const eds = editorsInline(item, 'harvard');
      const where = [item['publisher-place'], item.publisher].filter(Boolean).map(esc).join(': ');
      const tail = [where, pages(item) ? `pp. ${esc(pages(item))}` : ''].filter(Boolean).join(', ');
      body = `‘${esc(item.title)}’, in ${eds ? `${esc(eds)} (${item.editor.length > 1 ? 'eds' : 'ed.'}) ` : ''}${it(item['container-title'])}.${tail ? ` ${tail}.` : ''}`;
    } else if (isPreprint(item)) {
      body = `‘${esc(item.title)}’, ${esc(item.publisher || 'arXiv')}${item.arxiv ? ` [Preprint]. arXiv:${esc(item.arxiv)}` : ''}.`;
    } else {
      body = `${it(item.title)}.${item.publisher ? ` ${place(item, ': ')}` : ''}`.replace(/\.?$/, '.');
    }
    return `${who ? `${esc(who)} ` : ''}${y} ${body}${link ? ` Available at: ${esc(link)}.` : ''}`.replace(/\.\./g, '.');
  },
  ieee(item) {
    const who = authorsOf(item, 'ieee');
    const head = who ? `${esc(who)}, ` : '';
    const mon = item.issued?.[1] ? `${MONTH_ABBR[item.issued[1] - 1]} ` : '';
    const y = year(item);
    const doi = item.DOI && !item.arxiv ? `, doi: ${esc(item.DOI)}` : '';
    if (isJournal(item)) {
      const bits = [it(item['container-title-short'] || item['container-title'])];
      if (item.volume) bits.push(`vol. ${esc(item.volume)}`);
      if (item.issue) bits.push(`no. ${esc(item.issue)}`);
      if (pages(item)) bits.push(`${/[–]/.test(pages(item)) ? 'pp.' : 'p.'} ${esc(pages(item))}`);
      else if (item['article-number']) bits.push(`Art. no. ${esc(item['article-number'])}`);
      if (y) bits.push(`${mon}${y}`);
      return `${head}“${esc(item.title)},” ${bits.filter(Boolean).join(', ')}${doi}.`;
    }
    if (item.type === 'paper-conference' || isChapter(item)) {
      const bits = [`in ${it(item['container-title'])}`];
      const eds = editorsInline(item, 'ieee');
      if (eds) bits[0] += `, ${esc(eds)}, ${item.editor.length > 1 ? 'Eds' : 'Ed'}.`;
      if (item.publisher && isChapter(item)) bits.push(esc(item.publisher));
      if (y) bits.push(y);
      if (pages(item)) bits.push(`pp. ${esc(pages(item))}`);
      return `${head}“${esc(item.title)},” ${bits.join(', ')}${doi}.`;
    }
    if (isPreprint(item)) {
      return `${head}“${esc(item.title)},” ${y ? `${y}, ` : ''}${item.arxiv ? `arXiv:${esc(item.arxiv)}` : esc(item.publisher || 'preprint')}${item.DOI && !item.arxiv ? doi : ''}.`;
    }
    const where = [item['publisher-place'], item.publisher].filter(Boolean).map(esc).join(': ');
    return `${head}${it(item.title)}${item.edition && item.edition !== '1' ? `, ${esc(ordinal(item.edition))} ed` : ''}. ${where ? `${where}, ` : ''}${y}${doi}.`.replace(/\s\./, '.');
  },
  vancouver(item) {
    const who = authorsOf(item, 'vancouver');
    const head = who ? `${esc(endWith(who, '.'))} ` : '';
    const y = year(item);
    const doi = item.DOI ? ` doi:${esc(item.DOI)}` : '';
    if (isJournal(item)) {
      const j = (item['container-title-short'] || item['container-title'] || '').replace(/\./g, '');
      const vol = item.volume ? `;${esc(item.volume)}${item.issue ? `(${esc(item.issue)})` : ''}` : '';
      const pg = pages(item) || item['article-number'];
      return `${head}${esc(endWith(item.title, '.'))} ${esc(j)}. ${y}${vol}${pg ? `:${esc(pg)}` : ''}.${doi}`;
    }
    if (isChapter(item) || item.type === 'paper-conference') {
      const eds = (item.editor || []).length ? `${esc(NAMES.vancouver(item.editor))}, ${item.editor.length > 1 ? 'editors' : 'editor'}. ` : '';
      return `${head}${esc(endWith(item.title, '.'))} In: ${eds}${esc(endWith(item['container-title'], '.'))} ${place(item, ': ', '; ')}${y}.${pages(item) ? ` p. ${esc(pages(item))}.` : ''}${doi}`.replace(/\s+/g, ' ');
    }
    if (isPreprint(item)) return `${head}${esc(endWith(item.title, '.'))} ${item.arxiv ? `arXiv:${esc(item.arxiv)} [Preprint]` : '[Preprint]'}. ${y}.${doi}`;
    return `${head}${esc(endWith(item.title, '.'))} ${place(item, ': ', '; ')}${y}.${doi}`;
  },
};

function place(item, sep = ': ', end = '.') {
  const where = [item['publisher-place'], item.publisher].filter(Boolean).map(esc).join(sep);
  return where ? `${where}${end === '.' ? '.' : end}` : '';
}

function ordinal(n) {
  const v = Number(n);
  if (!v) return String(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const m = v % 100;
  return `${v}${s[(m - 20) % 10] || s[m] || s[0]}`;
}

function inText(item, style, n = 1) {
  const list = item.author?.length ? item.author : item.editor || [];
  const fam = list.map(familyOf);
  const y = year(item);
  const who = (and, etAl = 3) => {
    if (!fam.length) return `“${String(item.title || '').split(/[:.?]/)[0]}”`;
    if (fam.length >= etAl) return `${fam[0]} et al.`;
    if (fam.length === 1) return fam[0];
    return fam.length === 2 ? `${fam[0]} ${and} ${fam[1]}` : `${fam.slice(0, -1).join(', ')}, ${and} ${fam[fam.length - 1]}`;
  };
  switch (style) {
    case 'apa': return `(${who('&')}, ${y || 'n.d.'})`;
    case 'mla': return `(${who('and')})`;
    case 'chicago': return `(${who('and', 4)} ${y || 'n.d.'})`;
    case 'harvard': return `(${who('and', 4)}, ${y || 'no date'})`;
    case 'ieee': return `[${n}]`;
    case 'vancouver': return `(${n})`;
    case 'bibtex': return `\\cite{${bibKey(item)}}`;
    default: return '';
  }
}

// ---------- BibTeX and RIS ----------

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'for', 'and', 'to', 'with', 'from', 'by', 'at', 'is', 'are', 'towards', 'toward', 'via']);

function asciiWord(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function bibKey(item) {
  const p = (item.author || [])[0] || (item.editor || [])[0];
  const who = asciiWord(p ? familyOf(p).split(/\s+/).pop() : '') || 'anon';
  const word = String(item.title || '').split(/\s+/).map(asciiWord).find((w) => w && !STOP.has(w)) || '';
  return `${who}${year(item)}${word}`;
}

const bibEsc = (s) => String(s || '').replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
const bibName = (p) => (p.literal ? `{${bibEsc(p.literal)}}` : [bibEsc(p.family), bibEsc(p.given)].filter(Boolean).join(', '));

function bibtex(item) {
  let type = 'misc';
  if (isJournal(item)) type = 'article';
  else if (item.type === 'paper-conference') type = 'inproceedings';
  else if (isChapter(item)) type = 'incollection';
  else if (item.type === 'book') type = 'book';
  else if (item.type === 'thesis') type = /master/i.test(item.genre) ? 'mastersthesis' : 'phdthesis';
  else if (item.type === 'report') type = 'techreport';
  const f = [];
  const add = (k, v, raw = false) => {
    if (v) f.push(`  ${k} = {${raw ? v : bibEsc(v)}}`);
  };
  add('title', item.title);
  if (item.author?.length) add('author', item.author.map(bibName).join(' and '), true);
  if (item.editor?.length) add('editor', item.editor.map(bibName).join(' and '), true);
  if (type === 'article') add('journal', item['container-title']);
  else if (type === 'inproceedings' || type === 'incollection') add('booktitle', item['container-title']);
  add('year', year(item));
  if (item.issued?.[1]) f.push(`  month = ${['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][item.issued[1] - 1]}`);
  add('volume', item.volume);
  add('number', item.issue);
  add('pages', String(item.page || '').replace(/\s*[-–—]+\s*/g, '--'));
  if (type === 'techreport') add('institution', item.publisher);
  else if (type.endsWith('thesis')) add('school', item.publisher);
  else if (type !== 'article' && !item.arxiv) add('publisher', item.publisher);
  add('address', item['publisher-place']);
  add('edition', item.edition);
  add('isbn', item.ISBN);
  add('issn', type === 'article' ? item.ISSN : '');
  if (item.arxiv) {
    add('eprint', item.arxiv);
    add('archivePrefix', 'arXiv');
  }
  add('doi', item.DOI, true);
  add('url', doiUrl(item), true);
  return `@${type}{${bibKey(item)},\n${f.join(',\n')}\n}`;
}

function ris(item) {
  let ty = 'GEN';
  if (isJournal(item)) ty = 'JOUR';
  else if (item.type === 'paper-conference') ty = 'CPAPER';
  else if (isChapter(item)) ty = 'CHAP';
  else if (item.type === 'book') ty = 'BOOK';
  else if (item.type === 'thesis') ty = 'THES';
  else if (item.type === 'report') ty = 'RPRT';
  else if (isPreprint(item)) ty = 'UNPB';
  const out = [`TY  - ${ty}`];
  const add = (k, v) => {
    if (v) out.push(`${k}  - ${v}`);
  };
  add('TI', item.title);
  for (const p of item.author || []) add('AU', p.literal || [p.family, p.given].filter(Boolean).join(', '));
  for (const p of item.editor || []) add('ED', p.literal || [p.family, p.given].filter(Boolean).join(', '));
  add('T2', item['container-title']);
  add('J2', item['container-title-short']);
  add('PY', year(item));
  if (item.issued?.length > 1) add('DA', item.issued.map((x, i) => (i ? String(x).padStart(2, '0') : x)).join('/'));
  add('VL', item.volume);
  add('IS', item.issue);
  const [sp, ep] = String(item.page || '').split(/\s*[-–—]+\s*/);
  add('SP', sp);
  add('EP', ep);
  add('PB', item.publisher);
  add('CY', item['publisher-place']);
  add('SN', item.ISBN || item.ISSN);
  add('DO', item.DOI);
  add('UR', doiUrl(item));
  out.push('ER  - ');
  return out.join('\r\n');
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// One reference: { html, text } for the styles, and plain text for BibTeX and RIS.
function format(item, style) {
  if (style === 'bibtex') {
    const text = bibtex(item);
    return { text, html: esc(text), code: true };
  }
  if (style === 'ris') {
    const text = ris(item);
    return { text, html: esc(text), code: true };
  }
  const fn = FORMAT[style] || FORMAT.apa;
  const html = fn(item).replace(/\s+/g, ' ').replace(/\s+([.,])/g, '$1').replace(/,\s*,/g, ',').trim();
  return { html, text: stripHtml(html) };
}

module.exports = {
  STYLES,
  MONTHS,
  cleanDoi,
  cleanArxiv,
  cleanIsbn,
  findIds,
  parseQuery,
  normalize,
  fromArxivAtom,
  fromOpenLibrary,
  fromFileInfo,
  usefulTitle,
  guessTitle,
  titleScore,
  splitName,
  format,
  inText,
  bibKey,
};
