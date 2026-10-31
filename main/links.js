'use strict';

// Reads a public web page for "Notes from a link": fetches the page with a
// time and size limit and returns its readable text for the AI to summarize.

// Readable text from a web page's HTML: title plus body text, without
// scripts, styles, navigation chrome or runs of whitespace.
function pageText(html, limit = 120000) {
  const src = String(html || '');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src)?.[1]?.trim() || '';
  const body = src
    .replace(/<(head|script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return { title: decode(title), text: body.slice(0, limit) };
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}


// YouTube: the watch page lists caption tracks; the chosen track's text is
// the transcript. Videos without captions can't be read this way.
const YOUTUBE = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)$/i;

function youtubeId(raw) {
  let url = raw;
  if (typeof raw === 'string') {
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
  }
  if (!YOUTUBE.test(url.hostname)) return null;
  if (/youtu\.be$/i.test(url.hostname)) return url.pathname.slice(1).split('/')[0] || null;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const m = /^\/(?:shorts|live|embed)\/([\w-]{6,})/.exec(url.pathname);
  return m ? m[1] : null;
}

// Caption tracks from a watch page, English first, then manual over automatic.
function captionTracks(html) {
  const m = /"captionTracks":(\[.*?\])\s*,\s*"/s.exec(String(html || ''));
  if (!m) return [];
  let tracks;
  try {
    tracks = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const score = (t) => (/^en/.test(t.languageCode) ? 0 : 2) + (t.kind === 'asr' ? 1 : 0);
  return tracks.filter((t) => t.baseUrl).sort((a, b) => score(a) - score(b));
}

// Transcript text from a json3 caption file, with a line break at pauses.
function captionText(json) {
  const out = [];
  let last = 0;
  for (const ev of json?.events || []) {
    const text = (ev.segs || []).map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    out.push((ev.tStartMs - last > 4000 && out.length ? '\n' : ' ') + text);
    last = ev.tStartMs + (ev.dDurationMs || 0);
  }
  return out.join('').replace(/^ /, '').replace(/ ?\n ?/g, '\n');
}

async function youtubeTranscript(id, signal) {
  const page = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en`, {
    signal,
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'accept-language': 'en', cookie: 'CONSENT=YES+1' },
  });
  if (!page.ok) return { ok: false, message: `YouTube answered with error ${page.status}.` };
  const html = await page.text();
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/ - YouTube$/, '').trim();
  const track = captionTracks(html)[0];
  if (!track) return { ok: false, message: 'That video has no captions to read. Download the recording and use Transcribe a recording, or paste its transcript.' };
  const res = await fetch(`${track.baseUrl}&fmt=json3`, { signal });
  const text = res.ok ? captionText(await res.json().catch(() => null)) : '';
  if (!text) return { ok: false, message: 'YouTube didn’t send the captions for that video. Try again later, or paste its transcript.' };
  return { ok: true, url: `https://www.youtube.com/watch?v=${id}`, title, text: text.slice(0, 200000), kind: 'video' };
}

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT = 20000;

async function fetchLink(raw) {
  let url;
  try {
    url = new URL(String(raw || '').trim());
  } catch {
    return { ok: false, message: 'That doesn’t look like a web address.' };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, message: 'Only http and https links can be read.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const video = youtubeId(url);
    if (video) return await youtubeTranscript(video, controller.signal);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (Work notes)', accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
    });
    if (!res.ok) return { ok: false, message: res.status === 401 || res.status === 403 ? 'That page needs a sign-in, so it can’t be read from here.' : `The page answered with error ${res.status}.` };
    const type = res.headers.get('content-type') || '';
    if (!/text\/|html|xml|json/.test(type)) return { ok: false, message: 'That link isn’t a web page (it looks like a file). Open it and paste the text you need.' };
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      chunks.push(chunk);
      if (size > MAX_BYTES) break;
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const page = /html|xml/.test(type) ? pageText(body) : { title: '', text: body.slice(0, 120000) };
    if (page.text.length < 80) return { ok: false, message: 'That page has almost no text to read. It may need a sign-in or run as an app.' };
    return { ok: true, url: res.url || url.href, title: page.title, text: page.text };
  } catch (err) {
    return { ok: false, message: err?.name === 'AbortError' ? 'The page took too long to answer.' : `Couldn’t read the page: ${err?.message || err}` };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchLink, pageText, youtubeId, captionTracks, captionText };
