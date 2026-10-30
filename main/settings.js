'use strict';

// Settings live in the per-user app data folder. The Anthropic API key is
// encrypted with the OS keychain (Electron safeStorage) whenever it's available.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, cheapest)' },
];

const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium', recent: [], provider: 'anthropic', aiModels: {} };
const AI = { anthropic: 'Claude', chatgpt: 'ChatGPT', openai: 'OpenAI', gemini: 'Gemini' };

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readRaw() {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeRaw(data) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2), { mode: 0o600 });
}

function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const raw = readRaw();
  if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64'));
    } catch {
      return null;
    }
  }
  return raw.apiKeyPlain || null;
}

// Small encrypted values (cloud sign-in tokens) stored next to the settings.
function getSecret(name) {
  const v = readRaw().secrets?.[name];
  if (!v) return null;
  try {
    const text = v.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : v.plain;
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function setSecret(name, value) {
  const raw = readRaw();
  raw.secrets = { ...(raw.secrets || {}) };
  if (value == null) delete raw.secrets[name];
  else {
    const text = JSON.stringify(value);
    raw.secrets[name] = safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(text).toString('base64') } : { plain: text };
  }
  writeRaw(raw);
}

function publicSettings() {
  const raw = readRaw();
  const others = Object.fromEntries(['openai', 'gemini'].map((id) => [id, { hasKey: Boolean(getSecret(`ai-key:${id}`)), model: raw.aiModels?.[id] || '' }]));
  const chatgpt = getSecret('ai-chatgpt');
  // "hasKey" means signed in for ChatGPT, so the provider lists treat it like the others.
  others.chatgpt = { hasKey: Boolean(chatgpt), email: chatgpt?.email || '', model: raw.aiModels?.chatgpt || '' };
  const provider = AI[raw.provider] ? raw.provider : 'anthropic';
  const hasKey = Boolean(getApiKey());
  return {
    provider,
    providerLabel: AI[provider],
    ready: provider === 'anthropic' ? hasKey : others[provider].hasKey && Boolean(others[provider].model),
    ai: others,
    coach: Boolean(raw.coach),
    hasKey,
    keyFromEnv: Boolean(process.env.ANTHROPIC_API_KEY),
    model: raw.model,
    effort: raw.effort,
    models: MODELS,
    cloudClients: Object.fromEntries(Object.entries(raw.cloudClients || {}).map(([id, v]) => [id, { clientId: v.clientId, hasSecret: Boolean(v.clientSecret), org: v.org || '' }])),
  };
}

function update({ apiKey, model, effort, cloudClients, provider, aiKeys, aiModels, coach, autoUpdate }) {
  let raw = readRaw();
  if (aiKeys && typeof aiKeys === 'object') {
    for (const [id, k] of Object.entries(aiKeys)) if (['openai', 'gemini'].includes(id) && typeof k === 'string') setSecret(`ai-key:${id}`, k.trim() || null);
    raw = readRaw();
  }
  if (aiModels && typeof aiModels === 'object') {
    raw.aiModels = { ...(raw.aiModels || {}) };
    for (const [id, m] of Object.entries(aiModels)) if (['chatgpt', 'openai', 'gemini'].includes(id) && typeof m === 'string') raw.aiModels[id] = m.trim().slice(0, 100);
  }
  if (provider && AI[provider]) raw.provider = provider;
  if (typeof coach === 'boolean') raw.coach = coach;
  if (typeof autoUpdate === 'boolean') raw.autoUpdate = autoUpdate;
  if (cloudClients && typeof cloudClients === 'object') {
    raw.cloudClients = { ...(raw.cloudClients || {}) };
    for (const [id, v] of Object.entries(cloudClients)) {
      if (!['google', 'onedrive'].includes(id) || !v) continue;
      const prev = raw.cloudClients[id] || {};
      if (v.reset) {
        // Back to Work's built-in app registration; a college or work domain stays.
        raw.cloudClients[id] = { clientId: '', clientSecret: '', org: prev.org || '' };
        continue;
      }
      const secret = v.clientSecret == null || v.clientSecret === '' ? prev.clientSecret || '' : String(v.clientSecret).trim();
      const org = String(v.org ?? prev.org ?? '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');
      raw.cloudClients[id] = { clientId: String(v.clientId ?? prev.clientId ?? '').trim(), clientSecret: secret, org };
    }
  }
  if (typeof apiKey === 'string') {
    delete raw.apiKeyEnc;
    delete raw.apiKeyPlain;
    const key = apiKey.trim();
    if (key) {
      if (safeStorage.isEncryptionAvailable()) {
        raw.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
      } else {
        raw.apiKeyPlain = key;
      }
    }
  }
  if (model && MODELS.some((m) => m.id === model)) raw.model = model;
  if (effort && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) raw.effort = effort;
  writeRaw(raw);
  return publicSettings();
}

function addRecent(appName, filePath) {
  const raw = readRaw();
  raw.recent = [{ app: appName, path: filePath, at: Date.now() }, ...raw.recent.filter((r) => r.path !== filePath)].slice(0, 15);
  writeRaw(raw);
  // The OS recent list is shared by every account, so only use it when there's one.
  if (require('./profiles').active().count === 1) app.addRecentDocument?.(filePath);
}

function recent() {
  return readRaw().recent.filter((r) => fs.existsSync(r.path));
}

// Merges small internal values (not shown in Options) into the settings file.
function setRaw(patch) {
  writeRaw({ ...readRaw(), ...patch });
}

module.exports = { getApiKey, getSecret, setSecret, setRaw, publicSettings, update, addRecent, recent, readRaw };
