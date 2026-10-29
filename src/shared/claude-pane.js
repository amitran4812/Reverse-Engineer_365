// The Claude side pane: a chat with Claude that knows about the open file.
//
// Apps configure it with:
//   system           system prompt
//   context()        string describing the document/selection, sent with each request
//   quick            [{ label, icon, prompt, input?, format?, render?, actions? }] one-click actions
//   actions(text)    buttons shown under a normal answer, e.g. Insert / Replace
//   defaultQuick     quick action used for typed messages (the Claude app makes files)
// A quick action with `format` asks for structured JSON; its `actions(json)` apply it.
// Files can be attached with the paperclip or dropped on the pane; they go with the next message.

import { marked } from 'marked';
import { icon } from './icons.js';
import { escapeHtml, h, settingsForm, toast } from './shell.js';

marked.setOptions({ gfm: true, breaks: false });

export function sanitize(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}

export function markdownToHtml(md) {
  return sanitize(marked.parse(md || ''));
}

// First fenced code block (optionally of a given language), else null.
export function codeBlock(text, lang) {
  const re = /```([\w-]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    if (!lang || m[1] === lang || (Array.isArray(lang) && lang.includes(m[1]))) return m[2].trim();
  }
  return null;
}

let seq = 0;

export class ClaudePane {
  constructor(host, cfg) {
    this.host = host;
    this.cfg = cfg;
    this.history = [];
    this.busy = null;
    host.classList.add('claude-pane');
    host.innerHTML = '';
    const head = h('div', 'cp-head', `${icon('sparkle', 18)}<b>Claude</b><span class="cp-model"></span>`);
    const newChat = h('button', 'cp-icon', icon('newFile', 16));
    newChat.title = 'New conversation';
    newChat.onclick = () => this.reset();
    const close = h('button', 'cp-icon', icon('close', 16));
    close.title = 'Close (Ctrl+J)';
    close.onclick = () => this.hide();
    head.append(newChat, close);
    this.modelLabel = head.querySelector('.cp-model');
    this.body = h('div', 'cp-body');
    this.setup = h('div', 'cp-setup');
    this.log = h('div', 'cp-log');
    this.body.append(this.setup, this.log);
    const composer = h('form', 'cp-composer');
    this.attached = [];
    this.chipsEl = h('div', 'cp-files');
    const attach = h('button', 'cp-attach', icon('attach', 18));
    attach.type = 'button';
    attach.title = 'Attach files (PDF, images, Word, Excel, CSV, text)';
    attach.onclick = async () => this.addFiles(await window.office.claude.attach());
    this.input = h('textarea');
    this.input.rows = 3;
    this.input.placeholder = cfg.placeholder || 'Ask Claude…';
    this.send = h('button', 'cp-send', icon('send', 18));
    this.send.type = 'submit';
    this.send.title = 'Send (Enter)';
    composer.append(this.chipsEl, attach, this.input, this.send);
    host.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) {
        e.preventDefault();
        host.classList.add('cp-drop');
      }
    });
    host.addEventListener('dragleave', (e) => {
      if (!host.contains(e.relatedTarget)) host.classList.remove('cp-drop');
    });
    host.addEventListener('drop', async (e) => {
      host.classList.remove('cp-drop');
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      this.addFiles(await window.office.claude.attachFiles(e.dataTransfer.files));
    });
    composer.onsubmit = (e) => {
      e.preventDefault();
      if (this.busy) this.stop();
      else if (this.input.value.trim() || this.attached.length) {
        this.ask(this.input.value.trim() || 'Take a look at the attached files.');
        this.input.value = '';
      }
    };
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        composer.requestSubmit();
      }
      e.stopPropagation();
    });
    host.append(head, this.body, composer);
    this.reset();
    this.loadSettings();
  }

  addFiles(list) {
    for (const f of list || []) {
      if (f.error) toast(f.error, 'error');
      else this.attached.push(f);
    }
    this.drawFiles();
    this.input.focus();
  }

  drawFiles() {
    this.chipsEl.innerHTML = '';
    for (const f of this.attached) {
      const chip = h('span', 'cp-file', `${icon('attach', 12)}<span>${escapeHtml(f.name)}</span>`);
      const x = h('button', '', '×');
      x.type = 'button';
      x.title = 'Remove';
      x.onclick = () => {
        this.attached = this.attached.filter((a) => a !== f);
        this.drawFiles();
      };
      chip.append(x);
      this.chipsEl.append(chip);
    }
  }

  async loadSettings() {
    this.settings = await window.office.settings.get();
    const m = this.settings.models.find((x) => x.id === this.settings.model);
    this.modelLabel.textContent = m ? m.label.replace(/\s*\(.*\)/, '') : '';
    this.setup.innerHTML = '';
    if (!this.settings.hasKey) {
      this.setup.append(h('div', 'cp-note', `${icon('key', 18)}<div><b>Connect Claude</b><p>Sign in with your Anthropic account and paste a key to turn on Claude in Docs, Sheets and Slides.</p></div>`));
      this.setup.append(await settingsForm(() => this.loadSettings()));
    }
  }

  reset() {
    this.stop();
    this.history = [];
    this.log.innerHTML = '';
    const intro = h('div', 'cp-intro', `<p>${escapeHtml(this.cfg.intro || 'How can I help?')}</p>`);
    const chips = h('div', 'cp-chips');
    for (const q of this.cfg.quick || []) {
      const c = h('button', 'cp-chip', `${icon(q.icon || 'sparkle', 16)}<span>${escapeHtml(q.label)}</span>`);
      c.onclick = () => this.runQuick(q);
      chips.append(c);
    }
    intro.append(chips);
    this.log.append(intro);
  }

  show() {
    this.cfg.shell.root.classList.add('claude-open');
    this.input.focus();
  }

  hide() {
    this.cfg.shell.root.classList.remove('claude-open');
  }

  toggle() {
    if (this.cfg.shell.root.classList.contains('claude-open')) this.hide();
    else this.show();
  }

  async runQuick(q) {
    this.show();
    let prompt = q.prompt;
    if (q.input) {
      const typed = this.input.value.trim();
      if (!typed) {
        this.input.placeholder = q.input;
        this.input.focus();
        this.pendingQuick = q;
        return;
      }
      prompt = `${q.prompt}\n\n${typed}`;
      this.input.value = '';
      this.ask(prompt, q, `${q.label}: ${typed}`);
      return;
    }
    this.ask(prompt, q);
  }

  // Ask Claude. quick may carry a structured-output format and custom actions.
  ask(prompt, quick = null, label = null) {
    if (!quick && this.pendingQuick) {
      quick = this.pendingQuick;
      label = `${quick.label}: ${prompt}`;
      prompt = `${quick.prompt}\n\n${prompt}`;
    } else if (!quick && this.cfg.defaultQuick) {
      quick = this.cfg.defaultQuick;
      label = prompt;
      prompt = `${quick.prompt}\n\n${prompt}`;
    }
    this.pendingQuick = null;
    this.input.placeholder = this.cfg.placeholder || 'Ask Claude…';
    if (this.busy) return;
    if (!this.settings?.hasKey) {
      this.loadSettings();
      this.show();
      return;
    }
    const display = label || (quick ? quick.label : prompt);
    const files = this.attached;
    this.attached = [];
    this.drawFiles();
    const context = this.cfg.context?.() || '';
    const note = files.length ? `\n\n(Attached: ${files.map((f) => f.name).join(', ')})` : '';
    const content = context ? `${context}\n\n<request>\n${prompt}${note}\n</request>` : `${prompt}${note}`;
    const ids = files.map((f) => f.id);
    const messages = [...this.history, { role: 'user', content, attachments: ids }];
    const userMsg = h('div', 'cp-msg user', escapeHtml(display));
    if (files.length) userMsg.append(h('div', 'cp-msg-files', files.map((f) => `<span>${icon('attach', 12)} ${escapeHtml(f.name)}</span>`).join('')));
    this.log.append(userMsg);
    const bubble = h('div', 'cp-msg assistant');
    const textEl = h('div', 'cp-text', '<span class="cp-typing"><i></i><i></i><i></i></span>');
    bubble.append(textEl);
    this.log.append(bubble);
    this.scroll();

    const id = `c${Date.now()}-${seq++}`;
    let text = '';
    let pending = false;
    let raf = 0;
    const structured = !!quick?.format;
    const render = () => {
      pending = false;
      if (structured) textEl.innerHTML = `<span class="cp-status">${icon('sparkle', 14)} ${escapeHtml(quick.working || 'Working on it')}… <small>${text.length} chars</small></span>`;
      else textEl.innerHTML = markdownToHtml(text);
      this.scroll();
    };
    this.busy = id;
    this.send.innerHTML = icon('stop', 18);
    this.send.title = 'Stop';
    window.office.claude.stream(id, {
      system: this.cfg.system,
      messages,
      format: quick?.format,
      maxTokens: quick?.maxTokens,
    }, (evt) => {
      if (evt.type === 'text') {
        text += evt.text;
        if (!pending) {
          pending = true;
          raf = requestAnimationFrame(render);
        }
        return;
      }
      cancelAnimationFrame(raf);
      this.busy = null;
      this.send.innerHTML = icon('send', 18);
      this.send.title = 'Send (Enter)';
      if (evt.type === 'error') {
        textEl.innerHTML = `<div class="cp-error">${escapeHtml(evt.message)}</div>`;
        if (/API key/i.test(evt.message)) this.loadSettings();
        return;
      }
      if (!text) {
        textEl.innerHTML = '<span class="muted">Stopped.</span>';
        return;
      }
      this.history.push({ role: 'user', content: (quick ? `${quick.label}: ${prompt}` : prompt) + note, attachments: ids });
      let actions;
      if (structured) {
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        if (!data) {
          textEl.innerHTML = '<div class="cp-error">Claude’s answer was cut off. Try again.</div>';
          return;
        }
        textEl.innerHTML = markdownToHtml(quick.summary ? quick.summary(data) : 'Done.');
        this.history.push({ role: 'assistant', content: quick.history ? quick.history(data) : quick.summary ? quick.summary(data) : text });
        actions = quick.actions(data);
        if (quick.autoApply) actions[0]?.run();
      } else {
        render();
        this.history.push({ role: 'assistant', content: text });
        actions = [...(quick?.actions?.(text) || this.cfg.actions?.(text) || []), { label: 'Copy', icon: 'copy', run: () => navigator.clipboard.writeText(text) }];
      }
      const bar = h('div', 'cp-actions');
      for (const a of actions) {
        const b = h('button', 'cp-action', `${icon(a.icon || 'sparkle', 14)}<span>${escapeHtml(a.label)}</span>`);
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = () => {
          a.run();
          if (a.once !== false) b.classList.add('done');
        };
        bar.append(b);
      }
      bubble.append(bar);
      this.scroll();
    });
  }

  stop() {
    if (this.busy) window.office.claude.cancel(this.busy);
  }

  scroll() {
    this.body.scrollTop = this.body.scrollHeight;
  }
}
