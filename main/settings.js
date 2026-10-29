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

const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium', recent: [] };

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

function publicSettings() {
  const raw = readRaw();
  return {
    hasKey: Boolean(getApiKey()),
    keyFromEnv: Boolean(process.env.ANTHROPIC_API_KEY),
    model: raw.model,
    effort: raw.effort,
    models: MODELS,
  };
}

function update({ apiKey, model, effort }) {
  const raw = readRaw();
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
  app.addRecentDocument?.(filePath);
}

function recent() {
  return readRaw().recent.filter((r) => fs.existsSync(r.path));
}

module.exports = { getApiKey, publicSettings, update, addRecent, recent, readRaw };
