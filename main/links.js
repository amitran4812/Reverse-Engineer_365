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

module.exports = { fetchLink, pageText };
