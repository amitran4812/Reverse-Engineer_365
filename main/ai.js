'use strict';

// OpenAI (ChatGPT models) and Google Gemini, for people who'd rather use
// those than Claude. Same contract as claude.js: stream text deltas to the
// renderer, honour a JSON schema when a feature asks for one, and send
// attached files along. Keys stay in the main process.

const settings = require('./settings');
const attachments = require('./attachments');
const chatgptAuth = require('./chatgpt');

const PROVIDERS = {
  chatgpt: { label: 'ChatGPT' },
  openai: { label: 'OpenAI', keysUrl: 'https://platform.openai.com/api-keys', base: () => process.env.REA_OPENAI_BASE_URL || 'https://api.openai.com/v1' },
  gemini: { label: 'Gemini', keysUrl: 'https://aistudio.google.com/apikey', base: () => process.env.REA_GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta' },
};

const active = new Map();

class ProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function failure(res, label) {
  let msg = '';
  try {
    const j = await res.json();
    msg = j.error?.message || j.message || '';
  } catch {}
  if (label === 'ChatGPT' && res.status === 401) return new ProviderError(401, 'Your ChatGPT sign-in was rejected. Sign in again in File > Options.');
  if (res.status === 401 || res.status === 403 || /api key/i.test(msg)) return new ProviderError(res.status, `Your ${label} API key was rejected. Check it in File > Options.`);
  if (res.status === 429) return new ProviderError(429, `Rate limited by ${label}. Wait a moment and try again.${msg ? ` (${msg})` : ''}`);
  return new ProviderError(res.status, `${label} error ${res.status}${msg ? `: ${msg}` : ''}`);
}

// Reads a server-sent event stream and calls onData with each parsed JSON payload.
async function readSse(res, onData) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      onData(JSON.parse(data));
    }
  }
}

// Attachment blocks are stored in Claude's shape; translate them per provider.
function openaiParts(blocks, text) {
  const parts = blocks.map((b) => {
    if (b.type === 'image') return { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } };
    if (b.type === 'document') return { type: 'file', file: { filename: b.title || 'document.pdf', file_data: `data:application/pdf;base64,${b.source.data}` } };
    return { type: 'text', text: b.text };
  });
  return [...parts, { type: 'text', text }];
}

function geminiParts(blocks, text) {
  const parts = blocks.map((b) => (b.type === 'image' || b.type === 'document'
    ? { inlineData: { mimeType: b.type === 'image' ? b.source.media_type : 'application/pdf', data: b.source.data } }
    : { text: b.text }));
  return [...parts, { text }];
}

const openai = {
  request({ system, messages, maxTokens, format }, model) {
    const body = {
      model,
      stream: true,
      max_completion_tokens: maxTokens || 32000,
      messages: [
        { role: 'developer', content: system },
        ...messages.map((m) => ({ role: m.role, content: m.attachments?.length && m.role === 'user' ? openaiParts(attachments.blocks(m.attachments), m.content) : m.content })),
      ],
    };
    if (format) body.response_format = { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: format } };
    return body;
  },
  async stream(key, model, payload, signal, onText) {
    const res = await fetch(`${PROVIDERS.openai.base()}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.request(payload, model)),
      signal,
    });
    if (!res.ok) throw await failure(res, 'OpenAI');
    let stop = null;
    await readSse(res, (d) => {
      if (d.error) throw new ProviderError(500, `OpenAI error: ${d.error.message}`);
      const c = d.choices?.[0];
      if (c?.delta?.content) onText(c.delta.content);
      if (c?.delta?.refusal) onText(c.delta.refusal);
      if (c?.finish_reason) stop = c.finish_reason;
    });
    return stop === 'length' ? 'max_tokens' : stop === 'content_filter' ? 'refusal' : 'end_turn';
  },
  async models(key) {
    const res = await fetch(`${PROVIDERS.openai.base()}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) throw await failure(res, 'OpenAI');
    const ids = (await res.json()).data.map((m) => m.id);
    // Chat models only: leave out audio, image, embedding, moderation and similar.
    return ids.filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding|moderation|instruct)/.test(id)).sort().reverse();
  },
};

const gemini = {
  request({ system, messages, maxTokens, format }) {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: m.attachments?.length && m.role === 'user' ? geminiParts(attachments.blocks(m.attachments), m.content) : [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: maxTokens || 32000 },
    };
    if (format) Object.assign(body.generationConfig, { responseMimeType: 'application/json', responseJsonSchema: format });
    return body;
  },
  async stream(key, model, payload, signal, onText) {
    const res = await fetch(`${PROVIDERS.gemini.base()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(this.request(payload)),
      signal,
    });
    if (!res.ok) throw await failure(res, 'Gemini');
    let stop = null;
    await readSse(res, (d) => {
      if (d.promptFeedback?.blockReason) stop = 'refusal';
      const c = d.candidates?.[0];
      for (const p of c?.content?.parts || []) if (p.text && !p.thought) onText(p.text);
      if (c?.finishReason) stop = c.finishReason;
    });
    return stop === 'MAX_TOKENS' ? 'max_tokens' : ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'refusal'].includes(stop) ? 'refusal' : 'end_turn';
  },
  async models(key) {
    const res = await fetch(`${PROVIDERS.gemini.base()}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await failure(res, 'Gemini');
    return ((await res.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini-/.test(m.name) && !/(embedding|image|tts|audio|live)/.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort()
      .reverse();
  },
};

function responsesParts(blocks, text) {
  const parts = blocks.map((b) => {
    if (b.type === 'image') return { type: 'input_image', image_url: `data:${b.source.media_type};base64,${b.source.data}` };
    if (b.type === 'document') return { type: 'input_file', filename: b.title || 'document.pdf', file_data: `data:application/pdf;base64,${b.source.data}` };
    return { type: 'input_text', text: b.text };
  });
  return [...parts, { type: 'input_text', text }];
}

// ChatGPT plan usage through the Responses API. The preview requires
// stream on and store off, and rejects system messages and sampling or
// token-limit fields, so the system prompt goes in "instructions".
const chatgpt = {
  request({ system, messages, format }, model, plain) {
    const body = {
      model,
      stream: true,
      store: false,
      instructions: plain && format ? `${system}\n\nReply with only a JSON value that matches this JSON schema, with no other text:\n${JSON.stringify(format)}` : system,
      input: messages.map((m) => ({
        type: 'message',
        role: m.role,
        content: m.role === 'user'
          ? (m.attachments?.length ? responsesParts(attachments.blocks(m.attachments), m.content) : [{ type: 'input_text', text: m.content }])
          : [{ type: 'output_text', text: m.content }],
      })),
    };
    if (format && !plain) body.text = { format: { type: 'json_schema', name: 'result', strict: true, schema: format } };
    return body;
  },
  async stream(key, model, payload, signal, onText) {
    const send = (plain) => fetch(`${chatgptAuth.API()}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.request(payload, model, plain)),
      signal,
    });
    let res = await send(false);
    // If structured output isn't available on this path, ask for JSON in the instructions instead.
    if (res.status === 400 && payload.format) res = await send(true);
    if (!res.ok) throw await failure(res, 'ChatGPT');
    let stop = 'end_turn';
    await readSse(res, (d) => {
      if (d.type === 'response.output_text.delta') onText(d.delta);
      else if (d.type === 'response.incomplete') stop = 'max_tokens';
      else if (d.type === 'response.failed' || d.type === 'error') {
        const e = d.response?.error || d.error || d;
        if (/usage_limit_exceeded/.test(e.code || '')) throw new ProviderError(429, 'You’ve reached your ChatGPT plan’s limit for apps. It resets later, or you can switch to another AI in File > Options.');
        if (/usage_unavailable/.test(e.code || '')) throw new ProviderError(403, 'Your ChatGPT plan can’t be used in other apps. This needs ChatGPT Plus or Pro.');
        throw new ProviderError(500, `ChatGPT error: ${e.message || e.code || 'unknown'}`);
      }
    });
    return stop;
  },
  async models(key) {
    const res = await fetch(`${chatgptAuth.API()}/models`, { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) throw await failure(res, 'ChatGPT');
    return ((await res.json()).data || []).filter((m) => !m.visibility || m.visibility === 'list').map((m) => m.id).sort().reverse();
  },
};

const IMPL = { chatgpt, openai, gemini };

async function start(sender, id, payload, providerId) {
  const p = PROVIDERS[providerId];
  const send = (evt) => !sender.isDestroyed() && sender.send('claude:event', { id, ...evt });
  const model = settings.readRaw().aiModels?.[providerId];
  let key;
  try {
    key = providerId === 'chatgpt' ? await chatgptAuth.token() : settings.getSecret(`ai-key:${providerId}`);
  } catch (err) {
    return send({ type: 'error', message: err.message });
  }
  if (!key) return send({ type: 'error', message: `Add your ${p.label} API key first (File > Options).` });
  if (!model) return send({ type: 'error', message: `Pick a ${p.label} model in File > Options.` });
  const controller = new AbortController();
  active.set(id, controller);
  try {
    const stop = await IMPL[providerId].stream(key, model, payload, controller.signal, (text) => send({ type: 'text', text }));
    if (stop === 'refusal') send({ type: 'error', message: `${p.label} declined this request.` });
    else send({ type: 'done', stopReason: stop });
  } catch (err) {
    if (err?.name === 'AbortError') send({ type: 'done', stopReason: 'cancelled' });
    else send({ type: 'error', message: err instanceof ProviderError ? err.message : `Could not reach ${p.label}: ${err?.message || err}` });
  } finally {
    active.delete(id);
  }
}

// Checks a key and returns the chat models it can use.
async function models(providerId, key) {
  const p = PROVIDERS[providerId];
  if (!p) return { ok: false, message: 'Unknown provider.' };
  try {
    const k = providerId === 'chatgpt' ? await chatgptAuth.token() : (key || '').trim() || settings.getSecret(`ai-key:${providerId}`);
    if (!k) return { ok: false, message: `Paste your ${p.label} API key first.` };
    return { ok: true, models: await IMPL[providerId].models(k) };
  } catch (err) {
    return { ok: false, message: err instanceof ProviderError || err?.friendly ? err.message : `Could not reach ${p.label}: ${err?.message || err}` };
  }
}

// Picture generation for notes. Uses an image model on whichever of the
// OpenAI or Gemini keys is saved (the chosen AI first). Claude and a ChatGPT
// sign-in have no image model for apps, so the caller falls back to an
// SVG drawing when this returns { ok: false, fallback: true }.
const imageModels = {
  async openai(key) {
    try {
      const res = await fetch(`${PROVIDERS.openai.base()}/models`, { headers: { authorization: `Bearer ${key}` } });
      const ids = res.ok ? (await res.json()).data.map((m) => m.id).filter((id) => /^gpt-image-/.test(id)).sort() : [];
      return ids.find((id) => !/mini/.test(id) && /^gpt-image-\d+(\.\d+)?$/.test(id)) || ids[ids.length - 1] || 'gpt-image-1';
    } catch {
      return 'gpt-image-1';
    }
  },
  async gemini(key) {
    const res = await fetch(`${PROVIDERS.gemini.base()}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await failure(res, 'Gemini');
    const names = ((await res.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini-.*image/.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort()
      .reverse();
    return names.find((n) => !/preview|exp/.test(n)) || names[0] || null;
  },
};

async function openaiImage(key, prompt) {
  const model = await imageModels.openai(key);
  const res = await fetch(`${PROVIDERS.openai.base()}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, size: '1536x1024', n: 1 }),
  });
  if (!res.ok) throw await failure(res, 'OpenAI');
  const d = (await res.json()).data?.[0];
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (d?.url) {
    const img = await fetch(d.url);
    return `data:image/png;base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  }
  throw new ProviderError(500, 'OpenAI returned no picture.');
}

async function geminiImage(key, prompt) {
  const model = await imageModels.gemini(key);
  if (!model) throw new ProviderError(404, 'Your Gemini key has no picture model.');
  const res = await fetch(`${PROVIDERS.gemini.base()}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }),
  });
  if (!res.ok) throw await failure(res, 'Gemini');
  const parts = (await res.json()).candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new ProviderError(500, 'Gemini returned no picture. Try describing it differently.');
  return `data:${img.inlineData.mimeType || 'image/png'};base64,${img.inlineData.data}`;
}

async function image(prompt) {
  const text = String(prompt || '').trim().slice(0, 4000);
  if (!text) return { ok: false, message: 'Describe the picture first.' };
  const chosen = settings.readRaw().provider;
  const order = ['openai', 'gemini'].sort((a, b) => (b === chosen) - (a === chosen));
  const keyed = order.map((id) => ({ id, key: settings.getSecret(`ai-key:${id}`) })).filter((p) => p.key);
  if (!keyed.length) return { ok: false, fallback: true };
  const { id, key } = keyed[0];
  try {
    const src = id === 'openai' ? await openaiImage(key, text) : await geminiImage(key, text);
    return { ok: true, src, by: PROVIDERS[id].label };
  } catch (err) {
    return { ok: false, message: err instanceof ProviderError ? err.message : `Could not reach ${PROVIDERS[id].label}: ${err?.message || err}` };
  }
}

function cancel(id) {
  active.get(id)?.abort();
}

module.exports = { PROVIDERS, start, cancel, models, image, openai, gemini };
