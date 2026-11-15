// Choose which AI runs the assistant (Claude by default, a ChatGPT sign-in,
// or any AI you have an API key for), and connect the other providers.

import { icon } from './icons.js';
import { escapeHtml, h, toast } from './shell.js';
import shared from '../../common/ai-providers.js';

export const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Claude', by: 'Anthropic' },
  { id: 'chatgpt', label: 'ChatGPT', by: 'your ChatGPT Plus or Pro plan', signIn: true },
  ...shared.KEYED,
];

// The name to show for a provider: "Other" shows the name you gave it.
export function providerName(s, id) {
  if (id === 'custom') return s.ai.custom?.name || 'Custom AI';
  return AI_PROVIDERS.find((p) => p.id === id)?.label || id;
}

const ready = (s, id) => (id === 'anthropic' ? s.hasKey : Boolean(s.ai[id]?.hasKey && s.ai[id]?.model));

// The model name shown in panes, e.g. "Claude Opus 5.5" or "gpt-…".
export function activeModelLabel(s) {
  if (s.provider === 'anthropic') return (s.models.find((x) => x.id === s.model)?.label || '').replace(/\s*\(.*\)/, '');
  return s.ai[s.provider]?.model || '';
}

// After "Get a key" opens the provider's page, fill in a key the person copies there.
export function pasteCopiedKey(provider, input, onFound) {
  const look = async () => {
    window.removeEventListener('focus', look);
    if (input.value) return;
    const key = await window.office.claude.clipboardKey(provider);
    if (key) {
      input.value = key;
      onFound?.();
    }
  };
  window.addEventListener('focus', look);
}

function chatgptCard(s, onSaved, draw) {
  const st = s.ai.chatgpt;
  const card = h('form', 'cloud-card ai-card');
  card.innerHTML = `<div class="cloud-card-head">${icon('sparkle', 20)}<div><b>ChatGPT</b><span class="muted">${st.hasKey ? `Signed in${st.email ? ` as ${escapeHtml(st.email)}` : ''}${st.model ? `, using ${escapeHtml(st.model)}` : ', pick a model'}` : 'Sign in with your ChatGPT account. No API key needed; it uses your Plus or Pro plan.'}</span></div></div>
    <div class="cloud-card-actions"><button class="btn${st.hasKey ? '' : ' primary'}" type="button" data-sign>${st.hasKey ? 'Sign out' : 'Sign in with ChatGPT'}</button></div>
    ${st.hasKey ? `<div class="ai-card-body">
      <label class="modal-field"><span>Model</span><select name="model">${st.model ? `<option>${escapeHtml(st.model)}</option>` : '<option value="">Loading models…</option>'}</select></label>
      <p class="settings-status" data-status></p>
      <div class="modal-actions"><button class="btn primary" type="submit">Save</button></div>
    </div>` : '<p class="settings-status" data-status></p>'}`;
  const status = card.querySelector('[data-status]');
  const bad = (m) => {
    status.textContent = m;
    status.className = 'settings-status bad';
  };
  card.querySelector('[data-sign]').onclick = async (e) => {
    e.target.disabled = true;
    if (st.hasKey) {
      await window.office.claude.chatgptSignOut();
      toast('Signed out of ChatGPT');
      onSaved?.();
      return draw();
    }
    status.textContent = 'Finish signing in in your browser…';
    status.className = 'settings-status';
    const r = await window.office.claude.chatgptSignIn();
    if (!r.ok) {
      e.target.disabled = false;
      return bad(r.message);
    }
    toast(`Signed in to ChatGPT${r.email ? ` as ${r.email}` : ''}`);
    draw();
  };
  const select = card.querySelector('[name=model]');
  if (select) {
    window.office.claude.models('chatgpt').then((r) => {
      if (!r.ok) return bad(r.message);
      const keep = select.value;
      select.innerHTML = r.models.map((m) => `<option ${m === keep ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('') || '<option value="">No models available on this plan</option>';
    });
    card.onsubmit = async (e) => {
      e.preventDefault();
      if (!select.value) return bad('Pick a model first.');
      await window.office.settings.set({ aiModels: { chatgpt: select.value }, provider: 'chatgpt' });
      toast('AI features now use ChatGPT');
      onSaved?.();
      draw();
    };
  }
  return card;
}

let shown = null;

// One card for every AI that takes your own key: pick the service, paste the
// key (or a base URL for Ollama and other servers), pick a model, save.
function keyCard(s, onSaved, draw) {
  if (!shown || !shared.byId[shown]) shown = shared.byId[s.provider] ? s.provider : shared.KEYED.find((p) => ready(s, p.id))?.id || 'xai';
  const p = shared.byId[shown];
  const st = s.ai[p.id];
  const card = h('form', 'cloud-card ai-card ai-key-card');
  const statusText = st.hasKey ? `Connected${st.model ? `, using ${escapeHtml(st.model)}` : ', pick a model'}${s.provider === p.id ? ' (in use)' : ''}` : 'Not connected';
  const keyField = p.local ? '' : `<label class="modal-field"><span>${p.custom ? 'API key (leave empty if the server has none)' : `${escapeHtml(p.label)} API key`}</span><input name="key" type="password" autocomplete="off" placeholder="${st.savedKey ? '•••••••• (saved)' : escapeHtml(p.placeholder || '')}"></label>`;
  const baseField = p.local || p.custom
    ? `<label class="modal-field"><span>${p.custom ? 'Base URL' : 'Ollama address'}</span><input name="base" type="url" autocomplete="off" placeholder="${p.custom ? 'https://my-server.example.com/v1' : escapeHtml(p.base)}" value="${escapeHtml(st.base || '')}"></label>`
    : '';
  const nameField = p.custom ? `<label class="modal-field"><span>Name shown in Work (optional)</span><input name="ainame" maxlength="40" placeholder="For example LM Studio or Together" value="${escapeHtml(st.name || '')}"></label>` : '';
  const freeOnly = p.id === 'openrouter' ? '<label class="ai-toggle"><input type="checkbox" name="free" checked><span>Show free models only</span></label>' : '';
  card.innerHTML = `<label class="modal-field ai-key-pick"><span>Service</span><select name="service">${shared.KEYED.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${escapeHtml(x.label)}${ready(s, x.id) ? ' ✓' : ''}${x.free ? ` · ${escapeHtml(x.free)}` : ''}</option>`).join('')}</select></label>
    <div class="cloud-card-head">${icon('key', 20)}<div><b>${escapeHtml(providerName(s, p.id))}</b><span class="muted">${escapeHtml(p.by[0].toUpperCase() + p.by.slice(1))}. ${statusText}</span></div></div>
    <div class="cloud-card-actions">${p.keys ? `<button class="btn" type="button" data-link>${icon('key', 16)} ${p.local ? 'Get Ollama' : 'Get a key'}</button>` : ''}</div>
    <div class="ai-card-body">
      ${p.local ? '<p class="muted">Install Ollama, then download a model with it (for example <code>ollama pull llama3.2</code>). Nothing leaves your computer and there is no key.</p>' : ''}
      ${baseField}${nameField}${keyField}${freeOnly}
      <label class="modal-field"><span>Model</span><select name="model">${st.model ? `<option>${escapeHtml(st.model)}</option>` : `<option value="">${p.local ? 'Check to list your models' : 'Check the key to list models'}</option>`}<option value="__typed">Type a model name…</option></select></label>
      <label class="modal-field" data-typed hidden><span>Model name</span><input name="typed" autocomplete="off" placeholder="As the service names it, for example llama-3.3-70b-versatile"></label>
      <p class="settings-status" data-status></p>
      <div class="modal-actions"><button class="btn" type="button" data-check>${p.local ? 'Check and list models' : 'Check key and list models'}</button><button class="btn primary" type="submit">Save and use</button>${st.hasKey ? '<button class="btn" type="button" data-remove>Remove</button>' : ''}</div>
    </div>`;
  const status = card.querySelector('[data-status]');
  const select = card.querySelector('[name=model]');
  const typedRow = card.querySelector('[data-typed]');
  const say = (text, kind = '') => {
    status.textContent = text;
    status.className = `settings-status${kind ? ` ${kind}` : ''}`;
  };
  card.service.onchange = () => {
    shown = card.service.value;
    draw();
  };
  select.onchange = () => {
    typedRow.hidden = select.value !== '__typed';
    if (!typedRow.hidden) card.typed.focus();
  };
  let models = [];
  const fill = () => {
    const keep = select.value;
    const list = card.free?.checked ? models.filter((m) => m.endsWith(':free')) : models;
    select.innerHTML = list.map((m) => `<option ${m === keep ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('') + '<option value="__typed">Type a model name…</option>';
    if (!list.length) {
      select.value = '__typed';
      typedRow.hidden = false;
    }
  };
  if (card.free) card.free.onchange = fill;
  card.querySelector('[data-link]')?.addEventListener('click', () => {
    if (card.key) {
      pasteCopiedKey(p.id, card.key, () => {
        say('Found the key you copied. Checking it…');
        check();
      });
    }
    window.office.openExternal(p.keys);
  });
  const check = async () => {
    say('Checking…');
    const r = await window.office.claude.models(p.id, card.key?.value || '', card.base?.value || '');
    if (!r.ok) {
      say(r.message, 'bad');
      return false;
    }
    models = r.models;
    fill();
    say(models.length ? `${p.local ? 'Connected' : 'Key works'}. ${models.length} models available.` : `${p.local ? 'Connected' : 'Key works'}, but it listed no models. Type the model name instead.`, 'ok');
    return true;
  };
  card.querySelector('[data-check]').onclick = check;
  card.onsubmit = async (e) => {
    e.preventDefault();
    if (p.custom && !card.base.value.trim() && !st.base) return say('Add the server’s base URL first.', 'bad');
    if (!p.local && !p.custom && !card.key.value && !st.savedKey) return say(`Paste your ${p.label} API key first.`, 'bad');
    const model = select.value === '__typed' ? card.typed.value.trim() : select.value;
    if (card.key?.value && select.value !== '__typed' && !(await check())) return;
    if (!model) return say(select.value === '__typed' ? 'Type the model name first.' : 'Check the key and pick a model first.', 'bad');
    await window.office.settings.set({
      aiKeys: card.key?.value ? { [p.id]: card.key.value } : undefined,
      aiModels: { [p.id]: model },
      aiBase: card.base ? { [p.id]: card.base.value } : undefined,
      aiName: card.ainame ? { custom: card.ainame.value } : undefined,
      provider: p.id,
    });
    toast(`AI features now use ${p.custom ? card.ainame.value.trim() || 'Custom AI' : p.label}`);
    onSaved?.();
    draw();
  };
  card.querySelector('[data-remove]')?.addEventListener('click', async () => {
    await window.office.settings.set({ aiKeys: { [p.id]: '' }, aiModels: { [p.id]: '' }, ...(s.provider === p.id ? { provider: 'anthropic' } : {}) });
    toast(`${providerName(s, p.id)} removed`);
    onSaved?.();
    draw();
  });
  return card;
}

export async function aiSettings(onSaved) {
  const wrap = h('div', 'cloud-settings ai-settings');
  const draw = async () => {
    const s = await window.office.settings.get();
    wrap.innerHTML = `<h2>${icon('sparkle', 18)} AI assistant</h2><p class="muted">Claude runs every AI feature by default. You can sign in with ChatGPT, or use any AI you have an API key for instead (Grok, OpenAI, Gemini, Groq, OpenRouter, Mistral, DeepSeek, Ollama on your own computer, or any OpenAI-compatible server), and every feature works the same way: the Claude app, the side pane, What to say, and attached files. Keys are stored encrypted for this account only.</p>`;
    const pick = h('label', 'modal-field', `<span>Use for AI features</span><select name="provider">${AI_PROVIDERS.map((p) => {
      const ok = ready(s, p.id);
      return `<option value="${p.id}" ${p.id === s.provider ? 'selected' : ''} ${ok || p.id === s.provider ? '' : 'disabled'}>${escapeHtml(providerName(s, p.id))}${ok ? '' : ' (connect below first)'}</option>`;
    }).join('')}</select>`);
    pick.querySelector('select').onchange = async (e) => {
      await window.office.settings.set({ provider: e.target.value });
      toast(`AI features now use ${providerName(s, e.target.value)}`);
      onSaved?.();
      draw();
    };
    const coach = h('label', 'ai-toggle', `<input type="checkbox" ${s.coach ? 'checked' : ''}><span><b>What to say</b> in Present slide shows: a script for each slide at the bottom of the screen, following along as you change slides. You can also turn it on or off during a show with the What to say button or the S key.</span>`);
    coach.querySelector('input').onchange = async (e) => {
      await window.office.settings.set({ coach: e.target.checked });
      toast(`What to say is ${e.target.checked ? 'on' : 'off'} for slide shows`);
    };
    wrap.append(pick, coach);
    wrap.append(chatgptCard(s, onSaved, draw));
    wrap.append(keyCard(s, onSaved, draw));
  };
  await draw();
  return wrap;
}
