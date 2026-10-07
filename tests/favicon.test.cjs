'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { normalizeFaviconURL, pickFaviconURL, faviconCandidates, createImageDecoder, FaviconController, MAX_IMAGE_BYTES } = require('../electron/favicon.cjs');

test('favicon URLs accept remote images and safe data images only', () => {
  assert.equal(normalizeFaviconURL('https://example.com/favicon.ico#icon'), 'https://example.com/favicon.ico');
  assert.equal(normalizeFaviconURL('http://example.com/icon.png?v=1'), 'http://example.com/icon.png?v=1');
  assert.match(normalizeFaviconURL('data:image/png;base64,AAAA'), /^data:image\/png/);
  assert.equal(normalizeFaviconURL('javascript:alert(1)'), '');
  assert.equal(normalizeFaviconURL('file:///etc/passwd'), '');
  assert.equal(normalizeFaviconURL('data:text/html,<script>alert(1)</script>'), '');
  assert.equal(normalizeFaviconURL('https://user:pass@example.com/icon.png'), '');
});

test('favicon selection skips unusable candidates and keeps the first safe one', () => {
  assert.equal(pickFaviconURL(['javascript:bad', 'https://example.com/favicon.png#v2', 'https://other.test/icon.png']), 'https://example.com/favicon.png');
  assert.equal(pickFaviconURL(['file:///tmp/favicon.ico', 'data:text/plain,nope']), '');
});

const PNG = 'data:image/png;base64,YQ==';
function fixture(fetch = async () => new Response('icon', { headers: { 'Content-Type': 'image/png' } }), decode = async () => PNG) {
  const changes = [];
  let allowed = true;
  const controller = new FaviconController({ session: { fetch }, decode, onChange: (id, value) => changes.push({ id, value }), canFetch: () => allowed });
  const wc = new EventEmitter();
  wc.url = 'https://example.test/page'; wc.getURL = () => wc.url; wc.isDestroyed = () => false;
  controller.attach(wc, 'tab');
  return { controller, wc, state: controller.tabs.get('tab'), changes, pause: () => { allowed = false; controller.cancelAll(); } };
}

test('favicon candidates are bounded, deduplicated, and have a same-origin fallback', () => {
  assert.deepEqual(faviconCandidates(['javascript:bad', 'https://cdn.test/icon.png', 'https://cdn.test/icon.png'], 'https://example.test/path'), ['https://cdn.test/icon.png', 'https://example.test/favicon.ico']);
  assert.deepEqual(faviconCandidates([], 'file:///tmp/secret'), []);
  assert.equal(normalizeFaviconURL(`https://example.test/${'x'.repeat(8192)}`), '');
});

test('session fetch carries browsing credentials and referrer; shell receives only decoded PNG', async () => {
  const calls = [];
  const f = fixture(async (url, options) => { calls.push({ url, options }); return new Response('bytes'); });
  await f.controller.load(f.state, ['https://cdn.test/favicon.png']);
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.referrer, f.wc.url);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(f.changes.at(-1).value, PNG);
  assert.equal(f.state.icon, PNG);
});

test('cached icon survives reload, empty updates, failed fetches, and subframe navigation', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; if (calls > 1) throw new Error('temporary network failure'); return new Response('icon'); });
  await f.controller.load(f.state, ['https://example.test/icon.png']);
  f.wc.emit('did-start-loading');
  f.wc.emit('did-start-navigation', {}, 'https://other.test/frame', false, false);
  assert.equal(f.state.icon, PNG);
  f.wc.emit('did-start-navigation', {}, f.wc.url, false, true);
  assert.equal(f.state.icon, PNG);
  await f.controller.load(f.state, ['https://example.test/icon.png']);
  assert.equal(calls, 1, 'decoded image reused on reload');
  await f.controller.load(f.state, []);
  assert.equal(f.state.icon, PNG);
  assert.equal(f.changes.some(change => change.value === ''), false);
});

test('cross-origin navigation clears icon and rejects old asynchronous responses', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const loading = f.controller.load(f.state, ['https://example.test/slow.png']);
  f.wc.emit('did-start-navigation', {}, 'https://new.test/', false, true);
  assert.equal(f.changes.at(-1).value, '');
  finish(new Response('old icon'));
  await loading;
  assert.equal(f.state.origin, 'https://new.test');
  assert.equal(f.state.icon, '');
  assert.deepEqual(f.changes, [{ id: 'tab', value: '' }]);
});

test('bad candidates fall back without admitting oversized responses or unsafe redirects', async () => {
  const urls = [];
  const f = fixture(async url => {
    urls.push(url);
    if (url.includes('/large')) return new Response('a', { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } });
    if (url.includes('/redirect')) return new Response('', { status: 302, headers: { location: 'file:///tmp/secret' } });
    return new Response('fallback');
  });
  await f.controller.load(f.state, ['https://example.test/large.png', 'https://example.test/redirect.png']);
  assert.deepEqual(urls, ['https://example.test/large.png', 'https://example.test/redirect.png', 'https://example.test/favicon.ico']);
  assert.equal(f.state.icon, PNG);
});

test('streaming response limit is enforced even without a content-length header', async () => {
  let decoded = 0;
  const f = fixture(async () => new Response(new Uint8Array(MAX_IMAGE_BYTES + 1)), async () => { decoded++; return PNG; });
  await f.controller.load(f.state, []);
  assert.equal(decoded, 0);
  assert.equal(f.state.icon, '');
});

test('proxy transition cancels in-flight work and prevents new favicon requests', async () => {
  let finish, calls = 0;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const loading = f.controller.load(f.state, ['https://example.test/icon.png']);
  f.pause();
  finish(new Response('icon'));
  await loading;
  await f.controller.load(f.state, []);
  assert.equal(calls, 1);
  assert.equal(f.state.icon, '');
  assert.equal(f.changes.length, 0);
});

test('closing a tab cancels pending work and removes its event listeners', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const loading = f.controller.load(f.state, []);
  f.wc.emit('destroyed');
  finish(new Response('icon'));
  await loading;
  assert.equal(f.controller.tabs.size, 0);
  assert.equal(f.wc.listenerCount('page-favicon-updated'), 0);
  assert.equal(f.changes.length, 0);
});

test('SVG rasterization uses owned decoder contents and never the website context', async () => {
  let acquired = 0, executions = 0;
  const empty = { isEmpty: () => true };
  const decoded = { isEmpty: () => false, getSize: () => ({ width: 32, height: 32 }), resize: () => ({ toPNG: () => Buffer.from('a') }) };
  const nativeImage = { createFromBuffer: () => empty, createFromDataURL: () => decoded };
  const decoder = createImageDecoder(nativeImage, async () => {
    acquired++;
    return { isDestroyed: () => false, executeJavaScriptInIsolatedWorld: async (world, scripts) => {
      executions++; assert.equal(world, 1003); assert.match(scripts[0].code, /data:image\/svg\+xml;base64,/); return PNG;
    } };
  });
  const icon = await decoder(Buffer.from('<svg/>'), { mime: 'image/svg+xml', webContents: { executeJavaScriptInIsolatedWorld: () => { throw new Error('Must not execute in a website.'); } } });
  assert.equal(icon, PNG);
  assert.equal(acquired, 1); assert.equal(executions, 1);
});

test('native PNG decoding does not create the auxiliary decoder contents', async () => {
  const decoded = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), resize: () => ({ toPNG: () => Buffer.from('a') }) };
  const decoder = createImageDecoder({ createFromBuffer: () => decoded }, () => { throw new Error('Decoder should be lazy.'); });
  assert.equal(await decoder(Buffer.from('png'), { mime: 'image/png' }), PNG);
});
