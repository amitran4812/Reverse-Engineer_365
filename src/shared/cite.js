// The Cite dialog: finds the reference for an open paper (its DOI, arXiv id
// or ISBN, else a title search) and writes it in the common styles, ready to
// copy. Hosts add their own actions, such as inserting it into the document.
import cite from '../../common/cite.js';
import { escapeHtml, h, toast } from './shell.js';
import { icon } from './icons.js';
import './cite.css';

const STYLE_KEY = 'work.cite.style';

function savedStyle() {
  try {
    return localStorage.getItem(STYLE_KEY) || 'apa';
  } catch {
    return 'apa';
  }
}

function saveStyle(s) {
  try {
    localStorage.setItem(STYLE_KEY, s);
  } catch {}
}

let reader = null;
// pdf.js comes from a bundle of its own, loaded the first time a PDF is cited.
function pdfReader() {
  const url = './pdftext.js';
  reader ||= import(url).catch((err) => {
    reader = null;
    throw err;
  });
  return reader;
}

// Only plain strings cross to the main process.
function plainInfo(info) {
  const out = {};
  for (const [k, v] of Object.entries(info || {})) {
    if (typeof v === 'string' && v.length < 2000) out[k] = v;
    else if (k === 'Custom' && v && typeof v === 'object') Object.assign(out, plainInfo(v));
  }
  return out;
}

// A picked or dropped file, as a paper: { fileName, filePath, text, info, metadata }.
export async function paperFromFile(got) {
  if (!got || got.error) throw new Error(got?.error || 'Couldn’t read that file.');
  if (got.kind !== 'pdf') return got;
  const { readPdf } = await pdfReader();
  const read = await readPdf(got.data);
  return { fileName: got.fileName, filePath: got.filePath, text: read.text, info: plainInfo(read.info), metadata: read.metadata };
}

async function copyRich(html, text) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

function summary(item) {
  const who = item.author?.length ? `${item.author[0].literal || item.author[0].family}${item.author.length > 1 ? ' et al.' : ''}` : '';
  return [who, item.issued?.[0], item['container-title'] || item.publisher].filter(Boolean).map(escapeHtml).join(' · ');
}

const FIELDS = [
  ['title', 'Title'],
  ['authors', 'Authors (one per line, Family, Given)'],
  ['year', 'Year'],
  ['container-title', 'Journal, book or proceedings'],
  ['volume', 'Volume'],
  ['issue', 'Issue'],
  ['page', 'Pages'],
  ['publisher', 'Publisher'],
  ['DOI', 'DOI'],
  ['URL', 'Link'],
];

const TYPES = [
  ['article-journal', 'Journal article'],
  ['paper-conference', 'Conference paper'],
  ['article', 'Preprint'],
  ['book', 'Book'],
  ['chapter', 'Book chapter'],
  ['report', 'Report'],
  ['thesis', 'Thesis'],
  ['webpage', 'Web page'],
];

// paper: { text, info, metadata, fileName, filePath, doi, arxiv, isbn, title }, all optional;
// auto: 'id' looks it up only when the text carries a DOI, arXiv id or ISBN.
// actions: [{ label, icon, run(item, { style, html, text, inText }) }] shown beside Copy.
export function openCiteDialog(paper = {}, { actions = [], title = 'Cite', style: startStyle = '' } = {}) {
  return new Promise((resolve) => {
    let items = [];
    let picked = 0;
    let style = startStyle || savedStyle();
    let editing = false;
    let busy = 0;

    const back = h('div', 'modal-back');
    const box = h('div', 'modal wide cite-box');
    box.innerHTML = `
      <div class="modal-title">${icon('cite', 18)}<span>${escapeHtml(title)}</span><small class="cite-file"></small></div>
      <form class="cite-find">
        <input placeholder="DOI, arXiv id, ISBN, link or title" spellcheck="false">
        <button class="btn primary" type="submit">Find</button>
        <button class="btn cite-pick" type="button" title="Pick a PDF or Word file">${icon('open', 16)}<span>From a file…</span></button>
      </form>
      <div class="cite-status"></div>
      <div class="cite-list"></div>
      <div class="cite-styles" role="tablist"></div>
      <div class="cite-out">
        <div class="cite-ref"></div>
        <div class="cite-intext"><span class="muted">In text</span><code></code><button class="btn cite-copy-in" type="button">${icon('copy', 14)}<span>Copy</span></button></div>
      </div>
      <form class="cite-edit" hidden></form>
      <div class="modal-actions">
        <button class="btn cite-edit-btn" type="button">${icon('pen', 14)}<span>Edit details</span></button>
        <span class="cite-grow"></span>
        <button class="btn primary cite-copy" type="button">Copy reference</button>
        <button class="btn cite-close" type="button">Close</button>
      </div>`;
    back.append(box);
    document.body.append(back);

    const $ = (s) => box.querySelector(s);
    const input = $('.cite-find input');
    const status = $('.cite-status');
    const list = $('.cite-list');
    const ref = $('.cite-ref');
    const out = $('.cite-out');
    const editForm = $('.cite-edit');

    for (const a of actions) {
      const b = h('button', 'btn', `${a.icon ? icon(a.icon, 14) : ''}<span>${escapeHtml(a.label)}</span>`);
      b.type = 'button';
      b.onclick = () => {
        const item = items[picked];
        if (!item) return;
        const f = cite.format(item, style);
        a.run(item, { style, html: f.html, text: f.text, inText: cite.inText(item, style) });
        if (a.close !== false) done(item);
      };
      $('.cite-copy').before(b);
    }

    const styles = $('.cite-styles');
    for (const s of cite.STYLES) {
      const b = h('button', 'cite-style', escapeHtml(s.label));
      b.type = 'button';
      b.dataset.style = s.id;
      b.onclick = () => {
        style = s.id;
        saveStyle(style);
        draw();
      };
      styles.append(b);
    }

    function setStatus(text, kind = '') {
      status.className = `cite-status${kind ? ` ${kind}` : ''}`;
      status.innerHTML = text;
    }

    function draw() {
      styles.querySelectorAll('.cite-style').forEach((b) => b.classList.toggle('active', b.dataset.style === style));
      list.innerHTML = '';
      if (items.length > 1) {
        list.append(h('div', 'cite-list-head muted', 'Pick the right one:'));
        items.forEach((it, i) => {
          const row = h('button', `cite-cand${i === picked ? ' active' : ''}`, `<b>${escapeHtml(it.title)}</b><span>${summary(it)}${it.source === 'arXiv' ? ' · preprint' : ''}</span>`);
          row.type = 'button';
          row.onclick = () => {
            picked = i;
            editing = false;
            draw();
          };
          list.append(row);
        });
      }
      const item = items[picked];
      out.hidden = !item;
      styles.hidden = !item;
      $('.cite-copy').disabled = !item;
      $('.cite-edit-btn').hidden = !item;
      box.querySelectorAll('.modal-actions .btn:not(.cite-close):not(.cite-copy):not(.cite-edit-btn)').forEach((b) => {
        b.disabled = !item;
      });
      if (!item) return;
      const f = cite.format(item, style);
      ref.className = `cite-ref${f.code ? ' code' : ''}`;
      ref.innerHTML = f.code ? `<pre>${f.html}</pre>` : f.html;
      const inText = cite.inText(item, style);
      $('.cite-intext').hidden = !inText;
      $('.cite-intext code').textContent = inText;
      editForm.hidden = !editing;
      if (editing) drawEdit(item);
    }

    function drawEdit(item) {
      editForm.innerHTML = '';
      const type = h('label', 'modal-field');
      type.innerHTML = '<span>Type</span>';
      const sel = h('select');
      for (const [v, label] of TYPES) sel.append(Object.assign(h('option', '', escapeHtml(label)), { value: v }));
      sel.value = TYPES.some(([v]) => v === item.type) ? item.type : 'article-journal';
      sel.onchange = () => {
        item.type = sel.value;
        draw();
      };
      type.append(sel);
      editForm.append(type);
      for (const [k, label] of FIELDS) {
        const row = h('label', `modal-field${k === 'title' || k === 'authors' || k === 'container-title' ? ' span2' : ''}`);
        row.innerHTML = `<span>${escapeHtml(label)}</span>`;
        const el = k === 'authors' ? h('textarea') : h('input');
        if (k === 'authors') {
          el.rows = Math.min(6, Math.max(2, (item.author || []).length));
          el.value = (item.author || []).map((p) => p.literal || [p.family, p.given].filter(Boolean).join(', ')).join('\n');
        } else if (k === 'year') el.value = item.issued?.[0] || '';
        else el.value = item[k] || '';
        el.oninput = () => {
          if (k === 'authors') item.author = el.value.split('\n').map((l) => l.trim()).filter(Boolean).map(cite.splitName).filter(Boolean);
          else if (k === 'year') item.issued = /^\d{3,4}$/.test(el.value.trim()) ? [Number(el.value.trim())] : null;
          else if (k === 'DOI') item.DOI = cite.cleanDoi(el.value) || el.value.trim();
          else item[k] = el.value;
          const f = cite.format(item, style);
          ref.innerHTML = f.code ? `<pre>${f.html}</pre>` : f.html;
          $('.cite-intext code').textContent = cite.inText(item, style);
        };
        row.append(el);
        editForm.append(row);
      }
    }

    function show(res, quiet = false) {
      if (res?.error) {
        setStatus(escapeHtml(res.error), 'error');
        return;
      }
      items = (res?.items || []).map((x) => ({ ...x }));
      picked = 0;
      editing = res?.match === 'file';
      if (!items.length) setStatus(res?.query ? `Nothing found for “${escapeHtml(res.query)}”. Try the DOI, or edit the words.` : 'Type a DOI, arXiv id, ISBN, link or title and press Find.', quiet ? '' : 'warn');
      else if (res.match === 'id') setStatus(`✓ Found by ${res.ids?.doi && items[0].source !== 'arXiv' ? `DOI ${escapeHtml(res.ids.doi)}` : res.ids?.arxiv ? `arXiv ${escapeHtml(res.ids.arxiv)}` : `ISBN ${escapeHtml(res.ids?.isbn || '')}`}${items.length > 1 ? '. It has also been published; pick either version.' : ''}`, 'ok');
      else if (res.match === 'search' && res.guessed) setStatus(`No DOI in this paper, so it was matched by its title${res.query ? ` “${escapeHtml(res.query.slice(0, 90))}”` : ''}. Check it’s the right one.`, 'warn');
      else if (res.match === 'search') setStatus(`${items.length} result${items.length === 1 ? '' : 's'} from Crossref.`);
      else setStatus(escapeHtml(res.note || 'Built from the file’s own details. Check it.'), 'warn');
      draw();
    }

    async function run(task, label) {
      const n = ++busy;
      setStatus(`<span class="cite-spin"></span>${escapeHtml(label)}`);
      box.classList.add('busy');
      try {
        const res = await task();
        if (n === busy) show(res);
      } catch (err) {
        if (n === busy) setStatus(escapeHtml(err.message || String(err)), 'error');
      } finally {
        if (n === busy) box.classList.remove('busy');
      }
    }

    function lookupPaper(p) {
      $('.cite-file').textContent = p.fileName || '';
      const req = { doi: p.doi, arxiv: p.arxiv, isbn: p.isbn, title: p.title, text: String(p.text || '').slice(0, 30000), info: plainInfo(p.info), metadata: String(p.metadata || '').slice(0, 60000), fileName: p.fileName };
      const ids = cite.findIds([req.doi, req.arxiv, req.isbn, req.metadata, req.text].filter(Boolean).join('\n'));
      input.value = ids.doi || (ids.arxiv ? `arXiv:${ids.arxiv}` : '') || ids.isbn || '';
      return run(() => window.office.cite.lookup(req), 'Looking up this paper…');
    }

    async function fromFile(get) {
      setStatus('<span class="cite-spin"></span>Reading the file…');
      try {
        await lookupPaper(await paperFromFile(await get()));
      } catch (err) {
        setStatus(escapeHtml(err.message || String(err)), 'error');
      }
    }

    $('.cite-find').onsubmit = (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return input.focus();
      run(() => window.office.cite.search(q), 'Searching…');
    };
    $('.cite-pick').onclick = async () => {
      const got = await window.office.cite.openFile();
      if (got) fromFile(() => got);
    };
    box.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) {
        e.preventDefault();
        box.classList.add('drop');
      }
    });
    box.addEventListener('dragleave', () => box.classList.remove('drop'));
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.classList.remove('drop');
      const file = e.dataTransfer?.files?.[0];
      if (file) fromFile(() => window.office.cite.readFile(file));
    });

    $('.cite-copy').onclick = async () => {
      const item = items[picked];
      if (!item) return;
      const f = cite.format(item, style);
      await (f.code ? navigator.clipboard.writeText(f.text) : copyRich(f.html, f.text));
      toast(`${cite.STYLES.find((s) => s.id === style)?.label || ''} reference copied`);
    };
    $('.cite-copy-in').onclick = async () => {
      const item = items[picked];
      if (!item) return;
      await navigator.clipboard.writeText(cite.inText(item, style));
      toast('In-text citation copied');
    };
    $('.cite-edit-btn').onclick = () => {
      editing = !editing;
      draw();
    };
    $('.cite-close').onclick = () => done(null);
    back.addEventListener('mousedown', (e) => {
      if (e.target === back) done(null);
    });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
    });

    function done(v) {
      busy += 1;
      back.remove();
      resolve(v);
    }

    draw();
    let hasPaper = paper && (paper.text || paper.doi || paper.arxiv || paper.isbn || paper.metadata || paper.info?.Title);
    // A document that may be the user's own writing is only looked up when it carries an identifier.
    if (hasPaper && paper.auto === 'id') {
      const ids = cite.findIds(`${paper.metadata || ''}\n${String(paper.text || '').slice(0, 12000)}`);
      hasPaper = ids.doi || ids.arxiv || ids.isbn;
    }
    if (hasPaper) lookupPaper(paper);
    else {
      show({ items: [] }, true);
      input.value = paper?.title || '';
    }
    input.focus();
  });
}
