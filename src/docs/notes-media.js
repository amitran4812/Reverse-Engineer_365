// Attachments and voice notes in Write's notes. Both are one node, a card in
// the page that carries the file as a data URL: files open with the
// computer's default app, voice notes play in place and can be transcribed.
// The recorder bar handles voice notes and dictation (speech typed in).

import { Node, mergeAttributes } from '@tiptap/core';
import { escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import { formatBytes, formatDuration } from './notes-data.js';

const MAX_RECORDING = 30 * 60; // seconds

export const NoteFile = Node.create({
  name: 'noteFile',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    const data = (name, parse = (v) => v) => ({
      default: null,
      parseHTML: (el) => parse(el.getAttribute(`data-${name}`)),
      renderHTML: (a) => (a[name] == null || a[name] === '' ? {} : { [`data-${name}`]: a[name] }),
    });
    return {
      kind: data('kind'),
      name: data('name'),
      type: data('type'),
      size: data('size', (v) => (v ? Number(v) : null)),
      duration: data('duration', (v) => (v ? Number(v) : null)),
      transcript: data('transcript'),
      src: data('src'),
    };
  },
  parseHTML: () => [{ tag: 'div[data-note-file]' }],
  renderHTML({ HTMLAttributes, node }) {
    const label = node.attrs.kind === 'audio' ? `Voice note ${formatDuration(node.attrs.duration)}` : `${node.attrs.name} (${formatBytes(node.attrs.size)})`;
    return ['div', mergeAttributes(HTMLAttributes, { 'data-note-file': '', class: 'note-file' }), label];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = h('div', 'note-file');
      dom.contentEditable = 'false';
      let current = node;
      const draw = () => {
        const a = current.attrs;
        dom.innerHTML = '';
        dom.classList.toggle('audio', a.kind === 'audio');
        if (a.kind === 'audio') {
          const head = h('div', 'note-file-head', `${icon('mic', 18)}<b>Voice note</b><span>${formatDuration(a.duration)}</span>`);
          const audio = h('audio');
          audio.controls = true;
          audio.preload = 'metadata';
          audio.src = a.src || '';
          head.append(audio);
          const actions = h('div', 'note-file-actions');
          if (!a.transcript) actions.append(button('Transcribe', 'textbox', () => transcribeNode()));
          actions.append(button('Save', 'save', () => window.office.notes.saveAttachment({ name: `Voice note.${extOf(a.type)}`, src: a.src })));
          head.append(actions);
          dom.append(head);
          if (a.transcript) dom.append(h('div', 'note-file-text', escapeHtml(a.transcript)));
        } else {
          dom.append(h('div', 'note-file-head', `${icon(fileIcon(a.type, a.name), 22)}<b title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</b><span>${formatBytes(a.size)}</span>`));
          const actions = h('div', 'note-file-actions');
          actions.append(
            button('Open', 'open', async () => {
              const r = await window.office.notes.openAttachment({ name: a.name, src: a.src });
              if (!r?.ok) toast(r?.message || 'Couldn’t open the file.', 'error');
            }),
            button('Save as', 'save', () => window.office.notes.saveAttachment({ name: a.name, src: a.src })),
          );
          dom.firstChild.append(actions);
        }
      };
      const button = (label, ico, run) => {
        const b = h('button', 'note-file-btn', `${icon(ico, 14)}<span>${label}</span>`);
        b.type = 'button';
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = (e) => {
          e.stopPropagation();
          run();
        };
        return b;
      };
      async function transcribeNode() {
        toast('Transcribing…');
        const r = await window.office.notes.transcribe({ data: current.attrs.src.split(',')[1], mime: current.attrs.type, name: `voice.${extOf(current.attrs.type)}` });
        if (!r.ok) return toast(r.message, 'error');
        const pos = getPos();
        if (typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, null, { ...current.attrs, transcript: r.text }));
      }
      draw();
      return {
        dom,
        update(next) {
          if (next.type.name !== 'noteFile') return false;
          const changed = next.attrs !== current.attrs;
          current = next;
          if (changed) draw();
          return true;
        },
        stopEvent: (e) => e.target.closest?.('button, audio') != null,
        ignoreMutation: () => true,
      };
    };
  },
});

function extOf(type) {
  return { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[String(type || '').split(';')[0]] || 'webm';
}

function fileIcon(type, name) {
  if (/^image\//.test(type)) return 'imageFile';
  if (/pdf/.test(type) || /\.pdf$/i.test(name)) return 'pdf';
  if (/^audio\/|^video\//.test(type)) return 'mic';
  if (/zip/.test(type)) return 'zip';
  return 'file';
}

const dataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

// The recorder bar at the bottom of the page. mode: 'voice' keeps the audio
// as a voice note (transcribed too when a key allows); 'dictate' types the
// words in at the cursor and keeps no audio.
let active = null;
export async function record({ mode, host, onDone }) {
  if (active) return active.stop();
  if (mode === 'dictate' && !(await window.office.notes.canTranscribe())) {
    toast('Dictation needs an OpenAI or Gemini key (File > Options > AI). Claude and a ChatGPT sign-in can’t take audio from apps. Voice notes still work.', 'error');
    return null;
  }
  await window.office.notes.microphone();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    toast(err?.name === 'NotFoundError' ? 'No microphone was found.' : 'Work can’t use the microphone. Allow it in your computer’s privacy settings and try again.', 'error');
    return null;
  }
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const bar = h('div', 'rec-bar', `<i class="rec-dot"></i><b>${mode === 'dictate' ? 'Dictating' : 'Recording a voice note'}</b><span class="rec-time">0:00</span><canvas class="rec-level" width="120" height="24"></canvas>`);
  const stopBtn = h('button', 'btn primary', mode === 'dictate' ? 'Stop and type it' : 'Stop');
  const cancelBtn = h('button', 'btn', 'Cancel');
  bar.append(stopBtn, cancelBtn);
  host.append(bar);
  const started = Date.now();
  const timeEl = bar.querySelector('.rec-time');
  // A small level meter so it's clear the microphone hears you.
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const level = bar.querySelector('canvas').getContext('2d');
  const buf = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    const secs = Math.floor((Date.now() - started) / 1000);
    timeEl.textContent = formatDuration(secs);
    if (secs >= MAX_RECORDING) finish(true);
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    level.clearRect(0, 0, 120, 24);
    level.fillStyle = '#d64545';
    const bars = Math.round((peak / 128) * 20);
    for (let i = 0; i < 20; i += 1) {
      level.globalAlpha = i < bars ? 1 : 0.15;
      level.fillRect(i * 6, 4, 4, 16);
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  let done = false;
  const cleanup = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close();
    bar.remove();
    active = null;
  };
  function finish(keep) {
    if (done) return;
    done = true;
    rec.onstop = async () => {
      const seconds = Math.round((Date.now() - started) / 1000);
      cleanup();
      if (!keep || !chunks.length) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      onDone({ mode, src: await dataUrl(blob), type: blob.type.split(';')[0], seconds, size: blob.size });
    };
    rec.stop();
  }
  stopBtn.onclick = () => finish(true);
  cancelBtn.onclick = () => finish(false);
  rec.start(1000);
  active = { stop: () => finish(true) };
  return active;
}
