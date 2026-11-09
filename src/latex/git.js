// Git sync for LaTeX projects: set up a repository, commit, and sync with
// GitHub, GitLab or any HTTPS remote, all without installing Git.

import { escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const TOKEN_HELP = {
  'github.com': 'https://github.com/settings/personal-access-tokens/new',
  'gitlab.com': 'https://gitlab.com/-/user_settings/personal_access_tokens',
  'bitbucket.org': 'https://bitbucket.org/account/settings/app-passwords/',
};

export async function openGit({ api, beforeOpen, onPulled }) {
  await beforeOpen?.();
  const git = api.git;
  const back = h('div', 'modal-back');
  const box = h('div', 'modal wide gx');
  back.append(box);
  document.body.append(back);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close();
  });

  let busy = false;
  async function act(label, fn) {
    if (busy) return;
    busy = true;
    box.classList.add('busy');
    const note = box.querySelector('.gx-busy');
    if (note) note.textContent = label;
    try {
      const res = await fn();
      if (res?.error) toast(res.error, 'error');
      return res;
    } finally {
      busy = false;
      box.classList.remove('busy');
      await draw();
    }
  }

  async function draw() {
    const st = await git.status();
    box.innerHTML = '';
    box.append(h('div', 'modal-title', `${icon('gitSync', 18)} Git sync`));
    if (st?.error) {
      box.append(h('p', 'gx-error', escapeHtml(st.error)));
      return footer();
    }
    if (!st.repo) {
      const intro = h('div', 'gx-intro', `<p>Keep this project in a Git repository, such as one on GitHub or GitLab. Commit your work, then sync to send it and bring in your co-authors’ changes. No Git install is needed.</p>`);
      const setup = h('button', 'btn primary', `${icon('gitSync', 14)} Set up Git for this project`);
      setup.onclick = () => act('Setting up…', () => git.init());
      intro.append(setup);
      box.append(intro);
      return footer();
    }

    // Where it syncs to.
    const remote = h('div', 'gx-row');
    remote.innerHTML = `<label class="gx-label">Remote repository</label>`;
    const url = h('input', 'gx-input');
    url.placeholder = 'https://github.com/you/paper.git';
    url.value = st.remote || '';
    const saveUrl = h('button', 'btn', st.remote ? 'Change' : 'Connect');
    saveUrl.onclick = () => act('Saving…', () => git.setRemote(url.value));
    remote.append(url, saveUrl);
    box.append(remote);

    if (st.remote) {
      const auth = h('div', 'gx-row');
      auth.innerHTML = `<label class="gx-label">Sign-in for ${escapeHtml(st.host)}</label>`;
      const user = h('input', 'gx-input gx-user');
      user.placeholder = 'User name (optional)';
      const token = h('input', 'gx-input');
      token.type = 'password';
      token.placeholder = st.hasToken ? 'Saved. Paste a new token to replace it' : 'Paste an access token';
      const save = h('button', 'btn', 'Save');
      save.onclick = () => act('Saving…', () => git.setToken(st.remote, { username: user.value, token: token.value }));
      auth.append(user, token, save);
      const help = TOKEN_HELP[st.host];
      const hint = h('div', 'gx-hint', `${st.hasToken ? `${icon('check', 12)} A token is saved, encrypted on this computer. ` : ''}${help ? `<a href="#" data-link="${help}">Make a token on ${escapeHtml(st.host)}</a> with read and write access to the repository’s contents.` : 'Use a personal access token with read and write access.'} Public repositories can be pulled without one.`);
      hint.querySelector('[data-link]')?.addEventListener('click', (e) => {
        e.preventDefault();
        window.office.openExternal(e.target.dataset.link);
      });
      box.append(auth, hint);
    }

    const who = h('div', 'gx-row');
    who.innerHTML = '<label class="gx-label">Commit as</label>';
    const name = h('input', 'gx-input');
    name.placeholder = 'Your name';
    name.value = st.identity?.name || '';
    const email = h('input', 'gx-input');
    email.placeholder = 'you@example.com';
    email.value = st.identity?.email || '';
    const saveWho = h('button', 'btn', 'Save');
    saveWho.onclick = () => act('Saving…', () => git.setIdentity({ name: name.value, email: email.value }));
    who.append(name, email, saveWho);
    box.append(who);

    // What's waiting.
    const changes = h('div', 'gx-changes');
    const ahead = st.ahead ? ` · ${st.ahead} commit${st.ahead === 1 ? '' : 's'} not synced yet` : '';
    changes.append(h('div', 'gx-sec', `<b>Changes on branch ${escapeHtml(st.branch)}</b><span>${st.changes.length ? `${st.changes.length} file${st.changes.length === 1 ? '' : 's'}` : 'Nothing to commit'}${ahead}</span>`));
    const files = h('div', 'gx-files');
    for (const c of st.changes.slice(0, 200)) files.append(h('div', 'gx-file', `<span class="gx-st ${c.status}">${c.status}</span>${escapeHtml(c.path)}`));
    if (st.changes.length) changes.append(files);
    const msg = h('textarea', 'gx-msg');
    msg.rows = 2;
    msg.placeholder = 'What did you change? (optional)';
    changes.append(msg);
    const btns = h('div', 'gx-btns');
    const commit = h('button', 'btn', `${icon('check', 14)} Commit`);
    commit.disabled = !st.changes.length;
    commit.onclick = () => act('Committing…', async () => {
      const res = await git.commit(msg.value);
      if (res?.ok && !res.nothing) toast(`Committed ${res.files} file${res.files === 1 ? '' : 's'}`);
      return res;
    });
    const sync = h('button', 'btn primary', `${icon('gitSync', 14)} ${st.changes.length ? 'Commit and sync' : 'Sync'}`);
    sync.disabled = !st.remote;
    sync.title = st.remote ? 'Commit, bring in changes from the remote, then send yours' : 'Connect a remote repository first';
    sync.onclick = () => act('Syncing…', async () => {
      const res = await git.sync(msg.value);
      if (res?.ok) {
        toast(res.pulled ? 'Synced: brought in the remote’s changes and sent yours' : 'Synced: sent your commits');
        await onPulled?.();
      }
      return res;
    });
    btns.append(h('span', 'gx-busy'), commit, sync);
    changes.append(btns);
    box.append(changes);

    if (st.commits.length) {
      const log = h('div', 'gx-log');
      log.append(h('div', 'gx-sec', '<b>Recent commits</b>'));
      for (const c of st.commits) log.append(h('div', 'gx-commit', `<code>${c.oid}</code><span>${escapeHtml(c.message.split('\n')[0])}</span><small>${escapeHtml(c.name)} · ${when(c.time)}</small>`));
      box.append(log);
    }
    footer();
  }

  function footer() {
    const actions = h('div', 'modal-actions');
    const done = h('button', 'btn', 'Close');
    done.onclick = close;
    actions.append(done);
    box.append(actions);
  }

  await draw();
}

// "New project from Git": downloads a repository into a folder and opens it.
export async function cloneDialog({ api, dialog }) {
  const v = await dialog({
    title: 'Open a project from Git',
    body: '<p>Download a LaTeX project from GitHub, GitLab or another Git host, then keep it in sync from the Review tab.</p>',
    fields: [
      { name: 'url', label: 'Repository address (HTTPS)', placeholder: 'https://github.com/you/paper.git' },
      { name: 'token', label: 'Access token (only for private repositories)', type: 'password' },
    ],
    ok: 'Choose folder…',
  });
  if (!v?.url?.trim()) return;
  toast('Downloading the repository…');
  const res = await api.git.clone(v.url.trim(), v.token ? { token: v.token } : null);
  if (res?.error) toast(res.error, 'error');
}
