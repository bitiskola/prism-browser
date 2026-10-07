'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeHost } = require('./policy.cjs');

const DEFAULT_ADBLOCK_SETTINGS = Object.freeze({ enabled: true, allowlist: Object.freeze([]), blocklist: Object.freeze([]) });
const LIST_PATH = path.join(__dirname, 'adblock-data', 'easylist.txt');
const MAX_DOMAINS = 500;

function normalizeAdblockSettings(value = DEFAULT_ADBLOCK_SETTINGS) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ad blocker settings must be an object.');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('Ad blocker enabled must be true or false.');
  const normalizeList = (list, name) => {
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > MAX_DOMAINS) throw new Error(`Use up to ${MAX_DOMAINS} ${name} domains.`);
    return [...new Set(list.map(normalizeHost))];
  };
  return {
    enabled: value.enabled === undefined ? true : value.enabled,
    allowlist: normalizeList(value.allowlist, 'allowlisted'),
    blocklist: normalizeList(value.blocklist, 'blocked'),
  };
}

function hostname(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return '';
    return url.hostname.toLowerCase().replace(/\.$/, '');
  } catch { return ''; }
}

function domainMatches(host, domain) {
  return Boolean(host) && (host === domain || host.endsWith(`.${domain}`));
}

function listed(host, domains) { return domains.some(domain => domainMatches(host, domain)); }

/**
 * A native Electron integration of Adblock Plus core, not the Chrome extension.
 * The master switch disables every filter. Allowlisted top-level pages take
 * precedence over EasyList and custom blocked request destinations.
 */
class AdblockController {
  constructor({ settings = DEFAULT_ADBLOCK_SETTINGS, emit = () => {}, shouldBlockRequest = () => false, listPath = LIST_PATH, filterText } = {}) {
    this.settings = normalizeAdblockSettings(settings);
    this.emit = emit;
    this.shouldBlockRequest = shouldBlockRequest;
    this.listPath = listPath;
    this.filterText = filterText;
    this.tabs = new Map();
    this.session = null;
    this.ready = false;
    this.error = '';
    this.blockedCount = 0;
    this.filterCount = 0;
    this.listUpdatedAt = '';
    this.engine = null;
    this.emitTimer = null;
  }

  getSettings() { return { enabled: this.settings.enabled, allowlist: [...this.settings.allowlist], blocklist: [...this.settings.blocklist] }; }

  getState() {
    return { ...this.getSettings(), ready: this.ready, error: this.error, blockedCount: this.blockedCount,
      engineName: 'Adblock Plus core', filterCount: this.filterCount, listUpdatedAt: this.listUpdatedAt };
  }

  _emitState() { this.emit('adblock-state', this.getState()); }

  _countBlocked() {
    this.blockedCount++;
    if (!this.emitTimer) {
      this.emitTimer = setTimeout(() => { this.emitTimer = null; this._emitState(); }, 150);
      this.emitTimer.unref?.();
    }
  }

  apply(value) {
    this.settings = normalizeAdblockSettings(value);
    this._emitState();
    for (const state of this.tabs.values()) void this._refreshStyles(state);
    return this.getState();
  }

  attach(webContents) {
    if (this.tabs.get(webContents.id)?.webContents === webContents) return;
    this.detach(webContents.id);
    const state = { webContents, pageUrl: webContents.getURL(), pendingUrl: '', cssKey: null, cssRevision: 0 };
    state.onNavigation = (event, url, inPlace, isMainFrame) => {
      url = event.url ?? url;
      inPlace = event.isSameDocument ?? inPlace;
      isMainFrame = event.isMainFrame ?? isMainFrame;
      if (!isMainFrame) return;
      state.pageUrl = url;
      if (!inPlace) { state.pendingUrl = url; state.cssRevision++; }
      else void this._refreshStyles(state);
    };
    state.onCommitted = (event, url) => {
      state.pendingUrl = '';
      state.pageUrl = event.url ?? url ?? webContents.getURL();
    };
    state.onDOMReady = () => {
      // The old document can finish while its replacement is still pending.
      if (state.pendingUrl) return;
      state.pageUrl = webContents.getURL();
      void this._refreshStyles(state);
    };
    state.onFailLoad = (_event, code, _description, failedUrl, isMainFrame) => {
      // Chromium can deliver a superseded navigation's abort asynchronously.
      // It must not restore the old document's allowlist over a new destination.
      if (!isMainFrame || code === -3 || (state.pendingUrl && failedUrl !== state.pendingUrl)) return;
      state.pendingUrl = '';
      state.pageUrl = webContents.getURL();
      void this._refreshStyles(state);
    };
    state.onStopLoading = () => {
      // A user-stopped navigation stays on its old document. Reconcile only
      // after all main-frame navigation has stopped, not on an earlier abort.
      if (webContents.isDestroyed() || webContents.isLoadingMainFrame()) return;
      state.pendingUrl = '';
      state.pageUrl = webContents.getURL();
      void this._refreshStyles(state);
    };
    state.onDestroyed = () => this.detach(webContents.id);
    webContents.on('did-start-navigation', state.onNavigation);
    webContents.on('did-redirect-navigation', state.onNavigation);
    webContents.on('did-navigate', state.onCommitted);
    webContents.on('dom-ready', state.onDOMReady);
    webContents.on('did-fail-load', state.onFailLoad);
    webContents.on('did-stop-loading', state.onStopLoading);
    webContents.once('destroyed', state.onDestroyed);
    this.tabs.set(webContents.id, state);
    return state;
  }

  detach(webContentsId) {
    const state = this.tabs.get(webContentsId);
    if (!state) return;
    this.tabs.delete(webContentsId);
    state.cssRevision++;
    const wc = state.webContents;
    wc.removeListener('did-start-navigation', state.onNavigation);
    wc.removeListener('did-redirect-navigation', state.onNavigation);
    wc.removeListener('did-navigate', state.onCommitted);
    wc.removeListener('dom-ready', state.onDOMReady);
    wc.removeListener('did-fail-load', state.onFailLoad);
    wc.removeListener('did-stop-loading', state.onStopLoading);
    wc.removeListener('destroyed', state.onDestroyed);
    if (state.cssKey && !wc.isDestroyed()) void wc.removeInsertedCSS(state.cssKey).catch(() => {});
  }

  _pageURL(details) {
    // A navigation is evaluated against its destination, never the old page's
    // allowlist entry. This also handles the first request in a new browser tab.
    if (details.resourceType === 'mainFrame') return details.url;
    const state = this.tabs.get(details.webContentsId);
    if (state) return state.pageUrl;
    return details.referrer || details.initiator || details.frame?.top?.url || '';
  }

  shouldBlock(details) {
    if (!this.settings.enabled || !this.ready || !hostname(details.url)) return false;
    const pageUrl = this._pageURL(details);
    const pageHost = hostname(pageUrl);
    // Shared/service workers may have no attributable page. Fail open rather
    // than incorrectly filtering a page the user has allowlisted.
    if (!pageHost) return false;
    if (listed(pageHost, this.settings.allowlist)) return false;
    if (listed(hostname(details.url), this.settings.blocklist)) return true;
    return this.engine.shouldBlock(details, pageUrl);
  }

  async initialize(browserSession) {
    if (this.session && this.session !== browserSession) throw new Error('This ad blocker is already attached to a browser session.');
    if (this.session) return this.getState();
    try {
      const text = this.filterText === undefined ? await fs.readFile(this.listPath, 'utf8') : this.filterText;
      if (typeof text !== 'string' || !text.trim()) throw new Error('The bundled EasyList filter file is empty.');
      this.listUpdatedAt = /^! Last modified:\s*(.+)$/mi.exec(text)?.[1]?.trim() || '';
      this.engine = await createCoreEngine(text);
      this.filterCount = this.engine.filterCount;
      this.ready = true;
      this.error = '';
    } catch (error) {
      this.ready = false;
      this.error = `Ad blocker could not start: ${error.message}`.slice(0, 500);
    }
    this.session = browserSession;
    browserSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
      let cancel = false;
      // A proxy configuration failure can require stopping all communication.
      // This transport guard is independent of every ad blocker preference.
      try {
        if (this.shouldBlockRequest(details)) { callback({ cancel: true }); return; }
      } catch {
        callback({ cancel: true });
        return;
      }
      try { cancel = this.shouldBlock(details); }
      catch (error) {
        this.error = `Ad blocker request error: ${error.message}`.slice(0, 500);
        this._emitState();
      }
      if (cancel) this._countBlocked();
      callback({ cancel });
    });
    this._emitState();
    return this.getState();
  }

  async _refreshStyles(state) {
    const revision = ++state.cssRevision;
    const wc = state.webContents;
    if (wc.isDestroyed()) return;
    if (state.cssKey) {
      const key = state.cssKey;
      state.cssKey = null;
      await wc.removeInsertedCSS(key).catch(() => {});
    }
    if (wc.isDestroyed() || revision !== state.cssRevision || !this.settings.enabled || !this.ready ||
      !hostname(state.pageUrl) || listed(hostname(state.pageUrl), this.settings.allowlist)) return;
    const css = this.engine.styleSheet(state.pageUrl);
    if (!css) return;
    try {
      const key = await wc.insertCSS(css, { cssOrigin: 'user' });
      if (wc.isDestroyed()) return;
      if (revision !== state.cssRevision) await wc.removeInsertedCSS(key).catch(() => {});
      else state.cssKey = key;
    } catch { /* A navigation or closing tab can invalidate CSS insertion. */ }
  }

  dispose() {
    for (const id of [...this.tabs.keys()]) this.detach(id);
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    if (this.session) this.session.webRequest.onBeforeRequest(null);
    this.session = null;
  }
}

// The actual core adapter is deliberately kept separate from browser state so
// request matching and exceptions can be verified with offline fixture rules.
async function createCoreEngine(text) {
  // The standalone upstream modules are vendored unchanged with their GPLv3
  // source and notices. No extension API, network updater, or build-time npm
  // dependency is loaded into the browser process.
  const { FilterEngine } = require('./vendor/adblockpluscore/lib/filterEngine.js');
  const { Filter } = require('./vendor/adblockpluscore/lib/filterClasses.js');
  const { contentTypes } = require('./vendor/adblockpluscore/lib/contentTypes.js');
  const core = new FilterEngine();
  await core.initialize([]);
  let filterCount = 0;
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const normalized = Filter.normalize(line, true);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const filter = Filter.fromText(normalized);
    if (!['blocking', 'allowing', 'elemhide', 'elemhideexception'].includes(filter.type)) continue;
    // These options require separate ABP integration hooks. Do not silently
    // turn a rewrite or header filter into unconditional request cancellation.
    if (filter.rewrite || filter.csp || filter.header) continue;
    core.add(filter);
    filterCount++;
  }
  if (!filterCount) throw new Error('The filter list contains no supported rules.');
  const types = {
    mainFrame: contentTypes.DOCUMENT, subFrame: contentTypes.SUBDOCUMENT,
    stylesheet: contentTypes.STYLESHEET, script: contentTypes.SCRIPT,
    image: contentTypes.IMAGE, font: contentTypes.FONT, object: contentTypes.OBJECT,
    xhr: contentTypes.XMLHTTPREQUEST, ping: contentTypes.PING, cspReport: contentTypes.PING,
    media: contentTypes.MEDIA, webSocket: contentTypes.WEBSOCKET, other: contentTypes.OTHER,
  };
  const isException = filter => typeof filter === 'string' && filter.startsWith('@@');
  const exceptionFor = (url, type) => hostname(url) && isException(core.match(url, type, hostname(url)));
  return {
    filterCount,
    shouldBlock(details, pageUrl) {
      // Normal filter-list ad rules do not deny top-level navigations. A user
      // can still deny a whole destination explicitly via the custom blocklist.
      if (details.resourceType === 'mainFrame') return false;
      const frameUrl = details.resourceType === 'subFrame' ? details.referrer : details.frame?.url;
      const documentUrl = hostname(frameUrl) ? frameUrl : hostname(details.referrer) ? details.referrer : pageUrl;
      const contexts = [pageUrl, documentUrl];
      if (contexts.some(url => exceptionFor(url, contentTypes.DOCUMENT))) return false;
      const specificOnly = contexts.some(url => exceptionFor(url, contentTypes.GENERICBLOCK));
      const match = core.match(details.url, types[details.resourceType] || contentTypes.OTHER, hostname(documentUrl), null, specificOnly);
      return Boolean(match) && !isException(match);
    },
    styleSheet(pageUrl) {
      if (!hostname(pageUrl) || exceptionFor(pageUrl, contentTypes.DOCUMENT | contentTypes.ELEMHIDE)) return '';
      const specificOnly = Boolean(exceptionFor(pageUrl, contentTypes.GENERICHIDE));
      return core.elemHide.getStyleSheet(hostname(pageUrl), specificOnly).code;
    },
  };
}

module.exports = { AdblockController, DEFAULT_ADBLOCK_SETTINGS, normalizeAdblockSettings, domainMatches, createCoreEngine };
