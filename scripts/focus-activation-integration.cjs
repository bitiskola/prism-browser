'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let application, shell, primary, background, originalId, profile;
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Focus activation fixture</title><p id="console"></p><input><script>
    const log = document.getElementById('console');
    window.onfocus = () => { log.textContent += 'FOCUS\\n'; };
    window.onblur = () => { log.textContent += 'BLUR\\n'; };
  </script>`);
});
async function wait(check, label, timeout = 15000) {
  const until = Date.now() + timeout; let last;
  while (Date.now() < until) {
    try { const result = await check(); if (result) return result; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`Timed out: ${label}${last ? ` (${last.message})` : ''}`);
}
const invoke = (action, payload = {}) => shell.evaluate(({ action, payload }) => window.prism.invoke(action, payload), { action, payload });
const tab = async () => (await invoke('get-state')).tabs.find(value => value.id === originalId);
async function page(source) {
  return application.evaluate(async ({ webContents }, { url, source }) => {
    const wc = webContents.getAllWebContents().find(value => value.getURL() === url);
    if (!wc) throw new Error('Focus fixture unavailable');
    return wc.executeJavaScript(source, false);
  }, { url: primary, source });
}
async function launch() {
  const env = { ...process.env, PRISM_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: process.env.PRISM_TEST_EXECUTABLE || require('electron'), args: process.env.PRISM_TEST_EXECUTABLE ? [] : [project], env });
  shell = await application.firstWindow();
  await shell.waitForFunction(() => Boolean(window.prism));
  // Playwright's predicate treats a Promise as truthy. Poll IPC from Node instead.
  await wait(async () => (await invoke('get-state')).activeTabId, 'initial active tab');
}
async function switchWindow() {
  const id = await application.evaluate(({ BrowserWindow, webContents }, url) => {
    BrowserWindow.getAllWindows()[0].focus();
    webContents.getAllWebContents().find(value => value.getURL() === url).focus();
    const other = new BrowserWindow({ width: 320, height: 200, show: true, webPreferences: { sandbox: true } });
    other.focus(); return other.id;
  }, primary);
  await delay(150);
  await application.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id).close(); BrowserWindow.getAllWindows()[0].focus(); }, id);
  await delay(150);
}
async function overrideFrame(url, mode) {
  await application.evaluate(({ webContents }, { url, mode }) => {
    const frame = webContents.getAllWebContents().find(value => value.getURL() === url).mainFrame;
    globalThis.__prismFrameRestores ||= [];
    const original = frame.executeJavaScript;
    const pending = [];
    frame.executeJavaScript = function(source, userGesture) {
      if (mode === 'reject') return Promise.reject(new Error('Fixture rejected document injection'));
      return new Promise((resolve, reject) => pending.push({ source, userGesture, resolve, reject }));
    };
    globalThis.__prismFrameRestores.push(() => {
      frame.executeJavaScript = original;
      for (const item of pending) original.call(frame, item.source, item.userGesture).then(item.resolve, item.reject);
    });
  }, { url, mode });
}
async function restoreFrames() {
  await application.evaluate(() => { for (const restore of globalThis.__prismFrameRestores || []) restore(); globalThis.__prismFrameRestores = []; });
}
(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-activation-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  primary = process.env.PRISM_FOCUS_TEST_URL || `http://127.0.0.1:${server.address().port}/focus`;
  background = `http://localhost:${server.address().port}/background`;
  try {
    await launch(); originalId = (await invoke('get-state')).activeTabId;
    await invoke('navigate', { url: primary });
    await wait(() => page('document.readyState === "complete" && Boolean(document.getElementById("console"))'), 'focus test page');
    await shell.locator('#focus-toggle').click();
    await wait(async () => (await tab()).focusStatus?.status === 'active', 'live activation');
    await shell.waitForFunction(() => document.querySelector('#focus-toggle').classList.contains('active') && !document.querySelector('#focus-toggle').disabled);
    const before = await page('document.getElementById("console").textContent');
    await switchWindow();
    await invoke('tab-new'); await delay(150);
    assert.equal(await page('document.getElementById("console").textContent'), before, 'enabled window.onblur/onfocus must not observe tab/window switching');
    await invoke('tab-activate', { id: originalId });
    console.log('PASS live toolbar activation with pre-existing window.onblur and tab/window switching');

    await invoke('tab-new', { url: background });
    await wait(() => application.evaluate(({webContents}, url) => webContents.getAllWebContents().some(wc => wc.getURL() === url && !wc.isLoading()), background), 'background fixture');
    await invoke('tab-activate', { id: originalId });
    await overrideFrame(background, 'block');
    const state = await invoke('get-state');
    const beforeRuleSave = await page('document.getElementById("console").textContent');
    const started = Date.now();
    await Promise.race([invoke('rules-save', { rules: [...state.rules, { host: 'unrelated.example', focus: true }] }), delay(2500).then(() => { throw new Error('Unrelated blocked renderer stalled the active rule save'); })]);
    assert.ok(Date.now() - started < 2500);
    assert.equal((await tab()).focusStatus.status, 'active');
    assert.equal(await page('document.getElementById("console").textContent'), beforeRuleSave, 'unrelated rule changes must not emit focus events');
    await restoreFrames();
    console.log('PASS an unresponsive background document cannot stall active-tab activation');

    await overrideFrame(primary, 'reject');
    await invoke('focus-retry', { id: originalId });
    await wait(async () => (await tab()).focusStatus.status === 'error', 'visible apply failure');
    assert.match((await tab()).focusStatus.error, /Fixture rejected/);
    await restoreFrames();
    await invoke('focus-retry', { id: originalId });
    assert.equal((await tab()).focusStatus.status, 'active');
    assert.equal((await tab()).focusError, '');
    console.log('PASS application failure is visible and retry clears it');

    await application.evaluate(({webContents}, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url).debugger.detach(), primary);
    await wait(async () => (await tab()).focusStatus.status === 'unavailable', 'debugger disconnect status');
    await invoke('focus-retry', { id: originalId });
    assert.equal((await tab()).focusStatus.status, 'active');
    console.log('PASS disconnected page controls reconnect without changing saved rule');

    await invoke('devtools');
    assert.equal((await tab()).focusStatus.status, 'suspended');
    await invoke('focus-retry', { id: originalId });
    assert.equal((await tab()).focusStatus.status, 'suspended');
    await application.evaluate(({webContents}, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url).closeDevTools(), primary);
    await wait(async () => (await tab()).focusStatus.status === 'active', 'resume after DevTools close');
    console.log('PASS DevTools suspension is explicit and closing it resumes controls');

    for (let attempt = 0; attempt < 3; attempt++) {
      await shell.locator('#focus-toggle').click();
      await wait(async () => (await tab()).focusStatus.status === 'inactive', 'disable');
      await shell.waitForFunction(() => !document.querySelector('#focus-toggle').disabled);
      assert.equal(await page('Boolean(document[Symbol.for("prism.focus-state.v1")])'), false);
      await shell.locator('#focus-toggle').click();
      await wait(async () => (await tab()).focusStatus.status === 'active', 're-enable');
      await shell.waitForFunction(() => !document.querySelector('#focus-toggle').disabled);
    }
    console.log('PASS repeated toolbar off/on cycles restore and reapply controls');
    await application.close(); application = null;
    await launch(); originalId = (await invoke('get-state')).activeTabId;
    await wait(async () => (await tab()).focusStatus.status === 'active', 'persisted activation');
    await wait(() => page('document.readyState === "complete"'), 'restored page');
    const restored = await page('document.getElementById("console").textContent');
    await switchWindow();
    assert.equal(await page('document.getElementById("console").textContent'), restored);
    console.log('PASS saved spoof rule reapplies after a full relaunch');
  } finally {
    if (application) { await restoreFrames().catch(() => {}); await application.close(); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
