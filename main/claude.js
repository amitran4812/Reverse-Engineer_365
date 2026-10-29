'use strict';

// Streams Claude responses to a renderer. The API key never leaves the main
// process; renderers only send prompts and receive text deltas.

const Anthropic = require('@anthropic-ai/sdk');
const settings = require('./settings');

const active = new Map();

// Server-side refusal fallback is supported on these models (Claude API only).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

function buildRequest({ system, messages, maxTokens, format }) {
  const { model, effort } = settings.readRaw();
  const req = {
    model,
    max_tokens: maxTokens || 32000,
    system,
    messages,
    output_config: format ? { effort, format: { type: 'json_schema', schema: format } } : { effort },
  };
  if (FALLBACK_MODELS.has(model)) {
    req.betas = ['server-side-fallback-2026-07-01'];
    req.fallbacks = 'default';
  }
  return req;
}

function errorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your Anthropic API key was rejected. Check it in File > Options.';
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the Anthropic API. Wait a moment and try again.';
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ''}: ${err.message}`;
  if (err?.name === 'AbortError' || err instanceof Anthropic.APIUserAbortError) return null;
  return String(err?.message || err);
}

async function start(sender, id, payload) {
  const apiKey = settings.getApiKey();
  if (!apiKey) {
    sender.send('claude:event', { id, type: 'error', message: 'Add your Anthropic API key first (File > Options, or the Claude pane).' });
    return;
  }
  const client = new Anthropic({ apiKey });
  const controller = new AbortController();
  active.set(id, controller);
  try {
    const stream = client.beta.messages.stream(buildRequest(payload), { signal: controller.signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (!sender.isDestroyed()) sender.send('claude:event', { id, type: 'text', text: event.delta.text });
      }
    }
    const final = await stream.finalMessage();
    if (sender.isDestroyed()) return;
    if (final.stop_reason === 'refusal') {
      sender.send('claude:event', { id, type: 'error', message: 'Claude declined this request.' });
    } else {
      sender.send('claude:event', { id, type: 'done', stopReason: final.stop_reason });
    }
  } catch (err) {
    const message = errorMessage(err);
    if (!sender.isDestroyed()) sender.send('claude:event', message ? { id, type: 'error', message } : { id, type: 'done', stopReason: 'cancelled' });
  } finally {
    active.delete(id);
  }
}

// Checks a key (or the saved one) with a free Models API call, so the
// "Connect Claude" flow can confirm sign-in before saving.
async function verify(key) {
  const apiKey = (key || '').trim() || settings.getApiKey();
  if (!apiKey) return { ok: false, message: 'Paste your Anthropic API key first.' };
  try {
    await new Anthropic({ apiKey }).models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, message: errorMessage(err) || 'Could not check the key.' };
  }
}

function cancel(id) {
  active.get(id)?.abort();
}

module.exports = { start, cancel, verify, buildRequest };
