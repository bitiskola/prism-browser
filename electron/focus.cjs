'use strict';

// This is a compatibility aid, not an undetectable replacement for OS focus.
// A selected top-level site includes its embedded documents. Rules on embedded
// sites alone stay local to those documents; native CDP emulation is page-wide.
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

function getChromeUserAgent(existingUA = '') {
  const ua = String(existingUA || '').trim();
  const base = ua || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
  return base
    .replace(/Electron\/\S+\s*/g, '')
    .replace(/PrismBrowser\/\S+\s*/g, '')
    .replace(/Chrome\/\d+(\.\d+)*/g, 'Chrome/153.0.0.0')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
    const urls = [document.location.href];
    // Chromium exposes ancestor origins even across the same-origin boundary.
    // Only inherit the top-level site's rule, never a sibling/embedded site's
    // rule. This also covers nested frames, about:blank and srcdoc at creation.
    const ancestors = document.location.ancestorOrigins;
    if (ancestors?.length) urls.push(ancestors[ancestors.length - 1]);
    enabled = urls.some(value => {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      return (url.protocol === 'http:' || url.protocol === 'https:') && rules.some(rule =>
        host === rule.host || (rule.includeSubdomains && host.endsWith(`.${rule.host}`)));
    });
  } catch { /* Unavailable documents are not selected. */ }
  // Keep the original capture-listener order across dom-ready/frame refreshes.
  // Reinstalling after website scripts have run would let their listeners run first.
  if (enabled && previous?.version === 2) return true;
  if (previous && typeof previous.restore === 'function') previous.restore();
  if (!enabled) return false;

  const descriptors = [];
  const listeners = [];
  const docListeners = [];
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
    for (const [name, listener] of docListeners) {
      try { document.removeEventListener(name, listener, true); } catch {}
    }
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
    try { delete window.__prism_report_display_surface; } catch {} 
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

  // Fullscreen spoofing in spoof mode: page always sees fullscreen, never notices exiting or re-entering
  let activeFsElement = null;
  const getFsElement = () => activeFsElement || (typeof document !== "undefined" ? (document.documentElement || document.body || null) : null);

  for (const [name, getter] of [
    ["fullscreenElement", getFsElement],
    ["webkitFullscreenElement", getFsElement],
    ["webkitCurrentFullScreenElement", getFsElement],
    ["fullscreen", () => true],
    ["webkitIsFullScreen", () => true],
    ["fullscreenEnabled", () => true],
    ["webkitFullscreenEnabled", () => true]
  ]) {
    let owner = (typeof document !== "undefined" && Object.getPrototypeOf(document)) || null;
    while (owner && !Object.hasOwn(owner, name)) owner = Object.getPrototypeOf(owner);
    if (!owner) continue;
    if (owner) {
      const original = Object.getOwnPropertyDescriptor(owner, name);
      if (original?.get) {
        define(name, { ...original, get: function () { return this === document ? getter() : Reflect.apply(original.get, this, []); } }, owner);
      } else {
        define(name, { get: getter, configurable: true }, owner);
      }
    }
  }

  define("fullscreenElement", { get: getFsElement });
  define("webkitFullscreenElement", { get: getFsElement });
  define("webkitCurrentFullScreenElement", { get: getFsElement });
  define("fullscreen", { get: () => true });
  define("webkitIsFullScreen", { get: () => true });
  define("fullscreenEnabled", { get: () => true });
  define("webkitFullscreenEnabled", { get: () => true });
  define("onfullscreenchange", { get: () => null, set: () => {}, configurable: true });
  define("onwebkitfullscreenchange", { get: () => null, set: () => {}, configurable: true });
  if (typeof window !== "undefined") {
    define("onfullscreenchange", { get: () => null, set: () => {}, configurable: true }, window);
    define("onwebkitfullscreenchange", { get: () => null, set: () => {}, configurable: true }, window);
  }

  const stopFsEvent = e => {
    if (e && typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }
  };
  for (const eventName of ["fullscreenchange", "webkitfullscreenchange", "fullscreenerror", "webkitfullscreenerror"]) {
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener(eventName, stopFsEvent, true);
      listeners.push([eventName, stopFsEvent]);
    }
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener(eventName, stopFsEvent, true);
      docListeners.push([eventName, stopFsEvent]);
    }
  }

  if (typeof Element !== "undefined" && Element.prototype) {
    const elProto = Element.prototype;
    if (elProto.requestFullscreen) {
      const origRequestFs = elProto.requestFullscreen;
      define("requestFullscreen", {
        value: async function requestFullscreen(...args) {
          activeFsElement = this;
          try {
            return await Reflect.apply(origRequestFs, this, args);
          } catch {
            return Promise.resolve();
          }
        },
        writable: true,
        configurable: true
      }, elProto);
    }
    if (elProto.webkitRequestFullscreen) {
      const origWebkitRequestFs = elProto.webkitRequestFullscreen;
      define("webkitRequestFullscreen", {
        value: async function webkitRequestFullscreen(...args) {
          activeFsElement = this;
          try {
            return await Reflect.apply(origWebkitRequestFs, this, args);
          } catch {
            return Promise.resolve();
          }
        },
        writable: true,
        configurable: true
      }, elProto);
    }
  }

  if (typeof Document !== "undefined" && Document.prototype) {
    const docProto = Document.prototype;
    if (docProto.exitFullscreen) {
      const origExitFs = docProto.exitFullscreen;
      define("exitFullscreen", {
        value: async function exitFullscreen(...args) {
          try {
            return await Reflect.apply(origExitFs, this, args);
          } catch {
            return Promise.resolve();
          }
        },
        writable: true,
        configurable: true
      }, docProto);
    }
    if (docProto.webkitExitFullscreen) {
      const origWebkitExitFs = docProto.webkitExitFullscreen;
      define("webkitExitFullscreen", {
        value: async function webkitExitFullscreen(...args) {
          try {
            return await Reflect.apply(origWebkitExitFs, this, args);
          } catch {
            return Promise.resolve();
          }
        },
        writable: true,
        configurable: true
      }, docProto);
    }
  }

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const origMatchMedia = window.matchMedia.bind(window);
    define("matchMedia", {
      value: function matchMedia(query) {
        const m = origMatchMedia(query);
        if (typeof query === "string" && query.includes("display-mode") && query.includes("fullscreen")) {
          return new Proxy(m, {
            get(target, prop) {
              if (prop === "matches") return true;
              if (prop === "media") return query;
              const v = target[prop];
              return typeof v === "function" ? v.bind(target) : v;
            }
          });
        }
        return m;
      },
      writable: true,
      configurable: true
    }, window);
  }

  // Spoof browser as Chrome 153 instead of Electron 44
  if (typeof navigator !== 'undefined') {
    let navOwner = navigator;
    let proto = Object.getPrototypeOf(navigator);
    while (proto && proto !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(proto, 'userAgent')) {
        navOwner = proto;
        break;
      }
      proto = Object.getPrototypeOf(proto);
    }
    const rawUA = navigator.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    const cleanUA = rawUA.replace(/Electron\/\S+\s*/g, '').replace(/PrismBrowser\/\S+\s*/g, '').replace(/Chrome\/\d+(\.\d+)*/g, 'Chrome/153.0.0.0').replace(/\s{2,}/g, ' ').trim();
    const rawAV = navigator.appVersion || '5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';
    const cleanAV = rawAV.replace(/Electron\/\S+\s*/g, '').replace(/PrismBrowser\/\S+\s*/g, '').replace(/Chrome\/\d+(\.\d+)*/g, 'Chrome/153.0.0.0').replace(/\s{2,}/g, ' ').trim();

    define('userAgent', { get: () => cleanUA, configurable: true }, navOwner);
    define('appVersion', { get: () => cleanAV, configurable: true }, navOwner);
    define('vendor', { get: () => 'Google Inc.', configurable: true }, navOwner);

    const brands = [
      { brand: 'Chromium', version: '153' },
      { brand: 'Google Chrome', version: '153' },
      { brand: 'Not(A:Brand', version: '24' }
    ];
    const fullVersionList = [
      { brand: 'Chromium', version: '153.0.0.0' },
      { brand: 'Google Chrome', version: '153.0.0.0' },
      { brand: 'Not(A:Brand', version: '24.0.0.0' }
    ];
    const platform = (navigator.platform && !/electron/i.test(navigator.platform))
      ? (navigator.platform.includes('Linux') ? 'Linux' : navigator.platform.includes('Win') ? 'Windows' : navigator.platform.includes('Mac') ? 'macOS' : 'Linux')
      : 'Linux';
    const fakeUad = {
      brands,
      mobile: false,
      platform,
      getHighEntropyValues: async (hints = []) => {
        const res = { brands, mobile: false, platform };
        if (hints.includes('platformVersion')) res.platformVersion = '6.6.0';
        if (hints.includes('architecture')) res.architecture = 'x86';
        if (hints.includes('model')) res.model = '';
        if (hints.includes('uaFullVersion')) res.uaFullVersion = '153.0.0.0';
        if (hints.includes('fullVersionList')) res.fullVersionList = fullVersionList;
        if (hints.includes('bitness')) res.bitness = '64';
        if (hints.includes('wow64')) res.wow64 = false;
        return res;
      },
      toJSON: () => ({ brands, mobile: false, platform })
    };
    define('userAgentData', { get: () => fakeUad, configurable: true }, navOwner);
  }

  if (typeof window !== 'undefined' && (!window.chrome || !window.chrome.app)) {
    const fakeChrome = {
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
        getDetails: () => null,
        getIsInstalled: () => false,
        runningState: () => 'cannot_run'
      },
      csi: () => {},
      loadTimes: () => ({
        requestTime: (Date.now() - 1000) / 1000,
        startLoadTime: (Date.now() - 1000) / 1000,
        commitLoadTime: (Date.now() - 800) / 1000,
        finishDocumentLoadTime: (Date.now() - 500) / 1000,
        firstPaintTime: (Date.now() - 600) / 1000,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: false,
        npnNegotiatedProtocol: 'unknown',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'unknown'
      })
    };
    define('chrome', { value: fakeChrome, writable: true, configurable: true }, window);
  }
  // Intercept screensharing displaySurface reporting
  let spoofedTracks;
  try { spoofedTracks = new WeakMap(); } catch {}

  if (typeof window !== 'undefined' && window.MediaStreamTrack?.prototype) {
    const trackProto = window.MediaStreamTrack.prototype;
    const protoGetSettings = trackProto.getSettings;
    if (typeof protoGetSettings === 'function') {
      define('getSettings', {
        value: function getSettings() {
          const s = Reflect.apply(protoGetSettings, this, []);
          const target = spoofedTracks?.get(this);
          if (target && s) {
            s.displaySurface = target;
            if (target === 'browser') s.logicalSurface = true;
          }
          return s;
        },
        writable: true,
        configurable: true
      }, trackProto);
    }
    const protoGetCaps = trackProto.getCapabilities;
    if (typeof protoGetCaps === 'function') {
      define('getCapabilities', {
        value: function getCapabilities() {
          const c = Reflect.apply(protoGetCaps, this, []);
          const target = spoofedTracks?.get(this);
          if (target && c) {
            c.displaySurface = target;
          }
          return c;
        },
        writable: true,
        configurable: true
      }, trackProto);
    }
    const protoLabelDesc = Object.getOwnPropertyDescriptor(trackProto, 'label');
    if (protoLabelDesc?.get) {
      define('label', {
        get: function label() {
          const target = spoofedTracks?.get(this);
          if (target) {
            return target === 'browser' ? 'Google Chrome Tab' : 'screen:0:0';
          }
          return Reflect.apply(protoLabelDesc.get, this, []);
        },
        configurable: true
      }, trackProto);
    }
  }

  if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
    let mediaOwner = navigator.mediaDevices;
    const proto = Object.getPrototypeOf(navigator.mediaDevices);
    if (proto && Object.prototype.hasOwnProperty.call(proto, 'getDisplayMedia')) {
      mediaOwner = proto;
    }
    const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

    const patchTrack = (track, surface) => {
      if (!track) return;
      if (spoofedTracks) spoofedTracks.set(track, surface);
      if (typeof track.getSettings === 'function') {
        const origGetSettings = track.getSettings.bind(track);
        track.getSettings = function getSettings() {
          const s = origGetSettings();
          if (s) {
            s.displaySurface = surface;
            if (surface === 'browser') s.logicalSurface = true;
          }
          return s;
        };
      }
      if (typeof track.getCapabilities === 'function') {
        const origGetCaps = track.getCapabilities.bind(track);
        track.getCapabilities = function getCapabilities() {
          const c = origGetCaps();
          if (c) c.displaySurface = surface;
          return c;
        };
      }
      try {
        const fakeLabel = (surface === 'browser') ? 'Google Chrome Tab' : 'screen:0:0';
        Object.defineProperty(track, 'label', {
          get: () => fakeLabel,
          configurable: true
        });
      } catch {}
      if (typeof track.clone === 'function') {
        const origClone = track.clone.bind(track);
        track.clone = function clone() {
          const cloned = origClone();
          patchTrack(cloned, surface);
          return cloned;
        };
      }
    };

    const wrappedGetDisplayMedia = async function getDisplayMedia(constraints) {
      let cleanConstraints = constraints;
      if (constraints && typeof constraints === 'object') {
        cleanConstraints = { ...constraints };
        if (cleanConstraints.video && typeof cleanConstraints.video === 'object') {
          cleanConstraints.video = { ...cleanConstraints.video };
          delete cleanConstraints.video.displaySurface;
          delete cleanConstraints.video.width;
          delete cleanConstraints.video.height;
        }
      }
      const stream = await origGetDisplayMedia(cleanConstraints);
      try {
        const targetSurface = window.__prism_report_display_surface;
        if (targetSurface && (targetSurface === 'monitor' || targetSurface === 'browser')) {
          const tracks = (typeof stream.getVideoTracks === 'function') ? stream.getVideoTracks() : [];
          for (const track of tracks) {
            patchTrack(track, targetSurface);
          }
        }
        const allTracks = (typeof stream.getVideoTracks === 'function') ? stream.getVideoTracks() : [];
        for (const track of allTracks) {
          if (typeof track.addEventListener === 'function') {
            track.addEventListener('ended', () => {
              try { console.info('__prism_screenshare_ended__'); } catch {}
            }, { once: true });
          }
        }
      } catch {}
      return stream;
    };

    define('getDisplayMedia', {
      value: wrappedGetDisplayMedia,
      writable: true,
      configurable: true
    }, mediaOwner);
  }


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
  // Boundary events also expose when the cursor enters or leaves the page.
  // Include over/out because sites often use those bubbling equivalents.
  for (const name of ['keydown', 'keyup', 'keypress', 'selectionchange', 'selectstart', 'select', 'copy', 'cut', 'paste',
    'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout']) {
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
  constructor({ getRules, getFrameSessions = () => [], onError = () => {}, onStatus = () => {}, executionTimeout = 5000 }) {
    this.getRules = getRules;
    this.getFrameSessions = getFrameSessions;
    this.onError = onError;
    this.onStatus = onStatus;
    this.executionTimeout = executionTimeout;
    this.tabs = new Map();
  }

  async attach(webContents, tabId) {
    if (this.tabs.has(tabId)) await this.detach(tabId);
    if (!webContents.debugger.isAttached()) throw new Error('Attach the network debugger before the focus controller.');
    const state = { webContents, tabId, chain: Promise.resolve(), scriptId: null, signature: null, epoch: 0, closed: false, listeners: [], appliedFrames: new Map(), frameSessions: new Map(), status: { status: 'applying', error: '', warning: '' } };
    for (const id of this.getFrameSessions(tabId)) state.frameSessions.set(id, { scriptId: null, signature: null });
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
      state.frameSessions.clear();
      this.publish(state, 'unavailable', 'Page tools disconnected. Turn spoof mode on again to reconnect.');
    };
    // The network controller owns auto-attachment. Reuse its iframe sessions
    // without attaching workers or changing debugger ownership. OOPIFs need
    // their own native emulation; the root session does not cover them.
    state.onDebuggerMessage = (_event, method, params = {}) => {
      if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'iframe') {
        if (!state.frameSessions.has(params.sessionId)) {
          state.frameSessions.set(params.sessionId, { scriptId: null, signature: null });
          refresh();
        }
      } else if (method === 'Target.detachedFromTarget') {
        state.frameSessions.delete(params.sessionId);
      }
    };
    webContents.debugger.on?.('detach', state.onDebuggerDetach);
    webContents.debugger.on?.('message', state.onDebuggerMessage);
    // The native CDP setting spans a whole page. Suspend it while frame scope is
    // unknown, then re-enable only if EVERY current frame is selected, either
    // through the top-level rule or through its own site's rule.
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

  frameSelected(state, frame, rules) {
    return selected(state.webContents.mainFrame.url, rules) || selected(frame.url, rules);
  }

  async updateFrameScripts(state, source, signature) {
    const results = await Promise.allSettled([...state.frameSessions].map(async ([id, session]) => {
      if (session.signature === signature) return;
      const send = (method, params) => state.webContents.debugger.sendCommand(method, params, id);
      try {
        await send('Page.enable');
        if (session.scriptId) {
          await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId });
          session.scriptId = null;
        }
        if (state.closed || state.frameSessions.get(id) !== session) return;
        const result = await send('Page.addScriptToEvaluateOnNewDocument', { source });
        session.scriptId = result.identifier;
        session.signature = signature;
      } catch (error) {
        // Navigation can destroy an iframe while its CDP command is pending.
        if (state.frameSessions.get(id) === session) throw error;
      }
    }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  async setEmulation(state, enabled) {
    try {
      if (!state.webContents.isDestroyed() && state.webContents.debugger.isAttached()) {
        const defaultUA = state.webContents.session?.getUserAgent?.() || '';
        const chrome153UA = getChromeUserAgent(defaultUA);
        const uaMetadata = {
          brands: [
            { brand: 'Chromium', version: '153' },
            { brand: 'Google Chrome', version: '153' },
            { brand: 'Not(A:Brand', version: '24' }
          ],
          fullVersionList: [
            { brand: 'Chromium', version: '153.0.0.0' },
            { brand: 'Google Chrome', version: '153.0.0.0' },
            { brand: 'Not(A:Brand', version: '24.0.0.0' }
          ],
          fullVersion: '153.0.0.0',
          platform: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
          platformVersion: '6.6.0',
          architecture: 'x86',
          model: '',
          mobile: false,
          bitness: '64',
          wow64: false
        };
        const uaParams = enabled
          ? { userAgent: chrome153UA, userAgentMetadata: uaMetadata }
          : { userAgent: defaultUA };
        const results = await Promise.allSettled([
          state.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', uaParams),
          state.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled }),
          ...[...state.frameSessions].flatMap(([id, session]) => [
            (async () => {
              try { await state.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', uaParams, id); }
              catch (error) { if (state.frameSessions.get(id) === session) throw error; }
            })(),
            (async () => {
              try { await state.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled }, id); }
              catch (error) { if (state.frameSessions.get(id) === session) throw error; }
            })(),
          ]),
        ]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
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
          const scopeStillSelected = currentFrames.length > 0 && currentFrames.every(frame => this.frameSelected(state, frame, normalized));
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
        await this.updateFrameScripts(state, source, signature);
        if (state.closed) return;
        const frames = this.frames(state);
        // Bound every frame independently: an unresponsive background renderer
        // must not leave the toolbar waiting indefinitely for rule application.
        const results = await Promise.allSettled(frames.map(frame => this.execute(frame, source)));
        if (state.closed || epoch !== state.epoch) return;
        if (!frames.length) throw new Error('The page is not ready for spoof mode. Reload it and try again.');
        for (let index = 0; index < frames.length; index++) {
          const frame = frames[index];
          const enabled = this.frameSelected(state, frame, normalized);
          const previous = state.appliedFrames.get(frame);
          const result = results[index];
          // Failures on unrelated documents are irrelevant, but failed removal
          // from a previously selected frame must be visible as well.
          if ((enabled || previous === true) && (result.status === 'rejected' || result.value !== enabled)) {
            throw result.status === 'rejected' ? result.reason : new Error('Spoof mode could not be applied to this page. Reload it and try again.');
          }
        }
        const currentFrames = this.frames(state);
        const allSelected = currentFrames.length > 0 && currentFrames.every(frame => this.frameSelected(state, frame, normalized));
        const warning = await this.setEmulation(state, allSelected);
        if (state.closed || epoch !== state.epoch) return;
        // Only documents whose own setting changed need an update notification.
        // Saving an unrelated site's rule must not add fake focus events here.
        const changedFrames = frames.filter(frame => {
          const enabled = this.frameSelected(state, frame, normalized);
          return state.appliedFrames.get(frame) !== enabled && (enabled || state.appliedFrames.get(frame) === true);
        });
        const signal = `(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event(document.hasFocus() ? 'focus' : 'blur')); })();`;
        await Promise.allSettled(changedFrames.map(frame => this.execute(frame, signal)));
        if (state.closed || epoch !== state.epoch) return;
        state.appliedFrames = new Map(frames.map(frame => [frame, this.frameSelected(state, frame, normalized)]));
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
    state.webContents.debugger.removeListener?.('message', state.onDebuggerMessage);
    await state.chain.catch(() => {});
    await this.setEmulation(state, false);
    if (state.webContents.isDestroyed()) return;
    if (state.webContents.debugger.isAttached()) {
      const defaultUA = state.webContents.session?.getUserAgent?.() || '';
      await state.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: defaultUA }).catch(() => {});
    }
    if (state.scriptId && state.webContents.debugger.isAttached()) {
      await state.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: state.scriptId }).catch(() => {});
    }
    if (state.webContents.debugger.isAttached()) {
      await Promise.allSettled([...state.frameSessions].filter(([, session]) => session.scriptId).map(([id, session]) =>
        state.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId }, id)));
    }
    state.frameSessions.clear();
    const source = buildFocusScript([]);
    await Promise.allSettled(this.frames(state).map(frame => this.execute(frame, source)));
  }
}

module.exports = { FocusController, buildFocusScript, getChromeUserAgent };
