'use strict';

// This is a compatibility aid, not an undetectable replacement for OS focus.
// CDP's native emulation is page-wide; JS overrides are checked per document.
// https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument
// https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled

function focusRules(rules) {
  return (Array.isArray(rules) ? rules : []).filter(rule => rule && rule.focus === true && typeof rule.host === 'string')
    .flatMap(rule => {
      try {
        const parsed = new URL(`https://${rule.host}`);
        if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.port) return [];
        return [{ host: parsed.hostname.toLowerCase().replace(/\.$/, ''), includeSubdomains: rule.includeSubdomains === true }];
      } catch { return []; }
    });
}

function selected(url, rules) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return rules.some(rule => host === rule.host || (rule.includeSubdomains && host.endsWith(`.${rule.host}`)));
  } catch { return false; }
}

// Serialized into the page's MAIN world, before that document's own scripts.
// Prototype wrappers only affect this selected document; other document receivers
// still use their original getter/method. They are restored with the own properties.
function patchDocument(rules) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const key = Symbol.for('prism.focus-state.v1');
  const previous = document[key];

  let enabled = false;
  try {
    const url = new URL(document.location.href);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    enabled = (url.protocol === 'http:' || url.protocol === 'https:') && rules.some(rule =>
      host === rule.host || (rule.includeSubdomains && host.endsWith(`.${rule.host}`)));
  } catch { /* about:blank, opaque or unavailable documents are not selected. */ }
  // Keep the original capture-listener order across dom-ready/frame refreshes.
  // Reinstalling after website scripts have run would let their listeners run first.
  if (enabled && previous?.version === 2) return true;
  if (previous && typeof previous.restore === 'function') previous.restore();
  if (!enabled) return false;

  const descriptors = [];
  const listeners = [];
  const selectionStyles = new Map();
  const originalHasFocus = document.hasFocus.bind(document);
  const define = (name, descriptor, owner = document) => {
    const original = Object.getOwnPropertyDescriptor(owner, name);
    try {
      Object.defineProperty(owner, name, { ...descriptor, configurable: true });
      descriptors.push({ owner, name, original, replacement: Object.getOwnPropertyDescriptor(owner, name) });
    } catch { /* Non-configurable properties on unusual pages cannot be replaced. */ }
  };
  const restore = () => {
    for (const [name, listener] of listeners) window.removeEventListener(name, listener, true);
    for (const [element, properties] of selectionStyles) {
      for (const [property, original] of properties) {
        if (element.style.getPropertyValue(property) !== 'text' || element.style.getPropertyPriority(property) !== 'important') continue;
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      }
    }
    for (const { owner, name, original, replacement } of descriptors) {
      const current = Object.getOwnPropertyDescriptor(owner, name);
      // Respect a page's own subsequent changes instead of overwriting them.
      if (!current || current.get !== replacement.get || current.value !== replacement.value) continue;
      try {
        if (original) Object.defineProperty(owner, name, original);
        else delete owner[name];
      } catch { /* A page may deliberately freeze its properties after installation. */ }
    }
    try { delete document[key]; } catch { /* Best effort if a page freezes the document. */ }
  };
  try { Object.defineProperty(document, key, { value: { restore, version: 2 }, configurable: true }); }
  catch { return false; }

  for (const [name, value] of [['hasFocus', true], ['hidden', false], ['visibilityState', 'visible'], ['webkitHidden', false], ['webkitVisibilityState', 'visible']]) {
    let owner = Object.getPrototypeOf(document);
    while (owner && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
    if (!owner) continue;
    const original = Object.getOwnPropertyDescriptor(owner, name);
    if (name === 'hasFocus' && typeof original.value === 'function') {
      define(name, { ...original, value: function hasFocus(...args) { return this === document ? true : Reflect.apply(original.value, this, args); } }, owner);
    } else if (original.get) {
      define(name, { ...original, get: function () { return this === document ? value : Reflect.apply(original.get, this, []); } }, owner);
    }
  }

  define('hasFocus', { value: function hasFocus() { return true; }, writable: true });
  define('hidden', { get: () => false });
  define('visibilityState', { get: () => 'visible' });
  define('webkitHidden', { get: () => false });
  define('webkitVisibilityState', { get: () => 'visible' });

  // Keep Chromium's actual selection so native copy, drag selection and editing
  // still work. Only the page-facing selection read APIs report an empty range.
  // Script-driven rich-text editors may require this mode to be turned off.
  let nativeSelection;
  try { nativeSelection = window.getSelection?.(); } catch { /* Detached document. */ }
  if (nativeSelection && window.Selection?.prototype) {
    const prototype = window.Selection.prototype;
    for (const [name, value] of Object.entries({
      anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0,
      baseNode: null, baseOffset: 0, extentNode: null, extentOffset: 0,
      isCollapsed: true, rangeCount: 0, type: 'None', direction: 'none',
    })) {
      const original = Object.getOwnPropertyDescriptor(prototype, name);
      if (original?.get) define(name, { ...original, get: function () {
        return this === nativeSelection ? value : Reflect.apply(original.get, this, []);
      } }, prototype);
    }
    for (const [name, replacement] of Object.entries({
      toString: () => '', containsNode: () => false, getComposedRanges: () => [],
      getRangeAt: () => { throw new DOMException('The selection has no ranges.', 'IndexSizeError'); },
    })) {
      const original = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof original?.value === 'function') define(name, { ...original, value: function (...args) {
        return this === nativeSelection ? replacement() : Reflect.apply(original.value, this, args);
      } }, prototype);
    }
  }
  for (const constructor of [window.HTMLInputElement, window.HTMLTextAreaElement]) {
    if (!constructor?.prototype) continue;
    for (const name of ['selectionStart', 'selectionEnd', 'selectionDirection']) {
      const original = Object.getOwnPropertyDescriptor(constructor.prototype, name);
      if (original?.get) define(name, { ...original, get: function () {
        const native = Reflect.apply(original.get, this, []);
        return this.ownerDocument === document && native !== null ? (name === 'selectionDirection' ? 'none' : 0) : native;
      } }, constructor.prototype);
    }
  }

  const stop = event => {
    // Never preventDefault here: Chromium must still type, select and copy/paste.
    if (event.isTrusted) event.stopImmediatePropagation();
  };
  for (const name of ['keydown', 'keyup', 'keypress', 'selectionchange', 'selectstart', 'select', 'copy', 'cut', 'paste']) {
    window.addEventListener(name, stop, true);
    listeners.push([name, stop]);
  }

  const allowSelection = event => {
    if (!event.isTrusted || event.button !== 0) return;
    // Restore native text selection only on the clicked branch. Keep the exact
    // previous inline values for disable, and do not rewrite the entire page DOM.
    let element = event.composedPath?.()[0] || event.target;
    if (element?.nodeType === 3) element = element.parentElement;
    while (element?.style && element.ownerDocument === document) {
      const computed = window.getComputedStyle?.(element);
      if (computed?.userSelect === 'none' || computed?.webkitUserSelect === 'none') {
        let properties = selectionStyles.get(element);
        if (!properties) { properties = new Map(); selectionStyles.set(element, properties); }
        for (const property of ['user-select', '-webkit-user-select']) {
          if (!properties.has(property)) properties.set(property, {
            value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property),
          });
          element.style.setProperty(property, 'text', 'important');
        }
      }
      element = element.parentElement || element.getRootNode?.().host;
    }
    // A site can cancel pointerdown/mousedown to disable selection/focus. Prevent
    // that cancellation without swallowing its handlers or ordinary click logic.
    try {
      Object.defineProperty(event, 'preventDefault', { configurable: true, value() {} });
      Object.defineProperty(event, 'returnValue', { configurable: true, get: () => true, set() {} });
    } catch { /* An unusual event may not accept own-property overrides. */ }
  };
  for (const name of ['pointerdown', 'mousedown']) {
    window.addEventListener(name, allowSelection, true);
    listeners.push([name, allowSelection]);
  }

  const suppress = event => {
    if (!event.isTrusted) return;
    const isVisibility = event.type === 'visibilitychange' || event.type === 'webkitvisibilitychange';
    // Input-to-input focus still works; input blur caused by leaving the document
    // is suppressed when the native (unpatched) focus getter can distinguish it.
    const leavingDocument = (event.type === 'blur' || event.type === 'focusout') && !originalHasFocus();
    if (isVisibility || event.target === window || event.target === document || leavingDocument) event.stopImmediatePropagation();
  };
  for (const name of ['blur', 'focusout', 'focus', 'focusin', 'visibilitychange', 'webkitvisibilitychange']) {
    window.addEventListener(name, suppress, true);
    listeners.push([name, suppress]);
  }
  return true;
}

function buildFocusScript(rules) {
  return `(${patchDocument.toString()})(${JSON.stringify(focusRules(rules))});`;
}

class FocusController {
  constructor({ getRules, onError = () => {}, onStatus = () => {}, executionTimeout = 5000 }) {
    this.getRules = getRules;
    this.onError = onError;
    this.onStatus = onStatus;
    this.executionTimeout = executionTimeout;
    this.tabs = new Map();
  }

  async attach(webContents, tabId) {
    if (this.tabs.has(tabId)) await this.detach(tabId);
    if (!webContents.debugger.isAttached()) throw new Error('Attach the network debugger before the focus controller.');
    const state = { webContents, tabId, chain: Promise.resolve(), scriptId: null, signature: null, epoch: 0, closed: false, listeners: [], appliedFrames: new Map(), status: { status: 'applying', error: '', warning: '' } };
    this.tabs.set(tabId, state);
    this.onStatus(state.status, tabId);
    const listen = (name, handler) => {
      webContents.on(name, handler);
      state.listeners.push([name, handler]);
    };
    const suspend = () => {
      state.epoch++;
      this.publish(state, 'applying');
      void this.setEmulation(state, false);
    };
    const refresh = () => { void this.refresh(tabId).catch(() => {}); };
    state.onDebuggerDetach = () => {
      state.epoch++;
      this.publish(state, 'unavailable', 'Page tools disconnected. Turn spoof mode on again to reconnect.');
    };
    webContents.debugger.on?.('detach', state.onDebuggerDetach);
    // The native CDP setting spans a whole page. Suspend it while frame scope is
    // unknown, then re-enable only if EVERY current frame has its own rule.
    listen('did-start-navigation', suspend);
    listen('frame-created', suspend);
    listen('did-frame-navigate', refresh);
    listen('did-navigate-in-page', refresh);
    listen('did-finish-load', refresh);
    listen('dom-ready', refresh);
    listen('destroyed', () => { void this.detach(tabId); });
    try {
      await webContents.debugger.sendCommand('Page.enable');
      await this.refresh(tabId);
    } catch (error) {
      if (state.status.status !== 'error') this.fail(state, error);
      throw error;
    }
  }

  getStatus(tabId) {
    return { ...(this.tabs.get(tabId)?.status || { status: 'unavailable', error: 'Page tools are not attached.', warning: '' }) };
  }

  publish(state, status, error = '', warning = '') {
    if (state.closed) return;
    const next = { status, error, warning };
    if (JSON.stringify(state.status) === JSON.stringify(next)) return;
    state.status = next;
    this.onStatus({ ...next }, state.tabId);
  }

  fail(state, error) {
    if (state.closed) return;
    this.publish(state, 'error', error?.message || String(error));
    this.onError(error, state.tabId);
  }

  async execute(frame, source) {
    let timer;
    try {
      return await Promise.race([
        frame.executeJavaScript(source, false),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The page did not respond while applying spoof mode. Reload it and try again.')), this.executionTimeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  frames(state) {
    try {
      const main = state.webContents.mainFrame;
      if (!main) return [];
      return [...new Set([main, ...(main.framesInSubtree || [])])].filter(frame => !frame.isDestroyed?.());
    } catch { return []; }
  }

  async setEmulation(state, enabled) {
    try {
      if (!state.webContents.isDestroyed() && state.webContents.debugger.isAttached()) {
        await state.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled });
        return '';
      }
      return 'Native focus emulation is unavailable because page tools are disconnected.';
    } catch (error) {
      // Experimental CDP support can vary between Chromium releases. The
      // document-level overrides remain useful when native emulation is absent.
      return `Native focus emulation is unavailable: ${error.message || error}. Document controls remain active.`;
    }
  }

  refresh(tabId) {
    const state = this.tabs.get(tabId);
    if (!state || state.closed) return Promise.reject(new Error('Page tools are not attached. Turn spoof mode on again to reconnect.'));
    state.chain = state.chain.catch(() => {}).then(async () => {
      if (state.closed || state.webContents.isDestroyed()) return;
      const epoch = state.epoch;
      try {
        this.publish(state, 'applying');
        if (!state.webContents.debugger.isAttached()) throw new Error('Page tools are disconnected. Turn spoof mode on again to reconnect.');
        const rules = this.getRules();
        const normalized = focusRules(rules);
        const source = buildFocusScript(rules);
        const signature = JSON.stringify(normalized);
        if (state.signature !== signature) {
          // Replacing rules for another site must not briefly remove native
          // focus from an already selected page. Navigation/frame events still
          // suspend emulation immediately while the new document scope is unknown.
          const currentFrames = this.frames(state);
          const scopeStillSelected = currentFrames.length > 0 && currentFrames.every(frame => selected(frame.url, normalized));
          if (!scopeStillSelected) await this.setEmulation(state, false);
          if (state.scriptId) {
            await state.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: state.scriptId });
            state.scriptId = null;
          }
          if (state.closed) return;
          // Omit worldName: isolated-world replacements are invisible to websites.
          const result = await state.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source });
          state.scriptId = result.identifier;
          state.signature = signature;
        }
        if (state.closed) return;
        const frames = this.frames(state);
        // Bound every frame independently: an unresponsive background renderer
        // must not leave the toolbar waiting indefinitely for rule application.
        const results = await Promise.allSettled(frames.map(frame => this.execute(frame, source)));
        if (state.closed || epoch !== state.epoch) return;
        if (!frames.length) throw new Error('The page is not ready for spoof mode. Reload it and try again.');
        for (let index = 0; index < frames.length; index++) {
          const frame = frames[index];
          const enabled = selected(frame.url, normalized);
          const previous = state.appliedFrames.get(frame);
          const result = results[index];
          // Failures on unrelated documents are irrelevant, but failed removal
          // from a previously selected frame must be visible as well.
          if ((enabled || previous === true) && (result.status === 'rejected' || result.value !== enabled)) {
            throw result.status === 'rejected' ? result.reason : new Error('Spoof mode could not be applied to this page. Reload it and try again.');
          }
        }
        const currentFrames = this.frames(state);
        const allSelected = currentFrames.length > 0 && currentFrames.every(frame => selected(frame.url, normalized));
        const warning = await this.setEmulation(state, allSelected);
        if (state.closed || epoch !== state.epoch) return;
        // Only documents whose own setting changed need an update notification.
        // Saving an unrelated site's rule must not add fake focus events here.
        const changedFrames = frames.filter(frame => {
          const enabled = selected(frame.url, normalized);
          return state.appliedFrames.get(frame) !== enabled && (enabled || state.appliedFrames.get(frame) === true);
        });
        const signal = `(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event(document.hasFocus() ? 'focus' : 'blur')); })();`;
        await Promise.allSettled(changedFrames.map(frame => this.execute(frame, signal)));
        if (state.closed || epoch !== state.epoch) return;
        state.appliedFrames = new Map(frames.map(frame => [frame, selected(frame.url, normalized)]));
        this.publish(state, selected(state.webContents.mainFrame.url, normalized) ? 'active' : 'inactive', '', allSelected ? warning : '');
      } catch (error) {
        if (state.closed || epoch !== state.epoch) return;
        this.fail(state, error);
        throw error;
      }
    });
    return state.chain;
  }

  async detach(tabId) {
    const state = this.tabs.get(tabId);
    if (!state) return;
    state.closed = true;
    this.tabs.delete(tabId);
    for (const [name, handler] of state.listeners) state.webContents.removeListener(name, handler);
    state.webContents.debugger.removeListener?.('detach', state.onDebuggerDetach);
    await state.chain.catch(() => {});
    await this.setEmulation(state, false);
    if (state.webContents.isDestroyed()) return;
    if (state.scriptId && state.webContents.debugger.isAttached()) {
      await state.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: state.scriptId }).catch(() => {});
    }
    const source = buildFocusScript([]);
    await Promise.allSettled(this.frames(state).map(frame => this.execute(frame, source)));
  }
}

module.exports = { FocusController, buildFocusScript };
