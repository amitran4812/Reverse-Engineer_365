// Choose which AI runs the assistant (Claude by default, or OpenAI or Gemini
// with your own key), and connect the other providers.

import { icon } from './icons.js';
import { escapeHtml, h, toast } from './shell.js';

export const AI_PROVIDERS = [
  { id: 'anthropic', label: 'Claude', by: 'Anthropic' },
  { id: 'chatgpt', label: 'ChatGPT', by: 'your ChatGPT Plus or Pro plan', signIn: true },
  { id: 'openai', label: 'OpenAI', by: 'ChatGPT models', keys: 'https://platform.openai.com/api-keys', placeholder: 'sk-…' },
  { id: 'gemini', label: 'Gemini', by: 'Google', keys: 'https://aistudio.google.com/apikey', placeholder: 'AIza…' },
];

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

export async function aiSettings(onSaved) {
  const wrap = h('div', 'cloud-settings ai-settings');
  const draw = async () => {
    const s = await window.office.settings.get();
    wrap.innerHTML = `<h2>${icon('sparkle', 18)} AI assistant</h2><p class="muted">Claude runs every AI feature by default. You can sign in with ChatGPT, or connect OpenAI or Gemini with an API key, instead, and every feature works the same way: the Claude app, the side pane, What to say, and attached files. Keys are stored encrypted for this account only.</p>`;
    const pick = h('label', 'modal-field', `<span>Use for AI features</span><select name="provider">${AI_PROVIDERS.map((p) => {
      const ready = p.id === 'anthropic' ? s.hasKey : s.ai[p.id].hasKey && s.ai[p.id].model;
      return `<option value="${p.id}" ${p.id === s.provider ? 'selected' : ''} ${ready || p.id === s.provider ? '' : 'disabled'}>${escapeHtml(p.label)}${ready ? '' : ' (connect below first)'}</option>`;
    }).join('')}</select>`);
    pick.querySelector('select').onchange = async (e) => {
      await window.office.settings.set({ provider: e.target.value });
      toast(`AI features now use ${AI_PROVIDERS.find((p) => p.id === e.target.value).label}`);
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
    for (const p of AI_PROVIDERS.filter((x) => x.keys)) {
      const st = s.ai[p.id];
      const card = h('form', 'cloud-card ai-card');
      card.innerHTML = `<div class="cloud-card-head">${icon('key', 20)}<div><b>${p.label}</b><span class="muted">${st.hasKey ? `Connected${st.model ? `, using ${escapeHtml(st.model)}` : ', pick a model'}` : 'Not connected'}</span></div></div>
        <div class="cloud-card-actions"><button class="btn" type="button" data-link>${icon('key', 16)} Get a key</button></div>
        <div class="ai-card-body">
          <label class="modal-field"><span>${p.label} API key</span><input name="key" type="password" autocomplete="off" placeholder="${st.hasKey ? '•••••••• (saved)' : p.placeholder}"></label>
          <label class="modal-field"><span>Model</span><select name="model">${st.model ? `<option>${escapeHtml(st.model)}</option>` : '<option value="">Check the key to list models</option>'}</select></label>
          <p class="settings-status" data-status></p>
          <div class="modal-actions"><button class="btn" type="button" data-check>Check key and list models</button><button class="btn primary" type="submit">Save</button>${st.hasKey ? '<button class="btn" type="button" data-remove>Remove key</button>' : ''}</div>
        </div>`;
      const status = card.querySelector('[data-status]');
      const select = card.querySelector('[name=model]');
      card.querySelector('[data-link]').onclick = () => {
        pasteCopiedKey(p.id, card.key, () => {
          status.textContent = 'Found the key you copied. Checking it…';
          check();
        });
        window.office.openExternal(p.keys);
      };
      const check = async () => {
        status.textContent = 'Checking…';
        status.className = 'settings-status';
        const r = await window.office.claude.models(p.id, card.key.value);
        if (!r.ok) {
          status.textContent = r.message;
          status.className = 'settings-status bad';
          return false;
        }
        const keep = select.value;
        select.innerHTML = r.models.map((m) => `<option ${m === keep ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('') || '<option value="">No chat models on this key</option>';
        status.textContent = `Key works. ${r.models.length} models available.`;
        status.className = 'settings-status ok';
        return true;
      };
      card.querySelector('[data-check]').onclick = check;
      card.onsubmit = async (e) => {
        e.preventDefault();
        if (card.key.value && !(await check())) return;
        if (!select.value) {
          status.textContent = 'Check the key and pick a model first.';
          status.className = 'settings-status bad';
          return;
        }
        await window.office.settings.set({ aiKeys: card.key.value ? { [p.id]: card.key.value } : undefined, aiModels: { [p.id]: select.value } });
        toast(`${p.label} saved`);
        onSaved?.();
        draw();
      };
      card.querySelector('[data-remove]')?.addEventListener('click', async () => {
        await window.office.settings.set({ aiKeys: { [p.id]: '' }, ...(s.provider === p.id ? { provider: 'anthropic' } : {}) });
        toast(`${p.label} key removed`);
        onSaved?.();
        draw();
      });
      wrap.append(card);
    }
  };
  await draw();
  return wrap;
}
