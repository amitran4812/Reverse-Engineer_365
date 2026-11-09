'use strict';

// Git for LaTeX projects, with no Git install needed (isomorphic-git):
// set up a repository in the project folder, commit, and sync (pull, then
// push) with GitHub, GitLab or any HTTPS remote. Tokens are kept encrypted
// with the other secrets in settings, one per host.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const settings = require('./settings');

const IGNORE = ['*.aux', '*.log', '*.out', '*.toc', '*.lof', '*.lot', '*.fls', '*.fdb_latexmk', '*.synctex.gz', '*.synctex', '*.bbl', '*.blg', '*.bcf', '*.run.xml', '*.nav', '*.snm', '*.vrb', '*.xdv', '.DS_Store', 'Thumbs.db', ''].join('\n');

const isRepo = (root) => fs.existsSync(path.join(root, '.git'));
const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
};

function auths() {
  return settings.getSecret('git-auth') || {};
}

function author() {
  const a = settings.readRaw().gitAuthor || {};
  return { name: a.name || 'Work', email: a.email || 'work@localhost' };
}

function setIdentity({ name, email } = {}) {
  settings.setRaw({ gitAuthor: { name: String(name || '').trim().slice(0, 100), email: String(email || '').trim().slice(0, 200) } });
  return { ok: true };
}

function setToken(url, { username = '', token = '' } = {}) {
  const host = hostOf(url);
  if (!host) throw new Error('That isn’t a web address for a repository.');
  const all = { ...auths() };
  if (token) all[host] = { username: String(username || '').trim(), token: String(token).trim() };
  else delete all[host];
  settings.setSecret('git-auth', all);
  return { ok: true };
}

const authFor = (url) => {
  const a = auths()[hostOf(url)];
  return a ? { username: a.username || 'x-access-token', password: a.token } : null;
};

function remoteOpts(url) {
  return { http, onAuth: () => authFor(url) || { cancel: true }, onAuthFailure: () => ({ cancel: true }) };
}

function plainError(err, url) {
  const msg = String(err?.message || err);
  if (err?.code === 'HttpError' && /401|403/.test(msg)) return new Error(`${hostOf(url) || 'The remote'} refused the sign-in. Add an access token that can read and write this repository.`);
  if (err?.code === 'UserCanceledError') return new Error(authFor(url) ? `${hostOf(url) || 'The remote'} refused the access token. Check that it hasn’t expired and can write to this repository.` : `${hostOf(url) || 'The remote'} needs a sign-in. Add an access token for it.`);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)) return new Error('Couldn’t reach the remote. Check the internet connection and the address.');
  if (err?.code === 'MergeConflictError' || err?.code === 'MergeNotSupportedError') {
    const files = err.data?.filepaths?.length ? err.data.filepaths.join(', ') : 'some files';
    return new Error(`The remote has changes to ${files} that clash with yours. Nothing was changed here. Edit those files on one side so they match, then sync again.`);
  }
  if (err?.code === 'PushRejectedError') return new Error('The remote has newer commits. Sync again to bring them in first.');
  return err instanceof Error ? err : new Error(msg);
}

async function origin(root) {
  const remotes = await git.listRemotes({ fs, dir: root }).catch(() => []);
  return remotes.find((r) => r.remote === 'origin')?.url || remotes[0]?.url || '';
}

// Files that differ from the last commit: [{ path, status: 'added'|'changed'|'deleted' }].
async function changes(root) {
  const rows = await git.statusMatrix({ fs, dir: root });
  const out = [];
  for (const [file, head, work] of rows) {
    if (head === 1 && work === 1) continue;
    if (head === 0 && work === 0) continue;
    out.push({ path: file, status: head === 0 ? 'added' : work === 0 ? 'deleted' : 'changed' });
  }
  return out;
}

async function status(root) {
  if (!isRepo(root)) return { repo: false, identity: settings.readRaw().gitAuthor || null };
  const branch = (await git.currentBranch({ fs, dir: root, fullname: false }).catch(() => null)) || 'main';
  const url = await origin(root);
  const log = await git.log({ fs, dir: root, depth: 8 }).catch(() => []);
  let ahead = null;
  try {
    const remoteOid = await git.resolveRef({ fs, dir: root, ref: `refs/remotes/origin/${branch}` });
    const idx = (await git.log({ fs, dir: root, depth: 500 })).findIndex((c) => c.oid === remoteOid);
    ahead = idx < 0 ? null : idx;
  } catch {
    ahead = url ? log.length : null;
  }
  return {
    repo: true,
    branch,
    remote: url,
    host: hostOf(url),
    hasToken: Boolean(url && authFor(url)),
    ahead,
    changes: await changes(root),
    commits: log.map((c) => ({ oid: c.oid.slice(0, 7), message: c.commit.message.trim(), name: c.commit.author.name, time: c.commit.author.timestamp * 1000 })),
    identity: settings.readRaw().gitAuthor || null,
  };
}

async function init(root) {
  if (!isRepo(root)) await git.init({ fs, dir: root, defaultBranch: 'main' });
  const ignore = path.join(root, '.gitignore');
  if (!fs.existsSync(ignore)) await fsp.writeFile(ignore, IGNORE);
  return status(root);
}

async function commit(root, message) {
  if (!isRepo(root)) throw new Error('Set up Git for this project first.');
  const list = await changes(root);
  if (!list.length) return { ok: true, nothing: true };
  for (const c of list) {
    if (c.status === 'deleted') await git.remove({ fs, dir: root, filepath: c.path });
    else await git.add({ fs, dir: root, filepath: c.path });
  }
  const oid = await git.commit({ fs, dir: root, message: String(message || '').trim() || `Update ${list.length} file${list.length === 1 ? '' : 's'}`, author: author() });
  return { ok: true, oid: oid.slice(0, 7), files: list.length };
}

async function setRemote(root, url) {
  url = String(url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error('Use the repository’s HTTPS address, for example https://github.com/you/paper.git');
  if (!isRepo(root)) await init(root);
  await git.deleteRemote({ fs, dir: root, remote: 'origin' }).catch(() => {});
  if (url) await git.addRemote({ fs, dir: root, remote: 'origin', url });
  return status(root);
}

// Commits anything unsaved to Git, brings in the remote's commits, then sends ours.
async function sync(root, message) {
  const url = await origin(root);
  if (!url) throw new Error('Add the remote repository’s address first.');
  const done = await commit(root, message);
  const branch = (await git.currentBranch({ fs, dir: root, fullname: false })) || 'main';
  let pulled = false;
  try {
    const got = await git.fetch({ fs, dir: root, remote: 'origin', ref: branch, singleBranch: true, ...remoteOpts(url) });
    // A brand-new empty remote has nothing to bring in yet.
    if (got.fetchHead) {
      const res = await git.merge({ fs, dir: root, ours: branch, theirs: `remotes/origin/${branch}`, author: author(), fastForward: true });
      if (!res.alreadyMerged) {
        await git.checkout({ fs, dir: root, ref: branch });
        pulled = true;
      }
    }
  } catch (err) {
    throw plainError(err, url);
  }
  try {
    await git.push({ fs, dir: root, remote: 'origin', ref: branch, ...remoteOpts(url) });
  } catch (err) {
    throw plainError(err, url);
  }
  return { ok: true, committed: done.nothing ? 0 : done.files, pulled, status: await status(root) };
}

async function clone(url, dir) {
  url = String(url || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Use the repository’s HTTPS address, for example https://github.com/you/paper.git');
  await fsp.mkdir(dir, { recursive: true });
  if ((await fsp.readdir(dir)).length) throw new Error('Choose an empty folder to download the repository into.');
  try {
    await git.clone({ fs, dir, url, singleBranch: true, depth: 50, ...remoteOpts(url) });
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw plainError(err, url);
  }
  return { ok: true, dir };
}

module.exports = { status, init, commit, setRemote, sync, clone, setToken, setIdentity, hostOf };
