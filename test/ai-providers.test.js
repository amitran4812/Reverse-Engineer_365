'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const Module = require('module');
const shared = require('../common/ai-providers');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'work-ai-'));
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? 'electron-stub-ai' : resolve.call(this, req, ...rest);
};
require.cache['electron-stub-ai'] = {
  id: 'electron-stub-ai',
  filename: 'electron-stub-ai',
  loaded: true,
  exports: { app: { getPath: () => userData }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} },
};
const settings = require('../main/settings');
const ai = require('../main/ai');

test('base URLs are cleaned up', () => {
  assert.equal(shared.cleanBase('localhost:1234'), 'http://localhost:1234/v1');
  assert.equal(shared.cleanBase('https://api.example.com/v1/'), 'https://api.example.com/v1');
  assert.equal(shared.cleanBase('https://api.example.com/openai/v1/chat/completions'), 'https://api.example.com/openai/v1');
  assert.equal(shared.cleanBase('api.together.xyz'), 'https://api.together.xyz/v1');
  assert.equal(shared.cleanBase('ftp://x'), '');
  assert.equal(shared.cleanBase(''), '');
});

test('thinking is left out of streamed text', () => {
  const run = (pieces) => {
    const f = shared.thinkFilter();
    return pieces.map((p) => f(p)).join('') + f(null);
  };
  assert.equal(run(['<thi', 'nk>plan it', ' out</th', 'ink>\n\nHello', ' there']), 'Hello there');
  assert.equal(run(['Hello ', 'world']), 'Hello world');
  assert.equal(run(['Use <think> tags', ' like this']), 'Use <think> tags like this');
  assert.equal(run(['<think>never ends']), '');
});

test('JSON is pulled out of fenced or chatty replies', () => {
  assert.equal(shared.extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(shared.extractJson('Sure! Here it is: {"a":[1,2]} Hope that helps.'), '{"a":[1,2]}');
  assert.equal(shared.extractJson('<think>hmm</think>[1,2]'), '[1,2]');
  assert.equal(shared.extractJson('{"ok":true}'), '{"ok":true}');
});

test('only chat models are listed', () => {
  assert.deepEqual(shared.chatModels(['llama-3.3-70b', 'whisper-large-v3', 'text-embedding-3', 'llama-guard-4', 'grok-4', 'grok-2-image']), ['llama-3.3-70b', 'grok-4']);
});

test('copied keys are recognised per service', () => {
  const shape = (id) => shared.byId[id].shape;
  assert.ok(shape('xai').test('xai-abcdefghijklmnopqrstuvwxyz0123'));
  assert.ok(shape('groq').test('gsk_abcdefghijklmnopqrstuvwxyz0123'));
  assert.ok(shape('openrouter').test('sk-or-v1-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!shape('openai').test('sk-or-v1-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(!shape('openai').test('sk-ant-abcdefghijklmnopqrstuvwxyz'));
  assert.ok(shape('openai').test('sk-proj-abcdefghijklmnopqrstuvwxyz'));
});

// A small OpenAI-compatible server, like Ollama or LM Studio.
function server(handler) {
  return new Promise((done) => {
    const seen = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = body ? JSON.parse(body) : null;
        seen.push({ url: req.url, headers: req.headers, body: json });
        handler(req, res, json);
      });
    });
    srv.listen(0, '127.0.0.1', () => done({ srv, seen, base: `http://127.0.0.1:${srv.address().port}/v1` }));
  });
}

const sse = (res, pieces, finish = 'stop') => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const p of pieces) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
  res.end('data: [DONE]\n\n');
};

function run(payload) {
  return new Promise((done) => {
    const events = [];
    const sender = {
      isDestroyed: () => false,
      send: (ch, evt) => {
        events.push(evt);
        if (evt.type === 'done' || evt.type === 'error') done(events);
      },
    };
    ai.start(sender, 'r1', payload, settings.readRaw().provider);
  });
}

test('a server of your own runs the AI features without a key', async () => {
  const { srv, seen, base } = await server((req, res, body) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'qwen3:8b' }, { id: 'nomic-embed-text' }] }));
    }
    sse(res, ['<think>let me see</think>', 'Hi ', 'Amit']);
  });
  try {
    const listed = await ai.models('custom', '', base);
    assert.deepEqual(listed, { ok: true, models: ['qwen3:8b'] });
    settings.update({ aiBase: { custom: base }, aiModels: { custom: 'qwen3:8b' }, aiName: { custom: 'LM Studio' }, provider: 'custom' });
    const pub = settings.publicSettings();
    assert.equal(pub.ready, true);
    assert.equal(pub.providerLabel, 'LM Studio');
    const events = await run({ system: 'Be brief.', messages: [{ role: 'user', content: 'Hello' }] });
    assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'Hi Amit');
    assert.equal(events.at(-1).type, 'done');
    const chat = seen.find((s) => s.url === '/v1/chat/completions');
    assert.equal(chat.body.model, 'qwen3:8b');
    assert.deepEqual(chat.body.messages[0], { role: 'system', content: 'Be brief.' });
    assert.equal(chat.headers.authorization, undefined);
  } finally {
    srv.close();
  }
});

test('structured answers fall back to JSON in the prompt when a schema is refused', async () => {
  const { srv, seen, base } = await server((req, res, body) => {
    if (body.response_format) {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'response_format not supported' } }));
    }
    sse(res, ['Here you go:\n```json\n{"slides":', '[1,2]}\n```']);
  });
  try {
    settings.update({ aiBase: { custom: base }, aiKeys: { custom: 'secret-1' }, provider: 'custom' });
    const events = await run({ system: 'Make slides.', messages: [{ role: 'user', content: 'Go' }], format: { type: 'object' } });
    assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), '{"slides":[1,2]}');
    const kinds = seen.map((s) => s.body.response_format?.type || 'prompt');
    assert.deepEqual(kinds, ['json_schema', 'json_object', 'prompt']);
    assert.match(seen[2].body.messages[0].content, /matches this JSON schema/);
    assert.equal(seen[0].headers.authorization, 'Bearer secret-1');
  } finally {
    srv.close();
    settings.update({ aiKeys: { custom: '' } });
  }
});

test('Ollama that is not running says so', async () => {
  settings.update({ aiBase: { ollama: 'http://127.0.0.1:9' }, aiModels: { ollama: 'llama3.2' }, provider: 'ollama' });
  assert.equal(settings.publicSettings().ready, true);
  const events = await run({ system: 's', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(events.at(-1).type, 'error');
  assert.match(events.at(-1).message, /Start Ollama/);
});

test('every keyed service can be saved and chosen', () => {
  for (const p of shared.KEYED.filter((x) => !x.local && !x.custom)) {
    settings.update({ aiKeys: { [p.id]: 'k-123' }, aiModels: { [p.id]: 'm' }, provider: p.id });
    const pub = settings.publicSettings();
    assert.equal(pub.provider, p.id);
    assert.equal(pub.ready, true, p.id);
    assert.equal(settings.getSecret(`ai-key:${p.id}`), 'k-123');
  }
});
