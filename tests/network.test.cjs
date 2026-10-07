'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { NetworkMonitor, LIMITS } = require('../electron/network.cjs');

async function fixture(url = 'https://selected.test/home', options = {}) {
  const wc = new EventEmitter();
  wc.url = url;
  wc.getURL = () => wc.url;
  wc.debugger = new EventEmitter();
  wc.debugger.attached = false;
  wc.debugger.isAttached = () => wc.debugger.attached;
  wc.debugger.attach = () => { wc.debugger.attached = true; };
  wc.debugger.detach = () => { throw new Error('Monitor must not detach the shared debugger'); };
  const commands = [];
  wc.debugger.sendCommand = async (name, params, session) => {
    commands.push({ name, params, session });
    if (name === 'Network.enable') options.onNetworkEnable?.(wc);
    if (name === 'Page.getFrameTree') return { frameTree: { frame: { id: 'top', url: wc.url }, childFrames: options.childFrames || [] } };
    if (name === 'Network.getResponseBody') return options.getBody ? options.getBody(params) : { body: '{"ok":true}', base64Encoded: false };
    return {};
  };
  let rules = [{ host: 'selected.test', includeSubdomains: false, monitor: true }];
  const events = [];
  const monitor = new NetworkMonitor({ emit: options.quiet ? () => {} : (name, entry) => events.push({ name, entry }), getRules: () => rules });
  await monitor.attach(wc, 'tab1');
  const send = (method, params, session = '') => monitor.handleMessage('tab1', method, params, session);
  const request = (id, extras = {}, session = '') => send('Network.requestWillBeSent', {
    requestId: id, timestamp: 10, wallTime: 1700000000, type: 'Fetch', frameId: 'top',
    documentURL: wc.url, request: { url: `https://cdn.other.test/${id}`, method: 'GET', headers: {} }, ...extras,
  }, session);
  const navigate = target => { wc.url = target; wc.emit('did-start-navigation', {}, target, false, true); };
  return { wc, monitor, commands, events, send, request, navigate, setRules: value => { rules = value; } };
}

test('captures selected page third-party traffic but ignores unselected pages and disabled rules', async () => {
  const f = await fixture();
  await f.request('asset');
  assert.equal(f.monitor.getEntries().length, 1);
  assert.equal(f.monitor.getEntries()[0].pageUrl, 'https://selected.test/home');
  f.navigate('https://unselected.test/');
  await f.request('private', { request: { url: 'https://selected.test/api', method: 'GET' } });
  assert.equal(f.monitor.getEntries().length, 1);
  f.navigate('https://selected.test/');
  f.setRules([{ host: 'selected.test', monitor: false }]);
  await f.request('off');
  assert.equal(f.monitor.getEntries().length, 1);
});

test('initial main-frame request is captured and redirect stops at the allowlist boundary', async () => {
  const f = await fixture('about:blank');
  f.navigate('https://selected.test/');
  await f.request('document', { type: 'Document', loaderId: 'L1', request: { url: 'https://selected.test/', method: 'GET' } });
  await f.request('document', { type: 'Document', loaderId: 'L1', request: { url: 'https://private.test/', method: 'GET' },
    redirectResponse: { status: 302, headers: { location: 'https://private.test/' } } });
  await f.request('private-api', { request: { url: 'https://private.test/api', method: 'POST', postData: 'secret' } });
  const records = f.monitor.getEntries();
  assert.equal(records.length, 1);
  assert.equal(records[0].status, 302);
  assert.equal(records[0].url, 'https://selected.test/');
});

test('an old page cannot contribute unload traffic while a selected navigation is pending', async () => {
  const f = await fixture('https://unselected.test/');
  f.navigate('https://selected.test/');
  await f.request('unload-beacon', { loaderId: 'old-loader' });
  assert.equal(f.monitor.getEntries().length, 0);
  await f.request('navigation', { type: 'Document', loaderId: 'new-loader', request: { url: 'https://selected.test/', method: 'GET' } });
  await f.request('late-unload', { loaderId: 'old-loader' });
  await f.request('new-page', { loaderId: 'new-loader' });
  assert.equal(f.monitor.getEntries().length, 2);
});

test('initial document arriving before the frame-tree reply is retained', async () => {
  const f = await fixture('about:blank', { onNetworkEnable(wc) {
    wc.url = 'https://selected.test/';
    wc.emit('did-start-navigation', { url: wc.url, isMainFrame: true, isSameDocument: false });
    wc.debugger.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: 'initial', frameId: 'top', loaderId: 'initial-loader', type: 'Document',
      timestamp: 10, wallTime: 1700000000, documentURL: wc.url,
      request: { url: wc.url, method: 'GET', headers: {} },
    });
  } });
  assert.equal(f.monitor.getEntries().length, 1);
  assert.equal(f.monitor.getEntries()[0].url, 'https://selected.test/');
});

test('frame lifecycle admits current iframe resources and rejects the previous page iframe', async () => {
  const f = await fixture('https://unselected.test/', { childFrames: [{ frame: { id: 'old-child', url: 'https://private.test/' } }] });
  f.navigate('https://selected.test/');
  await f.request('document', { type: 'Document', loaderId: 'new-loader', request: { url: 'https://selected.test/', method: 'GET' } });
  await f.request('stale-child', { frameId: 'old-child' });
  await f.request('unknown-child', { frameId: 'unknown-child' });
  assert.equal(f.monitor.getEntries().length, 1);
  await f.send('Page.frameAttached', { frameId: 'new-child', parentFrameId: 'top' });
  await f.request('current-child', { frameId: 'new-child', type: 'Document' });
  await f.send('Page.frameNavigated', { frame: { id: 'new-child', parentId: 'top', url: 'https://cdn.other.test/' } });
  await f.request('current-child-fetch', { frameId: 'new-child' });
  assert.equal(f.monitor.getEntries().length, 3);
  await f.send('Page.frameDetached', { frameId: 'new-child' });
  await f.request('detached-child', { frameId: 'new-child' });
  assert.equal(f.monitor.getEntries().length, 3);
});

test('subresource redirect has separate entries and ExtraInfo attaches to the correct hop', async () => {
  const f = await fixture();
  await f.send('Network.requestWillBeSentExtraInfo', { requestId: 'chain', headers: { Cookie: 'first=1' } });
  await f.request('chain');
  await f.send('Network.responseReceivedExtraInfo', { requestId: 'chain', statusCode: 302, headers: { 'Set-Cookie': 'redirect=1' } });
  await f.request('chain', { timestamp: 10.2, redirectHasExtraInfo: true,
    request: { url: 'https://cdn.other.test/final', method: 'GET', headers: {} },
    redirectResponse: { status: 302, headers: { location: '/final' } } });
  await f.send('Network.requestWillBeSentExtraInfo', { requestId: 'chain', headers: { Cookie: 'second=2' } });
  await f.send('Network.responseReceived', { requestId: 'chain', timestamp: 10.3, hasExtraInfo: true, response: { status: 200, mimeType: 'application/json' } });
  await f.send('Network.responseReceivedExtraInfo', { requestId: 'chain', statusCode: 200, headers: { 'Set-Cookie': 'final=2' } });
  await f.send('Network.loadingFinished', { requestId: 'chain', timestamp: 10.5, encodedDataLength: 20 });
  const [first, second] = f.monitor.getEntries();
  assert.equal(first.status, 302);
  assert.equal(first.requestHeaders.Cookie, 'first=1');
  assert.equal(first.responseHeaders['Set-Cookie'], 'redirect=1');
  assert.equal(second.requestHeaders.Cookie, 'second=2');
  assert.equal(second.responseHeaders['Set-Cookie'], 'final=2');
  assert.equal(second.responseBody, '{"ok":true}');
  assert.ok(Math.abs(second.duration - 300) < 0.01);
});

test('navigation, pause, and clear prevent in-flight bodies from being recorded later', async () => {
  for (const action of ['navigate', 'pause', 'clear']) {
    let resolveBody;
    const f = await fixture(undefined, { getBody: () => new Promise(resolve => { resolveBody = resolve; }) });
    await f.request('slow');
    const finish = f.send('Network.loadingFinished', { requestId: 'slow', timestamp: 11, encodedDataLength: 10 });
    if (action === 'navigate') f.navigate('https://unselected.test/');
    if (action === 'pause') { f.monitor.setPaused(true); f.monitor.setPaused(false); }
    if (action === 'clear') f.monitor.clear();
    resolveBody({ body: 'must not arrive', base64Encoded: false });
    await finish;
    assert.ok(f.monitor.getEntries().every(entry => entry.responseBody === ''));
    if (action === 'clear') assert.equal(f.monitor.getEntries().length, 0);
  }
});

test('pause blocks new records; resume starts with new requests', async () => {
  const f = await fixture();
  f.monitor.setPaused(true);
  await f.request('paused');
  assert.equal(f.monitor.getEntries().length, 0);
  f.monitor.setPaused(false);
  await f.send('Network.responseReceived', { requestId: 'paused', response: { status: 200 } });
  assert.equal(f.monitor.getEntries().length, 0);
  await f.request('resumed');
  assert.equal(f.monitor.getEntries().length, 1);
});

test('request and response bodies respect byte limits including Unicode and base64', async () => {
  let result = { body: '😀'.repeat(LIMITS.bodyBytes), base64Encoded: false };
  const f = await fixture(undefined, { quiet: true, getBody: () => result });
  await f.request('unicode', { request: { url: 'https://cdn.other.test/u', method: 'POST', postData: '😀'.repeat(LIMITS.bodyBytes) } });
  await f.send('Network.loadingFinished', { requestId: 'unicode', timestamp: 11, encodedDataLength: 100 });
  let entry = f.monitor.getEntries()[0];
  assert.ok(Buffer.byteLength(entry.postData) <= LIMITS.bodyBytes);
  assert.ok(Buffer.byteLength(entry.responseBody) <= LIMITS.bodyBytes);
  assert.match(entry.bodyNote, /truncated/);
  result = { body: Buffer.alloc(LIMITS.bodyBytes * 2, 255).toString('base64'), base64Encoded: true };
  await f.request('binary');
  await f.send('Network.loadingFinished', { requestId: 'binary', timestamp: 11, encodedDataLength: 100 });
  entry = f.monitor.getEntries()[1];
  assert.equal(entry.bodyBase64, true);
  assert.ok(Buffer.from(entry.responseBody, 'base64').length <= LIMITS.bodyBytes);
});

test('large transfers and Chromium body errors retain useful metadata', async () => {
  const f = await fixture(undefined, { getBody: () => { throw new Error('evicted'); } });
  await f.request('large');
  await f.send('Network.loadingFinished', { requestId: 'large', timestamp: 11, encodedDataLength: LIMITS.bodyBytes + 1 });
  assert.equal(f.commands.filter(command => command.name === 'Network.getResponseBody').length, 0);
  assert.match(f.monitor.getEntries()[0].bodyNote, /omitted/);
  await f.request('cached');
  await f.send('Network.loadingFinished', { requestId: 'cached', timestamp: 11, encodedDataLength: 0 });
  assert.match(f.monitor.getEntries()[1].bodyNote, /unavailable/);
});

test('record count, retained memory, and temporary ExtraInfo queues are bounded', async () => {
  const f = await fixture(undefined, { quiet: true });
  for (let index = 0; index < LIMITS.entries + 20; index++) await f.request(String(index));
  assert.equal(f.monitor.getEntries().length, LIMITS.entries);
  assert.equal(f.monitor.getEntries()[0].id, 'net-21');
  const largePost = 'x'.repeat(LIMITS.bodyBytes);
  for (let index = 0; index < 80; index++) await f.request(`body-${index}`, { request: { url: 'https://cdn.other.test/post', method: 'POST', postData: largePost } });
  assert.ok(f.monitor.memoryBytes <= LIMITS.memoryBytes);
  assert.ok(f.monitor.getEntries().length < 80);
  for (let index = 0; index < 100; index++) await f.send('Network.requestWillBeSentExtraInfo', { requestId: `early-${index}`, headers: { Cookie: 'x'.repeat(65536) } });
  assert.ok(f.monitor.pendingExtraBytes <= 1024 * 1024);
  f.monitor.clear();
  assert.equal(f.monitor.memoryBytes, 0);
  assert.equal(f.monitor.pendingExtraBytes, 0);
});

test('WebSocket and EventSource retain bounded messages with direction and encoding', async () => {
  const f = await fixture(undefined, { quiet: true });
  await f.send('Network.webSocketCreated', { requestId: 'ws', url: 'wss://stream.other.test/' });
  await f.send('Network.webSocketWillSendHandshakeRequest', { requestId: 'ws', timestamp: 10, wallTime: 1700000000, request: { headers: { Cookie: 'local=1' } } });
  await f.send('Network.webSocketHandshakeResponseReceived', { requestId: 'ws', response: { status: 101, headers: { Upgrade: 'websocket' } } });
  await f.send('Network.webSocketFrameSent', { requestId: 'ws', timestamp: 11, response: { opcode: 2, payloadData: 'AQID' } });
  let entry = f.monitor.getEntries()[0];
  assert.equal(entry.frames[0].direction, 'sent');
  assert.equal(entry.frames[0].base64, true);
  for (let i = 0; i < 250; i++) await f.send('Network.webSocketFrameReceived', { requestId: 'ws', timestamp: 12 + i, response: { opcode: 1, payloadData: 'message' } });
  entry = f.monitor.getEntries()[0];
  assert.equal(entry.frames.length, LIMITS.frames);
  assert.match(entry.bodyNote, /Older stream messages/);
  await f.request('sse', { type: 'EventSource' });
  await f.send('Network.eventSourceMessageReceived', { requestId: 'sse', timestamp: 11, eventName: 'update', eventId: '42', data: '{"value":2}' });
  assert.equal(f.monitor.getEntries()[1].frames[0].eventName, 'update');
});

test('worker session IDs isolate requests; shared workers and stale child targets are ignored', async () => {
  const f = await fixture();
  await f.send('Target.attachedToTarget', { sessionId: 'worker1', targetInfo: { type: 'worker' } });
  await f.send('Target.attachedToTarget', { sessionId: 'shared1', targetInfo: { type: 'shared_worker' } });
  await f.request('same');
  await f.request('same', {}, 'worker1');
  await f.request('same', {}, 'shared1');
  assert.equal(f.monitor.getEntries().length, 2);
  f.monitor.clear();
  await f.request('afterclear', {}, 'worker1');
  assert.equal(f.monitor.getEntries().length, 1);
  f.navigate('https://selected.test/new');
  await f.request('stale', {}, 'worker1');
  assert.equal(f.monitor.getEntries().length, 1);
});

test('HAR is an explicit snapshot with local headers and stream extensions; getters return copies', async () => {
  const f = await fixture();
  await f.request('export', { request: { url: 'https://cdn.other.test/api?q=one', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'test-token' }, postData: '{"hello":1}' } });
  await f.send('Network.responseReceived', { requestId: 'export', response: { status: 200, mimeType: 'application/json' } });
  await f.send('Network.loadingFinished', { requestId: 'export', timestamp: 11, encodedDataLength: 11 });
  const result = f.monitor.getEntries()[0];
  result.requestHeaders.Authorization = 'mutated';
  assert.equal(f.monitor.getEntry(result.id).requestHeaders.Authorization, 'test-token');
  const har = f.monitor.exportHAR();
  assert.equal(har.log.version, '1.2');
  assert.equal(har.log.entries[0].request.postData.text, '{"hello":1}');
  assert.deepEqual(har.log.entries[0].request.queryString, [{ name: 'q', value: 'one' }]);
  assert.equal(har.log.entries[0].response.content.text, '{"ok":true}');
});

test('attach is idempotent and destruction removes listeners without detaching shared CDP', async () => {
  const f = await fixture();
  await f.monitor.attach(f.wc, 'tab1');
  assert.equal(f.wc.debugger.listenerCount('message'), 1);
  assert.equal(f.commands.filter(command => command.name === 'Network.enable').length, 1);
  f.wc.emit('destroyed');
  assert.equal(f.wc.debugger.listenerCount('message'), 0);
  assert.equal(f.monitor.tabs.size, 0);
});
