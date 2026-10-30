// The Claude app on the start screen: describe what you need (and attach
// files), and Claude makes a document, spreadsheet or presentation and opens
// it in the right app. Plain questions get a plain answer.

const SLIDE = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: ['title', 'content', 'section', 'two'] },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    right_bullets: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['layout', 'title', 'subtitle', 'bullets', 'right_bullets', 'notes'],
  additionalProperties: false,
};

const SHEET = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
  required: ['name', 'columns', 'rows'],
  additionalProperties: false,
};

const MAKE_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['document', 'spreadsheet', 'presentation', 'answer'] },
    title: { type: 'string' },
    summary: { type: 'string' },
    markdown: { type: 'string' },
    sheets: { type: 'array', items: SHEET },
    slides: { type: 'array', items: SLIDE },
    theme: { type: 'string', enum: ['paper', 'slate', 'midnight', 'sunrise', 'forest', 'berry'] },
  },
  required: ['kind', 'title', 'summary', 'markdown', 'sheets', 'slides', 'theme'],
  additionalProperties: false,
};

export const SYSTEM = [
  'You are Claude, built into Work, a desktop suite with Write (documents), Plot (spreadsheets) and Present (presentations).',
  'The user asks you to make something, often from attached files. Decide what to make and fill the matching fields; leave the other fields empty ("" or []).',
  '- kind "presentation": fill slides. Start with a "title" slide, use "section" slides between major parts, "content" slides with 3–5 bullets under 12 words, "two" for comparisons. Speaker notes of 2–4 sentences on every slide. Pick a fitting theme.',
  '- kind "spreadsheet": fill sheets. columns is the header row (row 1), rows start at row 2. Cells are strings; use Excel formulas starting with "=" and A1 references for totals and calculations (for example "=SUM(B2:B13)"), and plain numbers without currency symbols or thousands separators.',
  '- kind "document": fill markdown with a complete, well-structured document (headings, lists, tables where useful).',
  '- kind "answer": for questions or chat that do not need a file; put the reply in markdown.',
  'When files are attached, base the content on them and say what you used in summary. summary is one or two friendly sentences shown in the chat. title is a short file name without extension.',
].join('\n');

const KIND = {
  document: { app: 'Write', icon: 'appDocs' },
  spreadsheet: { app: 'Plot', icon: 'appSheets' },
  presentation: { app: 'Present', icon: 'appSlides' },
};

function make(label, icon, ask, input, style = null) {
  const open = (d) => window.office.newWith(style && d.kind === 'document' ? { ...d, style } : d);
  return {
    label,
    icon,
    input,
    prompt: ask,
    format: MAKE_SCHEMA,
    working: 'Making it',
    maxTokens: 32000,
    autoApply: true,
    // Follow-ups ("make it shorter") need the full result, not just the summary.
    history: (d) => JSON.stringify(d).slice(0, 60000),
    summary: (d) => {
      if (d.kind === 'answer') return d.markdown || d.summary;
      const what = d.kind === 'presentation' ? `${d.slides.length} slides` : d.kind === 'spreadsheet' ? `${d.sheets.length} sheet${d.sheets.length === 1 ? '' : 's'}` : 'document';
      return `${d.summary}\n\n**${d.title}** (${what}) is open in ${KIND[d.kind].app}. Save it from there.`;
    },
    actions: (d) => {
      if (!KIND[d.kind]) return [];
      const again = { label: `Open in ${KIND[d.kind].app} again`, icon: KIND[d.kind].icon, once: false, run: async () => {
        const r = await open(d);
        if (r?.error) alert(r.error);
      } };
      // A document can also open as notes, or as a document when it was made as notes.
      if (d.kind !== 'document') return [again];
      const other = style ? { ...d } : { ...d, style: 'notes' };
      return [again, { label: style ? 'Open as a document' : 'Open as notes', icon: style ? 'appDocs' : 'notes', once: false, run: () => window.office.newWith(other) }];
    },
  };
}

export const MAKE = {
  auto: make('Make', 'sparkle', 'Make what I ask for below. Choose the best kind (document, spreadsheet or presentation), or answer directly if no file is needed.'),
  deck: make('Presentation', 'appSlides', 'Make a presentation (kind "presentation") about:', 'What should the presentation cover? Attach files to build it from…'),
  sheet: make('Spreadsheet', 'appSheets', 'Make a spreadsheet (kind "spreadsheet") for:', 'What should the spreadsheet track or calculate?…'),
  doc: make('Document', 'appDocs', 'Write a document (kind "document"):', 'What should the document say? Attach files to work from…'),
  notes: make('Notes', 'notes', 'Write notes (kind "document"): a short title heading, then concise bullet points grouped under small headings, with "- [ ]" task lists for action items:', 'What should the notes cover? Attach a transcript, PDF or slides to take notes from…', 'notes'),
};
