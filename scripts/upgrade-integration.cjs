'use strict';

// Real sandboxed Electron checks. All server sockets bind to loopback; the fake
// proxy serves HTTP itself and rejects HTTPS CONNECT without contacting upstream.
// This script preserves CHROME_DEVEL_SANDBOX and never disables sandboxing.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require('playwright');

const project = path.resolve(__dirname, '..');
const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const output = path.resolve(project, '../../work/prism-upgrade-qa', runId);
const profile = path.join(output, 'profile');
const stateFile = path.join(profile, 'browser-state.json');
const results = [];
const runtimeLog = [];
const fixtureRequests = [];
const proxyRequests = [];
const proxyConnects = [];
const sockets = new Set();
const username = `qa-user-${runId}`;
const password = `qa-password-${runId}`;
const expectedAuthorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
let requireProxyAuth = false;
let fixtureServer, proxyServer, electronApp, shell, selected, allowlisted, proxyPort;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await delay(75);
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}
async function step(name, run) {
  console.log(`RUN ${name}`);
  const started = Date.now();
  try {
    const details = await run();
    results.push({ name, passed: true, durationMs: Date.now() - started, details });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, passed: false, durationMs: Date.now() - started, error: error.stack });
    console.error(`FAIL ${name}: ${error.message}`);
    throw error;
  }
}
function trackSockets(server) {
  server.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
  });
}
async function listen(server) {
  trackSockets(server);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
function fixtureHTML(response, label = 'Prism upgrade fixture') {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1><script>window.fixtureReady=true;</script></body></html>`);
}
async function startFixtures() {
  fixtureServer = http.createServer((request, response) => {
    fixtureRequests.push({ url: request.url, host: request.headers.host, hasProxyAuthorization: Boolean(request.headers['proxy-authorization']), hasAuthorization: Boolean(request.headers.authorization) });
    const url = new URL(request.url, 'http://fixture.invalid');
    if (url.pathname.endsWith('.js')) {
      response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      response.end('window.fixtureScriptLoads=(window.fixtureScriptLoads||0)+1;');
    } else if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); }
    else fixtureHTML(response);
  });
  const fixturePort = await listen(fixtureServer);
  selected = `http://127.0.0.1:${fixturePort}`;
  allowlisted = `http://localhost:${fixturePort}`;
  proxyServer = http.createServer((request, response) => {
    const authorized = request.headers['proxy-authorization'] === expectedAuthorization;
    const entry = { url: request.url, authorized, hasProxyAuthorization: Boolean(request.headers['proxy-authorization']), hasAuthorization: Boolean(request.headers.authorization) };
    proxyRequests.push(entry);
    if (requireProxyAuth && !authorized) {
      entry.status = 407;
      response.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="Prism local proxy"', 'Cache-Control': 'no-store', Connection: 'close' });
      response.end('Proxy authentication required'); return;
    }
    if (request.url.includes('/origin-auth')) {
      entry.status = 401;
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Separate origin"', 'Cache-Control': 'no-store' });
      response.end('Origin authentication intentionally cancelled'); return;
    }
    entry.status = 200;
    fixtureHTML(response, 'Served by the local proxy');
  });
  proxyServer.on('connect', (request, socket) => {
    proxyConnects.push(request.url);
    socket.end('HTTP/1.1 502 Local fixture rejects external tunnels\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  proxyPort = await listen(proxyServer);
}
async function launch() {
  const env = { ...process.env, PRISM_PROFILE: profile, DISPLAY: process.env.DISPLAY || ':0' };
  delete env.ELECTRON_RUN_AS_NODE;
  electronApp = await _electron.launch({ executablePath: require('electron'), args: [project], env, timeout: 45000 });
  electronApp.process().stderr?.on('data', data => { if (runtimeLog.length < 400) runtimeLog.push(data.toString().slice(0, 4000)); });
  shell = await electronApp.firstWindow();
  await shell.waitForFunction(() => typeof window.prism?.invoke === 'function');
  await waitFor(async () => Boolean((await invoke('get-state')).activeTabId), 'browser initial tab ready', 30000);
  await electronApp.evaluate(({ app }) => {
    globalThis.__prismUpgradeAuthEvents = [];
    app.on('login', (_event, _contents, details, info) => {
      globalThis.__prismUpgradeAuthEvents.push({ isProxy: info.isProxy, host: info.host, port: info.port, firstAuthAttempt: details.firstAuthAttempt });
    });
  });
}
async function invoke(action, payload = {}) {
  return shell.evaluate(({ action, payload }) => window.prism.invoke(action, payload), { action, payload });
}
async function pageValue(url, source) {
  return electronApp.evaluate(async ({ webContents }, { url, source }) => {
    const contents = webContents.getAllWebContents().find(item => !item.isDestroyed() && item.getURL() === url);
    if (!contents) throw new Error(`Page not found: ${url}`);
    return contents.executeJavaScript(source, false);
  }, { url, source });
}
async function navigate(url) {
  await invoke('navigate', { url });
  await waitFor(() => pageValue(url, 'document.readyState === "complete" && window.fixtureReady === true'), `fixture navigation to ${url}`);
}
async function loadScript(page, url) {
  return pageValue(page, `new Promise(resolve=>{const script=document.createElement('script');script.src=${JSON.stringify(url)};script.onload=()=>resolve(true);script.onerror=()=>resolve(false);document.head.append(script);})`);
}
async function resolveProxy(url) {
  return electronApp.evaluate(async ({ webContents }, url) => {
    const browsing = webContents.getAllWebContents().find(item => !item.isDestroyed() && item.getType() === 'webview');
    const fallback = webContents.getAllWebContents().find(item => !item.isDestroyed() && item.getLastWebPreferences().nodeIntegration === false && !item.getURL().startsWith('file:'));
    const contents = browsing || fallback;
    if (!contents) throw new Error('No browsing webContents found');
    return contents.session.resolveProxy(url);
  }, url);
}
async function closeApplication() {
  if (!electronApp) return;
  const current = electronApp; electronApp = null;
  await current.close(); shell = null;
}
const endpoint = () => ({ enabled: true, type: 'http', host: '127.0.0.1', port: proxyPort, bypass: 'localhost,127.0.0.1,[::1]' });
const blocker = (enabled = true, allowlist = [], blocklist = []) => ({ enabled, allowlist, blocklist });

async function main() {
  await fs.mkdir(profile, { recursive: true });
  try {
    await step('start loopback page and non-forwarding proxy fixtures', startFixtures);
    await step('launch sandboxed browser with offline Adblock Plus core ready', async () => {
      await launch();
      const sandboxed = await electronApp.evaluate(({ app, BrowserWindow }) => ({ disabled: app.commandLine.hasSwitch('no-sandbox'), sandbox: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().sandbox }));
      assert.equal(sandboxed.disabled, false); assert.equal(sandboxed.sandbox, true);
      const state = await invoke('get-state');
      assert.equal(state.adblock.ready, true, state.adblock.error);
      assert.ok(state.adblock.filterCount > 1000);
      assert.equal(state.search.engine, 'duckduckgo');
      return { sandboxed: true, filterCount: state.adblock.filterCount };
    });

    await step('HTTP browsing uses the configured proxy and contains no direct fallback', async () => {
      await invoke('proxy-save', { proxy: endpoint() });
      assert.equal(await resolveProxy('http://prism-fixture.invalid/'), `PROXY 127.0.0.1:${proxyPort}`);
      await navigate('http://prism-fixture.invalid/through-proxy');
      assert.ok(proxyRequests.some(item => item.url === 'http://prism-fixture.invalid/through-proxy' && item.status === 200));
      assert.equal((await invoke('get-state')).proxy.active, true);
    });

    await step('saved search engines drive encoded address-bar searches through a local-only proxy', async () => {
      const query = 'cats & dogs #images';
      for (const [engine, host, param] of [['duckduckgo', 'duckduckgo.com', 'q'], ['google', 'www.google.com', 'q'], ['bing', 'www.bing.com', 'q'], ['brave', 'search.brave.com', 'q'], ['startpage', 'www.startpage.com', 'query'], ['custom', 'search-fixture.invalid', 'q']]) {
        await invoke('search-save', { search: { engine, customTemplate: engine === 'custom' ? 'https://search-fixture.invalid/find?q={query}' : '' } });
        await invoke('navigate', { url: query });
        const url = await waitFor(async () => {
          const state = await invoke('get-state');
          const address = state.tabs.find(item => item.id === state.activeTabId)?.url;
          return address?.startsWith(`https://${host}/`) ? address : null;
        }, `${engine} search URL`);
        assert.equal(new URL(url).searchParams.get(param), query);
        assert.equal(new URL(url).hash, '');
        await waitFor(() => proxyConnects.includes(`${host}:443`), `${engine} local CONNECT rejection`);
      }
      await invoke('search-save', { search: { engine: 'brave', customTemplate: '' } });
      await navigate(`${allowlisted}/search-complete`);
      return { engines: 6, externalTunnelsOpened: 0 };
    });

    await step('HTTP proxy authentication is real and secrets remain absent from renderer and state JSON', async () => {
      requireProxyAuth = true;
      await invoke('proxy-save', { proxy: { ...endpoint(), username, password } });
      await navigate('http://prism-fixture.invalid/authenticated');
      assert.ok(proxyRequests.some(item => item.url.includes('/authenticated') && item.status === 407));
      assert.ok(proxyRequests.some(item => item.url.includes('/authenticated') && item.status === 200 && item.authorized));
      const state = await invoke('get-state');
      assert.equal(state.proxy.hasCredentials, true);
      assert.equal(Object.hasOwn(state.proxy, 'password'), false);
      assert.equal(Object.hasOwn(state.proxy, 'username'), false);
      const saved = await fs.readFile(stateFile, 'utf8');
      assert.equal(saved.includes(password), false); assert.equal(saved.includes(username), false);
      assert.equal(JSON.stringify(state).includes(password), false);
      await navigate(`${allowlisted}/direct-with-proxy-enabled`);
      assert.ok(fixtureRequests.filter(item => item.url.includes('/direct-with-proxy-enabled')).every(item => !item.hasProxyAuthorization && !item.hasAuthorization));
    });

    await step('origin authentication challenges never receive proxy credentials', async () => {
      await invoke('navigate', { url: 'http://prism-fixture.invalid/origin-auth' });
      await waitFor(() => proxyRequests.some(item => item.url.includes('/origin-auth') && item.status === 401), 'separate origin 401');
      await waitFor(async () => electronApp.evaluate(() => globalThis.__prismUpgradeAuthEvents.some(item => item.isProxy === false)), 'origin login event');
      assert.ok(proxyRequests.filter(item => item.url.includes('/origin-auth')).every(item => !item.hasAuthorization));
      await navigate(`${allowlisted}/after-origin-auth`);
    });

    await step('proxy disable switches the browsing session to direct connections', async () => {
      await invoke('proxy-save', { proxy: { ...endpoint(), enabled: false } });
      assert.equal(await resolveProxy('http://prism-fixture.invalid/'), 'DIRECT');
      assert.equal((await invoke('get-state')).proxy.active, false);
      await navigate(`${allowlisted}/direct-page`);
    });

    await step('bundled EasyList blocks a live ad script and master off permits it', async () => {
      await invoke('adblock-save', { adblock: blocker(true) });
      await navigate(`${allowlisted}/adblock-page`);
      const before = fixtureRequests.length;
      assert.equal(await loadScript(`${allowlisted}/adblock-page`, `${allowlisted}/ads/cbr.js?blocked=${runId}`), false);
      assert.ok(!fixtureRequests.slice(before).some(item => item.url.includes(`blocked=${runId}`)));
      await waitFor(async () => (await invoke('get-state')).adblock.blockedCount > 0, 'blocked request counter');
      await invoke('adblock-save', { adblock: blocker(false) });
      assert.equal(await loadScript(`${allowlisted}/adblock-page`, `${allowlisted}/ads/cbr.js?masteroff=${runId}`), true);
    });

    await step('custom blocked destinations and top-level allowlist take precedence correctly', async () => {
      await invoke('adblock-save', { adblock: blocker(true, [], ['127.0.0.1']) });
      const before = fixtureRequests.length;
      assert.equal(await loadScript(`${allowlisted}/adblock-page`, `${selected}/normal.js?customblocked=${runId}`), false);
      assert.ok(!fixtureRequests.slice(before).some(item => item.url.includes(`customblocked=${runId}`)));
      await invoke('adblock-save', { adblock: blocker(true, ['localhost'], ['127.0.0.1']) });
      assert.equal(await loadScript(`${allowlisted}/adblock-page`, `${selected}/normal.js?allowlisted=${runId}`), true);
      assert.equal(await loadScript(`${allowlisted}/adblock-page`, `${allowlisted}/ads/cbr.js?allowlisted=${runId}`), true);
      await invoke('adblock-save', { adblock: blocker(false, [], ['127.0.0.1']) });
      assert.equal(await loadScript(`${allowlisted}/adblock-page`, `${selected}/normal.js?masteroff=${runId}`), true);
    });

    await step('proxy saves gate requests and failed rollback stays blocked until explicit recovery', async () => {
      await invoke('adblock-save', { adblock: blocker(false) });
      const page = `${allowlisted}/adblock-page`;
      await electronApp.evaluate(({ session }) => {
        const browsingSession = session.fromPartition('persist:prism-default');
        globalThis.__prismUpgradeRestoreProxy = browsingSession.setProxy.bind(browsingSession);
        let first = true;
        browsingSession.setProxy = async () => {
          if (first) {
            first = false;
            await new Promise(resolve => { globalThis.__prismUpgradeReleaseProxy = resolve; });
          }
          throw new Error('Deliberate local integration failure');
        };
      });
      let outcome;
      const pending = invoke('proxy-save', { proxy: endpoint() }).then(
        () => { outcome = { rejected: false }; },
        error => { outcome = { rejected: true, message: error.message }; },
      );
      try {
        await waitFor(async () => (await invoke('get-state')).proxy.applying === true, 'proxy applying state');
        const inFlightStart = fixtureRequests.length;
        assert.equal(await loadScript(page, `${allowlisted}/normal.js?proxy-applying=${runId}`), false);
        assert.ok(!fixtureRequests.slice(inFlightStart).some(item => item.url.includes(`proxy-applying=${runId}`)));
        await electronApp.evaluate(() => globalThis.__prismUpgradeReleaseProxy());
        await pending;
        assert.equal(outcome.rejected, true);
        assert.match(outcome.message, /Restart the browser/);
        const state = await invoke('get-state');
        assert.equal(state.proxy.applying, false);
        assert.equal(state.proxy.active, false);
        assert.equal(state.adblock.enabled, false);
        assert.match(state.proxy.error, /Restart the browser/);
        const failedStart = fixtureRequests.length;
        assert.equal(await loadScript(page, `${allowlisted}/normal.js?proxy-fatal=${runId}`), false);
        assert.ok(!fixtureRequests.slice(failedStart).some(item => item.url.includes(`proxy-fatal=${runId}`)));
        await assert.rejects(invoke('navigate', { url: `${allowlisted}/must-not-load` }), /Restart/);
      } finally {
        await electronApp.evaluate(({ session }) => {
          globalThis.__prismUpgradeReleaseProxy?.();
          session.fromPartition('persist:prism-default').setProxy = globalThis.__prismUpgradeRestoreProxy;
          delete globalThis.__prismUpgradeRestoreProxy;
          delete globalThis.__prismUpgradeReleaseProxy;
        });
        await pending;
      }
      await invoke('proxy-save', { proxy: { ...endpoint(), enabled: false } });
      const recovered = await invoke('get-state');
      assert.equal(recovered.proxy.error, undefined);
      assert.equal(recovered.proxy.applying, false);
      assert.equal(await resolveProxy('http://prism-fixture.invalid/'), 'DIRECT');
      assert.equal(await loadScript(page, `${allowlisted}/normal.js?proxy-recovered=${runId}`), true);
      return { blockedDuringSave: true, blockedAfterFatalFailure: true, recoveredAfterExplicitSave: true };
    });

    await step('settings survive relaunch while proxy credentials remain session-only', async () => {
      await invoke('adblock-save', { adblock: blocker(true, ['localhost'], ['127.0.0.1']) });
      await invoke('proxy-save', { proxy: endpoint() });
      assert.equal((await invoke('get-state')).proxy.hasCredentials, true, 'Same-endpoint toggles preserve session credentials');
      await navigate(`${allowlisted}/persistent-settings`);
      await shell.screenshot({ path: path.join(output, 'before-relaunch.png') });
      await closeApplication();
      const savedText = await fs.readFile(stateFile, 'utf8');
      assert.equal(savedText.includes(password), false); assert.equal(savedText.includes(username), false);
      const saved = JSON.parse(savedText);
      assert.equal(saved.search.engine, 'brave');
      assert.equal(saved.proxy.port, proxyPort); assert.equal(saved.proxy.enabled, true);
      await launch();
      await waitFor(() => pageValue(`${allowlisted}/persistent-settings`, 'window.fixtureReady===true'), 'restored settings fixture');
      const state = await invoke('get-state');
      assert.equal(state.search.engine, 'brave');
      assert.equal(state.proxy.port, proxyPort); assert.equal(state.proxy.active, true);
      assert.equal(state.proxy.hasCredentials, false);
      assert.deepEqual(state.adblock.allowlist, ['localhost']); assert.deepEqual(state.adblock.blocklist, ['127.0.0.1']);
      assert.equal(state.adblock.enabled, true); assert.equal(state.adblock.ready, true);
      assert.equal(await resolveProxy('http://prism-fixture.invalid/'), `PROXY 127.0.0.1:${proxyPort}`);
      const before = proxyRequests.length;
      await invoke('navigate', { url: 'http://prism-fixture.invalid/after-relaunch-auth' });
      await waitFor(() => proxyRequests.slice(before).some(item => item.url.includes('/after-relaunch-auth') && item.status === 407), 'relaunch requires reentered auth');
      await waitFor(async () => (await invoke('get-state')).proxy.credentialStatus === 'required', 'missing credentials status');
      assert.ok(proxyRequests.slice(before).filter(item => item.url.includes('/after-relaunch-auth')).every(item => !item.authorized));
      await navigate(`${allowlisted}/persistent-settings`);
      await shell.screenshot({ path: path.join(output, 'after-relaunch.png') });
      return { persistentSearch: true, persistentProxyEndpoint: true, persistentLists: true, credentialsPersisted: false };
    });
    console.log(`PASS all ${results.length} upgrade checks. Report: ${path.join(output, 'report.json')}`);
  } finally {
    if (shell && !shell.isClosed()) await shell.screenshot({ path: path.join(output, 'final-state.png') }).catch(() => {});
    await closeApplication().catch(error => runtimeLog.push(`Shutdown: ${error.message}`));
    for (const socket of sockets) socket.destroy();
    for (const server of [fixtureServer, proxyServer]) if (server) await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ runId, profile, selected, allowlisted, proxyPort, sandboxDisabled: false, results, fixtureRequests, proxyRequests, proxyConnects, runtimeLog }, null, 2));
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
