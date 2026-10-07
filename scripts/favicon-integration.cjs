'use strict';

// Real Chromium session test: authenticated icon fetching, strict-CSP SVG
// rasterization, reload persistence, and cross-origin icon replacement.
// Uses loopback only and a fresh profile/cache for every run.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');

const project = path.resolve(__dirname, '..');
const profile = path.resolve(project, '../../work/favicon-qa', `${Date.now()}`);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const iconRequests = [];
let decoderProbeRequests = 0;
let electronApp, shell;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const otherOrigin = request.headers.host.startsWith('localhost:');
  if (url.pathname === '/decoder-network-probe') { decoderProbeRequests++; response.end('unexpected decoder network access'); return; }
  if (url.pathname === '/protected.png') {
    iconRequests.push({ cookie: request.headers.cookie, destination: request.headers['sec-fetch-dest'] });
    if (!request.headers.cookie?.includes('icon-access=allowed')) { response.writeHead(403); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); response.end(png); return;
  }
  if (url.pathname === '/icon.svg') {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    response.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#a988ff"/></svg>'); return;
  }
  if (url.pathname === '/favicon.ico') {
    response.writeHead(otherOrigin ? 404 : 200, { 'Content-Type': 'image/png' }); response.end(otherOrigin ? '' : png); return;
  }
  const icon = url.pathname === '/svg' ? '/icon.svg?strict-csp=1' : '/protected.png';
  response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Set-Cookie': 'icon-access=allowed; Path=/; HttpOnly; SameSite=Lax', ...(url.pathname === '/svg' ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self'" } : {}) });
  response.end(`<!doctype html><title>Favicon fixture</title>${otherOrigin || url.pathname === '/fallback' ? '' : `<link rel="icon" href="${icon}">`}<p>Local favicon fixture</p>`);
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, label) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { const result = await check(); if (result) return result; await sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
async function invoke(action, payload = {}) { return shell.evaluate(({ action, payload }) => window.prism.invoke(action, payload), { action, payload }); }
async function current() { const state = await invoke('get-state'); return state.tabs.find(tab => tab.id === state.activeTabId); }
async function navigate(url) {
  await invoke('navigate', { url });
  await waitFor(async () => { const tab = await current(); return tab.url === url && !tab.loading; }, 'navigation');
}

(async () => {
  await fs.mkdir(profile, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const otherOrigin = `http://localhost:${server.address().port}`;
  try {
    const env = { ...process.env, PRISM_PROFILE: profile, DISPLAY: process.env.DISPLAY || ':0' }; delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await _electron.launch({ executablePath: require('electron'), args: [project], env });
    shell = await electronApp.firstWindow();
    await shell.waitForFunction(() => typeof window.prism?.invoke === 'function');
    await waitFor(async () => Boolean(await current()), 'initial tab');
    await navigate(`${origin}/page`);
    const initial = await waitFor(async () => (await current()).favicon, 'cookie protected PNG');
    assert.match(initial, /^data:image\/png;base64,/);
    assert.ok(iconRequests.some(request => request.cookie?.includes('icon-access=allowed') && request.destination === 'empty'), 'session fetch included protected cookie');
    console.log('PASS cookie-protected image uses browsing session and becomes bounded PNG');

    await invoke('reload');
    assert.equal((await current()).favicon, initial, 'reload should immediately retain icon');
    await waitFor(async () => !(await current()).loading, 'reload finished');
    assert.equal((await current()).favicon, initial);
    console.log('PASS favicon retained throughout same-origin reload');

    const navigationState = await invoke('navigate', { url: `${otherOrigin}/no-icon` });
    const navigating = navigationState.tabs.find(tab => tab.id === navigationState.activeTabId);
    assert.equal(navigating.url, `${otherOrigin}/no-icon`);
    assert.equal(navigating.favicon, '', 'initial navigation snapshot must not pair new origin with old icon');
    await waitFor(async () => !(await current()).loading, 'iconless page navigation');
    assert.equal((await current()).favicon, '', 'old-origin icon must be cleared');
    await waitFor(() => shell.evaluate(id => {
      const tab = [...document.querySelectorAll('[data-tab-id]')].find(node => node.dataset.tabId === id);
      const image = tab?.querySelector('.tab-favicon');
      return image?.hidden && !image.hasAttribute('src') && !tab.classList.contains('has-favicon');
    }, navigationState.activeTabId), 'cross-origin tab icon cleared in shell DOM');
    console.log('PASS cross-origin navigation clears previous website icon in first snapshot and shell DOM');

    await navigate(`${origin}/svg`);
    const svg = await waitFor(async () => { const value = (await current()).favicon; return value && value !== initial ? value : ''; }, 'SVG rasterization');
    assert.match(svg, /^data:image\/png;base64,/);
    assert.ok(svg.length < 128 * 1024);
    console.log('PASS SVG from strict-CSP website decoded in owned sandbox and delivered as bounded PNG');

    const decoderSecurity = await electronApp.evaluate(async ({ webContents, BrowserWindow, session }, { origin, dataImage }) => {
      const contents = webContents.getAllWebContents();
      const page = contents.find(wc => wc.getURL() === `${origin}/svg`);
      const decoder = contents.find(wc => wc.getURL().startsWith('data:text/html') && wc.getTitle() === 'Prism favicon decoder');
      if (!page || !decoder) throw new Error('Decoder or fixture unavailable.');
      const prefs = decoder.getLastWebPreferences();
      const siteDataImageBlocked = await page.executeJavaScript(`new Promise(resolve => { const image = new Image(); image.onload = () => resolve(false); image.onerror = () => resolve(true); image.src = ${JSON.stringify(dataImage)}; })`);
      let externalRequestBlocked = false;
      try { await decoder.session.fetch(`${origin}/decoder-network-probe`); } catch { externalRequestBlocked = true; }
      return { siteDataImageBlocked, externalRequestBlocked, separateSession: decoder.session !== session.fromPartition('persist:prism-default'),
        browserWindows: BrowserWindow.getAllWindows().length, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation,
        nodeIntegration: prefs.nodeIntegration, webSecurity: prefs.webSecurity, preload: prefs.preload || '', backgroundThrottling: decoder.getBackgroundThrottling() };
    }, { origin, dataImage: `data:image/png;base64,${png.toString('base64')}` });
    assert.deepEqual(decoderSecurity, { siteDataImageBlocked: true, externalRequestBlocked: true, separateSession: true,
      browserWindows: 1, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: '', backgroundThrottling: false });
    assert.equal(decoderProbeRequests, 0);
    console.log('PASS decoder isolation/network denial verified and website CSP remains enforced');

    await navigate(`${otherOrigin}/no-icon`);
    await navigate(`${origin}/fallback`);
    await waitFor(async () => (await current()).favicon === initial, 'same-origin favicon.ico fallback');
    console.log('PASS same-origin favicon.ico fallback');
  } finally {
    if (electronApp) await electronApp.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
