'use strict';

// This is a compatibility aid, not an undetectable replacement for OS focus.
// A selected top-level site includes its embedded documents. Rules on embedded
// sites alone stay local to those documents; native CDP emulation is page-wide.
// https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument
// https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled

const SPOOF_PLATFORMS = Object.freeze({
  win64: Object.freeze({
    name: 'Windows 11 x64',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    platform: 'Win32',
    uadPlatform: 'Windows',
    platformVersion: '15.0.0',
    architecture: 'x86',
    bitness: '64',
    wow64: false
  }),
  linux64: Object.freeze({
    name: 'Linux x64',
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    appVersion: '5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    platform: 'Linux x86_64',
    uadPlatform: 'Linux',
    platformVersion: '6.6.0',
    architecture: 'x86',
    bitness: '64',
    wow64: false
  }),
  macos64: Object.freeze({
    name: 'macOS x64',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    appVersion: '5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    uadPlatform: 'macOS',
    platformVersion: '14.5.0',
    architecture: 'x86',
    bitness: '64',
    wow64: false
  })
});

const SPOOF_BROWSERS = Object.freeze({
  chrome: Object.freeze({ id: 'chrome', name: 'Google Chrome' }),
  edge: Object.freeze({ id: 'edge', name: 'Microsoft Edge' }),
  firefox: Object.freeze({ id: 'firefox', name: 'Mozilla Firefox' }),
  safari: Object.freeze({ id: 'safari', name: 'Apple Safari' }),
});

function getSpoofProfile(browser = 'chrome', platform = 'win64') {
  const platKey = ['win64', 'linux64', 'macos64'].includes(platform) ? platform : 'win64';
  const browKey = ['chrome', 'edge', 'firefox', 'safari'].includes(browser) ? browser : 'chrome';

  const osTokens = {
    win64: {
      token: 'Windows NT 10.0; Win64; x64',
      platform: 'Win32',
      uadPlatform: 'Windows',
      platformVersion: '15.0.0',
      architecture: 'x86',
      bitness: '64',
      wow64: false,
      firefoxToken: 'Windows NT 10.0; Win64; x64; rv:135.0',
      firefoxAppVersion: '5.0 (Windows)'
    },
    linux64: {
      token: 'X11; Linux x86_64',
      platform: 'Linux x86_64',
      uadPlatform: 'Linux',
      platformVersion: '6.6.0',
      architecture: 'x86',
      bitness: '64',
      wow64: false,
      firefoxToken: 'X11; Linux x86_64; rv:135.0',
      firefoxAppVersion: '5.0 (X11)'
    },
    macos64: {
      token: 'Macintosh; Intel Mac OS X 10_15_7',
      platform: 'MacIntel',
      uadPlatform: 'macOS',
      platformVersion: '14.5.0',
      architecture: 'x86',
      bitness: '64',
      wow64: false,
      firefoxToken: 'Macintosh; Intel Mac OS X 10.15; rv:135.0',
      firefoxAppVersion: '5.0 (Macintosh)'
    }
  };

  const p = osTokens[platKey];

  if (browKey === 'edge') {
    return {
      browser: 'edge',
      platform: p.platform,
      uadPlatform: p.uadPlatform,
      platformVersion: p.platformVersion,
      architecture: p.architecture,
      bitness: p.bitness,
      wow64: p.wow64,
      ua: `Mozilla/5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0`,
      appVersion: `5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0`,
      vendor: 'Google Inc.',
      hasUad: true,
      hasChromeObj: true,
      brands: [
        { brand: 'Chromium', version: '153' },
        { brand: 'Microsoft Edge', version: '153' },
        { brand: 'Not(A:Brand', version: '24' }
      ],
      fullVersionList: [
        { brand: 'Chromium', version: '153.0.0.0' },
        { brand: 'Microsoft Edge', version: '153.0.0.0' },
        { brand: 'Not(A:Brand', version: '24.0.0.0' }
      ],
      chUa: '"Chromium";v="153", "Microsoft Edge";v="153", "Not(A:Brand";v="24"',
      chFull: '"Chromium";v="153.0.0.0", "Microsoft Edge";v="153.0.0.0", "Not(A:Brand";v="24.0.0.0"'
    };
  }

  if (browKey === 'firefox') {
    return {
      browser: 'firefox',
      platform: p.platform,
      uadPlatform: p.uadPlatform,
      platformVersion: p.platformVersion,
      architecture: p.architecture,
      bitness: p.bitness,
      wow64: p.wow64,
      ua: `Mozilla/5.0 (${p.firefoxToken}) Gecko/20100101 Firefox/135.0`,
      appVersion: p.firefoxAppVersion,
      vendor: '',
      hasUad: false,
      hasChromeObj: false,
      brands: [],
      fullVersionList: [],
      chUa: null,
      chFull: null
    };
  }

  if (browKey === 'safari') {
    return {
      browser: 'safari',
      platform: p.platform,
      uadPlatform: p.uadPlatform,
      platformVersion: p.platformVersion,
      architecture: p.architecture,
      bitness: p.bitness,
      wow64: p.wow64,
      ua: `Mozilla/5.0 (${p.token}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15`,
      appVersion: `5.0 (${p.token}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15`,
      vendor: 'Apple Computer, Inc.',
      hasUad: false,
      hasChromeObj: false,
      brands: [],
      fullVersionList: [],
      chUa: null,
      chFull: null
    };
  }

  // Default: chrome
  return {
    browser: 'chrome',
    platform: p.platform,
    uadPlatform: p.uadPlatform,
    platformVersion: p.platformVersion,
    architecture: p.architecture,
    bitness: p.bitness,
    wow64: p.wow64,
    ua: `Mozilla/5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36`,
    appVersion: `5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36`,
    vendor: 'Google Inc.',
    hasUad: true,
    hasChromeObj: true,
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
    chUa: '"Chromium";v="153", "Google Chrome";v="153", "Not(A:Brand";v="24"',
    chFull: '"Chromium";v="153.0.0.0", "Google Chrome";v="153.0.0.0", "Not(A:Brand";v="24.0.0.0"'
  };
}

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

function getChromeUserAgent(existingUA = '', platform = '') {
  if (platform && SPOOF_PLATFORMS[platform]) {
    return SPOOF_PLATFORMS[platform].ua;
  }
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
function patchDocument(rules, spoofOptions = {}) {
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
  const currentSignature = JSON.stringify(spoofOptions);
  if (enabled && previous?.version === 2 && previous?.signature === currentSignature) return true;
  if (previous && typeof previous.restore === 'function') previous.restore();
  if (!enabled) return false;

  const optFocusVisibility = spoofOptions.focusVisibility !== false;
  const optFullscreen = spoofOptions.fullscreen !== false;
  const optKeyboard = spoofOptions.keyboard !== false;
  const optClipboard = spoofOptions.clipboardEvents !== false;
  const optRightClick = spoofOptions.rightClick !== false;
  const optSelection = spoofOptions.selection !== false;
  const optScreenshare = spoofOptions.screenshare !== false;
  const optScreenshareCursor = spoofOptions.screenshareCursor !== false;
  const optOsPlatform = spoofOptions.osPlatform !== false;
  const targetPlatformKey = spoofOptions.platform || 'win64';
  const optBrowser = spoofOptions.browserIdentity !== false;
  const targetBrowserKey = spoofOptions.browser || 'chrome';

  let activeCastTracksCount = 0;
  let cursorHost = null;
  let cursorEl = null;

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
    if (cursorHost) {
      try {
        if (typeof cursorHost.remove === 'function') cursorHost.remove();
        else if (cursorHost.parentNode && typeof cursorHost.parentNode.removeChild === 'function') {
          cursorHost.parentNode.removeChild(cursorHost);
        }
      } catch {}
      cursorHost = null;
      cursorEl = null;
    }
    try { delete window.__prism_report_display_surface; } catch {}
    try { delete window.__prism_set_cursor_stuck; } catch {}
    try { delete window.__prism_tab_cast_active; } catch {} 
    try { delete document[key]; } catch { /* Best effort if a page freezes the document. */ }
  };
  try { Object.defineProperty(document, key, { value: { restore, version: 2, signature: currentSignature }, configurable: true }); }
  catch { return false; }

  if (optFocusVisibility) {
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
  }

  // Fullscreen spoofing in spoof mode: page always sees fullscreen, never notices exiting or re-entering
  if (optFullscreen) {
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

    // Fullscreen resolution spoofing (embedded in optFullscreen):
    // Reports target device real fullscreen resolution (calibrated or 1920x1080, 24-bit, 1:1 dpr)
    // and keeps it locked even when toggling window fullscreen with Ctrl+F / controls.
    const targetWidth = (spoofOptions.targetResolution && spoofOptions.targetResolution.width) || 1920;
    const targetHeight = (spoofOptions.targetResolution && spoofOptions.targetResolution.height) || 1080;

    const fsResolution = {
      width: targetWidth,
      height: targetHeight,
      availWidth: targetWidth,
      availHeight: targetHeight,
      availLeft: 0,
      availTop: 0,
      colorDepth: 24,
      pixelDepth: 24
    };

    if (typeof Screen !== 'undefined' && Screen.prototype) {
      for (const [prop, val] of Object.entries(fsResolution)) {
        let owner = Screen.prototype;
        while (owner && !Object.hasOwn(owner, prop)) owner = Object.getPrototypeOf(owner);
        if (!owner) owner = Screen.prototype;
        const original = Object.getOwnPropertyDescriptor(owner, prop);
        if (original?.get) {
          define(prop, { ...original, get: function () { return val; } }, owner);
        } else {
          define(prop, { get: () => val, configurable: true }, owner);
        }
      }
    }

    if (typeof window !== 'undefined' && window.screen) {
      for (const [prop, val] of Object.entries(fsResolution)) {
        define(prop, { get: () => val, configurable: true }, window.screen);
      }
    }

    const fsWindowDims = {
      innerWidth: targetWidth,
      innerHeight: targetHeight,
      outerWidth: targetWidth,
      outerHeight: targetHeight,
      screenX: 0,
      screenY: 0,
      screenLeft: 0,
      screenTop: 0,
      devicePixelRatio: 1
    };

    if (typeof window !== 'undefined') {
      const winProto = (typeof Window !== 'undefined' && Window.prototype) || Object.getPrototypeOf(window);
      for (const [prop, val] of Object.entries(fsWindowDims)) {
        if (winProto) {
          let owner = winProto;
          while (owner && !Object.hasOwn(owner, prop)) owner = Object.getPrototypeOf(owner);
          if (owner) {
            const original = Object.getOwnPropertyDescriptor(owner, prop);
            if (original?.get) {
              define(prop, { ...original, get: function () { return val; } }, owner);
            } else {
              define(prop, { get: () => val, configurable: true }, owner);
            }
          }
        }
        define(prop, { get: () => val, configurable: true }, window);
      }
    }

    if (typeof VisualViewport !== 'undefined' && VisualViewport.prototype) {
      const vvProps = {
        width: targetWidth,
        height: targetHeight,
        scale: 1
      };
      for (const [prop, val] of Object.entries(vvProps)) {
        let owner = VisualViewport.prototype;
        while (owner && !Object.hasOwn(owner, prop)) owner = Object.getPrototypeOf(owner);
        if (!owner) owner = VisualViewport.prototype;
        const original = Object.getOwnPropertyDescriptor(owner, prop);
        if (original?.get) {
          define(prop, { ...original, get: function () { return val; } }, owner);
        } else {
          define(prop, { get: () => val, configurable: true }, owner);
        }
      }
    }

    if (typeof window !== 'undefined' && window.visualViewport) {
      for (const [prop, val] of Object.entries({
        width: targetWidth,
        height: targetHeight,
        scale: 1
      })) {
        define(prop, { get: () => val, configurable: true }, window.visualViewport);
      }
    }

    if (typeof ScreenOrientation !== 'undefined' && ScreenOrientation.prototype) {
      define('type', { get: () => 'landscape-primary', configurable: true }, ScreenOrientation.prototype);
      define('angle', { get: () => 0, configurable: true }, ScreenOrientation.prototype);
    }
    if (typeof window !== 'undefined' && window.screen?.orientation) {
      define('type', { get: () => 'landscape-primary', configurable: true }, window.screen.orientation);
      define('angle', { get: () => 0, configurable: true }, window.screen.orientation);
    }

    const stopResizeEvent = e => {
      if (e && e.isTrusted && typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('resize', stopResizeEvent, true);
      listeners.push(['resize', stopResizeEvent]);
    }

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      const origMatchMedia = window.matchMedia.bind(window);
      define("matchMedia", {
        value: function matchMedia(query) {
          const m = origMatchMedia(query);
          if (typeof query === "string") {
            const q = query.toLowerCase();
            if (q.includes("display-mode") && q.includes("fullscreen")) {
              return new Proxy(m, {
                get(target, prop) {
                  if (prop === "matches") return true;
                  if (prop === "media") return query;
                  const v = target[prop];
                  return typeof v === "function" ? v.bind(target) : v;
                }
              });
            }
            if (q.includes(`width: ${targetWidth}px`) || q.includes(`min-width: ${targetWidth}px`) || q.includes(`height: ${targetHeight}px`) || q.includes(`min-height: ${targetHeight}px`) || q.includes("width: 1920px") || q.includes("height: 1080px")) {
              return new Proxy(m, {
                get(target, prop) {
                  if (prop === "matches") return true;
                  if (prop === "media") return query;
                  const v = target[prop];
                  return typeof v === "function" ? v.bind(target) : v;
                }
              });
            }
          }
          return m;
        },
        writable: true,
        configurable: true
      }, window);
    }
  }

  // Spoof browser identity (Chrome, Edge, Firefox, Safari) and OS platform
  if (typeof navigator !== 'undefined' && (optOsPlatform || optBrowser)) {
    let navOwner = navigator;
    let proto = Object.getPrototypeOf(navigator);
    while (proto && proto !== Object.prototype) {
      if (Object.prototype.hasOwnProperty.call(proto, 'userAgent')) {
        navOwner = proto;
        break;
      }
      proto = Object.getPrototypeOf(proto);
    }

    const platKey = optOsPlatform ? (['win64', 'linux64', 'macos64'].includes(targetPlatformKey) ? targetPlatformKey : 'win64') : (
      (navigator.platform && navigator.platform.includes('Win')) ? 'win64' : (navigator.platform && navigator.platform.includes('Mac')) ? 'macos64' : 'linux64'
    );
    const browKey = optBrowser ? (['chrome', 'edge', 'firefox', 'safari'].includes(targetBrowserKey) ? targetBrowserKey : 'chrome') : 'chrome';

    const osTokens = {
      win64: {
        token: 'Windows NT 10.0; Win64; x64',
        platform: 'Win32',
        uadPlatform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        bitness: '64',
        wow64: false,
        firefoxToken: 'Windows NT 10.0; Win64; x64; rv:135.0',
        firefoxAppVersion: '5.0 (Windows)'
      },
      linux64: {
        token: 'X11; Linux x86_64',
        platform: 'Linux x86_64',
        uadPlatform: 'Linux',
        platformVersion: '6.6.0',
        architecture: 'x86',
        bitness: '64',
        wow64: false,
        firefoxToken: 'X11; Linux x86_64; rv:135.0',
        firefoxAppVersion: '5.0 (X11)'
      },
      macos64: {
        token: 'Macintosh; Intel Mac OS X 10_15_7',
        platform: 'MacIntel',
        uadPlatform: 'macOS',
        platformVersion: '14.5.0',
        architecture: 'x86',
        bitness: '64',
        wow64: false,
        firefoxToken: 'Macintosh; Intel Mac OS X 10.15; rv:135.0',
        firefoxAppVersion: '5.0 (Macintosh)'
      }
    };

    const p = osTokens[platKey] || osTokens.win64;
    let cleanUA;
    let cleanAV;
    let targetPlatform = p.platform;
    let targetVendor = 'Google Inc.';
    let hasUad = true;
    let hasChromeObj = true;
    let brands = [
      { brand: 'Chromium', version: '153' },
      { brand: 'Google Chrome', version: '153' },
      { brand: 'Not(A:Brand', version: '24' }
    ];
    let fullVersionList = [
      { brand: 'Chromium', version: '153.0.0.0' },
      { brand: 'Google Chrome', version: '153.0.0.0' },
      { brand: 'Not(A:Brand', version: '24.0.0.0' }
    ];

    if (browKey === 'edge') {
      cleanUA = `Mozilla/5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0`;
      cleanAV = `5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0`;
      brands = [
        { brand: 'Chromium', version: '153' },
        { brand: 'Microsoft Edge', version: '153' },
        { brand: 'Not(A:Brand', version: '24' }
      ];
      fullVersionList = [
        { brand: 'Chromium', version: '153.0.0.0' },
        { brand: 'Microsoft Edge', version: '153.0.0.0' },
        { brand: 'Not(A:Brand', version: '24.0.0.0' }
      ];
    } else if (browKey === 'firefox') {
      cleanUA = `Mozilla/5.0 (${p.firefoxToken}) Gecko/20100101 Firefox/135.0`;
      cleanAV = p.firefoxAppVersion;
      targetVendor = '';
      hasUad = false;
      hasChromeObj = false;
    } else if (browKey === 'safari') {
      cleanUA = `Mozilla/5.0 (${p.token}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15`;
      cleanAV = `5.0 (${p.token}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15`;
      targetVendor = 'Apple Computer, Inc.';
      hasUad = false;
      hasChromeObj = false;
    } else {
      cleanUA = `Mozilla/5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36`;
      cleanAV = `5.0 (${p.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36`;
    }

    define('userAgent', { get: () => cleanUA, configurable: true }, navOwner);
    define('appVersion', { get: () => cleanAV, configurable: true }, navOwner);
    define('vendor', { get: () => targetVendor, configurable: true }, navOwner);
    define('platform', { get: () => targetPlatform, configurable: true }, navOwner);

    if (hasUad) {
      const fakeUad = {
        brands,
        mobile: false,
        platform: p.uadPlatform,
        getHighEntropyValues: async (hints = []) => {
          const res = { brands, mobile: false, platform: p.uadPlatform };
          if (hints.includes('platformVersion')) res.platformVersion = p.platformVersion;
          if (hints.includes('architecture')) res.architecture = p.architecture;
          if (hints.includes('model')) res.model = '';
          if (hints.includes('uaFullVersion')) res.uaFullVersion = '153.0.0.0';
          if (hints.includes('fullVersionList')) res.fullVersionList = fullVersionList;
          if (hints.includes('bitness')) res.bitness = p.bitness;
          if (hints.includes('wow64')) res.wow64 = p.wow64;
          return res;
        },
        toJSON: () => ({ brands, mobile: false, platform: p.uadPlatform })
      };
      define('userAgentData', { get: () => fakeUad, configurable: true }, navOwner);
    } else {
      define('userAgentData', { get: () => undefined, configurable: true }, navOwner);
    }

    if (typeof window !== 'undefined') {
      if (hasChromeObj) {
        if (!window.chrome || !window.chrome.app) {
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
      } else {
        define('chrome', { value: undefined, writable: true, configurable: true }, window);
      }
    }
  }

  // Intercept screensharing displaySurface reporting
  if (optScreenshare) {
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
          const origTracks = (typeof stream.getVideoTracks === 'function') ? stream.getVideoTracks() : [];
          if (targetSurface && (targetSurface === 'monitor' || targetSurface === 'browser')) {
            for (const track of origTracks) {
              patchTrack(track, targetSurface);
            }
          }

          if (typeof MediaStreamTrackProcessor !== 'undefined' && typeof MediaStreamTrackGenerator !== 'undefined' && typeof VideoFrame !== 'undefined') {
            const videoTrack = origTracks[0];
            if (videoTrack) {
              try {
                const processor = new MediaStreamTrackProcessor({ track: videoTrack });
                const generator = new MediaStreamTrackGenerator({ kind: 'video' });

                const transformer = new TransformStream({
                  async transform(frame, controller) {
                    try {
                      const scale = (typeof window.__prism_tab_scale === 'number' && window.__prism_tab_scale > 0)
                        ? window.__prism_tab_scale
                        : 1;

                      if (scale < 0.999) {
                        const startX = (frame.visibleRect && typeof frame.visibleRect.x === 'number') ? frame.visibleRect.x : 0;
                        const startY = (frame.visibleRect && typeof frame.visibleRect.y === 'number') ? frame.visibleRect.y : 0;
                        const srcW = (frame.visibleRect && typeof frame.visibleRect.width === 'number') ? frame.visibleRect.width : frame.displayWidth;
                        const srcH = (frame.visibleRect && typeof frame.visibleRect.height === 'number') ? frame.visibleRect.height : frame.displayHeight;
                        const maxW = (typeof frame.codedWidth === 'number' && frame.codedWidth > 0) ? frame.codedWidth - startX : srcW;
                        const maxH = (typeof frame.codedHeight === 'number' && frame.codedHeight > 0) ? frame.codedHeight - startY : srcH;
                        const subW = Math.max(1, Math.min(maxW, Math.round(srcW * scale)));
                        const subH = Math.max(1, Math.min(maxH, Math.round(srcH * scale)));
                        const cropped = new VideoFrame(frame, {
                          visibleRect: { x: startX, y: startY, width: subW, height: subH },
                          displayWidth: frame.displayWidth,
                          displayHeight: frame.displayHeight
                        });
                        controller.enqueue(cropped);
                        frame.close();
                      } else {
                        controller.enqueue(frame);
                      }
                    } catch {
                      controller.enqueue(frame);
                    }
                  }
                });

                processor.readable.pipeThrough(transformer).pipeTo(generator.writable).catch(() => {});

                const origStop = (typeof generator.stop === 'function') ? generator.stop.bind(generator) : null;
                generator.stop = function stop() {
                  try { videoTrack.stop(); } catch {}
                  if (origStop) origStop();
                };
                videoTrack.addEventListener('ended', () => {
                  try { generator.stop(); } catch {}
                }, { once: true });

                generator.getSettings = function getSettings() {
                  return (typeof videoTrack.getSettings === 'function') ? videoTrack.getSettings() : {};
                };
                generator.getCapabilities = function getCapabilities() {
                  return (typeof videoTrack.getCapabilities === 'function') ? videoTrack.getCapabilities() : {};
                };
                try {
                  Object.defineProperty(generator, 'label', {
                    get: () => videoTrack.label,
                    configurable: true
                  });
                } catch {}

                if (targetSurface && (targetSurface === 'monitor' || targetSurface === 'browser')) {
                  patchTrack(generator, targetSurface);
                }

                if (typeof stream.removeTrack === 'function' && typeof stream.addTrack === 'function') {
                  stream.removeTrack(videoTrack);
                  stream.addTrack(generator);
                }
              } catch (cropErr) {
                console.warn('Failed to wrap tab screencast:', cropErr);
              }
            }
          }
          const allTracks = (typeof stream.getVideoTracks === 'function') ? stream.getVideoTracks() : [];
          for (const track of allTracks) {
            activeCastTracksCount++;
            if (typeof track.addEventListener === 'function') {
              track.addEventListener('ended', () => {
                activeCastTracksCount = Math.max(0, activeCastTracksCount - 1);
                if (typeof onCastChange === 'function') onCastChange();
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
  }

  // Screenshare cursor containment: when casting tab, keep cursor visible parked ~1cm from exit boundary
  let onCastChange;
  let showStuckCursor;
  if (optScreenshareCursor) {
    const MARGIN_CM = 38; // ~1cm at standard 96 CSS DPI
    const targetW = (spoofOptions.targetResolution && spoofOptions.targetResolution.width) || 1920;
    const targetH = (spoofOptions.targetResolution && spoofOptions.targetResolution.height) || 1080;
    let lastX = Math.round(targetW / 2);
    let lastY = Math.round(targetH / 2);
    if (typeof window !== 'undefined' && typeof window.innerWidth === 'number' && window.innerWidth > 0) {
      lastX = Math.round(window.innerWidth / 2);
      lastY = Math.round(window.innerHeight / 2);
    }

    const isTopLevel = typeof window === 'undefined' || !window.top || window.top === window;

    const isTabCasting = () => {
      return optScreenshareCursor !== false;
    };

    let pointerEl = null;

    const ensureOverlayElement = () => {
      if (!isTopLevel) return null;
      if (pointerEl && cursorHost && (cursorHost.isConnected || cursorHost.parentNode)) return pointerEl;
      if (typeof document === 'undefined') return null;
      const parent = document.documentElement || document.body;
      if (!parent) return null;

      if (!cursorHost || (!cursorHost.isConnected && !cursorHost.parentNode)) {
        cursorHost = document.createElement('div');
        cursorHost.id = '__prism_cast_cursor_host__';
        cursorHost.setAttribute('aria-hidden', 'true');
        cursorHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none !important;overflow:visible;';

        const pointer = document.createElement('div');
        pointer.id = '__prism_cast_pointer__';
        pointer.className = 'prism-cast-pointer';
        pointer.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px;margin-left:-4px;margin-top:-2px;pointer-events:none !important;user-select:none !important;z-index:2147483647 !important;filter:drop-shadow(1px 2px 2px rgba(0,0,0,0.5));display:none;';
        pointer.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 2 L4 20 L8.5 15.5 L12.5 23 L15.5 21.5 L11.5 14 L17.5 14 Z" fill="#FFFFFF" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/></svg>';

        cursorHost.appendChild(pointer);
        parent.appendChild(cursorHost);
        if (!cursorHost.parentNode) cursorHost.parentNode = parent;
        pointerEl = pointer;
        cursorEl = pointer;
      }
      return pointerEl;
    };

    const hideOverlay = () => {
      if (pointerEl) {
        pointerEl.style.display = 'none';
      } else if (cursorEl) {
        cursorEl.style.display = 'none';
      }
    };

    showStuckCursor = () => {
      if (!isTabCasting() || !isTopLevel) return;
      const W = (typeof window !== 'undefined' && window.innerWidth) || targetW;
      const H = (typeof window !== 'undefined' && window.innerHeight) || targetH;

      const dLeft = Math.max(0, lastX);
      const dRight = Math.max(0, W - lastX);
      const dTop = Math.max(0, lastY);
      const dBottom = Math.max(0, H - lastY);
      const minD = Math.min(dLeft, dRight, dTop, dBottom);

      let parkX = lastX;
      let parkY = lastY;

      if (minD === dLeft) {
        parkX = MARGIN_CM;
        parkY = Math.max(MARGIN_CM, Math.min(H - MARGIN_CM, lastY));
      } else if (minD === dRight) {
        parkX = W - MARGIN_CM;
        parkY = Math.max(MARGIN_CM, Math.min(H - MARGIN_CM, lastY));
      } else if (minD === dTop) {
        parkX = Math.max(MARGIN_CM, Math.min(W - MARGIN_CM, lastX));
        parkY = MARGIN_CM;
      } else {
        parkX = Math.max(MARGIN_CM, Math.min(W - MARGIN_CM, lastX));
        parkY = H - MARGIN_CM;
      }

      const el = ensureOverlayElement();
      if (el) {
        el.style.transform = 'translate3d(' + Math.round(parkX) + 'px, ' + Math.round(parkY) + 'px, 0)';
        el.style.display = 'block';
      }
    };

    const onMove = e => {
      if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        lastX = e.clientX;
        lastY = e.clientY;
      }
      hideOverlay();
    };

    const onLeave = e => {
      if (e && (e.type === 'mouseleave' || e.type === 'mouseout')) {
        if (e.relatedTarget || e.toElement) return;
      }
      showStuckCursor();
    };

    onCastChange = () => {
      if (!isTabCasting()) hideOverlay();
    };

    if (typeof window !== 'undefined') {
      window.__prism_set_cursor_stuck = function(stuck, relX, relY) {
        if (!stuck) {
          hideOverlay();
          return;
        }
        if (typeof relX === 'number' && typeof relY === 'number') {
          lastX = relX;
          lastY = relY;
        }
        showStuckCursor();
      };
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('mouseenter', onMove, true);
      window.addEventListener('blur', onLeave, true);
      window.addEventListener('__prism_tab_cast_change__', onCastChange, true);
      listeners.push(['mousemove', onMove]);
      listeners.push(['pointermove', onMove]);
      listeners.push(['mouseenter', onMove]);
      listeners.push(['blur', onLeave]);
      listeners.push(['__prism_tab_cast_change__', onCastChange]);
    }
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('mouseleave', onLeave, true);
      document.addEventListener('mouseout', onLeave, true);
      docListeners.push(['mouseleave', onLeave]);
      docListeners.push(['mouseout', onLeave]);
    }
  }

  // Keep Chromium's actual selection so native copy, drag selection and editing
  // still work. Only the page-facing selection read APIs report an empty range.
  // Script-driven rich-text editors may require this mode to be turned off.
  if (optSelection) {
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

    const stopBoundary = event => {
      if (event.isTrusted) {
        if (optScreenshareCursor && (event.type === 'mouseleave' || event.type === 'mouseout')) {
          try { if (typeof showStuckCursor === 'function') showStuckCursor(); } catch {}
        }
        event.stopImmediatePropagation();
      }
    };
    for (const name of ['selectionchange', 'selectstart', 'select',
      'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout']) {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener(name, stopBoundary, true);
        listeners.push([name, stopBoundary]);
      }
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
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener(name, allowSelection, true);
        listeners.push([name, allowSelection]);
      }
    }
  }

  const isEditable = el => {
    if (!el || typeof el !== 'object' || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return !el.readOnly && !el.disabled;
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      const textTypes = ['text', 'password', 'search', 'email', 'url', 'tel', 'number', ''];
      return textTypes.includes(type) && !el.readOnly && !el.disabled;
    }
    if (el.isContentEditable) return true;
    if (el.ownerDocument && el.ownerDocument.designMode === 'on') return true;
    return false;
  };

  const isWritingInTextbox = target => {
    let el = target;
    if (el && el.nodeType === 3) el = el.parentElement;
    if (isEditable(el)) return true;
    if (typeof document !== 'undefined' && document.activeElement && isEditable(document.activeElement)) return true;
    return false;
  };

  const isCharacterKey = (event, target) => {
    const key = event.key;
    if (!key) return false;
    const isAltGr = Boolean(event.getModifierState && event.getModifierState('AltGraph'));
    if (event.ctrlKey && !isAltGr) return false;
    if (event.metaKey) return false;
    if (event.altKey && !isAltGr) return false;

    // Single character (letters, numbers, symbols, spaces, Unicode)
    if (key.length === 1) return true;

    // Enter in multiline textarea or contenteditable writes a newline
    if (key === 'Enter') {
      let el = target;
      if (el && el.nodeType === 3) el = el.parentElement;
      if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable || el.ownerDocument?.designMode === 'on')) {
        return true;
      }
    }
    return false;
  };

  if (optKeyboard) {
    const handleKeyboard = event => {
      if (!event.isTrusted && !event.__prism_allowed__) return;
      const target = event.composedPath?.()[0] || event.target || (typeof document !== 'undefined' ? document.activeElement : null);
      if (isWritingInTextbox(target) && isCharacterKey(event, target)) {
        return;
      }
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    };
    for (const name of ['keydown', 'keyup', 'keypress']) {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener(name, handleKeyboard, true);
        listeners.push([name, handleKeyboard]);
      }
    }
  }

  if (optClipboard) {
    const stopClipboard = event => {
      if (event.isTrusted) event.stopImmediatePropagation();
    };
    for (const name of ['copy', 'cut', 'paste', 'beforecopy', 'beforecut', 'beforepaste']) {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener(name, stopClipboard, true);
        listeners.push([name, stopClipboard]);
      }
    }
    for (const name of ['oncopy', 'oncut', 'onpaste', 'onbeforecopy', 'onbeforecut', 'onbeforepaste']) {
      for (const owner of [
        (typeof window !== 'undefined' ? window : null),
        (typeof document !== 'undefined' ? document : null),
        (typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null)
      ]) {
        if (!owner) continue;
        define(name, { get: () => null, set: () => {}, configurable: true }, owner);
      }
    }
  }

  if (optRightClick) {
    const handleContextMenu = event => {
      try {
        Object.defineProperty(event, 'preventDefault', { configurable: true, value() {} });
        Object.defineProperty(event, 'returnValue', { configurable: true, get: () => true, set() {} });
      } catch {}
      event.stopImmediatePropagation();
    };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('contextmenu', handleContextMenu, true);
      listeners.push(['contextmenu', handleContextMenu]);
    }
    for (const owner of [
      (typeof window !== 'undefined' ? window : null),
      (typeof document !== 'undefined' ? document : null),
      (typeof HTMLElement !== 'undefined' ? HTMLElement.prototype : null)
    ]) {
      if (!owner) continue;
      define('oncontextmenu', { get: () => null, set: () => {}, configurable: true }, owner);
    }
  }

  if (optFocusVisibility) {
    const suppress = event => {
      if (!event.isTrusted) return;
      const isVisibility = event.type === 'visibilitychange' || event.type === 'webkitvisibilitychange';
      // Input-to-input focus still works; input blur caused by leaving the document
      // is suppressed when the native (unpatched) focus getter can distinguish it.
      const leavingDocument = (event.type === 'blur' || event.type === 'focusout') && !originalHasFocus();
      if (isVisibility || event.target === window || event.target === document || leavingDocument) event.stopImmediatePropagation();
    };
    for (const name of ['blur', 'focusout', 'focus', 'focusin', 'visibilitychange', 'webkitvisibilitychange']) {
      if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener(name, suppress, true);
        listeners.push([name, suppress]);
      }
    }
  }

  return true;
}

function buildFocusScript(rules, spoofOptions = {}) {
  return `(${patchDocument.toString()})(${JSON.stringify(focusRules(rules))}, ${JSON.stringify(spoofOptions)});`;
}

class FocusController {
  constructor({ getRules, getSpoofOptions = () => ({}), getTargetResolution = () => ({ width: 1920, height: 1080 }), getViewBounds = () => ({ width: 0, height: 0 }), onScaleApplied = () => {}, getFrameSessions = () => [], onError = () => {}, onStatus = () => {}, executionTimeout = 5000 }) {
    this.onScaleApplied = onScaleApplied;
    this.getViewBounds = getViewBounds;
    this.getRules = getRules;
    this.getSpoofOptions = getSpoofOptions;
    this.getTargetResolution = getTargetResolution;
    this.getFrameSessions = getFrameSessions;
    this.onError = onError;
    this.onStatus = onStatus;
    this.executionTimeout = executionTimeout;
    this.tabs = new Map();
  }

  computeScale(tabId, targetRes) {
    if (typeof this.getViewBounds !== 'function') return 1;
    const bounds = this.getViewBounds(tabId);
    if (!bounds || !bounds.width || !bounds.height || !targetRes || !targetRes.width || !targetRes.height) return 1;
    const scale = Math.min(bounds.width / targetRes.width, bounds.height / targetRes.height);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.min(1, scale);
  }

  async updateMetrics(tabId) {
    const state = this.tabs.get(tabId);
    if (!state || state.closed || state.webContents.isDestroyed()) return;
    if (!state.webContents.debugger.isAttached()) return;
    const spoofOptions = typeof this.getSpoofOptions === 'function' ? this.getSpoofOptions() : {};
    const optFullscreen = spoofOptions.fullscreen !== false;
    if (!optFullscreen) return;
    const targetRes = typeof this.getTargetResolution === 'function' ? this.getTargetResolution() : { width: 1920, height: 1080 };
    const scale = this.computeScale(tabId, targetRes);
    if (state.lastAppliedScale === scale && state.lastAppliedW === targetRes.width && state.lastAppliedH === targetRes.height) {
      return;
    }
    state.lastAppliedScale = scale;
    state.lastAppliedW = targetRes.width;
    state.lastAppliedH = targetRes.height;
    const deviceMetricsParams = {
      width: targetRes.width,
      height: targetRes.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: targetRes.width,
      screenHeight: targetRes.height,
      scale: scale
    };
    try {
      await state.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', deviceMetricsParams);
      for (const [id] of state.frameSessions) {
        try {
          await state.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', deviceMetricsParams, id);
        } catch {}
      }
      try {
        await Promise.race([
          state.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'),
          new Promise(r => setTimeout(r, 60))
        ]);
      } catch {}
      if (typeof this.onScaleApplied === 'function') {
        this.onScaleApplied(tabId, scale);
      }
    } catch {}
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
        const spoofOptions = typeof this.getSpoofOptions === 'function' ? this.getSpoofOptions() : {};
        const optOsPlatform = spoofOptions.osPlatform !== false;
        const optBrowserIdentity = spoofOptions.browserIdentity !== false;
        const hostPlat = process.platform === 'win32' ? 'win64' : process.platform === 'darwin' ? 'macos64' : 'linux64';
        const targetPlat = optOsPlatform ? (spoofOptions.platform || 'win64') : hostPlat;
        const targetBrow = optBrowserIdentity ? (spoofOptions.browser || 'chrome') : 'chrome';
        const profile = getSpoofProfile(targetBrow, targetPlat);

        let targetUA = profile.ua;
        if (!optOsPlatform && !optBrowserIdentity) {
          targetUA = defaultUA;
        }

        let uaParams;
        if (enabled) {
          if (profile.hasUad && (optBrowserIdentity || optOsPlatform)) {
            uaParams = {
              userAgent: targetUA,
              userAgentMetadata: {
                brands: profile.brands,
                fullVersionList: profile.fullVersionList,
                fullVersion: '153.0.0.0',
                platform: profile.uadPlatform,
                platformVersion: profile.platformVersion,
                architecture: profile.architecture,
                model: '',
                mobile: false,
                bitness: profile.bitness,
                wow64: profile.wow64
              }
            };
          } else {
            uaParams = { userAgent: targetUA };
          }
        } else {
          uaParams = { userAgent: defaultUA };
        }
        const optFullscreen = spoofOptions.fullscreen !== false;
        const targetRes = typeof this.getTargetResolution === 'function' ? this.getTargetResolution() : { width: 1920, height: 1080 };
        const scale = this.computeScale(state.tabId, targetRes);
        const deviceMetricsParams = {
          width: targetRes.width,
          height: targetRes.height,
          deviceScaleFactor: 1,
          mobile: false,
          screenWidth: targetRes.width,
          screenHeight: targetRes.height,
          scale: scale
        };

        const cdpCalls = [
          state.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', uaParams),
        ];

        if (enabled && optFullscreen) {
          cdpCalls.push(state.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', deviceMetricsParams));
        } else {
          cdpCalls.push(state.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => {}));
        }

        cdpCalls.push(state.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled }));

        for (const [id, session] of state.frameSessions) {
          cdpCalls.push((async () => {
            try { await state.webContents.debugger.sendCommand('Emulation.setUserAgentOverride', uaParams, id); }
            catch (error) { if (state.frameSessions.get(id) === session) throw error; }
          })());
          if (enabled && optFullscreen) {
            cdpCalls.push((async () => {
              try { await state.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', deviceMetricsParams, id); }
              catch (error) { if (state.frameSessions.get(id) === session) throw error; }
            })());
          } else {
            cdpCalls.push((async () => {
              try { await state.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride', {}, id); }
              catch (error) { if (state.frameSessions.get(id) === session) throw error; }
            })());
          }
          cdpCalls.push((async () => {
            try { await state.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled }, id); }
            catch (error) { if (state.frameSessions.get(id) === session) throw error; }
          })());
        }

        const results = await Promise.allSettled(cdpCalls);
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
        const rawSpoofOptions = typeof this.getSpoofOptions === 'function' ? this.getSpoofOptions() : {};
        const hasSpoof = Object.keys(rawSpoofOptions).length > 0;
        const targetRes = typeof this.getTargetResolution === 'function' ? this.getTargetResolution() : { width: 1920, height: 1080 };
        const spoofOptions = hasSpoof ? { ...rawSpoofOptions, targetResolution: targetRes } : rawSpoofOptions;
        const normalized = focusRules(rules);
        const source = buildFocusScript(rules, spoofOptions);
        const signature = JSON.stringify({ rules: normalized, spoof: spoofOptions });
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
        const mainSelected = selected(state.webContents.mainFrame.url, normalized);
        const warning = await this.setEmulation(state, mainSelected || allSelected);
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
      await state.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride').catch(() => {});
    }
    if (state.scriptId && state.webContents.debugger.isAttached()) {
      await state.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: state.scriptId }).catch(() => {});
    }
    if (state.webContents.debugger.isAttached()) {
      await Promise.allSettled([...state.frameSessions].flatMap(([id, session]) => [
        ...(session.scriptId ? [state.webContents.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: session.scriptId }, id).catch(() => {})] : []),
        state.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride', {}, id).catch(() => {})
      ]));
    }
    state.frameSessions.clear();
    const source = buildFocusScript([]);
    await Promise.allSettled(this.frames(state).map(frame => this.execute(frame, source)));
  }
}

module.exports = { FocusController, buildFocusScript, getChromeUserAgent, SPOOF_PLATFORMS, SPOOF_BROWSERS, getSpoofProfile };
