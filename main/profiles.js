'use strict';

// Accounts (profiles) such as Personal, College and Work. Each one has its own
// app data folder, so its Claude key, cloud sign-ins, recent files, cache,
// browser storage and settings never mix with another's. Each account runs as
// its own process: the single-instance lock is per data folder, so two
// accounts can be open side by side.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

const COLORS = ['#3b4a6b', '#2f5aa8', '#1b7a4b', '#c2532d', '#7b3fa0', '#a8326b', '#0f7c8c', '#8a6a12'];

let base = null; // the app's original userData folder; the default account lives here
let current = null;

const listFile = () => path.join(base, 'accounts.json');

function read() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(listFile(), 'utf8'));
  } catch {
    data = {};
  }
  const list = Array.isArray(data.accounts) && data.accounts.length ? data.accounts : [{ id: 'default', name: 'Personal', color: COLORS[0] }];
  return { accounts: list, last: data.last || 'default' };
}

function write(data) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(listFile(), JSON.stringify(data, null, 2));
}

const dirOf = (id) => (id === 'default' ? base : path.join(base, 'accounts', id));

function argProfile(argv) {
  const a = argv.find((x) => x.startsWith('--rea-account='));
  return a ? a.slice('--rea-account='.length) : null;
}

// Must run before app ready and before the single-instance lock.
function init() {
  base = app.getPath('userData');
  const data = read();
  const wanted = argProfile(process.argv) || process.env.REA_ACCOUNT || data.last;
  current = data.accounts.find((p) => p.id === wanted) || data.accounts[0];
  app.setPath('userData', dirOf(current.id));
  if (current.id !== data.last) write({ ...data, last: current.id });
  return current;
}

const active = () => ({ ...current, count: read().accounts.length });

function list() {
  return read().accounts.map((p) => ({ ...p, current: p.id === current.id }));
}

const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);

function add(name) {
  const n = cleanName(name);
  if (!n) throw new Error('Give the account a name, such as Work or College.');
  const data = read();
  if (data.accounts.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw new Error(`You already have an account called ${n}.`);
  const used = new Set(data.accounts.map((p) => p.color));
  const p = { id: crypto.randomBytes(6).toString('hex'), name: n, color: COLORS.find((c) => !used.has(c)) || COLORS[data.accounts.length % COLORS.length] };
  data.accounts.push(p);
  write(data);
  fs.mkdirSync(dirOf(p.id), { recursive: true });
  return list();
}

function rename(id, name) {
  const n = cleanName(name);
  if (!n) throw new Error('Give the account a name.');
  const data = read();
  const p = data.accounts.find((x) => x.id === id);
  if (!p) throw new Error('That account no longer exists.');
  p.name = n;
  write(data);
  if (id === current.id) current = { ...current, name: n };
  return list();
}

// Deletes the account and everything stored for it on this computer.
function remove(id) {
  if (id === current.id) throw new Error('Switch to another account before removing this one.');
  if (id === 'default') throw new Error('The first account keeps the app’s own settings and can’t be removed. You can rename it.');
  const data = read();
  if (!data.accounts.some((p) => p.id === id)) return list();
  try {
    fs.rmSync(dirOf(id), { recursive: true, force: true });
  } catch (err) {
    throw new Error(`Close that account’s windows first, then try again. (${err.code || err.message})`);
  }
  data.accounts = data.accounts.filter((p) => p.id !== id);
  write(data);
  return list();
}

// Opens an account in its own process. If it's already running, that process
// gets a second-instance event and opens its start screen.
function open(id) {
  if (!read().accounts.some((p) => p.id === id)) throw new Error('That account no longer exists.');
  const keep = process.argv.filter((a) => a === '--no-sandbox');
  const args = [...(app.isPackaged ? [] : [app.getAppPath()]), ...keep, `--rea-account=${id}`];
  spawn(process.execPath, args, { detached: true, stdio: 'ignore', env: { ...process.env, REA_ACCOUNT: '' } }).unref();
  return true;
}

module.exports = { init, active, list, add, rename, remove, open, argProfile };
