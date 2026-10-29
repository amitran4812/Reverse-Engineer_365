'use strict';

// Connected cloud drives. Tokens stay in the main process (encrypted with
// safeStorage); renderers only see file listings and get files to open.
// A file opened from the cloud is downloaded to a cache folder and remembered,
// so saving it uploads the new version back to where it came from.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { app } = require('electron');
const settings = require('../settings');
const oauth = require('./oauth');
const { providers, sheetsLive } = require('./providers');

const bindings = new Map(); // cache path -> { provider, id, parent, name }

// Client IDs: Options screen first, then environment, then cloud-config.json baked in at build time.
function bakedConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cloud-config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function client(id) {
  const saved = settings.readRaw().cloudClients?.[id] || {};
  const baked = bakedConfig()[id] || {};
  const env = id === 'google'
    ? { clientId: process.env.REA_GOOGLE_CLIENT_ID, clientSecret: process.env.REA_GOOGLE_CLIENT_SECRET }
    : { clientId: process.env.REA_MICROSOFT_CLIENT_ID };
  return {
    clientId: saved.clientId || env.clientId || baked.clientId || '',
    clientSecret: saved.clientSecret || env.clientSecret || baked.clientSecret || '',
  };
}

function provider(id) {
  const p = providers[id];
  if (!p) throw new Error(`Unknown cloud service: ${id}`);
  return p;
}

function status() {
  return Object.values(providers).map((p) => {
    const t = settings.getSecret(`cloud:${p.id}`);
    return { id: p.id, label: p.label, configured: Boolean(client(p.id).clientId), connected: Boolean(t?.refresh_token || t?.access_token), account: t?.account || null };
  });
}

async function connect(id) {
  const p = provider(id);
  const c = client(id);
  if (!c.clientId) throw new Error(`Add a ${p.label} client ID in File > Options first. The README explains how to get one.`);
  const tokens = await oauth.authorize({ ...p, ...c });
  const account = await p.account(tokens.access_token).catch(() => null);
  settings.setSecret(`cloud:${id}`, { ...tokens, account });
  return status();
}

function disconnect(id) {
  provider(id);
  settings.setSecret(`cloud:${id}`, null);
  return status();
}

async function token(id) {
  const p = provider(id);
  const t = settings.getSecret(`cloud:${id}`);
  if (!t) throw new Error(`Connect ${p.label} first.`);
  if (t.access_token && t.expires_at > Date.now() + 60_000) return t.access_token;
  if (!t.refresh_token) throw new Error(`Your ${p.label} sign-in expired. Connect it again in File > Options.`);
  const c = client(id);
  let next;
  try {
    next = await oauth.refresh(p.tokenUrl, { ...c, refreshToken: t.refresh_token, scope: id === 'onedrive' ? p.scope : undefined });
  } catch (err) {
    throw new Error(`Your ${p.label} sign-in expired (${err.message}). Connect it again in File > Options.`);
  }
  settings.setSecret(`cloud:${id}`, { ...t, ...next, refresh_token: next.refresh_token || t.refresh_token });
  return next.access_token;
}

// Runs an API call, retrying once with a fresh token if the old one was rejected.
async function withToken(id, fn) {
  try {
    return await fn(await token(id));
  } catch (err) {
    if (err.status !== 401) throw err;
    const t = settings.getSecret(`cloud:${id}`);
    if (t) settings.setSecret(`cloud:${id}`, { ...t, expires_at: 0 });
    return fn(await token(id));
  }
}

function cachePath(id, fileId, name) {
  const dir = path.join(app.getPath('userData'), 'cloud', id, String(fileId).replace(/[^\w.-]+/g, '_'));
  return path.join(dir, name.replace(/[\\/:*?"<>|]+/g, '_'));
}

function list(id, opts = {}) {
  const p = provider(id);
  return withToken(id, (t) => p.list(t, opts));
}

// Downloads a file into the cache; returns the local path to open.
async function download(id, file) {
  const p = provider(id);
  const { bytes, file: meta } = await withToken(id, (t) => p.download(t, file));
  const local = cachePath(id, meta.id, meta.name);
  await fsp.mkdir(path.dirname(local), { recursive: true });
  await fsp.writeFile(local, bytes);
  bindings.set(local, { provider: id, id: meta.id, parent: meta.parent, name: meta.name, native: meta.native });
  return { path: local, label: p.label, native: meta.native };
}

function bindingFor(local) {
  return local ? bindings.get(local) || null : null;
}

// Uploads a saved local file back to its cloud copy.
async function uploadBack(local) {
  const b = bindings.get(local);
  const p = provider(b.provider);
  const bytes = await fsp.readFile(local);
  const f = await withToken(b.provider, (t) => p.upload(t, { id: b.id, name: b.name, bytes }));
  bindings.set(local, { ...b, id: f.id || b.id });
  return p.label;
}

// Saves a new file into a cloud folder: `write(localPath)` writes it first.
async function saveNew(id, { folder, name }, write) {
  const p = provider(id);
  const local = cachePath(id, `new-${Date.now()}`, name);
  await fsp.mkdir(path.dirname(local), { recursive: true });
  const saved = await write(local);
  const bytes = await fsp.readFile(local);
  const f = await withToken(id, (t) => p.upload(t, { parent: folder, name, bytes }));
  bindings.set(local, { provider: id, id: f.id, parent: folder, name: f.name || name });
  return { ...saved, cloud: p.label };
}

// Live Google Sheets calls for the window editing `local`.
function sheet(local, op, args) {
  const b = bindings.get(local);
  if (!b || b.provider !== 'google' || b.native !== 'Google Sheets') throw new Error('This workbook isn’t a live Google Sheet.');
  if (!['read', 'write', 'structure'].includes(op)) throw new Error(`Unknown sheet operation: ${op}`);
  return withToken('google', (t) => sheetsLive[op](t, b.id, args));
}

module.exports = { status, connect, disconnect, list, download, bindingFor, uploadBack, saveNew, sheet };
