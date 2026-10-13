'use strict';

// CodePen-style results run in a cross-origin iframe. Exercise real Chromium
// focus events, with no third-party site or network dependency.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let application, shell, profile, primary, childOrigin, primaryId, otherId;
const fixtureScript = `<script>
  window.patchedAtStart = Boolean(document[Symbol.for('prism.focus-state.v1')]);
  window.events = [];
  window.visited = 0;
  let previousType;
  // This is the native equivalent of $(window).on('blur focus', handler):
  // both use bubbling listeners and suppress consecutive duplicate types.
  for (const type of ['blur', 'focus']) window.addEventListener(type, event => {
    if (previousType !== event.type) {
      events.push({ type: event.type, trusted: event.isTrusted });
      if (event.type === 'focus') visited++;
    }
    previousType = event.type;
  });
  window.fixtureReady = true;
</script>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://fixture.test').pathname;
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Frame focus fixture</title>${fixtureScript}
    <input id="field" aria-label="Fixture input">
    ${pathname === '/outer' ? `<iframe id="result" sandbox="allow-scripts allow-same-origin" src="${childOrigin}/embedded?initial"></iframe>` : ''}`);
});

async function wait(check, label, timeout = 15000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}

const invoke = (action, payload = {}) => shell.evaluate(({ action, payload }) => window.prism.invoke(action, payload), { action, payload });
const tab = async id => (await invoke('get-state')).tabs.find(value => value.id === id);

async function frame(expression, frameUrl = `${childOrigin}/embedded?initial`, topUrl = primary) {
  return application.evaluate(async ({ webContents }, { expression, frameUrl, topUrl }) => {
    const wc = webContents.getAllWebContents().find(value => value.getURL() === topUrl);
    const target = wc?.mainFrame.framesInSubtree.find(value => value.url === frameUrl);
    if (!target) throw new Error(`Frame unavailable: ${frameUrl}`);
    let timer;
    try {
      return await Promise.race([
        target.executeJavaScript(expression, false),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Frame evaluation timed out: ${frameUrl}`)), 2000); }),
      ]);
    } finally { clearTimeout(timer); }
  }, { expression, frameUrl, topUrl });
}

async function ready(frameUrl, topUrl = primary) {
  await wait(() => frame('window.fixtureReady && document.readyState === "complete"', frameUrl, topUrl), `loaded ${frameUrl}`);
}

async function focusFrame(frameUrl = `${childOrigin}/embedded?initial`, topUrl = primary) {
  await application.evaluate(async ({ BrowserWindow, webContents }, { frameUrl, topUrl }) => {
    const wc = webContents.getAllWebContents().find(value => value.getURL() === topUrl);
    BrowserWindow.getAllWindows()[0].focus();
    wc.focus();
    const target = wc.mainFrame.framesInSubtree.find(value => value.url === frameUrl);
    await target.executeJavaScript('window.focus(); document.querySelector("input").focus()', false);
  }, { frameUrl, topUrl });
  await delay(100);
}

async function switchWindow() {
  const id = await application.evaluate(async ({ BrowserWindow }) => {
    const other = new BrowserWindow({ width: 320, height: 200, show: true, webPreferences: { sandbox: true } });
    await other.loadURL('data:text/html,<title>Other focused window</title><input autofocus>');
    other.focus();
    other.webContents.focus();
    return other.id;
  });
  await wait(() => application.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id).isFocused(), id), 'other window focused');
  await delay(150);
  await application.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.fromId(id).close();
    BrowserWindow.getAllWindows()[0].focus();
  }, id);
  await delay(150);
}

async function assertSwitchesHidden(frameUrl, label) {
  await focusFrame(frameUrl);
  const before = await frame('events', frameUrl);
  await switchWindow();
  await invoke('tab-activate', { id: otherId });
  await delay(150);
  assert.deepEqual(await frame('events', frameUrl), before, `${label}: native tab/window blur must be hidden`);
  assert.deepEqual(await frame('({ focus: document.hasFocus(), hidden: document.hidden, visibility: document.visibilityState })', frameUrl),
    { focus: true, hidden: false, visibility: 'visible' }, `${label}: background document getters remain spoofed`);
  await invoke('tab-activate', { id: primaryId });
  await focusFrame(frameUrl);
  assert.deepEqual(await frame('events', frameUrl), before, `${label}: native return focus must be hidden`);
}

async function assertNativeEvents(frameUrl, topUrl, label) {
  await focusFrame(frameUrl, topUrl);
  await wait(() => frame('document.hasFocus()', frameUrl, topUrl), `${label}: initial frame focus`);
  await frame('events = []', frameUrl, topUrl);
  await switchWindow();
  await focusFrame(frameUrl, topUrl);
  const observed = await frame('events.filter(event => event.trusted).map(event => event.type)', frameUrl, topUrl);
  assert.ok(observed.includes('blur'), `${label}: trusted blur observed (${JSON.stringify(observed)})`);
  assert.ok(observed.includes('focus'), `${label}: trusted focus observed (${JSON.stringify(observed)})`);
}

(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-frame-focus-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  primary = `http://127.0.0.1:${server.address().port}/outer`;
  childOrigin = `http://localhost:${server.address().port}`;
  const initial = `${childOrigin}/embedded?initial`;
  const standalone = `${childOrigin}/standalone`;
  try {
    const env = { ...process.env, PRISM_PROFILE: profile, DISPLAY: process.env.DISPLAY || ':0' };
    delete env.ELECTRON_RUN_AS_NODE;
    // X11 allows deterministic programmatic window activation under Linux;
    // Wayland compositors may decline focus() without a user activation token.
    const args = [...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []), ...(process.env.PRISM_TEST_EXECUTABLE ? [] : [project])];
    application = await _electron.launch({ executablePath: process.env.PRISM_TEST_EXECUTABLE || require('electron'), args, env });
    shell = await application.firstWindow();
    await shell.waitForFunction(() => Boolean(window.prism));
    primaryId = await wait(async () => (await invoke('get-state')).activeTabId, 'initial browser tab');
    await invoke('navigate', { url: primary });
    await ready(initial);
    assert.equal(await frame('patchedAtStart'), false);
    await assertNativeEvents(initial, primary, 'disabled child');
    console.log('PASS the cross-origin fixture sees native blur/focus before activation');

    await invoke('tab-new', { url: standalone });
    otherId = (await invoke('get-state')).activeTabId;
    await ready(standalone, standalone);
    await invoke('tab-activate', { id: primaryId });
    await shell.locator('#focus-toggle').click();
    await wait(async () => (await tab(primaryId)).focusStatus?.status === 'active', 'live activation');
    assert.equal(await frame('Boolean(document[Symbol.for("prism.focus-state.v1")])'), true, 'selected top-level site must include its cross-origin result frame');
    await assertSwitchesHidden(initial, 'live child');
    console.log('PASS live activation protects pre-existing cross-origin blur/focus listeners');

    await invoke('tab-activate', { id: otherId });
    await wait(async () => (await tab(otherId)).focusStatus?.status === 'inactive', 'unselected standalone tab');
    assert.equal(await frame('Boolean(document[Symbol.for("prism.focus-state.v1")])', standalone, standalone), false, 'the embedded origin is not enabled globally');
    await assertNativeEvents(standalone, standalone, 'unselected standalone tab');
    await invoke('tab-activate', { id: primaryId });
    console.log('PASS an unrelated top-level tab on the iframe origin retains native events');

    const oldDocument = await frame('window.documentToken = Math.random()', primary);
    await invoke('reload');
    await wait(() => application.evaluate(({ webContents }, url) => {
      const wc = webContents.getAllWebContents().find(value => value.getURL() === url);
      return wc && !wc.isLoading();
    }, primary), 'reload finished');
    await wait(() => frame(`window.documentToken !== ${JSON.stringify(oldDocument)}`, primary), 'replacement document');
    await ready(initial);
    await wait(async () => (await tab(primaryId)).focusStatus?.status === 'active', 'reload activation');
    console.log('INFO cross-origin child patched at first page script after reload:', await frame('patchedAtStart'));
    assert.equal(await frame('Boolean(document[Symbol.for("prism.focus-state.v1")])'), true, 'reload patches the cross-origin child');
    await assertSwitchesHidden(initial, 'reloaded child');
    console.log('PASS reload protects cross-origin frame focus events');

    const dynamic = `${childOrigin}/embedded?dynamic`;
    await frame(`(() => { const child = document.createElement('iframe'); child.src = ${JSON.stringify(dynamic)}; document.body.append(child); })()`, primary);
    await ready(dynamic);
    await wait(async () => (await tab(primaryId)).focusStatus?.status === 'active', 'dynamic-frame activation');
    console.log('INFO dynamic child patched at first page script:', await frame('patchedAtStart', dynamic));
    assert.equal(await frame('Boolean(document[Symbol.for("prism.focus-state.v1")])', dynamic), true, 'new cross-origin frames inherit the selected top-level site');
    await assertSwitchesHidden(dynamic, 'dynamic child');
    const nested = `${childOrigin}/embedded?nested`;
    await frame(`(() => { const child = document.createElement('iframe'); child.src = ${JSON.stringify(nested)}; document.body.append(child); })()`, dynamic);
    await ready(nested);
    await wait(async () => (await tab(primaryId)).focusStatus?.status === 'active', 'nested-frame activation');
    assert.equal(await frame('Boolean(document[Symbol.for("prism.focus-state.v1")])', nested), true, 'nested frames inherit the selected top-level site');
    await assertSwitchesHidden(nested, 'nested child');
    console.log('PASS dynamic and nested frames inherit the selected top-level site');

    await shell.locator('#focus-toggle').click();
    await wait(async () => (await tab(primaryId)).focusStatus?.status === 'inactive', 'disable');
    for (const url of [initial, dynamic, nested]) {
      assert.equal(await frame('Boolean(document[Symbol.for("prism.focus-state.v1")])', url), false, `disable restores ${url}`);
    }
    await assertNativeEvents(initial, primary, 'restored child');
    console.log('PASS disabling spoof restores native cross-origin frame focus behavior');
  } finally {
    if (application) await application.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
