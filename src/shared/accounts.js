// Accounts such as Personal, College and Work. Each account keeps its own
// Claude key, cloud sign-ins, recent files and history; switching opens the
// other account in its own windows.

import { icon } from './icons.js';
import { dialog, escapeHtml, h, toast } from './shell.js';

const avatar = (a, size = 26) => `<span class="acct-avatar" style="background:${escapeHtml(a.color)};width:${size}px;height:${size}px">${escapeHtml(a.name[0]?.toUpperCase() || '?')}</span>`;

async function openAccount(a) {
  const r = await window.office.accounts.open(a.id);
  if (r?.error) toast(r.error, 'error');
  else toast(`Opening ${a.name} in its own window`);
}

export async function addAccount() {
  const got = await dialog({
    title: 'Add an account',
    body: '<p class="muted">Each account has its own Claude key, Google Drive and OneDrive sign-ins, recent files and history. Nothing is shared between accounts.</p>',
    fields: [{ name: 'name', label: 'Name', placeholder: 'Work, College, Personal…' }],
    ok: 'Add and open',
  });
  if (!got) return null;
  const r = await window.office.accounts.add(got.name);
  if (r?.error) {
    toast(r.error, 'error');
    return null;
  }
  const made = r[r.length - 1];
  await openAccount(made);
  return r;
}

// The account button at the bottom of the start screen's navigation.
export function accountSwitcher(current, onManage) {
  const btn = h('button', 'acct-switch', `${avatar(current)}<span><b>${escapeHtml(current.name)}</b><small>Switch account</small></span>`);
  btn.title = 'Switch or add accounts';
  btn.onclick = async (e) => {
    e.stopPropagation();
    document.querySelector('.acct-menu')?.remove();
    const menu = h('div', 'acct-menu');
    for (const a of await window.office.accounts.list()) {
      const row = h('button', `acct-row${a.current ? ' current' : ''}`, `${avatar(a, 22)}<span>${escapeHtml(a.name)}</span>${a.current ? '<em>This window</em>' : ''}`);
      row.onclick = () => {
        menu.remove();
        if (!a.current) openAccount(a);
      };
      menu.append(row);
    }
    const add = h('button', 'acct-row', `${icon('newFile', 18)}<span>Add account…</span>`);
    add.onclick = () => {
      menu.remove();
      addAccount();
    };
    const manage = h('button', 'acct-row', `${icon('settings', 18)}<span>Manage accounts</span>`);
    manage.onclick = () => {
      menu.remove();
      onManage();
    };
    menu.append(h('div', 'acct-sep'), add, manage);
    const r = btn.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
    document.body.append(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }));
  };
  return btn;
}

// Options section: rename and remove accounts.
export async function accountsSection() {
  const wrap = h('div', 'cloud-settings acct-settings');
  const draw = async () => {
    const list = await window.office.accounts.list();
    wrap.innerHTML = `<h2>${icon('profile', 18)} Accounts</h2><p class="muted">Keep personal, college and work files apart. Each account has its own Claude key, cloud sign-ins, recent files, history and cache, and opens in its own windows. For a work or school account, add your organization in its Cloud storage settings so you sign in through your organization.</p>`;
    for (const a of list) {
      const card = h('div', 'cloud-card', `<div class="cloud-card-head">${avatar(a, 30)}<div><b>${escapeHtml(a.name)}</b><span class="muted">${a.current ? 'This window' : 'Opens in its own window'}</span></div></div>`);
      const actions = h('div', 'cloud-card-actions');
      if (!a.current) {
        const open = h('button', 'btn primary', 'Open');
        open.onclick = () => openAccount(a);
        actions.append(open);
      }
      const ren = h('button', 'btn', 'Rename');
      ren.onclick = async () => {
        const got = await dialog({ title: 'Rename account', fields: [{ name: 'name', label: 'Name', value: a.name }], ok: 'Rename' });
        if (!got) return;
        const r = await window.office.accounts.rename(a.id, got.name);
        if (r?.error) toast(r.error, 'error');
        draw();
      };
      actions.append(ren);
      if (!a.current && a.id !== 'default') {
        const rm = h('button', 'btn danger', 'Remove');
        rm.onclick = async () => {
          const ok = await dialog({ title: `Remove ${a.name}?`, body: `<p>This deletes the ${escapeHtml(a.name)} account from this computer: its Claude key, cloud sign-ins, recent files list and downloaded copies. Files saved in your own folders, Google Drive or OneDrive are not touched.</p>`, ok: 'Remove account' });
          if (!ok) return;
          const r = await window.office.accounts.remove(a.id);
          if (r?.error) toast(r.error, 'error');
          else toast(`${a.name} removed`);
          draw();
        };
        actions.append(rm);
      }
      card.append(actions);
      wrap.append(card);
    }
    const add = h('button', 'btn', `${icon('profile', 16)} Add account`);
    add.onclick = async () => {
      if (await addAccount()) draw();
    };
    const foot = h('div', 'acct-add');
    foot.append(add);
    wrap.append(foot);
  };
  await draw();
  return wrap;
}

// A small badge in each app's title bar so you always know which account a
// window belongs to. Shown once there's more than one account.
export function accountChip(a) {
  if (!a || a.count < 2) return null;
  const chip = h('div', 'acct-chip', `${avatar(a, 18)}<span>${escapeHtml(a.name)}</span>`);
  chip.title = `This window uses your ${a.name} account`;
  return chip;
}
