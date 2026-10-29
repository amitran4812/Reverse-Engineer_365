'use strict';

// Google Drive (Drive API v3) and OneDrive (Microsoft Graph). Each provider
// lists folders, downloads a file as bytes and uploads bytes back.
// Files come back in one shape: { id, name, folder, app, ext, native, modified, size }.

const path = require('path');
const { appForFile } = require('../formats');

// REA_CLOUD_MOCK points every endpoint at a local stand-in server (tests only).
const MOCK = process.env.REA_CLOUD_MOCK;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME = { xlsx: XLSX, docx: DOCX, csv: 'text/csv', reaslides: 'application/json', html: 'text/html', md: 'text/markdown', txt: 'text/plain', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

// Google Sheets and Docs are exported to .xlsx/.docx to open, and converted back on save.
const GOOGLE_NATIVE = {
  'application/vnd.google-apps.spreadsheet': { ext: 'xlsx', mime: XLSX, label: 'Google Sheets' },
  'application/vnd.google-apps.document': { ext: 'docx', mime: DOCX, label: 'Google Docs' },
};
const GOOGLE_FOLDER = 'application/vnd.google-apps.folder';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function call(token, url, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      const j = JSON.parse(text);
      message = j.error?.message || j.error_description || j.error || text;
    } catch {}
    throw new ApiError(res.status, `${res.status} ${typeof message === 'string' ? message : JSON.stringify(message)}`.trim());
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  return res.status === 204 ? null : res.json();
}

const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const google = {
  id: 'google',
  label: 'Google Drive',
  authUrl: MOCK ? `${MOCK}/google/auth` : 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: MOCK ? `${MOCK}/google/token` : 'https://oauth2.googleapis.com/token',
  api: MOCK ? `${MOCK}/google/drive/v3` : 'https://www.googleapis.com/drive/v3',
  uploadApi: MOCK ? `${MOCK}/google/upload/drive/v3` : 'https://www.googleapis.com/upload/drive/v3',
  sheetsApi: MOCK ? `${MOCK}/google/sheets/v4` : 'https://sheets.googleapis.com/v4',
  // Full Drive access is needed to browse existing files; see README for the consent-screen setup.
  scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets openid email profile',
  redirectHost: '127.0.0.1',
  extraParams: { access_type: 'offline', prompt: 'consent' },

  async account(token) {
    const r = await call(token, `${this.api}/about?fields=user(displayName,emailAddress)`);
    return { name: r.user?.displayName || '', email: r.user?.emailAddress || '' };
  },

  toFile(f) {
    const native = GOOGLE_NATIVE[f.mimeType];
    const folder = f.mimeType === GOOGLE_FOLDER;
    const name = native ? `${f.name}.${native.ext}` : f.name;
    return {
      id: f.id,
      name,
      title: f.name,
      folder,
      app: folder ? null : appForFile(name),
      native: native ? native.label : null,
      parent: f.parents?.[0] || null,
      modified: f.modifiedTime || null,
      size: f.size ? Number(f.size) : null,
    };
  },

  async list(token, { folder, query }) {
    let q;
    if (query) q = `name contains '${quote(query)}' and trashed = false`;
    else if (folder === 'shared') q = 'sharedWithMe = true and trashed = false';
    else q = `'${quote(folder || 'root')}' in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,modifiedTime,size,parents)',
      orderBy: 'folder,name_natural',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const r = await call(token, `${this.api}/files?${params}`);
    const files = r.files.map((f) => this.toFile(f));
    if (!folder && !query) files.unshift({ id: 'shared', name: 'Shared with me', folder: true, virtual: true });
    return files;
  },

  async download(token, file) {
    const meta = await call(token, `${this.api}/files/${encodeURIComponent(file.id)}?fields=id,name,mimeType,parents&supportsAllDrives=true`);
    const native = GOOGLE_NATIVE[meta.mimeType];
    const bytes = native
      ? await call(token, `${this.api}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(native.mime)}`, { raw: true })
      : await call(token, `${this.api}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, { raw: true });
    return { bytes, file: this.toFile(meta) };
  },

  // Sharing: people with access, invites by email (Google sends the email), removal.
  async people(token, id) {
    const f = encodeURIComponent(id);
    const [meta, r] = await Promise.all([
      call(token, `${this.api}/files/${f}?fields=webViewLink&supportsAllDrives=true`),
      call(token, `${this.api}/files/${f}/permissions?fields=permissions(id,type,role,emailAddress,displayName)&supportsAllDrives=true`),
    ]);
    const role = { owner: 'owner', organizer: 'owner', fileOrganizer: 'edit', writer: 'edit', commenter: 'view', reader: 'view' };
    return {
      link: meta.webViewLink || null,
      people: (r.permissions || []).map((p) => ({ id: p.id, email: p.emailAddress || (p.type === 'anyone' ? 'Anyone with the link' : p.type), name: p.displayName || '', role: role[p.role] || p.role })),
    };
  },

  async invite(token, id, { emails, role, message }) {
    for (const email of emails) {
      const params = new URLSearchParams({ sendNotificationEmail: 'true', supportsAllDrives: 'true' });
      if (message) params.set('emailMessage', message);
      await call(token, `${this.api}/files/${encodeURIComponent(id)}/permissions?${params}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'user', role: role === 'edit' ? 'writer' : 'reader', emailAddress: email }),
      });
    }
  },

  async remove(token, id, permissionId) {
    await call(token, `${this.api}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`, { method: 'DELETE' });
  },

  // Updates an existing file, or creates one in `parent` when no id is given.
  // Uploading .xlsx/.docx onto a Google Sheet/Doc converts it back in place.
  async upload(token, { id, parent, name, bytes }) {
    const ext = path.extname(name).slice(1).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    if (id) {
      const r = await call(token, `${this.uploadApi}/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,parents`, {
        method: 'PATCH',
        headers: { 'content-type': mime },
        body: bytes,
      });
      return this.toFile(r);
    }
    const boundary = `rea${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name, parents: [parent && parent !== 'shared' ? parent : 'root'] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mime}\r\n\r\n`),
      bytes,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await call(token, `${this.uploadApi}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,parents`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return this.toFile(r);
  },
};

// Live editing of a Google Sheet through the Sheets API: values and formulas
// only (formatting comes from the .xlsx export when the file is opened).
const sheetsLive = {
  async read(token, id) {
    const g = google;
    const meta = await call(token, `${g.sheetsApi}/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties(sheetId,title,index)`);
    const tabs = (meta.sheets || []).map((x) => x.properties).sort((a, b) => a.index - b.index);
    const params = new URLSearchParams({ valueRenderOption: 'FORMULA', dateTimeRenderOption: 'FORMATTED_STRING', majorDimension: 'ROWS' });
    for (const t of tabs) params.append('ranges', `'${t.title.replace(/'/g, "''")}'`);
    const r = tabs.length ? await call(token, `${g.sheetsApi}/spreadsheets/${encodeURIComponent(id)}/values:batchGet?${params}`) : { valueRanges: [] };
    return tabs.map((t, i) => {
      const cells = {};
      (r.valueRanges?.[i]?.values || []).forEach((row, ri) => row.forEach((v, ci) => {
        if (v === '' || v == null) return;
        cells[cellName(ri, ci)] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
      }));
      return { gid: t.sheetId, title: t.title, cells };
    });
  },

  // changes: [{ title, ref, v }] with v '' to clear a cell.
  async write(token, id, changes) {
    if (!changes.length) return;
    const data = changes.map((c) => ({ range: `'${c.title.replace(/'/g, "''")}'!${c.ref}`, values: [[c.v]] }));
    await call(token, `${google.sheetsApi}/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    });
  },

  // ops: [{ add: title } | { rename: gid, title } | { remove: gid }]; returns new sheet ids for adds.
  async structure(token, id, ops) {
    if (!ops.length) return [];
    const requests = ops.map((o) => (o.add != null
      ? { addSheet: { properties: { title: o.add } } }
      : o.rename != null
        ? { updateSheetProperties: { properties: { sheetId: o.rename, title: o.title }, fields: 'title' } }
        : { deleteSheet: { sheetId: o.remove } }));
    const r = await call(token, `${google.sheetsApi}/spreadsheets/${encodeURIComponent(id)}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests }),
    });
    return (r.replies || []).map((x) => x.addSheet?.properties?.sheetId ?? null);
  },
};

function cellName(r, c) {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return `${s}${r + 1}`;
}

// Items shared from another drive are addressed as "driveId|itemId".
const itemPath = (id) => {
  const [drive, item] = String(id).includes('|') ? String(id).split('|') : [null, id];
  return drive ? `/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item)}` : `/me/drive/items/${encodeURIComponent(item)}`;
};

const onedrive = {
  id: 'onedrive',
  label: 'OneDrive',
  authUrl: MOCK ? `${MOCK}/ms/auth` : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: MOCK ? `${MOCK}/ms/token` : 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  api: MOCK ? `${MOCK}/ms/graph/v1.0` : 'https://graph.microsoft.com/v1.0',
  scope: 'offline_access User.Read Files.ReadWrite.All',
  redirectHost: 'localhost',
  extraParams: { response_mode: 'query', prompt: 'select_account' },

  async account(token) {
    const r = await call(token, `${this.api}/me?$select=displayName,mail,userPrincipalName`);
    return { name: r.displayName || '', email: r.mail || r.userPrincipalName || '' };
  },

  toFile(it) {
    const remote = it.remoteItem;
    const src = remote || it;
    const driveId = remote?.parentReference?.driveId;
    const folder = Boolean(src.folder);
    return {
      id: driveId ? `${driveId}|${src.id}` : it.id,
      name: it.name,
      folder,
      app: folder ? null : appForFile(it.name),
      native: null,
      parent: driveId ? null : it.parentReference?.id || null,
      modified: it.lastModifiedDateTime || null,
      size: src.size ?? null,
    };
  },

  async list(token, { folder, query }) {
    const select = '$select=id,name,folder,file,size,lastModifiedDateTime,parentReference,remoteItem&$top=200';
    let url;
    if (query) url = `${this.api}/me/drive/root/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')?${select}`;
    else if (folder === 'shared') url = `${this.api}/me/drive/sharedWithMe`;
    else url = `${this.api}${folder ? itemPath(folder) : '/me/drive/root'}/children?${select}`;
    const r = await call(token, url);
    const files = r.value.map((it) => this.toFile(it)).sort((a, b) => b.folder - a.folder || a.name.localeCompare(b.name));
    if (!folder && !query) files.unshift({ id: 'shared', name: 'Shared with me', folder: true, virtual: true });
    return files;
  },

  async download(token, file) {
    const meta = await call(token, `${this.api}${itemPath(file.id)}?$select=id,name,folder,file,size,lastModifiedDateTime,parentReference`);
    const bytes = await call(token, `${this.api}${itemPath(file.id)}/content`, { raw: true });
    const f = this.toFile(meta);
    if (String(file.id).includes('|')) f.id = file.id;
    return { bytes, file: f };
  },

  async people(token, id) {
    const [meta, r] = await Promise.all([
      call(token, `${this.api}${itemPath(id)}?$select=webUrl`),
      call(token, `${this.api}${itemPath(id)}/permissions`),
    ]);
    const people = (r.value || []).map((p) => {
      const user = p.grantedToV2?.user || p.grantedTo?.user || p.grantedToIdentitiesV2?.[0]?.user || {};
      const email = user.email || p.invitation?.email || (p.link ? `Anyone with the ${p.link.scope === 'organization' ? 'organization ' : ''}link` : '');
      return { id: p.id, email, name: user.displayName || '', role: (p.roles || []).includes('owner') ? 'owner' : (p.roles || []).includes('write') ? 'edit' : 'view', inherited: Boolean(p.inheritedFrom) };
    }).filter((p) => p.email);
    return { link: meta.webUrl || null, people };
  },

  async invite(token, id, { emails, role, message }) {
    await call(token, `${this.api}${itemPath(id)}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recipients: emails.map((email) => ({ email })), message: message || undefined, requireSignIn: true, sendInvitation: true, roles: [role === 'edit' ? 'write' : 'read'] }),
    });
  },

  async remove(token, id, permissionId) {
    await call(token, `${this.api}${itemPath(id)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' });
  },

  async upload(token, { id, parent, name, bytes }) {
    const target = id
      ? `${this.api}${itemPath(id)}`
      : `${this.api}${parent && parent !== 'shared' ? itemPath(parent) : '/me/drive/root'}:/${encodeURIComponent(name)}:`;
    let r;
    if (bytes.length <= 4 * 1024 * 1024) {
      r = await call(token, `${target}/content`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
    } else {
      // Large files go through an upload session in chunks (multiples of 320 KiB).
      const session = await call(token, `${target}/createUploadSession`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
      });
      const chunk = 320 * 1024 * 16;
      for (let start = 0; start < bytes.length; start += chunk) {
        const end = Math.min(start + chunk, bytes.length);
        const res = await fetch(session.uploadUrl, {
          method: 'PUT',
          headers: { 'content-range': `bytes ${start}-${end - 1}/${bytes.length}` },
          body: bytes.subarray(start, end),
        });
        if (!res.ok && res.status !== 202) throw new ApiError(res.status, `Upload failed (${res.status}).`);
        if (end === bytes.length) r = await res.json();
      }
    }
    const f = this.toFile(r);
    if (id && String(id).includes('|')) f.id = id;
    return f;
  },
};

module.exports = { providers: { google, onedrive }, sheetsLive, ApiError };
