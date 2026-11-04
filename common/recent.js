'use strict';

// The Recent list, shared by the main process and every app's Recent section.
// Each entry: { app, path, at, kind?, pinned?, cloud? }. kind is 'notes' or
// 'latex' for Write's modes; cloud is { provider, id, parent, name, native,
// label, modified } for a file opened from a cloud drive, whose path is the
// cached copy that reopens without downloading again.

const MAX = 30;

const VIEWS = [
  { id: 'all', label: 'All' },
  { id: 'docs', label: 'Write' },
  { id: 'notes', label: 'Notes' },
  { id: 'latex', label: 'LaTeX' },
  { id: 'slides', label: 'Present' },
  { id: 'sheets', label: 'Plot' },
  { id: 'pdf', label: 'Read' },
];

const viewOf = (r) => r.kind || r.app;

// Pinned files first, then newest first.
function sortRecent(list) {
  return [...list].sort((a, b) => Boolean(b.pinned) - Boolean(a.pinned) || (b.at || 0) - (a.at || 0));
}

// Adds or refreshes an entry, keeping what was known about it (pin, cloud copy).
// Pinned files never fall off; the rest keep the newest MAX.
function mergeRecent(list, entry, max = MAX) {
  const old = list.find((r) => r.path === entry.path);
  const next = { ...old, ...entry };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  const all = sortRecent([next, ...list.filter((r) => r.path !== entry.path)]);
  let unpinned = 0;
  return all.filter((r) => r.pinned || ++unpinned <= max);
}

function filterRecent(list, view = 'all', query = '') {
  const q = String(query || '').trim().toLowerCase();
  return sortRecent(list).filter((r) => (view === 'all' || viewOf(r) === view) && (!q || nameOf(r).toLowerCase().includes(q) || placeOf(r).toLowerCase().includes(q)));
}

function nameOf(r) {
  return r.cloud?.name || String(r.path).split(/[\\/]/).pop();
}

// Where the file lives, for the second line of a row: the cloud drive, or the folder.
function placeOf(r) {
  if (r.cloud) return r.cloud.native ? `${r.cloud.label || 'Cloud'} · ${r.cloud.native}` : r.cloud.label || 'Cloud';
  const p = String(r.path);
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : p;
}

// "Just now", "5 min ago", "Yesterday", or a date.
function whenOf(at, now = Date.now()) {
  const d = now - at;
  if (d < 60_000) return 'Just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  const day = (t) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString();
}

// A cloud copy is stale when the drive's modified time moved past the one we downloaded.
function isStale(known, remote) {
  if (!remote) return false;
  if (!known) return true;
  return new Date(remote).getTime() > new Date(known).getTime();
}

module.exports = { MAX, VIEWS, viewOf, sortRecent, mergeRecent, filterRecent, nameOf, placeOf, whenOf, isStale };
