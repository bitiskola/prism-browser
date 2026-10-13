'use strict';

const { matchesRule } = require('./policy.cjs');

const LIMITS = Object.freeze({ entries: 1000, bodyBytes: 256 * 1024, memoryBytes: 20 * 1024 * 1024, headerBytes: 64 * 1024, frames: 200 });
const NETWORK_OPTIONS = { maxTotalBufferSize: 2 * 1024 * 1024, maxResourceBufferSize: LIMITS.bodyBytes, maxPostDataSize: LIMITS.bodyBytes };
const AUTO_ATTACH = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
  filter: [{ type: 'iframe' }, { type: 'worker' }, { exclude: true }] };

function clipped(value, bytes) {
  const input = typeof value === 'string' ? value : String(value ?? '');
  // Avoid allocating a Buffer proportional to an arbitrarily large payload.
  const candidate = input.slice(0, bytes);
  if (Buffer.byteLength(candidate) <= bytes) return candidate;
  return Buffer.from(candidate).subarray(0, bytes).toString('utf8').replace(/\uFFFD$/, '');
}
function headers(input) {
  const result = Object.create(null);
  let remaining = LIMITS.headerBytes;
  for (const [rawName, rawValue] of Object.entries(input || {}).slice(0, 256)) {
    if (remaining <= 0) break;
    const name = clipped(rawName, Math.min(1024, remaining));
    remaining -= Buffer.byteLength(name);
    const value = clipped(rawValue, Math.max(0, remaining));
    remaining -= Buffer.byteLength(value);
    result[name] = value;
  }
  return result;
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function validUrl(url) { return /^(https?|wss?):\/\//i.test(url || ''); }
function nonnegative(value) { return Number.isFinite(value) ? Math.max(0, value) : 0; }
function note(entry, value) {
  if (!entry.bodyNote.includes(value)) entry.bodyNote = clipped([entry.bodyNote, value].filter(Boolean).join(' '), 2048);
}

/** Records traffic associated with selected top-level pages; never intercepts or rewrites it. */
class NetworkMonitor {
  constructor({ emit = () => {}, getRules = () => [] } = {}) {
    this.emit = emit;
    this.getRules = getRules;
    this.tabs = new Map();
    this.entries = new Map();
    this.metadata = new Map();
    this.paused = false;
    this.memoryBytes = 0;
    this.pendingExtraBytes = 0;
    this.sequence = 0;
  }

  async attach(webContents, tabId) {
    const old = this.tabs.get(tabId);
    if (old?.webContents === webContents) return;
    if (old) this.detach(tabId);
    const debuggerApi = webContents.debugger;
    if (!debuggerApi.isAttached()) debuggerApi.attach('1.3');
    const state = { webContents, tabId, pageUrl: webContents.getURL(), epoch: 0,
      mainFrameId: '', loaderId: '', awaitingDocument: false, frameEpochs: new Map(), chains: new Map(), sessions: new Map(), frameSessions: new Set() };
    state.onMessage = (_event, method, params, sessionId) => {
      this.handleMessage(tabId, method, params, sessionId).catch(() => {});
    };
    state.onNavigation = (event, url, inPlace, mainFrame) => {
      url = event.url ?? url;
      inPlace = event.isSameDocument ?? inPlace;
      mainFrame = event.isMainFrame ?? mainFrame;
      if (mainFrame && !inPlace) this._navigate(state, url, true);
      else if (mainFrame) state.pageUrl = url;
    };
    state.onRedirect = (event, url, _inPlace, mainFrame) => {
      url = event.url ?? url;
      mainFrame = event.isMainFrame ?? mainFrame;
      if (mainFrame) this._navigate(state, url);
    };
    state.onDestroyed = () => this.detach(tabId);
    state.onDetach = (_event, reason) => {
      state.epoch++;
      this._clearChains(state);
      state.sessions.clear();
      state.frameSessions.clear();
      this.emit('network-status', { tabId, attached: false, reason: clipped(reason, 256) });
    };
    this.tabs.set(tabId, state);
    debuggerApi.on('message', state.onMessage);
    debuggerApi.on('detach', state.onDetach);
    webContents.on('did-start-navigation', state.onNavigation);
    webContents.on('did-redirect-navigation', state.onRedirect);
    webContents.once('destroyed', state.onDestroyed);
    await debuggerApi.sendCommand('Network.enable', NETWORK_OPTIONS);
    // Independent Page commands are also used by the focus controller.
    await debuggerApi.sendCommand('Page.enable').catch(() => {});
    const treeEpoch = state.epoch;
    const tree = await debuggerApi.sendCommand('Page.getFrameTree').catch(() => null);
    if (tree?.frameTree?.frame) {
      state.mainFrameId = tree.frameTree.frame.id;
      const visit = node => {
        if (state.frameEpochs.size < 1024) state.frameEpochs.set(node.frame.id, state.epoch);
        for (const child of node.childFrames || []) visit(child);
      };
      if (treeEpoch === state.epoch && tree.frameTree.frame.url === state.pageUrl && !state.awaitingDocument) visit(tree.frameTree);
    }
    // Only exclusive child workers and frames: shared/service workers may serve other tabs.
    await debuggerApi.sendCommand('Target.setAutoAttach', AUTO_ATTACH).catch(() => {});
    this.emit('network-status', { tabId, attached: true });
  }

  detach(tabId) {
    const state = this.tabs.get(tabId);
    if (!state) return;
    const wc = state.webContents;
    wc.debugger.removeListener('message', state.onMessage);
    wc.debugger.removeListener('detach', state.onDetach);
    wc.removeListener('did-start-navigation', state.onNavigation);
    wc.removeListener('did-redirect-navigation', state.onRedirect);
    wc.removeListener('destroyed', state.onDestroyed);
    this._clearChains(state);
    state.sessions.clear();
    state.frameSessions.clear();
    this.tabs.delete(tabId);
    // Do not detach the shared CDP connection: focus emulation also uses it.
  }

  getEntries() { return Array.from(this.entries.values(), copy); }
  // Focus controls also use iframe targets, including targets attached while
  // network capture is between documents. Keep connection lifetime separate
  // from the capture epochs in sessions.
  getFrameSessions(tabId) { return [...(this.tabs.get(tabId)?.frameSessions || [])]; }
  getEntry(id) { return this.entries.has(id) ? copy(this.entries.get(id)) : null; }
  clear() {
    this.entries.clear();
    this.metadata.clear();
    this.memoryBytes = 0;
    for (const state of this.tabs.values()) this._resetCapture(state);
    this.emit('network-cleared', {});
  }
  setPaused(value) {
    const changed = this.paused !== Boolean(value);
    this.paused = Boolean(value);
    if (changed) for (const state of this.tabs.values()) this._resetCapture(state);
    return this.paused;
  }
  _selected(url) {
    return (this.getRules() || []).some(rule => rule.monitor === true && matchesRule(url, rule));
  }
  _allowed(state, sessionId = '') {
    if (this.paused || state.awaitingDocument || !this.tabs.has(state.tabId) || !this._selected(state.pageUrl)) return false;
    if (sessionId && state.sessions.get(sessionId)?.epoch !== state.epoch) return false;
    return true;
  }
  _navigate(state, url, force = false) {
    if (!force && state.pageUrl === url) return;
    state.pageUrl = url;
    state.epoch++;
    state.loaderId = '';
    state.awaitingDocument = true;
    this._clearChains(state);
    // Old child targets remain attached but cannot add records to the next page.
  }
  _resetCapture(state) {
    const previousEpoch = state.epoch++;
    this._clearChains(state);
    for (const session of state.sessions.values()) if (session.epoch === previousEpoch) session.epoch = state.epoch;
    for (const [frameId, epoch] of state.frameEpochs) if (epoch === previousEpoch) state.frameEpochs.set(frameId, state.epoch);
  }
  _clearChains(state) {
    for (const chain of state.chains.values()) this.pendingExtraBytes -= chain.extraBytes || 0;
    state.chains.clear();
  }
  _queueExtra(chain, field, value) {
    const bytes = JSON.stringify(value).length * 2 + 256;
    // ExtraInfo can arrive before its request. Bound those temporary queues separately.
    if (chain[field].length >= 4 || this.pendingExtraBytes + bytes > 1024 * 1024) return;
    chain[field].push({ value, bytes });
    chain.extraBytes += bytes;
    this.pendingExtraBytes += bytes;
  }
  _shiftExtra(chain, field) {
    const item = chain[field].shift();
    chain.extraBytes -= item.bytes;
    this.pendingExtraBytes -= item.bytes;
    return item.value;
  }
  _chain(state, key) {
    let chain = state.chains.get(key);
    if (!chain) {
      chain = { ids: [], requestExtras: [], responseExtras: [], extraBytes: 0 };
      state.chains.set(key, chain);
      while (state.chains.size > LIMITS.entries) {
        const oldest = state.chains.keys().next().value;
        this.pendingExtraBytes -= state.chains.get(oldest).extraBytes;
        state.chains.delete(oldest);
      }
    }
    return chain;
  }
  _current(state, key) {
    const ids = state.chains.get(key)?.ids || [];
    return this.entries.get(ids[ids.length - 1]);
  }
  _update(entry) {
    if (!this.entries.has(entry.id)) return;
    const meta = this.metadata.get(entry.id);
    // UTF-16 plus object overhead: conservative estimate for the retained JavaScript data.
    const size = JSON.stringify(entry).length * 2 + 2048;
    this.memoryBytes += size - meta.estimate;
    meta.estimate = size;
    const removed = [];
    while (this.entries.size > LIMITS.entries || this.memoryBytes > LIMITS.memoryBytes) {
      const id = this.entries.keys().next().value;
      this.memoryBytes -= this.metadata.get(id).estimate;
      this.metadata.delete(id);
      this.entries.delete(id);
      removed.push(id);
    }
    if (removed.length) this.emit('network-removed', { ids: removed });
    if (this.entries.has(entry.id)) this.emit('network-entry', copy(entry));
  }
  _newEntry(state, key, params, sessionId = '', socket = false) {
    const request = params.request || { url: params.url, method: 'GET', headers: {} };
    if (!validUrl(request.url)) return null;
    const entry = {
      id: `net-${++this.sequence}`, tabId: state.tabId, pageUrl: clipped(state.pageUrl, 16384),
      url: clipped(request.url, 16384), method: clipped(request.method || 'GET', 32),
      type: socket ? 'WebSocket' : clipped(params.type || 'Other', 64), status: null,
      mimeType: socket ? 'application/websocket' : '',
      startTime: Number.isFinite(params.wallTime) ? params.wallTime * 1000 : Date.now(),
      duration: 0, size: 0, requestHeaders: headers(request.headers), responseHeaders: {},
      postData: clipped(request.postData || '', LIMITS.bodyBytes), responseBody: '', bodyBase64: false,
      error: '', frames: [], bodyNote: '',
    };
    if (request.postData && Buffer.byteLength(request.postData) > LIMITS.bodyBytes) note(entry, 'Request body truncated at 256 KiB.');
    if (request.hasPostData && !request.postData) note(entry, 'Chromium omitted the request body; file upload contents may be unavailable.');
    const meta = { state, key, sessionId, requestId: params.requestId, epoch: state.epoch,
      startTs: params.timestamp, estimate: 0, expectedExtra: null, requestExtraSeen: false, responseExtraSeen: false };
    this.metadata.set(entry.id, meta);
    this.entries.set(entry.id, entry);
    const chain = this._chain(state, key);
    chain.ids.push(entry.id);
    if (chain.ids.length > 32) chain.ids.shift();
    this._update(entry);
    this._drainExtras(state, key);
    return entry;
  }
  _duration(entry, timestamp) {
    const meta = this.metadata.get(entry.id);
    if (meta && Number.isFinite(timestamp) && Number.isFinite(meta.startTs)) entry.duration = nonnegative((timestamp - meta.startTs) * 1000);
  }
  _response(entry, response) {
    entry.status = response.status ?? entry.status;
    entry.statusText = clipped(response.statusText || '', 256);
    entry.mimeType = clipped(response.mimeType || entry.mimeType, 256);
    entry.responseHeaders = headers({ ...entry.responseHeaders, ...response.headers });
    entry.protocol = clipped(response.protocol || '', 64);
    entry.fromCache = Boolean(response.fromDiskCache || response.fromPrefetchCache || entry.fromCache);
    entry.fromServiceWorker = Boolean(response.fromServiceWorker);
  }
  _drainExtras(state, key) {
    const chain = state.chains.get(key);
    if (!chain) return;
    for (const id of chain.ids) {
      const entry = this.entries.get(id), meta = this.metadata.get(id);
      if (!entry || meta.expectedExtra === false) continue;
      let changed = false;
      if (!meta.requestExtraSeen && chain.requestExtras.length) {
        entry.requestHeaders = headers({ ...entry.requestHeaders, ...this._shiftExtra(chain, 'requestExtras') });
        meta.requestExtraSeen = changed = true;
      }
      if (meta.expectedExtra === true && !meta.responseExtraSeen && chain.responseExtras.length) {
        const extra = this._shiftExtra(chain, 'responseExtras');
        entry.responseHeaders = headers({ ...entry.responseHeaders, ...extra.headers });
        entry.status = extra.statusCode ?? entry.status;
        meta.responseExtraSeen = changed = true;
      }
      if (changed) this._update(entry);
    }
  }
  _addFrame(entry, params, direction, kind) {
    const source = params.response || {};
    const data = kind === 'sse' ? params.data : source.payloadData;
    const originalBytes = Buffer.byteLength(String(data || ''));
    const frame = { direction, kind, timestamp: params.timestamp,
      data: clipped(data, LIMITS.bodyBytes), opcode: kind === 'sse' ? null : source.opcode,
      base64: kind !== 'sse' && source.opcode !== 1,
      eventName: clipped(params.eventName || '', 256), eventId: clipped(params.eventId || '', 256) };
    entry.frames.push(frame);
    let bytes = entry.frames.reduce((total, item) => total + Buffer.byteLength(item.data), 0);
    while (entry.frames.length > LIMITS.frames || bytes > LIMITS.bodyBytes) {
      bytes -= Buffer.byteLength(entry.frames.shift().data);
      note(entry, 'Older stream messages discarded at the 200-message / 256 KiB limit.');
    }
    if (originalBytes > LIMITS.bodyBytes) note(entry, 'Stream message truncated at 256 KiB.');
    this._duration(entry, params.timestamp);
    this._update(entry);
  }

  /** Public for deterministic tests; Electron passes sessionId as the fourth message argument. */
  async handleMessage(tabId, method, params = {}, sessionId = '') {
    const state = this.tabs.get(tabId);
    if (!state) return;
    if (method === 'Target.attachedToTarget') {
      if (!['iframe', 'worker'].includes(params.targetInfo?.type)) return;
      if (params.targetInfo.type === 'iframe') state.frameSessions.add(params.sessionId);
      if (state.awaitingDocument) return;
      if (sessionId && state.sessions.get(sessionId)?.epoch !== state.epoch) return;
      if (state.sessions.size >= 256) return;
      state.sessions.set(params.sessionId, { epoch: state.epoch, type: params.targetInfo.type });
      const dbg = state.webContents.debugger;
      await dbg.sendCommand('Network.enable', NETWORK_OPTIONS, params.sessionId).catch(() => {});
      await dbg.sendCommand('Target.setAutoAttach', AUTO_ATTACH, params.sessionId).catch(() => {});
      return;
    }
    if (method === 'Target.detachedFromTarget') { state.sessions.delete(params.sessionId); state.frameSessions.delete(params.sessionId); return; }
    if (!sessionId && method === 'Page.frameAttached') {
      if (state.frameEpochs.get(params.parentFrameId) === state.epoch && state.frameEpochs.size < 1024) state.frameEpochs.set(params.frameId, state.epoch);
      return;
    }
    if (!sessionId && method === 'Page.frameDetached') { state.frameEpochs.delete(params.frameId); return; }
    if (!sessionId && method === 'Page.frameNavigated' && params.frame?.parentId) {
      if (!state.awaitingDocument && state.frameEpochs.get(params.frame.parentId) === state.epoch && state.frameEpochs.size < 1024) state.frameEpochs.set(params.frame.id, state.epoch);
      return;
    }
    if (!sessionId && method === 'Page.frameNavigated' && params.frame && !params.frame.parentId) {
      state.mainFrameId = params.frame.id;
      this._navigate(state, params.frame.url);
      state.loaderId = params.frame.loaderId || state.loaderId;
      state.awaitingDocument = false;
      state.frameEpochs.set(state.mainFrameId, state.epoch);
      return;
    }
    if (!method.startsWith('Network.')) return;
    const key = `${sessionId}:${params.requestId}`;
    if (method === 'Network.requestWillBeSent') {
      const previous = this._current(state, key);
      if (previous && params.redirectResponse && this._allowed(state, sessionId)) {
        this._response(previous, params.redirectResponse);
        this._duration(previous, params.timestamp);
        note(previous, 'Redirect response: no response body is exposed by Chromium.');
        this.metadata.get(previous.id).expectedExtra = params.redirectHasExtraInfo === true;
        this._drainExtras(state, key);
        this._update(previous);
      }
      // Main-frame redirects must re-evaluate the destination before recording it.
      const initialMainDocument = !state.mainFrameId && params.request?.url === state.pageUrl;
      if (!sessionId && params.type === 'Document' && (params.frameId === state.mainFrameId || initialMainDocument)) {
        state.mainFrameId = params.frameId;
        this._navigate(state, params.request?.url || state.pageUrl);
        state.loaderId = params.loaderId || '';
        state.awaitingDocument = false;
        state.frameEpochs.set(state.mainFrameId, state.epoch);
      }
      if (!this._allowed(state, sessionId)) return;
      // A late request from the old top-level document must not be attributed to the new page.
      if (!sessionId && params.frameId === state.mainFrameId && params.loaderId && state.loaderId && params.loaderId !== state.loaderId) return;
      if (!sessionId && params.frameId && state.frameEpochs.get(params.frameId) !== state.epoch) return;
      this._newEntry(state, key, params, sessionId);
      return;
    }
    if (!this._allowed(state, sessionId)) return;
    if (method === 'Network.webSocketCreated') {
      this._newEntry(state, key, params, sessionId, true);
      return;
    }
    if (method === 'Network.requestWillBeSentExtraInfo' || method === 'Network.responseReceivedExtraInfo') {
      const chain = this._chain(state, key);
      if (method === 'Network.requestWillBeSentExtraInfo') {
        this._queueExtra(chain, 'requestExtras', headers(params.headers));
      } else {
        this._queueExtra(chain, 'responseExtras', { headers: headers(params.headers), statusCode: params.statusCode });
      }
      this._drainExtras(state, key);
      return;
    }
    const entry = this._current(state, key);
    if (!entry) return;
    const meta = this.metadata.get(entry.id);
    if (meta.epoch !== state.epoch) return;
    switch (method) {
      case 'Network.responseReceived':
        this._response(entry, params.response || {});
        meta.expectedExtra = params.hasExtraInfo === true;
        this._drainExtras(state, key);
        this._duration(entry, params.timestamp);
        break;
      case 'Network.requestServedFromCache': entry.fromCache = true; break;
      case 'Network.dataReceived':
        entry.size += nonnegative(params.encodedDataLength || params.dataLength);
        this._duration(entry, params.timestamp);
        break;
      case 'Network.loadingFailed':
        entry.error = clipped(params.errorText || params.blockedReason || 'Request failed', 2048);
        this._duration(entry, params.timestamp);
        note(entry, 'No response body: request failed.');
        break;
      case 'Network.loadingFinished': {
        entry.size = nonnegative(params.encodedDataLength);
        this._duration(entry, params.timestamp);
        this._update(entry);
        if (entry.size > LIMITS.bodyBytes) {
          note(entry, 'Response body omitted: transfer exceeds the 256 KiB capture limit.');
          break;
        }
        try {
          const response = await state.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: params.requestId }, sessionId || undefined);
          if (!this.entries.has(entry.id) || !this._allowed(state, sessionId) || meta.epoch !== state.epoch) return;
          entry.bodyBase64 = Boolean(response.base64Encoded);
          const limit = entry.bodyBase64 ? Math.floor(LIMITS.bodyBytes / 3) * 4 : LIMITS.bodyBytes;
          entry.responseBody = clipped(response.body, limit);
          if (Buffer.byteLength(response.body || '') > limit) note(entry, 'Response body truncated at 256 KiB.');
        } catch {
          if (!this.entries.has(entry.id) || !this._allowed(state, sessionId) || meta.epoch !== state.epoch) return;
          note(entry, 'Response body unavailable (Chromium may omit cached, redirected, or evicted bodies).');
        }
        break;
      }
      case 'Network.webSocketWillSendHandshakeRequest':
        entry.requestHeaders = headers(params.request?.headers);
        if (Number.isFinite(params.wallTime)) entry.startTime = params.wallTime * 1000;
        meta.startTs = params.timestamp;
        break;
      case 'Network.webSocketHandshakeResponseReceived': this._response(entry, params.response || {}); break;
      case 'Network.webSocketFrameSent': this._addFrame(entry, params, 'sent', 'websocket'); return;
      case 'Network.webSocketFrameReceived': this._addFrame(entry, params, 'received', 'websocket'); return;
      case 'Network.eventSourceMessageReceived': this._addFrame(entry, params, 'received', 'sse'); return;
      case 'Network.webSocketFrameError': entry.error = clipped(params.errorMessage, 2048); break;
      case 'Network.webSocketClosed': this._duration(entry, params.timestamp); entry.closed = true; break;
      default: return;
    }
    this._update(entry);
  }

  exportHAR() {
    const headerList = source => Object.entries(source || {}).map(([name, value]) => ({ name, value }));
    return { log: { version: '1.2', creator: { name: 'Prism Browser', version: '1.0' },
      comment: 'Local capture. Bodies and stream messages are bounded; cookies and credentials may be present.',
      entries: this.getEntries().map(entry => {
        let queryString = [];
        try { queryString = Array.from(new URL(entry.url).searchParams, ([name, value]) => ({ name, value })); } catch {}
        return {
          startedDateTime: new Date(entry.startTime).toISOString(), time: entry.duration,
          request: { method: entry.method, url: entry.url, httpVersion: entry.protocol || '',
            cookies: [], headers: headerList(entry.requestHeaders), queryString, headersSize: -1,
            bodySize: Buffer.byteLength(entry.postData),
            ...(entry.postData ? { postData: { mimeType: Object.entries(entry.requestHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '', text: entry.postData } } : {}) },
          response: { status: entry.status || 0, statusText: entry.statusText || '', httpVersion: entry.protocol || '',
            cookies: [], headers: headerList(entry.responseHeaders), redirectURL: Object.entries(entry.responseHeaders).find(([name]) => name.toLowerCase() === 'location')?.[1] || '',
            headersSize: -1, bodySize: entry.size,
            content: { size: Buffer.byteLength(entry.responseBody, entry.bodyBase64 ? 'base64' : 'utf8'), mimeType: entry.mimeType,
              text: entry.responseBody, ...(entry.bodyBase64 ? { encoding: 'base64' } : {}), comment: entry.bodyNote } },
          cache: {}, timings: { send: 0, wait: entry.duration, receive: 0 },
          _tabId: entry.tabId, _pageUrl: entry.pageUrl, _resourceType: entry.type, _error: entry.error,
          _streamMessages: entry.frames,
        };
      }) } };
  }
}

module.exports = { NetworkMonitor, LIMITS };
