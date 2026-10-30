'use strict';

// Live data for Plot's formulas, fetched in the main process (the renderer can't reach the network):
// quotes and price history for GOOGLEFINANCE, web pages and files for IMPORT*, ranges of other
// Google Sheets for IMPORTRANGE, and translations for GOOGLETRANSLATE / DETECTLANGUAGE.
// Market data comes from Yahoo Finance's public chart endpoint; Google has no public finance API.

const MOCK = process.env.REA_WEB_MOCK;
const CHART = MOCK ? `${MOCK}/chart/` : 'https://query1.finance.yahoo.com/v8/finance/chart/';
const TRANSLATE = MOCK ? `${MOCK}/translate` : 'https://translate.googleapis.com/translate_a/single';
const MAX_BYTES = 10 * 1024 * 1024;
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', accept: '*/*' };

// Google Finance exchange prefixes -> Yahoo symbol suffixes.
const SUFFIX = {
  NASDAQ: '', NYSE: '', NYSEARCA: '', NYSEAMERICAN: '', NYSEMKT: '', AMEX: '', BATS: '', OTCMKTS: '', OTC: '', MUTF: '',
  NSE: '.NS', BOM: '.BO', BSE: '.BO', LON: '.L', TSE: '.TO', TSX: '.TO', CVE: '.V', ASX: '.AX', HKG: '.HK', TYO: '.T',
  FRA: '.F', ETR: '.DE', XETRA: '.DE', EPA: '.PA', AMS: '.AS', EBR: '.BR', BIT: '.MI', BME: '.MC', SWX: '.SW', VTX: '.SW',
  STO: '.ST', CPH: '.CO', HEL: '.HE', OSL: '.OL', SHA: '.SS', SHE: '.SZ', KRX: '.KS', KOSDAQ: '.KQ', TPE: '.TW', SGX: '.SI',
  BMV: '.MX', BVMF: '.SA', JSE: '.JO', NZE: '.NZ', IST: '.IS', TLV: '.TA', WSE: '.WA', ELI: '.LS', VIE: '.VI', IDX: '.JK',
  KLSE: '.KL', SET: '.BK', TADAWUL: '.SR', BCBA: '.BA',
};
const INDEXES = {
  '.INX': '^GSPC', '.DJI': '^DJI', '.IXIC': '^IXIC', NDX: '^NDX', '.NDX': '^NDX', RUT: '^RUT', VIX: '^VIX', NIFTY_50: '^NSEI', 'NIFTY 50': '^NSEI',
  NIFTY_BANK: '^NSEBANK', SENSEX: '^BSESN', UKX: '^FTSE', DAX: '^GDAXI', PX1: '^FCHI', NI225: '^N225', HSI: '^HSI', '000001': '000001.SS',
};
const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'LTC', 'BNB', 'DOT', 'USDT', 'USDC']);

function yahooSymbol(ticker) {
  const t = String(ticker).trim().toUpperCase();
  let m = /^CURRENCY:([A-Z]{3,5})([A-Z]{3})$/.exec(t);
  if (m) {
    if (CRYPTO.has(m[1])) return `${m[1]}-${m[2]}`;
    return `${m[1]}${m[2]}=X`;
  }
  m = /^([A-Z]+):(.+)$/.exec(t);
  if (m) {
    if (m[1].startsWith('INDEX')) return INDEXES[m[2]] || `^${m[2].replace(/^\./, '')}`;
    const suffix = SUFFIX[m[1]];
    if (suffix === undefined) return m[2];
    return suffix === '' ? m[2].replace(/\./g, '-') : `${m[2]}${suffix}`;
  }
  return INDEXES[t] || t;
}

async function get(url, what) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) {
    let msg = `${what} returned ${res.status}.`;
    try {
      const j = await res.json();
      if (j?.chart?.error?.description) msg = j.chart.error.description;
    } catch {}
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return res;
}

const serial = (unix, offset = 0) => (unix + offset) / 86400 + 25569;

async function chart(symbol, params) {
  const sym = yahooSymbol(symbol);
  const res = await get(`${CHART}${encodeURIComponent(sym)}?${new URLSearchParams(params)}`, 'The market data service').catch((e) => {
    if (e.status === 404) throw new Error(`GOOGLEFINANCE couldn't find "${symbol}".`);
    throw e;
  });
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(j?.chart?.error?.description || `No market data for "${symbol}".`);
  return r;
}

async function quote(symbol) {
  const r = await chart(symbol, { range: '1y', interval: '1d', includePrePost: 'false' });
  const m = r.meta || {};
  const q = r.indicators?.quote?.[0] || {};
  const closes = (q.close || []).filter((v) => v != null);
  const volumes = (q.volume || []).filter((v) => v != null);
  const ts = r.timestamp || [];
  const offset = m.gmtoffset || 0;
  const lastDay = ts.length ? Math.floor(serial(ts[ts.length - 1], offset)) : null;
  const tradeDay = m.regularMarketTime ? Math.floor(serial(m.regularMarketTime, offset)) : null;
  const price = m.regularMarketPrice ?? closes[closes.length - 1] ?? null;
  const prev = m.previousClose ?? (closes.length > 1 ? closes[lastDay === tradeDay ? closes.length - 2 : closes.length - 1] : m.chartPreviousClose) ?? null;
  const back = (weeks) => {
    if (!ts.length || price == null) return null;
    const target = ts[ts.length - 1] - weeks * 7 * 86400;
    let i = ts.findIndex((t) => t >= target);
    if (i < 0) return null;
    while (i < ts.length && q.close?.[i] == null) i += 1;
    const then = q.close?.[i];
    return then ? ((price - then) / then) * 100 : null;
  };
  const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
  return {
    price,
    open: q.open?.[q.open.length - 1] ?? null,
    high: m.regularMarketDayHigh ?? q.high?.[q.high.length - 1] ?? null,
    low: m.regularMarketDayLow ?? q.low?.[q.low.length - 1] ?? null,
    volume: m.regularMarketVolume ?? volumes[volumes.length - 1] ?? null,
    volumeAvg: avg(volumes.slice(-30)),
    high52: m.fiftyTwoWeekHigh ?? (closes.length ? Math.max(...closes) : null),
    low52: m.fiftyTwoWeekLow ?? (closes.length ? Math.min(...closes) : null),
    closeYest: prev,
    change: price != null && prev != null ? price - prev : null,
    changePct: price != null && prev ? ((price - prev) / prev) * 100 : null,
    tradeTime: m.regularMarketTime ? serial(m.regularMarketTime, offset) : null,
    dataDelay: m.exchangeDataDelayedBy ?? 0,
    currency: m.currency ?? null,
    name: m.longName || m.shortName || null,
    exchange: m.fullExchangeName || m.exchangeName || null,
    return1: back(1),
    return4: back(4),
    return13: back(13),
    return52: back(52),
    marketCap: null,
    pe: null,
    eps: null,
    beta: null,
    shares: null,
  };
}

// Rows of [date, open, high, low, close, volume]; dates are serials at the 4pm close, like Google's.
async function history(symbol, from, to, interval) {
  const p1 = Math.round((from - 25569) * 86400);
  const p2 = Math.round((to - 25569) * 86400);
  const r = await chart(symbol, { period1: String(p1), period2: String(p2), interval: interval === 'weekly' ? '1wk' : '1d', events: 'history' });
  const q = r.indicators?.quote?.[0] || {};
  const offset = r.meta?.gmtoffset || 0;
  return (r.timestamp || []).map((t, i) => [Math.floor(serial(t, offset)) + 16 / 24, q.open?.[i], q.high?.[i], q.low?.[i], q.close?.[i], q.volume?.[i]])
    .filter((row) => row[4] != null && row[0] >= from && row[0] < to);
}

async function text(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links can be imported.');
  const res = await get(url, 'The site');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('The page is larger than 10 MB.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('The page is larger than 10 MB.');
  const type = res.headers.get('content-type') || '';
  const charset = /charset=([\w-]+)/i.exec(type)?.[1];
  let body;
  try {
    body = new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    body = buf.toString('utf8');
  }
  return { text: body, type };
}

async function translate({ text: t, from = 'auto', to = 'en' }) {
  const params = new URLSearchParams({ client: 'gtx', sl: from || 'auto', tl: to || 'en', dt: 't', q: t });
  const res = await get(`${TRANSLATE}?${params}`, 'The translation service');
  const j = await res.json();
  return { text: (j?.[0] || []).map((s) => s?.[0] || '').join(''), lang: j?.[2] || null };
}

async function data(kind, params = {}) {
  switch (kind) {
    case 'quote': return quote(params.symbol);
    case 'history': return history(params.symbol, Number(params.from), Number(params.to), params.interval);
    case 'text': return text(String(params.url || ''));
    case 'translate': return translate(params);
    case 'range': return require('./cloud').importRange(params.key, params.range);
    default: throw new Error(`Unknown data request: ${kind}`);
  }
}

module.exports = { data, yahooSymbol };
