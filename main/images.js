'use strict';

// Finds free photos on the web for Send to Present. Openverse first (openly
// licensed pictures you may use and change, also commercially), Wikimedia
// Commons when it has nothing. Each result comes back as a data URL with a
// credit line, since most of these licences ask for one.

const MOCK = process.env.REA_IMAGES_MOCK;
const OPENVERSE = MOCK ? `${MOCK}/openverse/` : 'https://api.openverse.org/v1/images/';
const COMMONS = MOCK ? `${MOCK}/commons` : 'https://commons.wikimedia.org/w/api.php';
const TIMEOUT = 15000;
const MAX_BYTES = 12 * 1024 * 1024;
const TYPES = /^image\/(jpeg|png|webp|gif)$/;

function agent() {
  let version = '';
  try {
    version = require('electron').app.getVersion();
  } catch {}
  // Wikimedia asks API users to say who they are.
  return `Work/${version || 'dev'} (https://github.com/amitran4812/Reverse-Engineer_365)`;
}

const get = (url, accept = 'application/json') => fetch(url, { headers: { accept, 'user-agent': agent() }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) });

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

function licence(code, version) {
  const c = String(code || '').toLowerCase();
  if (c === 'cc0') return 'CC0';
  if (c === 'pdm') return 'Public domain';
  return c ? `CC ${c.toUpperCase()}${version ? ` ${version}` : ''}` : '';
}

// A credit line: “Title” by Creator, Licence.
function credit(title, creator, lic) {
  const t = strip(title).slice(0, 60);
  return [t && `“${t}”`, creator && `by ${strip(creator).slice(0, 40)}`].filter(Boolean).join(' ') + (lic ? `${t || creator ? ', ' : ''}${lic}` : '');
}

async function openverse(query) {
  const q = new URLSearchParams({ q: query, page_size: '8', license_type: 'commercial,modification', mature: 'false' });
  const res = await get(`${OPENVERSE}?${q}`);
  if (!res.ok) throw new Error(`Openverse returned ${res.status}.`);
  const data = await res.json();
  return (data.results || []).filter((r) => r.url).map((r) => ({
    urls: [r.url, r.thumbnail].filter(Boolean),
    w: r.width || 0,
    h: r.height || 0,
    credit: credit(r.title, r.creator, licence(r.license, r.license_version)),
    link: r.foreign_landing_url || r.url,
  }));
}

async function commons(query) {
  const q = new URLSearchParams({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${query} filetype:bitmap`, gsrlimit: '8',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1600', iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName', origin: '*',
  });
  const res = await get(`${COMMONS}?${q}`);
  if (!res.ok) throw new Error(`Wikimedia Commons returned ${res.status}.`);
  const data = await res.json();
  return Object.values(data.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => {
    const ii = p.imageinfo?.[0] || {};
    const meta = ii.extmetadata || {};
    return {
      urls: [ii.thumburl, ii.url].filter(Boolean),
      w: ii.thumbwidth || ii.width || 0,
      h: ii.thumbheight || ii.height || 0,
      credit: credit(meta.ObjectName?.value || String(p.title || '').replace(/^File:|\.\w+$/g, ''), meta.Artist?.value, strip(meta.LicenseShortName?.value)),
      link: ii.descriptionurl || ii.url,
      mime: ii.mime,
    };
  }).filter((r) => r.urls.length && (!r.mime || TYPES.test(r.mime)));
}

async function download(url) {
  const res = await get(url, 'image/*');
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!res.ok || !TYPES.test(type)) return null;
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return `data:${type};base64,${buf.toString('base64')}`;
}

// Photos are fairly wide by default; prefer ones that aren't tiny or extreme in shape.
const usable = (r) => (!r.w || !r.h || (r.w >= 400 && r.h >= 300 && r.w / r.h < 3.2 && r.h / r.w < 2.2));

// The first photo for the query that downloads, skipping the links in skip.
// Resolves to { src, credit, link } or { error }.
async function find(query, skip = []) {
  const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!q) return { error: 'Nothing to search for.' };
  const seen = new Set(Array.isArray(skip) ? skip : []);
  let failed = null;
  for (const source of [openverse, commons]) {
    let list = [];
    try {
      list = (await source(q)).filter((r) => !seen.has(r.link));
    } catch (err) {
      failed = err;
      continue;
    }
    for (const r of [...list.filter(usable), ...list.filter((x) => !usable(x))].slice(0, 5)) {
      for (const url of r.urls) {
        try {
          const src = await download(url);
          if (src) return { src, credit: r.credit, link: r.link };
        } catch (err) {
          failed = err;
        }
      }
    }
  }
  if (failed && /fetch failed|ENOTFOUND|ECONN|Timeout|aborted/i.test(`${failed.name} ${failed.message} ${failed.cause?.code || ''}`)) return { error: 'offline' };
  return { error: 'No photo found.' };
}

module.exports = { find, credit, licence };
