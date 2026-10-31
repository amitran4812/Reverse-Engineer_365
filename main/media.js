'use strict';

// Voice notes, recordings and attachments for Write's notes. Speech becomes
// text through an OpenAI key (its transcription model) or a Gemini key (a
// chat model that takes audio); Claude and a ChatGPT sign-in have no audio
// input for apps. Attachments open from a copy in the account's temp folder.

const { app, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const settings = require('./settings');
const { PROVIDERS } = require('./ai');

const AUDIO = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', wav: 'audio/wav', webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', mpeg: 'audio/mpeg', mpga: 'audio/mpeg', aac: 'audio/aac', mov: 'video/quicktime' };
const OPENAI_MAX = 25 * 1024 * 1024;
const GEMINI_MAX = 19 * 1024 * 1024;
const ATTACH_MAX = 25 * 1024 * 1024;

const keyFor = (id) => settings.getSecret(`ai-key:${id}`);

// Which saved key can transcribe, the chosen AI first.
function transcriber() {
  const chosen = settings.readRaw().provider;
  const order = ['openai', 'gemini'].sort((a, b) => (b === chosen) - (a === chosen));
  return order.find((id) => keyFor(id)) || null;
}

async function failure(res, label) {
  let msg = '';
  try {
    msg = (await res.json()).error?.message || '';
  } catch {}
  if (res.status === 401 || res.status === 403) return new Error(`Your ${label} API key was rejected. Check it in File > Options.`);
  return new Error(`${label} couldn’t transcribe this (error ${res.status}${msg ? `: ${msg}` : ''}).`);
}

async function openaiTranscribe(key, buf, mime, name) {
  const send = (model) => {
    const form = new FormData();
    form.append('model', model);
    form.append('file', new Blob([buf], { type: mime }), name);
    return fetch(`${PROVIDERS.openai.base()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  };
  let res = await send('gpt-4o-transcribe');
  if (res.status === 404 || res.status === 400) res = await send('whisper-1');
  if (!res.ok) throw await failure(res, 'OpenAI');
  return String((await res.json()).text || '').trim();
}

async function geminiTranscribe(key, buf, mime) {
  const model = settings.readRaw().aiModels?.gemini || 'gemini-2.5-flash';
  const res = await fetch(`${PROVIDERS.gemini.base()}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: mime, data: buf.toString('base64') } },
      { text: 'Transcribe this recording word for word. When more than one person speaks, start each change of speaker on a new line. Reply with only the transcript.' },
    ] }] }),
  });
  if (!res.ok) throw await failure(res, 'Gemini');
  return ((await res.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
}

// Speech to text. audio: { data (base64) | path, mime, name }.
async function transcribe(audio) {
  const id = transcriber();
  if (!id) return { ok: false, needsKey: true, message: 'Turning speech into text needs an OpenAI or Gemini key (File > Options > AI). Claude and a ChatGPT sign-in can’t take audio from apps.' };
  try {
    const buf = audio.path ? await fs.readFile(audio.path) : Buffer.from(String(audio.data || ''), 'base64');
    const max = id === 'openai' ? OPENAI_MAX : GEMINI_MAX;
    if (buf.length > max) return { ok: false, message: `That recording is ${(buf.length / 1048576).toFixed(0)} MB. ${PROVIDERS[id].label} takes up to ${Math.round(max / 1048576)} MB, so trim it or save it as audio only (for example .m4a or .mp3).` };
    const mime = audio.mime || 'audio/webm';
    const text = id === 'openai' ? await openaiTranscribe(keyFor(id), buf, mime, audio.name || 'recording.webm') : await geminiTranscribe(keyFor(id), buf, mime);
    if (!text) return { ok: false, message: 'No speech was found in that recording.' };
    return { ok: true, text, by: PROVIDERS[id].label };
  } catch (err) {
    return { ok: false, message: err.message || String(err) };
  }
}

function mimeOf(file) {
  return AUDIO[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
}

// Picks a meeting recording and transcribes it.
async function transcribeFile(win, dialog) {
  const res = await dialog.showOpenDialog(win, {
    title: 'Transcribe a recording',
    properties: ['openFile'],
    filters: [{ name: 'Audio and video', extensions: Object.keys(AUDIO) }, { name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  const file = res.filePaths[0];
  const out = await transcribe({ path: file, mime: mimeOf(file), name: path.basename(file) });
  return { ...out, name: path.basename(file) };
}

// Picks files to attach to notes, as data URLs.
async function pickAttachments(win, dialog) {
  const res = await dialog.showOpenDialog(win, { title: 'Attach files', properties: ['openFile', 'multiSelections'] });
  if (res.canceled) return [];
  const out = [];
  for (const file of res.filePaths.slice(0, 10)) {
    const stat = await fs.stat(file);
    if (stat.size > ATTACH_MAX) {
      out.push({ name: path.basename(file), error: `${path.basename(file)} is over 25 MB, so it can’t be attached. Add a link to it instead.` });
      continue;
    }
    const type = mimeOf(file) !== 'application/octet-stream' ? mimeOf(file) : guessType(file);
    out.push({ name: path.basename(file), size: stat.size, type, src: `data:${type};base64,${(await fs.readFile(file)).toString('base64')}` });
  }
  return out;
}

const TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
function guessType(file) {
  return TYPES[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
}

const safeName = (n) => String(n || 'attachment').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'attachment';

function bytesOf(src) {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(String(src || ''));
  if (!m) throw new Error('This attachment is empty.');
  return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
}

// Opens an attachment with the computer's default app, from a temp copy.
async function openAttachment({ name, src }) {
  const dir = path.join(app.getPath('userData'), 'Attachments');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, safeName(name));
  await fs.writeFile(file, bytesOf(src));
  const err = await shell.openPath(file);
  return err ? { ok: false, message: err } : { ok: true };
}

async function saveAttachment(win, dialog, { name, src }) {
  const res = await dialog.showSaveDialog(win, { defaultPath: safeName(name) });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  await fs.writeFile(res.filePath, bytesOf(src));
  return { ok: true, path: res.filePath };
}

module.exports = { transcribe, transcribeFile, pickAttachments, openAttachment, saveAttachment, transcriber, bytesOf };
