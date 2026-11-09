// Writing tools for LaTeX mode: an AI proofreader that marks spelling,
// grammar and style problems in the prose (never the commands or maths) with
// a one-click fix.

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: 'The exact text with the problem, copied character for character from the source, 1 to 12 words.' },
          suggestion: { type: 'string', description: 'The replacement for quote, keeping every LaTeX command in it.' },
          kind: { type: 'string', enum: ['spelling', 'grammar', 'punctuation', 'style', 'clarity'] },
          why: { type: 'string', description: 'A few words on why, e.g. "subject–verb agreement".' },
        },
        required: ['quote', 'suggestion', 'kind', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
};

const SYSTEM = [
  'You are a careful academic proofreader working on LaTeX source.',
  'Find real problems in the prose: spelling, grammar, punctuation, and wording that is unclear or clumsy. Use the document’s own variety of English (US or UK) consistently.',
  'Never flag or change LaTeX commands, environment names, maths, labels, citation keys, file names, URLs or comments. Never suggest adding or removing citations.',
  'Each quote must be copied exactly from the source, long enough to be found (usually 2 to 8 words), and the suggestion replaces just that quote.',
  'Skip matters of taste. If the text is fine, return an empty list.',
].join('\n');

// Splits the body of a file into pieces of about max characters at blank lines.
export function chunks(text, max = 9000) {
  const begin = /\\begin\s*\{document\}/.exec(text);
  const start = begin ? begin.index + begin[0].length : 0;
  const out = [];
  let at = start;
  while (at < text.length) {
    let end = Math.min(text.length, at + max);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > at + max / 3) end = para;
    }
    out.push({ from: at, text: text.slice(at, end) });
    at = end;
  }
  return out.filter((c) => /[a-zA-Z]{3}/.test(c.text));
}

// Finds where each issue's quote is in the text, nearest the chunk it came from.
export function locate(text, chunk, issues) {
  const out = [];
  const used = new Set();
  for (const it of issues || []) {
    const q = String(it.quote || '');
    if (!q || q === it.suggestion) continue;
    let pos = text.indexOf(q, chunk.from);
    while (pos >= 0 && used.has(pos)) pos = text.indexOf(q, pos + 1);
    if (pos < 0 || pos > chunk.from + chunk.text.length) pos = text.indexOf(q);
    if (pos < 0) continue;
    used.add(pos);
    out.push({ from: pos, to: pos + q.length, quote: q, suggestion: String(it.suggestion ?? ''), kind: it.kind, why: it.why || '' });
  }
  return out;
}

function ask(text, providerLabel) {
  return new Promise((resolve, reject) => {
    const id = `proof${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    let out = '';
    window.office.claude.stream(id, {
      system: SYSTEM,
      messages: [{ role: 'user', content: `Proofread this LaTeX:\n\n<latex>\n${text}\n</latex>` }],
      format: ISSUE_SCHEMA,
      maxTokens: 8000,
    }, (evt) => {
      if (evt.type === 'text') out += evt.text;
      else if (evt.type === 'error') reject(new Error(evt.message));
      else if (evt.type === 'done') {
        try {
          resolve(JSON.parse(out).issues || []);
        } catch {
          reject(new Error(`${providerLabel}’s answer couldn’t be read. Try again on a shorter part.`));
        }
      }
    });
  });
}

// Checks text (the whole file, or a selection at offset base). onProgress(done, total).
export async function proofread({ text, base = 0, onProgress }) {
  const settings = await window.office.settings.get();
  if (!settings.ready) throw new Error('Connect Claude or another AI in the AI pane first.');
  const parts = base ? [{ from: 0, text }] : chunks(text);
  const found = [];
  let done = 0;
  onProgress?.(0, parts.length);
  // A few pieces at a time keeps long theses quick.
  const queue = [...parts];
  const worker = async () => {
    while (queue.length) {
      const part = queue.shift();
      const issues = await ask(part.text, settings.providerLabel);
      found.push(...locate(text, part, issues).map((x) => ({ ...x, from: x.from + base, to: x.to + base })));
      done += 1;
      onProgress?.(done, parts.length);
    }
  };
  await Promise.all([worker(), worker(), worker()].slice(0, Math.max(1, Math.min(3, parts.length))));
  return found.sort((a, b) => a.from - b.from);
}
