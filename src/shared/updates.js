// Updates: the Options section (automatic checks on or off, Check for
// updates) and the bar that offers to restart once a new version is ready.

import { icon } from './icons.js';
import { escapeHtml, h } from './shell.js';

function describe(s) {
  if (s.status === 'checking') return 'Checking for updates…';
  if (s.status === 'latest') return `You have the latest version (${s.current}).`;
  if (s.status === 'downloading') return `Downloading Work ${s.version}… ${s.percent || 0}%`;
  if (s.status === 'ready') return `Work ${s.version} is ready. Restart to install it.`;
  if (s.status === 'available') return s.note || `Work ${s.version} is available. ${s.canInstall ? '' : 'Download it from the releases page.'}`;
  if (s.status === 'error') return s.message;
  return `Version ${s.current}`;
}

function restartButton() {
  const b = h('button', 'btn primary', 'Restart and update');
  b.type = 'button';
  b.onclick = () => window.office.updates.install();
  return b;
}

function releasesButton(s) {
  const b = h('button', 'btn', 'Open releases page');
  b.type = 'button';
  b.onclick = () => window.office.openExternal(s.releases);
  return b;
}

export async function updateSettings() {
  const wrap = h('div', 'cloud-settings update-settings');
  const draw = (s) => {
    wrap.innerHTML = `<h2>${icon('refresh', 18)} Updates</h2><p class="muted">Work checks the project’s GitHub releases for new versions, downloads them in the background and installs them when you restart. Files and settings are kept.</p>`;
    const auto = h('label', 'ai-toggle', `<input type="checkbox" ${s.auto ? 'checked' : ''}><span><b>Check for updates automatically</b> when Work starts and every few hours.</span>`);
    auto.querySelector('input').onchange = (e) => window.office.settings.set({ autoUpdate: e.target.checked }).then(refresh);
    const status = h('p', `settings-status${s.status === 'error' ? ' bad' : s.status === 'ready' || s.status === 'latest' ? ' ok' : ''}`, escapeHtml(describe(s)));
    const actions = h('div', 'modal-actions');
    const check = h('button', 'btn', 'Check for updates');
    check.type = 'button';
    check.disabled = ['checking', 'downloading'].includes(s.status);
    check.onclick = () => window.office.updates.check().then(draw);
    if (s.status === 'ready') actions.append(restartButton());
    else actions.append(check);
    if (s.status === 'available' || s.status === 'error') actions.append(releasesButton(s));
    wrap.append(auto, status, actions);
  };
  const refresh = () => window.office.updates.status().then(draw);
  window.office.updates.onChange((s) => wrap.isConnected && draw(s));
  draw(await window.office.updates.status());
  return wrap;
}

// A bar at the bottom of every window once an update has downloaded.
export function watchUpdates() {
  let bar = null;
  const show = (s) => {
    if (s.status !== 'ready' || bar) return;
    bar = h('div', 'update-bar', `${icon('refresh', 16)}<span>${escapeHtml(describe(s))}</span>`);
    const later = h('button', 'btn', 'Later');
    later.onclick = () => bar.remove();
    bar.append(restartButton(), later);
    document.body.append(bar);
  };
  window.office.updates.onChange(show);
  window.office.updates.status().then(show);
}
