'use strict';

const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, Menu, shell, nativeImage, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { navigationURL, normalizeRules, normalizeHost, isWebURL } = require('./policy.cjs');
const { FaviconController, createImageDecoder } = require('./favicon.cjs');
const { makeCookieExport, parseCookieExportText, cookieSetDetails, cookieDomainInScope, MAX_FILE_BYTES } = require('./cookies.cjs');
const { NetworkMonitor } = require('./network.cjs');
const { FocusController } = require('./focus.cjs');
const { DEFAULT_PREFERENCES, SEARCH_ENGINES, normalizeSearch, normalizeProxy, publicProxyConfig, normalizeTyping } = require('./preferences.cjs');
const { ProxyController } = require('./proxy.cjs');
const { AdblockController, normalizeAdblockSettings } = require('./adblock.cjs');
const { ClipboardTyping } = require('./clipboard-typing.cjs');

app.setName('Prism Browser');
if (process.platform === 'linux') app.setDesktopName('prism-browser.desktop');
if (process.env.PRISM_PROFILE) app.setPath('userData', path.resolve(process.env.PRISM_PROFILE));
if (!app.requestSingleInstanceLock()) app.exit(0);
app.enableSandbox();
const profile = app.getPath('userData');
const stateFile = path.join(profile, 'browser-state.json');
const shellFile = path.join(__dirname, '../renderer/index.html');
let win, browserSession, proxy, adblock, favicons, connectionError = '', activeTabId, viewport = { x: 220, y: 100, width: 900, height: 650, visible: true };
let saveTimer, stateTimer, closing = false, flushed = false, proxyChangesInFlight = 0;
let faviconDecoderView, faviconDecoderReady, faviconDecoderShutdown = false;
let data = { rules: [], bookmarks: [], history: [], tabs: [], activeIndex: 0,
  search: { ...DEFAULT_PREFERENCES.search }, typing: { ...DEFAULT_PREFERENCES.typing }, proxy: publicProxyConfig(DEFAULT_PREFERENCES.proxy),
  adblock: { enabled: true, allowlist: [], blocklist: [] } };
const tabs = new Map();
const downloads = new Map();
const grants = new Set();
const emit = (event, value) => { if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(`prism:${event}`, value); };
const toast = message => emit('toast', { message });
const clipboardTyping = new ClipboardTyping({
  readText: () => clipboard.readText(), notify: toast, getSpeed: () => data.typing.speed,
  canType: wc => Boolean(win && !win.isDestroyed() && win.isFocused() && !wc.isDestroyed() && wc.isFocused()
    && (wc === win.webContents || (active()?.view.webContents === wc && viewport.visible)))
});
const monitor = new NetworkMonitor({ getRules: () => data.rules, emit: (event, value) => { emit(event, value); scheduleState(); } });
const focus = new FocusController({ getRules: () => data.rules,
  onError: (error, id) => { const tab = tabs.get(id); if (tab) { tab.focusError = error.message; scheduleState(); } },
  onStatus: (status, id) => { const tab = tabs.get(id); if (tab) { tab.focusStatus = status; tab.focusError = status.error || ''; scheduleState(); } }
});
app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    data.rules = normalizeRules(saved.rules || []);
    data.bookmarks = (saved.bookmarks || []).filter(x => isWebURL(x.url)).slice(0, 500);
    data.history = (saved.history || []).filter(x => isWebURL(x.url)).slice(0, 1000);
    data.tabs = (saved.tabs || []).filter(x => x === 'about:blank' || isWebURL(x)).slice(0, 30);
    data.activeIndex = Math.max(0, Number(saved.activeIndex) || 0);
    try { data.search = normalizeSearch(saved.search); } catch { /* Keep defaults for invalid legacy preferences. */ }
    try { data.typing = normalizeTyping(saved.typing); } catch { /* Keep normal speed for invalid saved preferences. */ }
    try { data.proxy = publicProxyConfig(normalizeProxy({ ...saved.proxy, username: '', password: '' })); } catch { /* Keep direct defaults for malformed settings. */ }
    try { data.adblock = normalizeAdblockSettings(saved.adblock || data.adblock); } catch { /* Keep default filter settings. */ }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Could not restore browser state:', error.message); }
}
function saveState() {
  clearTimeout(saveTimer);
  if (!closing) {
    data.tabs = [...tabs.values()].map(t => t.url);
    data.activeIndex = [...tabs.keys()].indexOf(activeTabId);
  }
  try {
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(`${stateFile}.tmp`, stateFile);
  } catch (error) { toast(`Could not save your profile: ${error.message}`); }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 350); }
function active() { return tabs.get(activeTabId); }
function tabState(t) {
  const wc = t.view.webContents;
  const focusStatus = !wc.isDestroyed() && (t.devtoolsRequested || wc.isDevToolsOpened())
    ? { status: 'suspended', error: 'Close Developer Tools to resume spoof mode.' }
    : t.focusStatus || { status: 'unavailable', error: 'Page controls are not connected. Retry to reconnect.' };
  return { id: t.id, url: t.url, title: t.title, loading: t.loading, error: t.error, favicon: t.favicon || '',
    canGoBack: !wc.isDestroyed() && wc.navigationHistory.canGoBack(), canGoForward: !wc.isDestroyed() && wc.navigationHistory.canGoForward(),
    zoom: wc.isDestroyed() ? 1 : wc.getZoomFactor(), focusStatus, focusError: t.focusError || '', inspectorError: t.inspectorError || '' };
}
function snapshot() {
  return { tabs: [...tabs.values()].map(tabState), activeTabId, bookmarks: data.bookmarks, history: data.history,
    rules: data.rules, downloads: [...downloads.values()].map(({ item, ...entry }) => entry), profilePath: profile,
    networkPaused: monitor.paused, networkCount: monitor.entries.size,
    search: data.search, searchEngines: SEARCH_ENGINES, typing: data.typing,
    proxy: { ...data.proxy, ...proxy?.snapshot(), applying: proxyChangesInFlight > 0, hasCredentials: Boolean(proxy?.getConfig().username || proxy?.getConfig().password), ...(connectionError ? { error: connectionError } : {}) },
    adblock: adblock?.getState() || { ...data.adblock, ready: false, blockedCount: 0 } };
}
function sendState() { clearTimeout(stateTimer); stateTimer = null; emit('state', snapshot()); }
function scheduleState() { if (!stateTimer) stateTimer = setTimeout(() => { stateTimer = null; sendState(); }, 100); }

function layout() {
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  for (const tab of tabs.values()) {
    const show = tab.id === activeTabId && viewport.visible && tab.url !== 'about:blank' && !tab.error;
    tab.view.setVisible(Boolean(show));
    if (show) {
      const x = Math.max(0, Math.min(width, Math.round(viewport.x)));
      const y = Math.max(0, Math.min(height, Math.round(viewport.y)));
      tab.view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(viewport.width))), height: Math.max(0, Math.min(height - y, Math.round(viewport.height))) });
    }
  }
}
function visit(tab) {
  if (!isWebURL(tab.url)) return;
  data.history = [{ url: tab.url, title: tab.title, visitedAt: new Date().toISOString() }, ...data.history.filter(h => h.url !== tab.url)].slice(0, 1000);
  scheduleSave();
}
async function instrument(tab) {
  if (tab.instrumenting) return tab.instrumenting;
  const pending = (async () => {
    try {
      // A disconnected debugger can leave a monitor entry behind. Reconnect it
      // before attaching page controls, rather than treating that entry as ready.
      if (!tab.view.webContents.debugger.isAttached()) monitor.detach(tab.id);
      await monitor.attach(tab.view.webContents, tab.id);
      await focus.attach(tab.view.webContents, tab.id);
      tab.inspectorError = '';
    } catch (error) {
      tab.inspectorError = error.message;
      tab.focusStatus = { status: 'error', error: error.message };
      tab.focusError = error.message;
      scheduleState();
    }
  })();
  tab.instrumenting = pending;
  try { await pending; } finally { if (tab.instrumenting === pending) tab.instrumenting = null; }
}
async function refreshPageTools(tab) {
  const wc = tab.view.webContents;
  if (wc.isDestroyed()) return;
  if (tab.devtoolsRequested || wc.isDevToolsOpened()) {
    tab.focusStatus = { status: 'suspended', error: 'Close Developer Tools to resume spoof mode.' };
    scheduleState();
    return;
  }
  try {
    if (!focus.tabs.has(tab.id) || !wc.debugger.isAttached()) await instrument(tab);
    else await focus.refresh(tab.id);
  } catch (error) {
    tab.focusStatus = { status: 'error', error: error.message };
    tab.focusError = error.message;
    scheduleState();
  }
}
async function createTab(url = 'about:blank', activate = true) {
  if (tabs.size >= 30) throw new Error('Close a tab before opening another (30-tab limit).');
  if (activate) clipboardTyping.stop();
  const target = navigationURL(url, data.search);
  if (target !== 'about:blank' && connectionError) throw new Error(connectionError);
  if (target === 'about:blank' && activate) {
    // Move native keyboard focus before the async guest/CDP setup so early
    // typing after Ctrl+T is held by the shell's pending search field.
    win.webContents.focus();
    emit('shortcut', 'prepare-new-tab-search');
  }
  const id = randomUUID();
  const view = new WebContentsView({ webPreferences: {
    session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webSecurity: true,
    allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false, spellcheck: true,
    backgroundThrottling: true
  } });
  const wc = view.webContents;
  clipboardTyping.attach(wc);
  const tab = { id, view, url: 'about:blank', title: 'New tab', loading: false, error: '', favicon: '' };
  tabs.set(id, tab);
  adblock?.attach(wc);
  favicons?.attach(wc, id);
  win.contentView.addChildView(view);
  view.setVisible(false);
  const update = () => { scheduleState(); scheduleSave(); };
  wc.on('did-start-loading', () => { tab.loading = true; update(); });
  wc.on('did-stop-loading', () => { tab.loading = false; update(); });
  wc.on('page-title-updated', (_event, title) => { tab.title = title || 'Untitled'; const visit = data.history.find(h => h.url === tab.url); if (visit) visit.title = tab.title; update(); });
  wc.on('did-navigate', (_event, next) => { tab.url = next; tab.error = ''; visit(tab); layout(); update(); });
  wc.on('did-navigate-in-page', (_event, next, mainFrame) => { if (mainFrame) { tab.url = next; visit(tab); update(); } });
  wc.on('did-fail-load', (_event, code, description, failedURL, mainFrame) => {
    if (!mainFrame || code === -3) return;
    tab.url = failedURL || tab.url; tab.error = `${description} (${code})`; tab.loading = false; layout(); update();
  });
  wc.on('render-process-gone', (_event, details) => { tab.error = `Page stopped: ${details.reason}. Reload to try again.`; layout(); update(); });
  wc.on('will-navigate', (event, next) => { if (!isWebURL(next) && next !== 'about:blank') event.preventDefault(); });
  wc.on('will-frame-navigate', (event) => { if (!/^(https?:|about:|blob:)/i.test(event.url)) event.preventDefault(); });
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.setWindowOpenHandler(({ url: next }) => {
    if (isWebURL(next)) void createTab(next).catch(error => toast(error.message));
    else toast('This link uses an unsupported address type.');
    return { action: 'deny' };
  });
  wc.on('found-in-page', (_event, result) => emit('find-result', result));
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase(), mod = input.control || input.meta;
    if (mod && ['l','f','t','w','r','+','=','-','0'].includes(key)) {
      event.preventDefault();
      if (key === 'l' || key === 'f') { win.webContents.focus(); emit('shortcut', key === 'l' ? 'address' : 'find'); }
      else if (key === 't') void createTab().catch(error => toast(error.message));
      else if (key === 'w') void closeTab(id);
      else if (key === 'r') wc.reload();
      else wc.setZoomFactor(key === '0' ? 1 : Math.min(3, Math.max(0.5, wc.getZoomFactor() + (key === '-' ? -0.1 : 0.1))));
      sendState();
    } else if (input.alt && ['arrowleft','arrowright'].includes(key)) {
      event.preventDefault();
      const h = wc.navigationHistory;
      if (key === 'arrowleft' && h.canGoBack()) h.goBack();
      if (key === 'arrowright' && h.canGoForward()) h.goForward();
    }
  });
  wc.on('context-menu', (_event, params) => {
    const template = [];
    if (isWebURL(params.linkURL)) template.push({ label: 'Open link in new tab', click: () => void createTab(params.linkURL).catch(e => toast(e.message)) });
    if (params.isEditable) template.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) template.push({ role: 'copy' });
    template.push({ type: 'separator' }, { label: 'Reload', click: () => wc.reload() });
    Menu.buildFromTemplate(template).popup({ window: win });
  });
  wc.on('devtools-opened', () => { tab.devtoolsRequested = true; sendState(); });
  wc.on('devtools-closed', () => { tab.devtoolsRequested = false; tab.focusStatus = { status: 'applying', error: '' }; sendState(); void instrument(tab); });
  // Give CDP a live target before setup, then install tools before real navigation.
  await wc.loadURL('about:blank');
  await instrument(tab);
  if (activate || !activeTabId) activeTabId = id;
  if (target !== 'about:blank') void navigate(tab, target);
  layout(); sendState(); scheduleSave();
  if (target === 'about:blank' && activate && activeTabId === id) {
    win.webContents.focus();
    emit('shortcut', { action: 'new-tab-search', tabId: id });
  }
  return id;
}
async function navigate(tab, value) {
  if (!tab) return;
  const url = navigationURL(value, data.search);
  if (url !== 'about:blank' && connectionError) { toast(connectionError); return; }
  // Publish a consistent URL/icon pair before loadURL emits its navigation
  // events. Otherwise the shell could cache the old icon under the new origin.
  const previousOrigin = isWebURL(tab.url) ? new URL(tab.url).origin : '';
  const nextOrigin = isWebURL(url) ? new URL(url).origin : '';
  if (previousOrigin !== nextOrigin || !nextOrigin) tab.favicon = '';
  tab.url = url; tab.error = ''; tab.title = url === 'about:blank' ? 'New tab' : new URL(url).hostname;
  layout(); sendState();
  try { await tab.view.webContents.loadURL(url); } catch (error) { if (error.code !== 'ERR_ABORTED') { tab.error ||= error.message; layout(); sendState(); } }
  scheduleSave();
}
async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (clipboardTyping.run?.wc === tab.view.webContents) clipboardTyping.stop();
  await focus.detach(id);
  if (tabs.get(id) !== tab) return;
  monitor.detach(id);
  adblock?.detach(tab.view.webContents.id);
  favicons?.detach(id);
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  const orderedIds = [...tabs.keys()], index = orderedIds.indexOf(id);
  tabs.delete(id);
  if (activeTabId === id) activeTabId = orderedIds[index + 1] || orderedIds[index - 1];
  if (!tabs.size && !closing) await createTab();
  layout(); sendState(); scheduleSave();
}
function reorderTab(id, beforeId) {
  if (typeof id !== 'string' || !id || (beforeId !== null && (typeof beforeId !== 'string' || !beforeId))) {
    throw new Error('Invalid tab order.');
  }
  // A tab can close while a drag is in progress. Validate both ends before
  // changing the Map so stale drops cannot remove or accidentally move a tab.
  if (!tabs.has(id) || (beforeId !== null && !tabs.has(beforeId)) || id === beforeId) return;
  const entries = [...tabs.entries()], previousIndex = entries.findIndex(([key]) => key === id);
  const [entry] = entries.splice(previousIndex, 1);
  const nextIndex = beforeId === null ? entries.length : entries.findIndex(([key]) => key === beforeId);
  if (previousIndex === nextIndex) return;
  entries.splice(nextIndex, 0, entry);
  tabs.clear();
  for (const [key, tab] of entries) tabs.set(key, tab);
  scheduleSave();
}
async function getFaviconDecoderContents() {
  if (faviconDecoderShutdown || !win || win.isDestroyed()) throw new Error('Favicon decoder unavailable.');
  if (faviconDecoderView && !faviconDecoderView.webContents.isDestroyed()) return faviconDecoderReady;
  const decoderSession = session.fromPartition(`prism-favicon-decoder-${randomUUID()}`, { cache: false });
  decoderSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(?:data:|about:)/i.test(details.url) }));
  decoderSession.setPermissionCheckHandler(() => false);
  decoderSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  decoderSession.on('will-download', event => event.preventDefault());
  // An unparented view provides a Chromium image decoder without creating a
  // hidden application window or sharing the website's session/CSP.
  const view = new WebContentsView({ webPreferences: {
    session: decoderSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
    nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false, webSecurity: true,
    allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
    backgroundThrottling: false
  } });
  faviconDecoderView = view;
  view.setVisible(false);
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', event => event.preventDefault());
  wc.on('will-frame-navigate', event => event.preventDefault());
  wc.on('will-attach-webview', event => event.preventDefault());
  const document = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:"><title>Prism favicon decoder</title>';
  faviconDecoderReady = wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`).then(() => {
    if (faviconDecoderShutdown || !win || win.isDestroyed() || wc.isDestroyed()) throw new Error('Favicon decoder closed.');
    return wc;
  }).catch(error => {
    if (faviconDecoderView === view) { faviconDecoderView = null; faviconDecoderReady = null; }
    if (!wc.isDestroyed()) wc.close();
    throw error;
  });
  return faviconDecoderReady;
}
function closeFaviconDecoder() {
  favicons?.cancelAll();
  const view = faviconDecoderView;
  faviconDecoderView = null; faviconDecoderReady = null;
  if (view && !view.webContents.isDestroyed()) view.webContents.close();
}

async function configureSession() {
  browserSession = session.fromPartition('persist:prism-default', { cache: true });
  proxy = new ProxyController({ session: browserSession });
  try { await proxy.apply(data.proxy); } catch (error) {
    connectionError = `Proxy setup failed. Open proxy settings before browsing. ${error.message}`;
    browserSession.enableNetworkEmulation({ offline: true });
  }
  adblock = new AdblockController({ settings: data.adblock, emit: () => scheduleState(), shouldBlockRequest: () => Boolean(connectionError || proxyChangesInFlight) });
  await adblock.initialize(browserSession);
  favicons = new FaviconController({ session: browserSession, decode: createImageDecoder(nativeImage, getFaviconDecoderContents),
    canFetch: () => !connectionError && !proxyChangesInFlight,
    onChange: (id, icon) => { const tab = tabs.get(id); if (tab) { tab.favicon = icon; scheduleState(); } } });
  browserSession.setPermissionCheckHandler((_wc, permission, origin) => grants.has(`${origin}|${permission}`));
  browserSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const tab = [...tabs.values()].find(t => t.view.webContents === wc);
    const requesting = details.requestingUrl || details.requestingOrigin || wc.getURL();
    const supported = ['media','geolocation','notifications','clipboard-read','fullscreen','pointerLock'];
    if (!tab || !isWebURL(requesting) || !supported.includes(permission)) return callback(false);
    const origin = new URL(requesting).origin;
    if (grants.has(`${origin}|${permission}`)) return callback(true);
    try {
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'Site permission', message: `${origin} wants ${permission} access.`, detail: 'Allow access for this browser session?', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0, noLink: true });
      if (response === 1) grants.add(`${origin}|${permission}`);
      callback(response === 1);
    } catch { callback(false); }
  });
  browserSession.on('will-download', (_event, item) => {
    const id = randomUUID();
    const entry = { id, item, name: item.getFilename(), receivedBytes: 0, totalBytes: item.getTotalBytes(), state: 'progressing', path: '' };
    downloads.set(id, entry);
    item.on('updated', (_e, state) => { entry.state = state; entry.receivedBytes = item.getReceivedBytes(); entry.totalBytes = item.getTotalBytes(); scheduleState(); });
    item.once('done', (_e, state) => { entry.state = state; entry.path = item.getSavePath(); entry.receivedBytes = item.getReceivedBytes(); entry.item = null; sendState(); });
    sendState();
  });
}

function cookieExportFilename(host) {
  const safe = String(host || 'all').replace(/[^a-z\d.-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'all';
  return `prism-cookies-${safe}.json`;
}

async function exportCookies(host = '') {
  const siteHost = host ? normalizeHost(host) : '';
  const all = await browserSession.cookies.get({});
  const cookies = siteHost
    ? all.filter(cookie => cookieDomainInScope(cookie.domain || siteHost, siteHost))
    : all;
  const payload = makeCookieExport(cookies, siteHost ? { host: siteHost } : {});
  const result = await dialog.showSaveDialog(win, {
    title: siteHost ? `Export cookies for ${siteHost}` : 'Export all cookies',
    defaultPath: path.join(profile, cookieExportFilename(siteHost)),
    filters: [{ name: 'Prism cookie export', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true, count: 0 };
  await fs.promises.writeFile(result.filePath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await fs.promises.chmod(result.filePath, 0o600).catch(() => {});
  toast(`Exported ${payload.cookies.length} ${payload.cookies.length === 1 ? 'cookie' : 'cookies'}${siteHost ? ` for ${siteHost}` : ''}.`);
  return { ok: true, count: payload.cookies.length, scope: payload.scope, host: payload.host || '' };
}

async function importCookies(host = '') {
  const siteHost = host ? normalizeHost(host) : '';
  const result = await dialog.showOpenDialog(win, {
    title: siteHost ? `Import cookies for ${siteHost}` : 'Import cookies',
    properties: ['openFile'],
    filters: [{ name: 'Prism cookie export', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true, imported: 0, failed: 0 };
  const filename = result.filePaths[0];
  const stat = await fs.promises.stat(filename);
  if (stat.size > MAX_FILE_BYTES) throw new Error('Cookie export is too large.');
  const parsed = parseCookieExportText(await fs.promises.readFile(filename, 'utf8'));
  if (siteHost && parsed.host && !cookieDomainInScope(parsed.host, siteHost) && !cookieDomainInScope(siteHost, parsed.host)) {
    throw new Error(`This cookie export is for ${parsed.host}, not ${siteHost}.`);
  }
  const cookies = siteHost
    ? parsed.cookies.filter(cookie => cookieDomainInScope(cookie.domain || siteHost, siteHost))
    : parsed.cookies;
  let imported = 0;
  let failed = 0;
  for (const cookie of cookies) {
    try {
      await browserSession.cookies.set(cookieSetDetails(cookie));
      imported++;
    } catch (error) {
      failed++;
      console.warn(`Could not import cookie ${cookie.name}:`, error.message);
    }
  }
  await browserSession.cookies.flushStore();
  const summary = `${imported} ${imported === 1 ? 'cookie' : 'cookies'} imported${failed ? `, ${failed} skipped` : ''}${siteHost ? ` for ${siteHost}` : ''}.`;
  toast(summary);
  return { ok: failed === 0, imported, failed, scope: parsed.scope, host: siteHost || parsed.host || '' };
}

async function action(name, payload = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid request.');
  const tab = active(), wc = tab?.view.webContents;
  switch (name) {
    case 'get-state': return snapshot();
    case 'search-save': data.search = normalizeSearch(payload.search); saveState(); break;
    case 'typing-save': data.typing = normalizeTyping(payload.typing); saveState(); break;
    case 'proxy-save': {
      proxyChangesInFlight++;
      favicons?.cancelAll();
      try {
        // Suspend the session while pooled connections and authentication are replaced.
        // Keep it offline after a failed rollback until a successful explicit save.
        browserSession.enableNetworkEmulation({ offline: true });
        sendState();
        await proxy.apply(payload.proxy);
        data.proxy = publicProxyConfig(proxy.getConfig()); connectionError = ''; saveState();
      } catch (error) {
        if (proxy.snapshot().error?.includes('Restart')) {
          connectionError = proxy.snapshot().error;
          for (const t of tabs.values()) t.view.webContents.stop();
          for (const entry of downloads.values()) entry.item?.cancel();
        }
        sendState(); throw error;
      } finally {
        proxyChangesInFlight--;
        if (!connectionError && !proxyChangesInFlight) browserSession.disableNetworkEmulation();
        scheduleState();
      }
      toast(data.proxy.enabled ? 'Proxy settings applied. Reload open pages to reconnect.' : 'Proxy disabled. New connections are direct.'); break;
    }
    case 'adblock-save': await adblock.apply(payload.adblock); data.adblock = normalizeAdblockSettings(payload.adblock); saveState(); break;
    case 'tab-new': await createTab(payload.url); break;
    case 'tab-close': await closeTab(payload.id); break;
    case 'tab-activate': if (tabs.has(payload.id)) { clipboardTyping.stop(); activeTabId = payload.id; layout(); scheduleSave(); } break;
    case 'tab-reorder': reorderTab(payload.id, payload.beforeId); break;
    case 'navigate': { const url = navigationURL(payload.url, data.search); if (url !== 'about:blank' && connectionError) throw new Error(connectionError); void navigate(tab, url); break; }
    case 'back': if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': if (tab) { tab.error = ''; layout(); wc.reload(); } break;
    case 'stop': wc?.stop(); break;
    case 'viewport': {
      if (!['x','y','width','height'].every(k => Number.isFinite(payload[k]) && payload[k] >= 0 && payload[k] <= 20000)) throw new Error('Invalid viewport.');
      viewport = { ...payload, visible: payload.visible !== false }; layout(); return { ok: true };
    }
    case 'bookmark-toggle':
      if (tab && isWebURL(tab.url)) { const exists = data.bookmarks.some(b => b.url === tab.url); data.bookmarks = exists ? data.bookmarks.filter(b => b.url !== tab.url) : [...data.bookmarks, { url: tab.url, title: tab.title }].slice(-500); scheduleSave(); }
      break;
    case 'history-clear': data.history = []; scheduleSave(); break;
    case 'rules-save': {
      data.rules = normalizeRules(payload.rules); saveState();
      const updates = new Map();
      for (const candidate of tabs.values()) {
        candidate.focusStatus = { status: 'applying', error: '' };
        updates.set(candidate.id, refreshPageTools(candidate));
      }
      // Show the saved preference immediately. An unrelated blocked/background
      // renderer must not hold the active tab's toolbar request open.
      sendState();
      await updates.get(tab?.id);
      break;
    }
    case 'focus-retry': {
      const requested = payload.id ? tabs.get(payload.id) : tab;
      if (!requested) throw new Error('This tab is no longer open.');
      if (!isWebURL(requested.url)) throw new Error('Open a website before retrying its page controls.');
      requested.focusStatus = { status: 'applying', error: '' }; sendState();
      await refreshPageTools(requested);
      break;
    }
    case 'network-list': return monitor.getEntries();
    case 'network-detail': return monitor.getEntry(payload.id);
    case 'network-clear': monitor.clear(); break;
    case 'network-pause': monitor.setPaused(payload.paused); break;
    case 'network-export': {
      const { canceled, filePath } = await dialog.showSaveDialog(win, { title: 'Export captured traffic', defaultPath: `prism-network-${Date.now()}.har`, filters: [{ name: 'HTTP Archive', extensions: ['har'] }] });
      if (!canceled && filePath) { await fs.promises.writeFile(filePath, JSON.stringify(monitor.exportHAR(), null, 2), { mode: 0o600 }); toast('Network capture exported.'); }
      return { ok: !canceled };
    }
    case 'cookies-list': return browserSession.cookies.get(payload.url && isWebURL(payload.url) ? { url: payload.url } : {});
    case 'cookies-export': return exportCookies(payload.host || '');
    case 'cookies-import': return importCookies(payload.host || '');
    case 'site-data-clear': {
      const host = normalizeHost(payload.host);
      const cookies = await browserSession.cookies.get({ domain: host });
      for (const cookie of cookies) {
        const domain = cookie.domain.replace(/^\./, '');
        if (domain === host) await browserSession.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${domain}${cookie.path}`, cookie.name);
      }
      const origins = new Set([`https://${host}`, `http://${host}`]);
      for (const t of tabs.values()) if (isWebURL(t.url) && new URL(t.url).hostname === host) origins.add(new URL(t.url).origin);
      for (const origin of origins) await browserSession.clearStorageData({ origin, storages: ['filesystem','indexdb','localstorage','serviceworkers','cachestorage'] });
      await browserSession.cookies.flushStore(); toast(`Stored data cleared for ${host}.`); break;
    }
    case 'downloads-list': return snapshot().downloads;
    case 'download-cancel': downloads.get(payload.id)?.item?.cancel(); break;
    case 'download-show': { const entry = downloads.get(payload.id); if (entry?.path && entry.state === 'completed') shell.showItemInFolder(entry.path); break; }
    case 'find': if (wc && typeof payload.text === 'string' && payload.text.trim()) return wc.findInPage(payload.text.slice(0, 1000), { forward: payload.forward !== false, findNext: true }); wc?.stopFindInPage('clearSelection'); return { ok: true };
    case 'find-stop': wc?.stopFindInPage('clearSelection'); break;
    case 'zoom': if (wc) wc.setZoomFactor(Math.max(0.5, Math.min(3, wc.getZoomFactor() + (Number(payload.delta) || 0)))); break;
    case 'devtools': if (wc) {
      tab.devtoolsRequested = true; sendState();
      await focus.detach(tab.id); monitor.detach(tab.id);
      if (wc.debugger.isAttached()) wc.debugger.detach();
      emit('network-status', { tabId: tab.id, attached: false, reason: 'Full Developer Tools is open.' });
      try { wc.openDevTools({ mode: 'detach' }); }
      catch (error) { tab.devtoolsRequested = false; await instrument(tab); throw error; }
      toast('Capture and focus controls resume when Developer Tools closes.');
    } break;
    case 'window-minimize': win.minimize(); break;
    case 'window-maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break;
    case 'window-close': win.close(); return { ok: true };
    default: throw new Error('Unsupported browser action.');
  }
  sendState();
  return snapshot();
}

async function createWindow() {
  closing = false;
  win = new BrowserWindow({ width: 1440, height: 940, minWidth: 1000, minHeight: 680, backgroundColor: '#111318', frame: false, title: 'Prism Browser', icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false } });
  win.webContents.on('will-navigate', event => event.preventDefault());
  clipboardTyping.attach(win.webContents);
  win.on('blur', () => clipboardTyping.stop());
  win.on('close', () => clipboardTyping.stop());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('resize', layout);
  win.on('close', () => { saveState(); closing = true; clearTimeout(saveTimer); });
  win.on('closed', () => { closeFaviconDecoder(); for (const tab of tabs.values()) { monitor.detach(tab.id); adblock?.detach(tab.view.webContents.id); void focus.detach(tab.id); if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } tabs.clear(); win = null; });
  await win.loadFile(shellFile);
  const restore = !connectionError && data.tabs.length ? [...data.tabs] : ['about:blank'];
  const selected = data.activeIndex;
  for (const url of restore) await createTab(url, false);
  activeTabId = [...tabs.keys()][Math.min(selected, tabs.size - 1)];
  layout(); sendState();
}

ipcMain.handle('prism:action', (event, name, payload) => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(shellFile).href) throw new Error('Untrusted browser request.');
  return action(name, payload);
});

app.whenReady().then(async () => {
  readState(); await configureSession(); Menu.setApplicationMenu(null); await createWindow();
  app.on('activate', () => { if (!win) void createWindow(); });
}).catch(error => { console.error(error); app.quit(); });
app.on('login', (event, wc, details, authInfo, callback) => {
  if (wc?.session === browserSession && proxy?.handleLogin(event, authInfo, callback, details)) sendState();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', event => {
  faviconDecoderShutdown = true;
  closeFaviconDecoder();
  if (flushed || !browserSession) return;
  event.preventDefault();
  browserSession.cookies.flushStore().catch(() => {}).finally(() => { browserSession.flushStorageData(); flushed = true; app.quit(); });
});
