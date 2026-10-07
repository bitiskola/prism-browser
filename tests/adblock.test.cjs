'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { AdblockController, normalizeAdblockSettings, createCoreEngine } = require('../electron/adblock.cjs');

const FILTERS = `[Adblock Plus 2.0]
! Last modified: offline fixture
||ads.example^
@@||ads.example/allowed^
/slot-ad.$image,third-party
||conditional.example^$script,domain=news.example|~special.news.example
||xhr.example^$xmlhttprequest
||socket.example^$websocket
/advertisement.js$script
@@||doc-safe.example^$document
@@||generic-safe.example^$genericblock
@@||cosmetic-safe.example^$elemhide
@@||generic-hidden-safe.example^$generichide
##.sponsor
news.example##.news-ad
news.example#@#.sponsor
generic-hidden-safe.example##.specific-ad
`;

function fakeSession() {
  return { webRequest: { listener: null, installs: 0, onBeforeRequest(filter, listener) {
    this.installs++;
    this.listener = filter === null ? null : listener;
  } } };
}

class FakeContents extends EventEmitter {
  constructor(id, url) { super(); this.id = id; this.url = url; this.destroyed = false; this.styles = new Map(); this.nextKey = 1; }
  getURL() { return this.url; }
  isDestroyed() { return this.destroyed; }
  isLoadingMainFrame() { return this.loading === true; }
  async insertCSS(css) { const key = String(this.nextKey++); this.styles.set(key, css); return key; }
  async removeInsertedCSS(key) { this.styles.delete(key); }
}

async function setup(settings = { enabled: true, allowlist: [], blocklist: [] }, filterText = FILTERS) {
  const controller = new AdblockController({ settings, filterText });
  const session = fakeSession();
  await controller.initialize(session);
  assert.equal(controller.ready, true, controller.error);
  return { controller, session };
}

function request(url, overrides = {}) {
  return { url, resourceType: 'script', webContentsId: 12, referrer: 'https://news.example/article', ...overrides };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('ad blocker settings canonicalize and deduplicate lists without exposing mutable state', async () => {
  assert.deepEqual(normalizeAdblockSettings({ allowlist: [' News.EXAMPLE. ', 'https://news.example/'], blocklist: ['bücher.example'] }), {
    enabled: true, allowlist: ['news.example'], blocklist: ['xn--bcher-kva.example'],
  });
  const { controller } = await setup();
  controller.getState().blocklist.push('injected.example');
  assert.deepEqual(controller.getSettings().blocklist, []);
  controller.dispose();
});

test('ad blocker rejects invalid switches, wildcard rules, paths, credentials and excessive lists', () => {
  for (const value of [null, [], true, { enabled: 'false' }, { allowlist: '*.example.com' }, { blocklist: ['*.example.com'] },
    { allowlist: ['example.com/path'] }, { blocklist: ['https://secret@host.example'] }, { allowlist: Array(501).fill('x.example') }]) {
    assert.throws(() => normalizeAdblockSettings(value), undefined, JSON.stringify(value));
  }
});

test('real ABP core matches URL boundaries and resource exceptions', async () => {
  const { controller } = await setup();
  assert.equal(controller.shouldBlock(request('https://ads.example/script.js')), true);
  assert.equal(controller.shouldBlock(request('https://child.ads.example/script.js')), true);
  assert.equal(controller.shouldBlock(request('https://notads.example/script.js')), false);
  assert.equal(controller.shouldBlock(request('https://ads.example.unrelated.test/script.js')), false);
  assert.equal(controller.shouldBlock(request('https://ads.example/allowed/file.js')), false);
  controller.dispose();
});

test('ABP third-party and resource-type filters use request context', async () => {
  const { controller } = await setup();
  assert.equal(controller.shouldBlock(request('https://cdn.example/slot-ad.png', { resourceType: 'image' })), true);
  assert.equal(controller.shouldBlock(request('https://news.example/slot-ad.png', { resourceType: 'image' })), false);
  assert.equal(controller.shouldBlock(request('https://cdn.example/slot-ad.png', { resourceType: 'script' })), false);
  assert.equal(controller.shouldBlock(request('https://xhr.example/endpoint', { resourceType: 'xhr' })), true);
  assert.equal(controller.shouldBlock(request('https://xhr.example/endpoint', { resourceType: 'image' })), false);
  assert.equal(controller.shouldBlock(request('wss://socket.example/channel', { resourceType: 'webSocket' })), true);
  controller.dispose();
});

test('domain-restricted filter uses an iframe document and exclusions', async () => {
  const { controller } = await setup();
  assert.equal(controller.shouldBlock(request('https://conditional.example/js')), true);
  assert.equal(controller.shouldBlock(request('https://conditional.example/js', { frame: { url: 'https://special.news.example/frame' } })), false);
  assert.equal(controller.shouldBlock(request('https://conditional.example/js', { frame: { url: 'https://unrelated.example/frame' } })), false);
  controller.dispose();
});

test('master switch stops both EasyList and explicit denied destinations', async () => {
  const { controller } = await setup({ enabled: false, allowlist: [], blocklist: ['custom.example'] });
  assert.equal(controller.shouldBlock(request('https://ads.example/js')), false);
  assert.equal(controller.shouldBlock(request('https://custom.example/')), false);
  controller.apply({ ...controller.getSettings(), enabled: true });
  assert.equal(controller.shouldBlock(request('https://ads.example/js')), true);
  assert.equal(controller.shouldBlock(request('https://custom.example/')), true);
  controller.dispose();
});

test('top-level allowlisted websites override all filters including custom blocklists', async () => {
  const { controller } = await setup({ enabled: true, allowlist: ['trusted.example'], blocklist: ['ads.example'] });
  const contents = new FakeContents(12, 'https://child.trusted.example/article');
  controller.attach(contents);
  assert.equal(controller.shouldBlock(request('https://ads.example/js', { frame: { url: 'https://untrusted-iframe.example/' } })), false);
  contents.emit('did-start-navigation', { url: 'https://nottrusted.example/', isMainFrame: true, isSameDocument: false });
  assert.equal(controller.shouldBlock(request('https://ads.example/js')), true);
  controller.dispose();
});

test('custom request-domain blocklists include direct visits and match only DNS boundaries', async () => {
  const { controller } = await setup({ enabled: true, allowlist: [], blocklist: ['blocked.example'] });
  for (const host of ['blocked.example', 'sub.blocked.example']) {
    assert.equal(controller.shouldBlock(request(`https://${host}/`, { resourceType: 'mainFrame' })), true);
  }
  for (const host of ['notblocked.example', 'blocked.example.other']) {
    assert.equal(controller.shouldBlock(request(`https://${host}/`, { resourceType: 'mainFrame' })), false);
  }
  assert.equal(controller.shouldBlock(request('https://ads.example/', { resourceType: 'mainFrame' })), false);
  controller.dispose();
});

test('navigation evaluates destination before old-page allowlist and follows redirect destinations', async () => {
  const { controller } = await setup({ enabled: true, allowlist: ['trusted.example'], blocklist: ['blocked.example'] });
  const contents = new FakeContents(12, 'https://trusted.example/');
  controller.attach(contents);
  assert.equal(controller.shouldBlock(request('https://blocked.example/', { resourceType: 'mainFrame' })), true);
  contents.emit('did-redirect-navigation', { url: 'https://untrusted.example/', isMainFrame: true });
  assert.equal(controller.shouldBlock(request('https://ads.example/script')), true);
  contents.emit('did-redirect-navigation', { url: 'https://trusted.example/', isMainFrame: true });
  assert.equal(controller.shouldBlock(request('https://ads.example/script')), false);
  controller.dispose();
});

test('late abort and old DOM-ready cannot replace a newer destination with an allowlisted page', async () => {
  const { controller } = await setup({ enabled: true, allowlist: ['trusted.example'], blocklist: [] });
  const contents = new FakeContents(12, 'https://trusted.example/');
  controller.attach(contents);
  contents.loading = true;
  contents.emit('did-start-navigation', { url: 'https://abandoned.example/', isMainFrame: true, isSameDocument: false });
  contents.emit('did-start-navigation', { url: 'https://news.example/', isMainFrame: true, isSameDocument: false });
  contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://abandoned.example/', true);
  contents.emit('dom-ready');
  contents.emit('did-stop-loading');
  assert.equal(controller.shouldBlock(request('https://ads.example/script')), true);
  contents.url = 'https://news.example/';
  contents.emit('did-navigate', {}, contents.url);
  contents.emit('dom-ready');
  assert.equal(controller.shouldBlock(request('https://ads.example/script')), true);
  await tick();
  assert.match([...contents.styles.values()].join(''), /\.news-ad/);
  controller.dispose();
  assert.equal(contents.listenerCount('did-navigate'), 0);
  assert.equal(contents.listenerCount('did-stop-loading'), 0);
});

test('a stopped current navigation restores filtering for the document that remains visible', async () => {
  const { controller } = await setup({ enabled: true, allowlist: ['trusted.example'], blocklist: [] });
  const contents = new FakeContents(12, 'https://news.example/');
  controller.attach(contents);
  contents.loading = true;
  contents.emit('did-start-navigation', { url: 'https://trusted.example/', isMainFrame: true, isSameDocument: false });
  contents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://trusted.example/', true);
  contents.loading = false;
  contents.emit('did-stop-loading');
  assert.equal(controller.shouldBlock(request('https://ads.example/script')), true);
  await tick();
  assert.match([...contents.styles.values()].join(''), /\.news-ad/);
  controller.dispose();
});

test('ABP document and generic-block exceptions are honored', async () => {
  const { controller } = await setup();
  assert.equal(controller.shouldBlock(request('https://ads.example/js', { referrer: 'https://doc-safe.example/' })), false);
  assert.equal(controller.shouldBlock(request('https://cdn.example/advertisement.js', { referrer: 'https://generic-safe.example/' })), false);
  assert.equal(controller.shouldBlock(request('https://cdn.example/advertisement.js')), true);
  controller.dispose();
});

test('unattributable worker requests and non-web URLs fail open', async () => {
  const { controller } = await setup();
  assert.equal(controller.shouldBlock(request('https://ads.example/js', { webContentsId: -1, referrer: '' })), false);
  assert.equal(controller.shouldBlock(request('https://ads.example/js', { webContentsId: -1, referrer: 'https://news.example' })), true);
  for (const url of ['file:///tmp/ads.example', 'data:text/plain,ads.example', 'invalid']) {
    assert.equal(controller.shouldBlock(request(url)), false);
  }
  controller.dispose();
});

test('single Electron request handler cancels matched traffic, counts it and releases on dispose', async () => {
  const { controller, session } = await setup();
  await controller.initialize(session);
  assert.equal(session.webRequest.installs, 1);
  let calls = 0;
  session.webRequest.listener(request('https://ads.example/script'), response => { calls++; assert.deepEqual(response, { cancel: true }); });
  session.webRequest.listener(request('https://normal.example/script'), response => { calls++; assert.deepEqual(response, { cancel: false }); });
  assert.equal(calls, 2);
  assert.equal(controller.getState().blockedCount, 1);
  controller.dispose();
  assert.equal(session.webRequest.listener, null);
});

test('filter initialization failure is reported and cannot masquerade as working protection', async () => {
  const controller = new AdblockController({ filterText: '' });
  const session = fakeSession();
  await controller.initialize(session);
  assert.equal(controller.getState().ready, false);
  assert.match(controller.getState().error, /empty/);
  assert.equal(controller.shouldBlock(request('https://ads.example/js')), false);
  controller.dispose();
});

test('fatal proxy transport guard overrides disabled and allowlisted ad blocker state without ad counts', async () => {
  let locked = true;
  const controller = new AdblockController({ settings: { enabled: false, allowlist: ['news.example'], blocklist: [] },
    filterText: FILTERS, shouldBlockRequest: () => locked });
  const session = fakeSession();
  await controller.initialize(session);
  session.webRequest.listener(request('https://ordinary.example/'), result => assert.deepEqual(result, { cancel: true }));
  assert.equal(controller.blockedCount, 0);
  locked = false;
  session.webRequest.listener(request('https://ordinary.example/'), result => assert.deepEqual(result, { cancel: false }));
  controller.shouldBlockRequest = () => { throw new Error('unavailable proxy state'); };
  session.webRequest.listener(request('https://ordinary.example/'), result => assert.deepEqual(result, { cancel: true }));
  controller.dispose();
});

test('core generates standard cosmetic CSS and respects element and page exceptions', async () => {
  const engine = await createCoreEngine(FILTERS);
  assert.match(engine.styleSheet('https://ordinary.example/'), /\.sponsor/);
  assert.match(engine.styleSheet('https://news.example/'), /\.news-ad/);
  assert.doesNotMatch(engine.styleSheet('https://news.example/'), /\.sponsor/);
  assert.equal(engine.styleSheet('https://cosmetic-safe.example/'), '');
  assert.equal(engine.styleSheet('https://doc-safe.example/'), '');
  assert.doesNotMatch(engine.styleSheet('https://generic-hidden-safe.example/'), /\.sponsor/);
  assert.match(engine.styleSheet('https://generic-hidden-safe.example/'), /\.specific-ad/);
});

test('cosmetic CSS is removed when master off or page allowlisted without reloading', async () => {
  const { controller } = await setup();
  const contents = new FakeContents(12, 'https://news.example/article');
  controller.attach(contents);
  contents.emit('dom-ready');
  await tick();
  assert.equal(contents.styles.size, 1);
  controller.apply({ enabled: false, allowlist: [], blocklist: [] });
  await tick();
  assert.equal(contents.styles.size, 0);
  controller.apply({ enabled: true, allowlist: [], blocklist: [] });
  await tick();
  assert.equal(contents.styles.size, 1);
  controller.apply({ enabled: true, allowlist: ['news.example'], blocklist: [] });
  await tick();
  assert.equal(contents.styles.size, 0);
  controller.dispose();
  assert.equal(contents.listenerCount('dom-ready'), 0);
});

test('late CSS insertion cannot survive an overlapping disable action', async () => {
  const { controller } = await setup();
  const contents = new FakeContents(12, 'https://news.example/article');
  let finish;
  contents.insertCSS = css => new Promise(resolve => { finish = () => { contents.styles.set('late', css); resolve('late'); }; });
  controller.attach(contents);
  contents.emit('dom-ready');
  await tick();
  assert.equal(typeof finish, 'function');
  controller.apply({ enabled: false, allowlist: [], blocklist: [] });
  finish();
  await tick();
  assert.equal(contents.styles.size, 0);
  controller.dispose();
});

test('bundled EasyList initializes offline and blocks a real advertising endpoint', async () => {
  const controller = new AdblockController();
  await controller.initialize(fakeSession());
  assert.equal(controller.ready, true, controller.error);
  assert.ok(controller.filterCount > 10000);
  assert.match(controller.listUpdatedAt, /2026/);
  assert.equal(controller.shouldBlock(request('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js')), true);
  controller.dispose();
});
