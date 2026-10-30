// Google Drive and OneDrive in the renderer: a file browser to open from or
// save to a cloud folder, and the Options section that connects accounts.

import { icon } from './icons.js';
import { escapeHtml, h, toast } from './shell.js';

export const CLOUDS = [
  { id: 'google', label: 'Google Drive', icon: 'cloudGoogle' },
  { id: 'onedrive', label: 'OneDrive', icon: 'cloudOne' },
];

const APP_ICON = { docs: 'appDocs', sheets: 'appSheets', slides: 'appSlides' };

const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : '');

// Opens the browser. mode 'open' resolves after a file is opened; mode 'save'
// resolves with { folder } once the user picks a folder, or null.
export function cloudBrowser(provider, { mode = 'open', app = null, title } = {}) {
  const meta = CLOUDS.find((c) => c.id === provider);
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('div', 'modal wide cloud-browser');
    const head = h('div', 'modal-title', `${icon(meta.icon, 18)} ${escapeHtml(title || (mode === 'save' ? `Save to ${meta.label}` : `Open from ${meta.label}`))}`);
    const tools = h('div', 'cb-tools');
    const crumbs = h('div', 'cb-crumbs');
    const search = h('input', 'cb-search');
    search.placeholder = `Search ${meta.label}`;
    const refresh = h('button', 'cb-icon', icon('refresh', 16));
    refresh.title = 'Refresh';
    tools.append(crumbs, search, refresh);
    const listEl = h('div', 'cb-list');
    const foot = h('div', 'modal-actions');
    const cancel = h('button', 'btn', 'Cancel');
    foot.append(cancel);
    let pick = null;
    if (mode === 'save') {
      pick = h('button', 'btn primary', 'Save here');
      foot.append(pick);
    }
    box.append(head, tools, listEl, foot);
    back.append(box);
    document.body.append(back);

    let path = [{ id: null, name: meta.label }];
    let query = '';
    const done = (v) => {
      back.remove();
      resolve(v);
    };
    cancel.onclick = () => done(null);
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
      e.stopPropagation();
    });
    back.onclick = (e) => {
      if (e.target === back) done(null);
    };
    if (pick) pick.onclick = () => done({ folder: path[path.length - 1].id });

    const drawCrumbs = () => {
      crumbs.innerHTML = '';
      path.forEach((p, i) => {
        if (i) crumbs.append(h('span', 'cb-sep', '›'));
        const b = h('button', 'cb-crumb', escapeHtml(p.name));
        b.onclick = () => {
          path = path.slice(0, i + 1);
          query = '';
          search.value = '';
          load();
        };
        crumbs.append(b);
      });
    };

    const load = async () => {
      drawCrumbs();
      listEl.innerHTML = '<div class="cb-empty">Loading…</div>';
      const folder = path[path.length - 1].id;
      const res = await window.office.cloud.list(provider, { folder, query });
      if (res?.error) {
        listEl.innerHTML = `<div class="cb-empty cb-error">${escapeHtml(res.error)}</div>`;
        return;
      }
      const items = res.filter((f) => f.folder || (mode === 'open' && f.app && (!app || f.app === app)));
      listEl.innerHTML = '';
      if (!items.length) listEl.append(h('div', 'cb-empty', query ? 'Nothing matches that search.' : mode === 'save' ? 'No folders here. Save here, or pick another folder.' : 'No documents Work can open here.'));
      for (const f of items) {
        const row = h('button', `cb-row${f.folder ? ' folder' : ''}`, `${icon(f.folder ? 'folder' : APP_ICON[f.app] || 'newFile', 20)}<b>${escapeHtml(f.title || f.name)}</b><span>${escapeHtml(f.native || (f.folder ? 'Folder' : (f.name.split('.').pop() || '').toUpperCase()))}</span><time>${fmtDate(f.modified)}</time>`);
        row.onclick = async () => {
          if (f.folder) {
            path.push({ id: f.id, name: f.name });
            query = '';
            search.value = '';
            load();
            return;
          }
          listEl.querySelectorAll('.cb-row').forEach((r) => (r.disabled = true));
          row.classList.add('busy');
          row.querySelector('span').textContent = 'Opening…';
          const r = await window.office.cloud.open(provider, f);
          if (r?.error) {
            toast(r.error, 'error');
            load();
            return;
          }
          done(f);
        };
        listEl.append(row);
      }
    };

    let timer = 0;
    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = search.value.trim();
        load();
      }, 300);
    };
    refresh.onclick = load;
    load();
    search.focus();
  });
}

// Picks a cloud and opens a file from it; connects first when needed.
export async function openFromCloud(provider, app) {
  if (!(await ensureConnected(provider))) return;
  await cloudBrowser(provider, { mode: 'open', app });
}

// Saves the current document into a cloud folder. shell.saveToCloud does the work.
export async function ensureConnected(provider) {
  const st = (await window.office.cloud.status()).find((s) => s.id === provider);
  if (st?.connected) return true;
  const meta = CLOUDS.find((c) => c.id === provider);
  if (!st?.configured) {
    toast(`Set up ${meta.label} in File > Options first.`, 'error');
    return false;
  }
  toast(`Sign in to ${meta.label} in your browser…`);
  const r = await window.office.cloud.connect(provider);
  if (r?.error) {
    toast(r.error, 'error');
    return false;
  }
  toast(`${meta.label} connected`);
  return true;
}

// Options section: connect/disconnect each service and enter app client IDs.
export async function cloudSettings() {
  const wrap = h('div', 'cloud-settings');
  const draw = async () => {
    const [status, s] = await Promise.all([window.office.cloud.status(), window.office.settings.get()]);
    wrap.innerHTML = `<h2>${icon('cloud', 18)} Cloud storage</h2><p class="muted">Open and save files in Google Drive and OneDrive. Google Sheets you open stay live: edits sync both ways while the workbook is open.</p>`;
    for (const meta of CLOUDS) {
      const st = status.find((x) => x.id === meta.id) || {};
      const cfg = s.cloudClients?.[meta.id] || {};
      const card = h('div', 'cloud-card');
      const who = st.account ? escapeHtml(st.account.email || st.account.name) : '';
      card.innerHTML = `<div class="cloud-card-head">${icon(meta.icon, 22)}<div><b>${meta.label}</b><span class="muted">${st.connected ? `Connected${who ? ` as ${who}` : ''}${cfg.org ? ` through ${escapeHtml(cfg.org)}` : ''}` : st.configured ? (cfg.org ? `Not connected. Only ${escapeHtml(cfg.org)} accounts can sign in.` : 'Not connected') : 'Needs an app client ID (see README)'}</span></div></div>`;
      const actions = h('div', 'cloud-card-actions');
      const btn = h('button', `btn${st.connected ? '' : ' primary'}`, st.connected ? 'Disconnect' : 'Connect');
      btn.type = 'button';
      btn.disabled = !st.configured && !st.connected;
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = st.connected ? 'Disconnecting…' : 'Waiting for your browser…';
        const r = st.connected ? await window.office.cloud.disconnect(meta.id) : await window.office.cloud.connect(meta.id);
        if (r?.error) toast(r.error, 'error');
        else toast(st.connected ? `${meta.label} disconnected` : `${meta.label} connected`);
        draw();
      };
      const setup = h('details', 'cloud-setup');
      setup.innerHTML = `<summary>App registration and college or work sign-in</summary>
        ${st.builtIn ? `<p class="muted">Work signs in with its own app registration, so you don’t need to fill this in. Enter an ID here only to use your own.</p>` : ''}
        <label class="modal-field"><span>${meta.id === 'google' ? 'Google OAuth client ID (Desktop app)' : 'Microsoft application (client) ID'}</span><input name="clientId" value="${escapeHtml(cfg.clientId || '')}" placeholder="${meta.id === 'google' ? '…apps.googleusercontent.com' : '00000000-0000-0000-0000-000000000000'}"></label>
        ${meta.id === 'google' ? `<label class="modal-field"><span>Client secret</span><input name="clientSecret" type="password" placeholder="${cfg.hasSecret ? '•••••••• (saved)' : 'GOCSPX-…'}"></label>` : ''}
        <label class="modal-field"><span>Only for a college or work account: its ${meta.id === 'google' ? 'Google Workspace domain' : 'domain or tenant ID'}. Leave empty for a personal account.</span><input name="org" value="${escapeHtml(cfg.org || '')}" placeholder="${meta.id === 'google' ? 'college.edu' : 'contoso.com'}"></label>
        <button class="btn" type="button" data-save>Save</button>`;
      setup.querySelector('[data-save]').onclick = async () => {
        const v = { org: setup.querySelector('[name=org]').value, clientId: setup.querySelector('[name=clientId]').value, clientSecret: setup.querySelector('[name=clientSecret]')?.value || '' };
        await window.office.settings.set({ cloudClients: { [meta.id]: v } });
        toast(`${meta.label} settings saved. Connect again if you changed the organization.`);
        draw();
      };
      if (!st.configured) setup.open = true;
      if (st.builtIn && st.custom) {
        const reset = h('button', 'btn', 'Use Work’s built-in sign-in');
        reset.type = 'button';
        reset.onclick = async () => {
          if (st.connected) await window.office.cloud.disconnect(meta.id);
          await window.office.settings.set({ cloudClients: { [meta.id]: { reset: true } } });
          toast(`${meta.label} now uses Work’s built-in sign-in. Connect again.`);
          draw();
        };
        setup.querySelector('[data-save]').after(reset);
      }
      actions.append(btn);
      if (cfg.org && !st.connected) {
        // A domain limits sign-in to that organization; offer the way back to personal accounts.
        const any = h('button', 'btn', `Use any ${meta.id === 'google' ? 'Google' : 'Microsoft'} account`);
        any.type = 'button';
        any.title = `Sign-in is limited to ${cfg.org} accounts`;
        any.onclick = async () => {
          await window.office.settings.set({ cloudClients: { [meta.id]: { ...cfg, org: '' } } });
          toast(`${meta.label} now accepts any account, including personal ones`);
          draw();
        };
        actions.append(any);
      }
      card.append(actions, setup);
      wrap.append(card);
    }
  };
  await draw();
  return wrap;
}

const ROLE_LABEL = { owner: 'Owner', edit: 'Can edit', view: 'Can view' };

// Share the open file with people by email. Files that aren't in a cloud yet
// are saved to Google Drive or OneDrive first.
export async function shareDialog(shell) {
  const path = shell.state.path;
  const first = path ? await window.office.cloud.share(path, 'people') : { notInCloud: true };
  if (first?.error) return toast(first.error, 'error');

  const back = h('div', 'modal-back');
  const box = h('div', 'modal share-box');
  back.append(box);
  document.body.append(back);
  const done = () => back.remove();
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') done();
    e.stopPropagation();
  });
  back.onclick = (e) => {
    if (e.target === back) done();
  };

  if (first.notInCloud) {
    box.innerHTML = `<div class="modal-title">${icon('share', 18)} Share “${escapeHtml(shell.state.name)}”</div><p class="modal-body">To share, the file needs to live in Google Drive or OneDrive. Save a copy there, and people you invite can open it with their own account.</p>`;
    const actions = h('div', 'modal-actions');
    for (const c of CLOUDS) {
      const b = h('button', 'btn primary', `${icon(c.icon, 16)} Save to ${c.label}`);
      b.onclick = async () => {
        done();
        if (await shell.saveToCloud(c.id)) shareDialog(shell);
      };
      actions.append(b);
    }
    const cancel = h('button', 'btn', 'Cancel');
    cancel.onclick = done;
    actions.append(cancel);
    box.append(actions);
    return;
  }

  const draw = (info) => {
    box.innerHTML = `<div class="modal-title">${icon('share', 18)} Share “${escapeHtml(shell.state.name)}”</div>`;
    const form = h('form', 'share-invite');
    form.innerHTML = `<input name="emails" placeholder="Add people by email (separate with commas)" autocomplete="off" required>
      <select name="role"><option value="edit">Can edit</option><option value="view">Can view</option></select>
      <textarea name="message" rows="2" placeholder="Message (optional)"></textarea>
      <button class="btn primary" type="submit">Send invite</button>`;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const send = form.querySelector('[type=submit]');
      send.disabled = true;
      send.textContent = 'Sending…';
      const r = await window.office.cloud.share(path, 'invite', { emails: form.emails.value, role: form.role.value, message: form.message.value });
      if (r?.error) {
        toast(r.error, 'error');
        send.disabled = false;
        send.textContent = 'Send invite';
        return;
      }
      toast(`Invited ${r.invited.join(', ')}`);
      reload();
    };
    const list = h('div', 'share-people');
    list.append(h('div', 'share-head', `People with access <span class="muted">on ${escapeHtml(info.label)}</span>`));
    for (const p of info.people) {
      const row = h('div', 'share-person', `<span class="share-avatar">${escapeHtml((p.name || p.email || '?')[0].toUpperCase())}</span><div><b>${escapeHtml(p.name || p.email || 'Anyone with the link')}</b>${p.name && p.email ? `<span class="muted">${escapeHtml(p.email)}</span>` : ''}</div><span class="share-role">${ROLE_LABEL[p.role] || p.role}</span>`);
      if (p.role !== 'owner' && !p.inherited) {
        const x = h('button', 'cb-icon', icon('close', 14));
        x.title = 'Remove access';
        x.onclick = async () => {
          x.disabled = true;
          const r = await window.office.cloud.share(path, 'remove', { id: p.id });
          if (r?.error) toast(r.error, 'error');
          reload();
        };
        row.append(x);
      }
      list.append(row);
    }
    const note = h('p', 'muted share-note', shell.info.file?.cloud?.live
      ? 'Everyone with edit access sees changes live while the sheet is open.'
      : `People you invite get an email and open the file with their own ${escapeHtml(info.label)} account.`);
    const actions = h('div', 'modal-actions');
    if (info.link) {
      const copy = h('button', 'btn', `${icon('link', 16)} Copy link`);
      copy.onclick = async () => {
        await navigator.clipboard.writeText(info.link);
        toast('Link copied. Only people with access can open it.');
      };
      actions.append(copy);
    }
    const close = h('button', 'btn', 'Done');
    close.onclick = done;
    actions.append(close);
    box.append(form, list, note, actions);
    form.emails.focus();
  };
  const reload = async () => {
    const r = await window.office.cloud.share(path, 'people');
    if (r?.error) toast(r.error, 'error');
    else draw(r);
  };
  draw(first);
}
