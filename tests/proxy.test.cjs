'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProxyController } = require('../electron/proxy.cjs');
const { publicProxyConfig } = require('../electron/preferences.cjs');

function harness(hooks = {}) {
  const calls = [];
  const session = {
    async setProxy(config) { calls.push(['setProxy', config]); await hooks.setProxy?.(config); },
    async clearAuthCache() { calls.push(['clearAuthCache']); await hooks.clearAuthCache?.(); },
    async closeAllConnections() { calls.push(['closeAllConnections']); await hooks.closeAllConnections?.(); },
  };
  return { calls, session, controller: new ProxyController({ session }) };
}

const proxy = { enabled: true, type: 'https', host: 'proxy.example', port: 8443, bypass: '*.internal', username: 'person', password: 'secret' };

function challenge(controller, authInfo, details) {
  let prevented = false;
  let credentials = null;
  const handled = controller.handleLogin({ preventDefault() { prevented = true; } }, authInfo, (...args) => { credentials = args; }, details);
  return { prevented, credentials, handled };
}

test('proxy starts with no active endpoint and configures fixed servers without a direct fallback', async () => {
  const { controller, calls } = harness();
  assert.deepEqual(controller.snapshot(), { configured: false, active: false, credentialStatus: 'none' });
  const state = await controller.apply(proxy);
  assert.deepEqual(calls, [
    ['setProxy', { mode: 'fixed_servers', proxyRules: 'https://proxy.example:8443', proxyBypassRules: '*.internal' }],
    ['clearAuthCache'], ['closeAllConnections'],
  ]);
  assert.deepEqual(state, { configured: true, active: true, credentialStatus: 'session' });
  assert.equal(JSON.stringify(state).includes('secret'), false);
});

test('disabling a proxy explicitly uses direct mode and closes previous connections', async () => {
  const { controller, calls } = harness();
  await controller.apply(proxy);
  calls.length = 0;
  await controller.apply({ ...publicProxyConfig(proxy), enabled: false });
  assert.deepEqual(calls, [['setProxy', { mode: 'direct' }], ['clearAuthCache'], ['closeAllConnections']]);
  assert.equal(controller.snapshot().active, false);
  assert.equal(controller.snapshot().configured, true);
  assert.equal(controller.getConfig().password, 'secret');
  assert.deepEqual(challenge(controller, { isProxy: true, host: proxy.host, port: proxy.port }).credentials, []);
});

test('first disabled startup applies direct mode while unchanged settings do not disrupt sockets again', async () => {
  const { controller, calls } = harness();
  await controller.apply({});
  assert.equal(calls[0][1].mode, 'direct');
  calls.length = 0;
  await controller.apply({});
  assert.deepEqual(calls, []);
});

test('proxy apply failures restore the previous config and keep prior credentials and status', async () => {
  const { controller, calls } = harness({ setProxy(config) {
    if (config.proxyRules?.includes('broken.example')) throw new Error('arbitrary error with secret');
  } });
  await controller.apply(proxy);
  calls.length = 0;
  await assert.rejects(controller.apply({ ...proxy, host: 'broken.example', password: 'new-secret' }), /previous connection settings were restored/);
  assert.equal(controller.getConfig().host, 'proxy.example');
  assert.equal(controller.getConfig().password, 'secret');
  assert.equal(controller.snapshot().active, true);
  assert.equal(JSON.stringify(controller.snapshot()).includes('secret'), false);
  assert.equal(calls[1][1].proxyRules, 'https://proxy.example:8443');
  await controller.apply({ ...publicProxyConfig(proxy), enabled: false });
  assert.equal(controller.snapshot().active, false);
  assert.equal(controller.snapshot().error, undefined);
});

test('a connection flush failure rolls back instead of claiming the new proxy is ready', async () => {
  let failFlush = false;
  const { controller } = harness({ closeAllConnections() {
    if (failFlush) { failFlush = false; throw new Error('flush failed'); }
  } });
  await controller.apply(proxy);
  failFlush = true;
  await assert.rejects(controller.apply({ ...proxy, host: 'new.example' }), /restored/);
  assert.equal(controller.getConfig().host, 'proxy.example');
  assert.equal(controller.snapshot().active, true);
});

test('failure to restore does not report an uncertain connection as active or supply credentials', async () => {
  let failing = false;
  const { controller } = harness({ setProxy() { if (failing) throw new Error('unavailable'); } });
  await controller.apply(proxy);
  failing = true;
  await assert.rejects(controller.apply({ ...proxy, host: 'new.example' }), /Restart the browser/);
  assert.equal(controller.snapshot().active, false);
  assert.deepEqual(challenge(controller, { isProxy: true, host: proxy.host, port: proxy.port }).credentials, []);
});

test('overlapping saves are serialized and each uses the previous completed configuration', async () => {
  let release;
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { controller, calls } = harness({ async setProxy(config) {
    if (config.proxyRules?.includes('proxy.example')) { announce(); await gate; }
  } });
  const first = controller.apply(proxy);
  const second = controller.apply({ ...publicProxyConfig(proxy), enabled: false });
  await started;
  assert.equal(calls.length, 1);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls.map(call => call[0]), ['setProxy', 'clearAuthCache', 'closeAllConnections', 'setProxy', 'clearAuthCache', 'closeAllConnections']);
  assert.equal(controller.snapshot().active, false);
  assert.equal(controller.getConfig().password, 'secret');
});

test('session credentials survive omitted fields only on the same endpoint, and can be explicitly cleared', async () => {
  const { controller } = harness();
  await controller.apply(proxy);
  await controller.apply({ ...publicProxyConfig(proxy), bypass: '<local>' });
  assert.equal(controller.getConfig().password, 'secret');
  await controller.apply({ ...publicProxyConfig(proxy), host: 'other.example' });
  assert.equal(controller.getConfig().password, '');
  assert.equal(controller.getConfig().username, '');
  await controller.apply(proxy);
  await controller.apply({ ...publicProxyConfig(proxy), username: '', password: '' });
  assert.equal(controller.getConfig().password, '');
  assert.equal(controller.snapshot().credentialStatus, 'none');
});

test('proxy credentials are scoped to exact proxy host and port and never go to website auth', async () => {
  const { controller } = harness();
  await controller.apply(proxy);
  assert.deepEqual(challenge(controller, { isProxy: true, host: 'PROXY.EXAMPLE.', port: 8443 }, { firstAuthAttempt: true }), {
    prevented: true, credentials: ['person', 'secret'], handled: true,
  });
  assert.deepEqual(challenge(controller, { isProxy: false, host: proxy.host, port: proxy.port }), {
    prevented: false, credentials: null, handled: false,
  });
  for (const authInfo of [
    { isProxy: true, host: 'evil.example', port: 8443 }, { isProxy: true, host: 'proxy.example.evil.test', port: 8443 },
    { isProxy: true, host: 'proxy.example@evil.test', port: 8443 }, { isProxy: true, host: proxy.host, port: 80 },
    { isProxy: true, host: proxy.host, port: '8443' }, { isProxy: true, host: null, port: 8443 },
  ]) assert.deepEqual(challenge(controller, authInfo).credentials, []);
});

test('IPv6 proxy auth handles canonical bracketed and unbracketed challenge addresses', async () => {
  const { controller } = harness();
  await controller.apply({ ...proxy, host: '[::1]' });
  assert.deepEqual(challenge(controller, { isProxy: true, host: '0:0:0:0:0:0:0:1', port: 8443 }).credentials, ['person', 'secret']);
  assert.deepEqual(challenge(controller, { isProxy: true, host: '[::1]', port: 8443 }).credentials, ['person', 'secret']);
});

test('missing and rejected proxy credentials cancel authentication and expose useful safe status', async () => {
  const { controller } = harness();
  await controller.apply(publicProxyConfig(proxy));
  assert.deepEqual(challenge(controller, { isProxy: true, host: proxy.host, port: proxy.port }).credentials, []);
  assert.equal(controller.snapshot().credentialStatus, 'required');
  await controller.apply(proxy);
  assert.deepEqual(challenge(controller, { isProxy: true, host: proxy.host, port: proxy.port }, { firstAuthAttempt: false }).credentials, []);
  assert.equal(controller.snapshot().credentialStatus, 'rejected');
});

test('SOCKS5 is configured without credentials and invalid input never touches the session', async () => {
  const { controller, calls } = harness();
  await controller.apply({ enabled: true, type: 'socks5', host: '[::1]', port: 1080 });
  assert.equal(calls[0][1].proxyRules, 'socks5://[::1]:1080');
  assert.equal(controller.snapshot().credentialStatus, 'unsupported');
  assert.deepEqual(challenge(controller, { isProxy: true, host: '[::1]', port: 1080 }).credentials, []);
  calls.length = 0;
  await assert.rejects(controller.apply({ ...proxy, host: 'proxy.example;direct://' }));
  assert.deepEqual(calls, []);
});
