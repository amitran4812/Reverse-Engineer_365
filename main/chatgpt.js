'use strict';

// Sign in with ChatGPT: people with a ChatGPT Plus or Pro plan use it for
// Work's AI features without an API key. This follows OpenAI's flow for
// open-source, locally run apps: OAuth with PKCE and a loopback callback on
// 127.0.0.1, first-time registration through dynamic_agent_client, then the
// Responses API with the user's token (stream on, store off).

const crypto = require('crypto');
const settings = require('./settings');
const oauth = require('./cloud/oauth');

const AUTH = () => process.env.REA_CHATGPT_AUTH_URL || 'https://auth.openai.com';
const API = () => process.env.REA_CHATGPT_BASE_URL || 'https://api.openai.com/v1';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const SECRET = 'ai-chatgpt';

const endpoints = () => ({ authUrl: `${AUTH()}/api/accounts/authorize`, tokenUrl: `${AUTH()}/api/accounts/oauth/token` });

// One host id per account folder, so OpenAI can tell this install apart.
function hostId() {
  const raw = settings.readRaw();
  if (raw.chatgptHost) return raw.chatgptHost;
  const id = `urn:uuid:${crypto.randomUUID()}`;
  settings.setRaw({ chatgptHost: id });
  return id;
}

const friendly = (message) => Object.assign(new Error(message), { friendly: true });

function claims(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

async function signIn() {
  const saved = settings.getSecret(SECRET);
  const clientId = saved?.client_id || 'dynamic_agent_client';
  const tokens = await oauth.authorize({
    ...endpoints(),
    clientId,
    scope: SCOPE,
    redirectHost: '127.0.0.1',
    redirectPath: '/auth/callback',
    extraParams: {
      resource: RESOURCE,
      nonce: crypto.randomBytes(16).toString('base64url'),
      ext_agent_host_id: hostId(),
      ...(clientId === 'dynamic_agent_client' ? { agent_name_hint: 'Work' } : {}),
    },
    tokenParams: { resource: RESOURCE },
  });
  const granted = String(tokens.scope || '').split(/[\s+]+/);
  if (tokens.scope && !granted.includes('chatgpt.tokens.use.direct')) {
    throw friendly('ChatGPT didn’t allow Work to use your plan. Sign in again and allow it, or use an API key.');
  }
  const who = claims(tokens.id_token);
  const record = { ...tokens, client_id: tokens.client_id || who.aud?.[0] || who.aud || clientId, email: who.email || '' };
  settings.setSecret(SECRET, record);
  return { email: record.email };
}

function signOut() {
  settings.setSecret(SECRET, null);
}

function account() {
  const t = settings.getSecret(SECRET);
  return t ? { email: t.email || '' } : null;
}

async function token() {
  const t = settings.getSecret(SECRET);
  if (!t) throw friendly('Sign in with ChatGPT first (File > Options > AI assistant).');
  if (t.expires_at - Date.now() > 60 * 1000) return t.access_token;
  if (!t.refresh_token) throw friendly('Your ChatGPT sign-in expired. Sign in again in File > Options.');
  const next = await oauth.refresh(endpoints().tokenUrl, { clientId: t.client_id, refreshToken: t.refresh_token, extra: { resource: RESOURCE } });
  settings.setSecret(SECRET, { ...t, ...next, refresh_token: next.refresh_token || t.refresh_token });
  return next.access_token;
}

module.exports = { API, signIn, signOut, account, token };
