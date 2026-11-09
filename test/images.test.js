'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function server(routes) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.push({ path: url.pathname, q: Object.fromEntries(url.searchParams), agent: req.headers['user-agent'] });
    const route = routes[url.pathname];
    if (!route) {
      res.writeHead(404);
      return res.end();
    }
    const [type, body] = route(url);
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, seen, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('photos come from Openverse with a credit, skip dead links and ones already used', async () => {
  let base = '';
  const s = await server({
    '/openverse/': () => ['application/json', JSON.stringify({ results: [
      { url: `${base}/used.png`, thumbnail: '', title: 'Used', creator: 'A', license: 'by', license_version: '2.0', foreign_landing_url: 'https://openverse.example/used', width: 1600, height: 900 },
      { url: `${base}/dead.png`, thumbnail: `${base}/thumb.png`, title: 'Rooftop <b>panels</b>', creator: 'Sam Lee', license: 'by-sa', license_version: '4.0', foreign_landing_url: 'https://openverse.example/roof', width: 2000, height: 1300 },
    ] })],
    '/thumb.png': () => ['image/png', PNG],
    '/used.png': () => ['image/png', PNG],
  });
  base = s.base;
  process.env.REA_IMAGES_MOCK = base;
  delete require.cache[require.resolve('../main/images')];
  const images = require('../main/images');
  try {
    const got = await images.find('solar panels  on a roof', ['https://openverse.example/used']);
    assert.equal(got.src, `data:image/png;base64,${PNG.toString('base64')}`);
    assert.equal(got.credit, '“Rooftop panels” by Sam Lee, CC BY-SA 4.0');
    assert.equal(got.link, 'https://openverse.example/roof');
    const q = s.seen[0].q;
    assert.equal(q.q, 'solar panels on a roof');
    assert.equal(q.license_type, 'commercial,modification');
    assert.match(s.seen[0].agent, /^Work\//);
    assert.equal(images.licence('cc0'), 'CC0');
  } finally {
    s.srv.close();
  }
});

test('Wikimedia Commons is asked when Openverse has nothing', async () => {
  let base = '';
  const s = await server({
    '/openverse/': () => ['application/json', JSON.stringify({ results: [] })],
    '/commons': () => ['application/json', JSON.stringify({ query: { pages: {
      7: { index: 1, title: 'File:Wind farm.jpg', imageinfo: [{ thumburl: `${base}/wind.png`, url: `${base}/wind-full.png`, thumbwidth: 1600, thumbheight: 1000, mime: 'image/png', descriptionurl: 'https://commons.example/wind', extmetadata: { Artist: { value: '<a href="x">Jo</a>' }, LicenseShortName: { value: 'CC BY 3.0' } } }] },
    } } })],
    '/wind.png': () => ['image/png', PNG],
  });
  base = s.base;
  process.env.REA_IMAGES_MOCK = base;
  delete require.cache[require.resolve('../main/images')];
  const images = require('../main/images');
  try {
    const got = await images.find('wind farm');
    assert.equal(got.credit, '“Wind farm” by Jo, CC BY 3.0');
    assert.equal(got.link, 'https://commons.example/wind');
    assert.deepEqual((await images.find('  ')).error, 'Nothing to search for.');
  } finally {
    s.srv.close();
    delete process.env.REA_IMAGES_MOCK;
  }
});
