'use strict';

// The AIs that take your own API key, shared by the main process (requests,
// stored keys) and Options. "compat" ones speak the OpenAI chat completions
// API, so one client in main/ai.js runs them all. A provider with `local`
// runs on your own computer and needs no key; "custom" is any server with an
// OpenAI-compatible API, at a base URL you give.

const KEYED = [
  { id: 'openai', label: 'OpenAI', by: 'ChatGPT models', keys: 'https://platform.openai.com/api-keys', placeholder: 'sk-…', shape: /^sk-(?!ant-|or-)[\w-]{20,}$/ },
  { id: 'gemini', label: 'Gemini', by: 'Google', keys: 'https://aistudio.google.com/apikey', placeholder: 'AIza…', shape: /^AIza[\w-]{30,}$/, free: 'Free tier in Google AI Studio' },
  { id: 'xai', label: 'Grok', by: 'xAI', compat: true, base: 'https://api.x.ai/v1', keys: 'https://console.x.ai/', placeholder: 'xai-…', shape: /^xai-[\w-]{20,}$/, schema: true },
  { id: 'groq', label: 'Groq', by: 'fast open models (Llama, Qwen, GPT-OSS)', compat: true, base: 'https://api.groq.com/openai/v1', keys: 'https://console.groq.com/keys', placeholder: 'gsk_…', shape: /^gsk_\w{20,}$/, free: 'Free tier, no card needed' },
  { id: 'openrouter', label: 'OpenRouter', by: 'hundreds of models with one key', compat: true, base: 'https://openrouter.ai/api/v1', keys: 'https://openrouter.ai/settings/keys', placeholder: 'sk-or-…', shape: /^sk-or-[\w-]{20,}$/, free: 'Many models marked (free)', pdf: true },
  { id: 'mistral', label: 'Mistral', by: 'Mistral AI', compat: true, base: 'https://api.mistral.ai/v1', keys: 'https://console.mistral.ai/api-keys', placeholder: 'Your Mistral key', free: 'Free Experiment plan' },
  { id: 'deepseek', label: 'DeepSeek', by: 'DeepSeek', compat: true, base: 'https://api.deepseek.com/v1', keys: 'https://platform.deepseek.com/api_keys', placeholder: 'sk-…', noImages: true },
  { id: 'ollama', label: 'Ollama', by: 'models on your own computer', compat: true, local: true, base: 'http://localhost:11434/v1', keys: 'https://ollama.com/download', free: 'Free, runs offline on your computer' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', by: 'any server with an OpenAI-style API', compat: true, custom: true, base: '', placeholder: 'Key, if the server needs one' },
];

const byId = Object.fromEntries(KEYED.map((p) => [p.id, p]));
const KEYED_IDS = KEYED.map((p) => p.id);
const LABELS = { anthropic: 'Claude', chatgpt: 'ChatGPT', ...Object.fromEntries(KEYED.map((p) => [p.id, p.id === 'custom' ? 'Custom AI' : p.label])) };

// A base URL the person typed: http(s) only, no trailing slash, and /v1 added for a bare host.
function cleanBase(url) {
  let s = String(url || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (/^[a-z][\w+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return '';
  if (!/^https?:\/\//i.test(s)) s = `${/^(localhost|127\.|\[::1\]|192\.168\.|10\.)/.test(s) ? 'http' : 'https'}://${s}`;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    if (u.pathname === '/' || u.pathname === '') s = `${u.origin}/v1`;
    s = s.replace(/\/chat\/completions$/, '');
  } catch {
    return '';
  }
  return s;
}

// Hides a model's thinking (<think>…</think>, as some open models write it)
// from streamed text. Returns a function that takes each piece and gives back
// what to show; call it with null at the end to flush.
function thinkFilter() {
  let buf = '';
  let inside = false;
  let started = false;
  return (piece) => {
    if (piece == null) {
      const rest = inside ? '' : buf;
      buf = '';
      return rest;
    }
    buf += piece;
    let out = '';
    for (;;) {
      if (inside) {
        const end = buf.indexOf('</think>');
        if (end < 0) {
          buf = buf.slice(-7);
          return out;
        }
        buf = buf.slice(end + 8).replace(/^\s+/, '');
        inside = false;
        continue;
      }
      const at = buf.indexOf('<think>');
      // Thinking only comes first; anything after real text is left as written.
      if (at >= 0 && !started && !buf.slice(0, at).trim()) {
        buf = buf.slice(at + 7);
        inside = true;
        continue;
      }
      const hold = !started && '<think>'.startsWith(buf.trimStart()) ? buf.length : 0;
      out += buf.slice(0, buf.length - hold);
      if (buf.slice(0, buf.length - hold).trim()) started = true;
      buf = buf.slice(buf.length - hold);
      return out;
    }
  };
}

// The JSON in a reply from a model that couldn't be held to a schema:
// drops ```json fences and any words around the object.
function extractJson(text) {
  let s = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    JSON.parse(s);
    return s;
  } catch {}
  const open = s.search(/[[{]/);
  if (open < 0) return s;
  const close = s[open] === '{' ? s.lastIndexOf('}') : s.lastIndexOf(']');
  if (close > open) {
    const cut = s.slice(open, close + 1);
    try {
      JSON.parse(cut);
      return cut;
    } catch {}
  }
  return s;
}

// Chat models only: leaves out embedding, speech, picture, moderation and guard models.
function chatModels(ids) {
  return ids.filter((id) => !/(embed|whisper|tts|transcri|audio|realtime|moderation|guard|rerank|image|dall-e|vision-preview|ocr)/i.test(id));
}

module.exports = { KEYED, KEYED_IDS, LABELS, byId, cleanBase, thinkFilter, extractJson, chatModels };
