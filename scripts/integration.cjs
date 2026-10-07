'use strict';

// Runs a real sandboxed Electron browser against an ephemeral loopback fixture.
// All cookies, browser profiles, logs, and screenshots stay under work/prism-qa.
// A host-installed Chromium sandbox helper can be selected through
// CHROME_DEVEL_SANDBOX when required by the desktop environment. This script
// preserves that environment setting and never supplies --no-sandbox.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { _electron } = require('playwright');

const project = path.resolve(__dirname, '..');
const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const output = path.resolve(project, '../../work/prism-qa', runId);
const profile = path.join(output, 'profile');
const results = [];
const runtimeLog = [];
const sockets = new Set();
let electronApp;
let shell;
let server;
let selected;
let unselected;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
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

function websocketFrame(text, opcode = 1) {
  const payload = Buffer.from(text);
  if (payload.length >= 126) throw new Error('Fixture messages must fit a short WebSocket frame.');
  return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
}
async function startFixture() {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    if (url.pathname === '/redirect-out') {
      response.writeHead(302, { Location: `${unselected}/private`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (url.pathname === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      response.write('id: one\nevent: message\ndata: {"stream":1}\n\n');
      const timer = setTimeout(() => { if (!response.destroyed) response.write('id: two\nevent: message\ndata: {"stream":2}\n\n'); }, 100);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (url.pathname === '/echo') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; if (body.length > 65536) request.destroy(); });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Prism-Fixture': 'echo' });
        response.end(JSON.stringify({ method: request.method, body, cookie: request.headers.cookie || '' }));
      });
      return;
    }
    if (url.pathname === '/private-data') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end('{"privateFixture":true}');
      return;
    }
    if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html><head><title>Prism local integration fixture</title><link rel="icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="></head>
      <body><h1>Prism fixture</h1><p>Local browser integration checks.</p><input id="editable" placeholder="Editable field">
      <script>window.fixtureReady = true; ${url.pathname === '/private' ? "fetch('/private-data').then(r=>r.json()).then(value=>window.privateReady=value.privateFixture);" : ''}</script></body></html>`);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    if (request.url !== '/socket' || !request.headers['sec-websocket-key']) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(`${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(websocketFrame('{"hello":"prism"}'));
    let buffered = Buffer.alloc(0);
    socket.on('data', data => {
      buffered = Buffer.concat([buffered, data]);
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 15;
        const masked = Boolean(buffered[1] & 128);
        const length = buffered[1] & 127;
        if (length >= 126) { socket.destroy(); return; }
        const headerLength = masked ? 6 : 2;
        if (buffered.length < headerLength + length) return;
        const payload = Buffer.from(buffered.subarray(headerLength, headerLength + length));
        if (masked) for (let index = 0; index < payload.length; index++) payload[index] ^= buffered[2 + index % 4];
        buffered = buffered.subarray(headerLength + length);
        if (opcode === 8) { socket.end(websocketFrame('', 8)); return; }
        if (opcode === 1) socket.write(websocketFrame(payload.toString('utf8')));
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  selected = `http://127.0.0.1:${port}`;
  unselected = `http://localhost:${port}`;
}

async function launch() {
  const env = { ...process.env, PRISM_PROFILE: profile, DISPLAY: process.env.DISPLAY || ':0' };
  delete env.ELECTRON_RUN_AS_NODE;
  electronApp = await _electron.launch({ executablePath: require('electron'), args: [project], env, timeout: 30000 });
  const child = electronApp.process();
  child.stderr?.on('data', data => { if (runtimeLog.length < 500) runtimeLog.push(data.toString().slice(0, 4000)); });
  shell = await electronApp.firstWindow();
  await shell.waitForFunction(() => typeof window.prism?.invoke === 'function');
  await waitFor(async () => Boolean((await invoke('get-state')).activeTabId), 'initial browser tab ready');
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
  await waitFor(() => pageValue(url, 'document.readyState === "complete" && window.fixtureReady === true'), `navigation to ${url}`);
}
async function entries() { return invoke('network-list'); }
async function closeApplication() {
  if (!electronApp) return;
  const current = electronApp;
  electronApp = null;
  await current.close();
  shell = null;
}

async function main() {
  await fs.mkdir(profile, { recursive: true });
  let persistentTabId;
  const cookieValue = `remember-${runId}`;
  try {
    await step('loopback HTTP and stream fixture', startFixture);
    await step('launch with Chromium sandbox enabled and an isolated test profile', async () => {
      await launch();
      const native = await electronApp.evaluate(({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        const remote = window.contentView.children.find(view => view.webContents && view.webContents !== window.webContents);
        return { switches: app.commandLine.hasSwitch('no-sandbox'), remote: remote?.webContents.getLastWebPreferences(), shell: window.webContents.getLastWebPreferences() };
      });
      assert.equal(native.switches, false, 'The test must not disable Chromium sandboxing');
      assert.equal(native.remote.sandbox, true);
      assert.equal(native.remote.contextIsolation, true);
      assert.equal(native.remote.nodeIntegration, false);
      assert.equal(native.shell.sandbox, true);
      assert.equal(native.shell.contextIsolation, true);
      const state = await invoke('get-state');
      assert.equal(state.profilePath, profile);
      assert.ok(state.tabs.every(tab => !tab.inspectorError), JSON.stringify(state.tabs));
      return { profile, sandbox: true };
    });

    await step('real HTTP navigation and isolated website context', async () => {
      await invoke('rules-save', { rules: [{ host: '127.0.0.1', includeSubdomains: false, monitor: true, focus: true }] });
      await navigate(`${selected}/page`);
      persistentTabId = (await invoke('get-state')).activeTabId;
      const favicon = await waitFor(async () => {
        const tab = (await invoke('get-state')).tabs.find(item => item.id === persistentTabId);
        return tab?.favicon || null;
      }, 'tab favicon');
      assert.match(favicon, /^(?:https?:|data:image\/)/i);
      const capabilities = await pageValue(`${selected}/page`, '({ require: typeof require, process: typeof process, prism: typeof window.prism })');
      assert.deepEqual(capabilities, { require: 'undefined', process: 'undefined', prism: 'undefined' });
      const documentEntry = await waitFor(async () => (await entries()).find(entry => entry.url === `${selected}/page` && entry.type === 'Document' && entry.status === 200), 'captured initial document');
      return { documentId: documentEntry.id, capabilities, favicon: true };
    });

    await step('POST request headers, request body and response body', async () => {
      const body = JSON.stringify({ source: 'prism-integration', value: 42 });
      const response = await pageValue(`${selected}/page`, `fetch('/echo', {method:'POST',headers:{'Content-Type':'application/json','X-Prism-Test':'local-only'},body:${JSON.stringify(body)}}).then(response=>response.json())`);
      assert.equal(response.body, body);
      const entry = await waitFor(async () => (await entries()).find(item => item.url === `${selected}/echo` && item.method === 'POST' && item.responseBody.includes('prism-integration')), 'captured POST body');
      assert.equal(entry.postData, body);
      assert.equal(entry.status, 200);
      assert.ok(Object.entries(entry.requestHeaders).some(([name, value]) => name.toLowerCase() === 'x-prism-test' && value === 'local-only'));
      assert.ok(Object.entries(entry.responseHeaders).some(([name, value]) => name.toLowerCase() === 'x-prism-fixture' && value === 'echo'));
      return { requestId: entry.id, status: entry.status };
    });

    await step('real WebSocket frames and EventSource messages', async () => {
      const messages = await pageValue(`${selected}/page`, `new Promise((resolve,reject)=>{
        const result={websocket:[],sse:[]};
        const ws=new WebSocket(${JSON.stringify(`${selected.replace('http:', 'ws:')}/socket`)});
        const es=new EventSource('/events');
        const timeout=setTimeout(()=>{ws.close();es.close();reject(new Error('stream fixture timeout'));},8000);
        const done=()=>{if(result.websocket.length>=2&&result.sse.length>=2){clearTimeout(timeout);ws.close();es.close();resolve(result);}};
        ws.onopen=()=>ws.send('{"ping":"prism"}');
        ws.onmessage=event=>{result.websocket.push(event.data);done();};
        ws.onerror=()=>reject(new Error('WebSocket fixture failed'));
        es.onmessage=event=>{result.sse.push(event.data);done();};
        es.onerror=()=>reject(new Error('EventSource fixture failed'));
      })`);
      assert.equal(messages.websocket.length, 2);
      assert.equal(messages.sse.length, 2);
      const captured = await waitFor(async () => {
        const list = await entries();
        const ws = list.find(entry => entry.type === 'WebSocket' && entry.frames.some(frame => frame.direction === 'sent') && entry.frames.some(frame => frame.direction === 'received'));
        const sse = list.find(entry => entry.type === 'EventSource' && entry.frames.filter(frame => frame.kind === 'sse').length >= 2);
        return ws && sse ? { ws, sse } : null;
      }, 'captured streaming communication');
      return { websocketMessages: captured.ws.frames.length, eventSourceMessages: captured.sse.frames.length };
    });

    await step('capture pause and resume work against live traffic', async () => {
      await invoke('network-pause', { paused: true });
      await pageValue(`${selected}/page`, "fetch('/echo?paused=1').then(response=>response.text())");
      assert.ok(!(await entries()).some(entry => entry.url.includes('paused=1')));
      await invoke('network-pause', { paused: false });
      await pageValue(`${selected}/page`, "fetch('/echo?resumed=1').then(response=>response.text())");
      await waitFor(async () => (await entries()).some(entry => entry.url.includes('resumed=1') && entry.status === 200), 'traffic after resume');
    });

    await step('selected background tab focus spoof and reversible opt-out', async () => {
      await invoke('tab-new', { url: `${unselected}/private` });
      await waitFor(() => pageValue(`${unselected}/private`, 'window.privateReady === true'), 'unselected tab load');
      const background = await pageValue(`${selected}/page`, '({ hasFocus:document.hasFocus(), hidden:document.hidden, visibility:document.visibilityState, patched:Object.hasOwn(document,"hasFocus") })');
      assert.deepEqual(background, { hasFocus: true, hidden: false, visibility: 'visible', patched: true });
      const unrelated = await pageValue(`${unselected}/private`, '({patched:Object.hasOwn(document,"hasFocus"),prism:typeof window.prism})');
      assert.deepEqual(unrelated, { patched: false, prism: 'undefined' });
      await invoke('rules-save', { rules: [{ host: '127.0.0.1', includeSubdomains: false, monitor: true, focus: false }] });
      const restored = await pageValue(`${selected}/page`, '({ hasFocus:document.hasFocus(), patched:Object.hasOwn(document,"hasFocus"), state:!!document[Symbol.for("prism.focus-state.v1")] })');
      assert.equal(restored.patched, false);
      assert.equal(restored.state, false);
      assert.equal(restored.hasFocus, false);
      await invoke('rules-save', { rules: [{ host: '127.0.0.1', includeSubdomains: false, monitor: true, focus: true }] });
      return { background, restored, unrelated };
    });

    await step('redirect capture stops at the selected hostname boundary', async () => {
      await invoke('network-clear');
      await invoke('navigate', { url: `${selected}/redirect-out` });
      await waitFor(() => pageValue(`${unselected}/private`, 'window.privateReady === true'), 'redirected unselected page');
      await delay(250);
      const captured = await entries();
      assert.ok(captured.some(entry => entry.url === `${selected}/redirect-out`), 'Selected initial redirect request must be captured');
      assert.ok(captured.every(entry => new URL(entry.pageUrl).hostname === '127.0.0.1'));
      assert.ok(captured.every(entry => !entry.url.startsWith(unselected)), 'Unselected redirected page and its traffic must be excluded');
      return captured.map(({ url, status, pageUrl }) => ({ url, status, pageUrl }));
    });

    await step('javascript navigation is rejected through the trusted IPC surface', async () => {
      const beforeState = await invoke('get-state');
      const before = beforeState.tabs.find(tab => tab.id === beforeState.activeTabId);
      let rejected = false;
      try { await invoke('navigate', { url: 'javascript:window.__prismUnexpectedExecution=true' }); } catch { rejected = true; }
      assert.equal(rejected, true, 'Unsupported scheme must reject the IPC request');
      assert.equal(await pageValue(before.url, 'typeof window.__prismUnexpectedExecution'), 'undefined');
      const afterState = await invoke('get-state');
      assert.equal(afterState.tabs.find(tab => tab.id === afterState.activeTabId).url, before.url);
    });

    await step('persistent cookie and localStorage are written to the dedicated profile', async () => {
      await invoke('tab-activate', { id: persistentTabId });
      await navigate(`${selected}/persist`);
      await pageValue(`${selected}/persist`, `document.cookie=${JSON.stringify(`prism_persist=${cookieValue}; Max-Age=86400; SameSite=Lax; Path=/`)};localStorage.setItem('prism-persist',${JSON.stringify(cookieValue)});true`);
      await invoke('bookmark-toggle');
      const cookies = await invoke('cookies-list', { url: selected });
      const cookie = cookies.find(item => item.name === 'prism_persist');
      assert.equal(cookie.value, cookieValue);
      assert.ok(cookie.expirationDate > Date.now() / 1000);
      assert.equal(await pageValue(`${selected}/persist`, "localStorage.getItem('prism-persist')"), cookieValue);
      await shell.screenshot({ path: path.join(output, 'browser-before-relaunch.png') });
      await closeApplication();
    });

    await step('cookies, localStorage, tabs and bookmarks survive a full app relaunch', async () => {
      await launch();
      await waitFor(() => pageValue(`${selected}/persist`, 'document.readyState === "complete" && window.fixtureReady === true'), 'restored persistent tab');
      const restored = await pageValue(`${selected}/persist`, '({cookie:document.cookie,storage:localStorage.getItem("prism-persist")})');
      assert.ok(restored.cookie.includes(`prism_persist=${cookieValue}`));
      assert.equal(restored.storage, cookieValue);
      const state = await invoke('get-state');
      assert.ok(state.bookmarks.some(item => item.url === `${selected}/persist`));
      assert.ok(state.tabs.some(tab => tab.url === `${selected}/persist`));
      assert.equal(state.rules[0].host, '127.0.0.1');
      await shell.screenshot({ path: path.join(output, 'browser-after-relaunch.png') });
      return { persistentCookie: true, localStorage: true, tabs: state.tabs.length, bookmarks: state.bookmarks.length };
    });
    console.log(`PASS all ${results.length} integration checks. Report: ${path.join(output, 'report.json')}`);
  } finally {
    if (shell && !shell.isClosed()) await shell.screenshot({ path: path.join(output, 'final-state.png') }).catch(() => {});
    await closeApplication().catch(error => runtimeLog.push(`Shutdown: ${error.message}`));
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ runId, selected, unselected, profile, sandboxDisabled: false, results, runtimeLog }, null, 2));
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
