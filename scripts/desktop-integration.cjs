'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');

// Also accepts the unpacked release binary, exercising its actual asar and icon.
(async () => {
  const project = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prism-desktop-check-'));
  const server = http.createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Desktop keyboard fixture</title><input autofocus>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const env = { ...process.env, PRISM_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  try {
    const args = process.env.PRISM_TEST_EXECUTABLE ? [] : [project];
    // Select X11 for the native icon-property check; Wayland exposes no XID.
    if (process.platform === 'linux' && process.env.DISPLAY) args.push('--ozone-platform=x11');
    application = await _electron.launch({ executablePath: process.env.PRISM_TEST_EXECUTABLE || require('electron'), args, env });
    const shell = await application.firstWindow();
    await shell.waitForFunction(() => Boolean(window.prism));
    const waitForState = async (matches, label) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        if (matches(await shell.evaluate(() => window.prism.invoke('get-state')))) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${label}`);
    };
    await waitForState(state => Boolean(state.activeTabId), 'initial active tab');
    const details = await application.evaluate(({ app, BrowserWindow, nativeImage }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const icon = nativeImage.createFromPath(`${app.getAppPath()}/build/icon.png`);
      return { version: app.getVersion(), packaged: app.isPackaged, sandboxDisabled: app.commandLine.hasSwitch('no-sandbox'), shellSandbox: window.webContents.getLastWebPreferences().sandbox, iconSize: icon.getSize(), nativeWindowId: window.getNativeWindowHandle().readUInt32LE(0) };
    });
    assert.equal(details.version, require('../package.json').version);
    assert.equal(details.sandboxDisabled, false);
    assert.equal(details.shellSandbox, true);
    assert.deepEqual(details.iconSize, { width: 512, height: 512 });
    if (process.env.PRISM_TEST_EXECUTABLE) assert.equal(details.packaged, true);
    if (process.platform === 'linux' && process.env.DISPLAY) {
      const properties = execFileSync('xprop', ['-id', String(details.nativeWindowId), '-notype', '-f', '_NET_WM_ICON', '32c', '_NET_WM_ICON', 'WM_CLASS'], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
      assert.match(properties, /_NET_WM_ICON = 512, 512,/, 'native window has the custom icon');
      if (details.packaged) assert.match(properties, /WM_CLASS = .*prism-browser/i);
    }
    const state = await shell.evaluate(() => window.prism.invoke('get-state'));
    assert.equal(state.adblock.ready, true);
    await shell.evaluate(url => window.prism.invoke('navigate', { url }), url);
    await waitForState(state => state.tabs.some(tab => tab.url === url && !tab.loading), 'fixture loaded');
    const attempts = Math.max(1, Math.min(8, Number(process.env.PRISM_NATIVE_ATTEMPTS) || 1));
    for (let attempt = 0; attempt < attempts; attempt++) {
      await shell.evaluate(id => window.prism.invoke('tab-activate', {id}), state.activeTabId);
      const trace = await application.evaluate(async ({ webContents }, url) => {
        const guest = webContents.getAllWebContents().find(contents => contents.getURL() === url);
        if (!guest) throw new Error('Fixture web contents missing.');
        guest.focus();
        guest.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
        guest.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] });
        // Type through the native focused WebContents, including while the new
        // tab's asynchronous document instrumentation is still being installed.
        const trace = [];
        for (const letter of 'quick search') {
          await new Promise(resolve => setTimeout(resolve, 15));
          const focused = webContents.getFocusedWebContents();
          if (!focused) throw new Error('New tab lost native keyboard focus.');
          trace.push({letter, id: focused.id, url: focused.getURL()});
          focused.sendInputEvent({ type: 'char', keyCode: letter });
        }
        return trace;
      }, url);
      try {
        await shell.waitForFunction(() => document.activeElement?.id === 'home-address' && document.querySelector('#home-address').value === 'quick search');
      } catch (error) {
        console.error('Native input trace:', trace);
        console.error('New-tab state:', await shell.evaluate(async () => ({ active: document.activeElement?.id, search: document.querySelector('#home-address').value, address: document.querySelector('#address').value, state: await window.prism.invoke('get-state') })));
        throw error;
      }
    }
    await shell.locator('#new-tab').click();
    await shell.keyboard.type('another search');
    await shell.waitForFunction(() => document.activeElement?.id === 'home-address' && document.querySelector('#home-address').value === 'another search');
    console.log(JSON.stringify({ passed: true, ...details, adblockReady: true, nativeTypingAttempts: attempts, checks: ['runtime version and sandbox', 'packaged icon asset and native window icon', 'guest Ctrl+T with immediate native typing', 'new-tab button with immediate typing'] }));
  } finally {
    await application?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
