'use strict';

// OAuth 2.0 for installed apps: authorization code + PKCE, with the code
// delivered to a one-off loopback server (RFC 8252). Used for Google and Microsoft.

const crypto = require('crypto');
const http = require('http');
const { shell } = require('electron');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const DONE_PAGE = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>Work</title>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#1f2328">
<div style="text-align:center"><h2>${ok ? 'You’re signed in' : 'Sign-in didn’t finish'}</h2><p>${msg}</p></div></body>`;

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

// Opens the provider's sign-in page in the browser and resolves with the token response.
async function authorize({ authUrl, tokenUrl, clientId, clientSecret, scope, redirectHost, redirectPath = '', extraParams = {}, tokenParams = {} }) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  let finish;
  const result = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (!code && !error) {
      res.writeHead(404).end();
      return;
    }
    const ok = code && url.searchParams.get('state') === state;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(DONE_PAGE(ok, ok ? 'You can close this tab and go back to Work.' : 'Close this tab and try again from Work.'));
    if (ok) finish.resolve({ code, clientId: url.searchParams.get('client_id') });
    else finish.reject(new Error(error || 'Sign-in was cancelled.'));
  };
  const v4 = http.createServer(handler);
  const v6 = http.createServer(handler);
  const port = await listen(v4, '127.0.0.1', 0);
  // "localhost" may resolve to ::1 in the browser; listen there too when IPv6 is available.
  await listen(v6, '::1', port).catch(() => null);
  const redirectUri = `http://${redirectHost}:${port}${redirectPath}`;
  const timer = setTimeout(() => finish.reject(new Error('Sign-in timed out. Try again.')), 5 * 60 * 1000);
  try {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...extraParams,
    });
    const url = `${authUrl}?${params}`;
    if (process.env.REA_OAUTH_AUTOFOLLOW) fetch(url).catch(() => {}); // tests: a mock auth server redirects straight back
    else await shell.openExternal(url);
    const back = await result;
    // A provider that registers the app on first sign-in hands back its client id with the code.
    const issued = back.clientId || clientId;
    const tokens = await tokenRequest(tokenUrl, {
      grant_type: 'authorization_code',
      code: back.code,
      redirect_uri: redirectUri,
      client_id: issued,
      code_verifier: verifier,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      ...tokenParams,
    });
    return back.clientId ? { client_id: issued, ...tokens } : tokens;
  } finally {
    clearTimeout(timer);
    v4.close();
    v6.close();
  }
}

async function tokenRequest(tokenUrl, form) {
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error_description || body.error || `Sign-in failed (${res.status}).`);
  return { ...body, expires_at: Date.now() + (body.expires_in || 3600) * 1000 };
}

function refresh(tokenUrl, { clientId, clientSecret, refreshToken, scope, extra = {} }) {
  return tokenRequest(tokenUrl, {
    ...extra,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    ...(scope ? { scope } : {}),
  });
}

module.exports = { authorize, refresh };
