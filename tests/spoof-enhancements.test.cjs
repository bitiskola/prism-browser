const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_PREFERENCES, normalizeSpoof, SUPPORTED_SPOOF_PLATFORMS, SUPPORTED_SPOOF_BROWSERS } = require('../electron/preferences.cjs');
const { buildFocusScript, getChromeUserAgent, SPOOF_PLATFORMS, SPOOF_BROWSERS, getSpoofProfile } = require('../electron/focus.cjs');

test('DEFAULT_PREFERENCES includes spoof with all features enabled, platform win64 and browser chrome', () => {
  assert.ok(DEFAULT_PREFERENCES.spoof, 'spoof exists in DEFAULT_PREFERENCES');
  assert.equal(DEFAULT_PREFERENCES.spoof.focusVisibility, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.fullscreen, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.keyboard, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.clipboardEvents, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.rightClick, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.selection, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.screenshare, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.osPlatform, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.platform, 'win64');
  assert.equal(DEFAULT_PREFERENCES.spoof.browserIdentity, true);
  assert.equal(DEFAULT_PREFERENCES.spoof.browser, 'chrome');
});

test('normalizeSpoof validates options and defaults safely', () => {
  const empty = normalizeSpoof({});
  assert.equal(empty.focusVisibility, true);
  assert.equal(empty.fullscreen, true);
  assert.equal(empty.keyboard, true);
  assert.equal(empty.clipboardEvents, true);
  assert.equal(empty.rightClick, true);
  assert.equal(empty.selection, true);
  assert.equal(empty.screenshare, true);
  assert.equal(empty.osPlatform, true);
  assert.equal(empty.platform, 'win64');
  assert.equal(empty.browserIdentity, true);
  assert.equal(empty.browser, 'chrome');

  assert.throws(() => normalizeSpoof(null), /Invalid spoof settings/);

  const custom = normalizeSpoof({
    focusVisibility: false,
    fullscreen: true,
    keyboard: false,
    clipboardEvents: true,
    rightClick: false,
    selection: false,
    screenshare: false,
    osPlatform: true,
    platform: 'macos64',
    browserIdentity: true,
    browser: 'firefox'
  });
  assert.equal(custom.focusVisibility, false);
  assert.equal(custom.fullscreen, true);
  assert.equal(custom.keyboard, false);
  assert.equal(custom.clipboardEvents, true);
  assert.equal(custom.rightClick, false);
  assert.equal(custom.selection, false);
  assert.equal(custom.screenshare, false);
  assert.equal(custom.osPlatform, true);
  assert.equal(custom.platform, 'macos64');
  assert.equal(custom.browserIdentity, true);
  assert.equal(custom.browser, 'firefox');

  // Invalid platform defaults to win64
  const invalidPlat = normalizeSpoof({ platform: 'android' });
  assert.equal(invalidPlat.platform, 'win64');

  // Invalid browser defaults to chrome
  const invalidBrow = normalizeSpoof({ browser: 'opera' });
  assert.equal(invalidBrow.browser, 'chrome');

  // Linux platform with Edge
  const linuxEdge = normalizeSpoof({ platform: 'linux64', browser: 'edge' });
  assert.equal(linuxEdge.platform, 'linux64');
  assert.equal(linuxEdge.browser, 'edge');
});

test('SPOOF_PLATFORMS definitions contain valid headers and UA strings', () => {
  for (const key of SUPPORTED_SPOOF_PLATFORMS) {
    const plat = SPOOF_PLATFORMS[key];
    assert.ok(plat, `platform definition for ${key} exists`);
    assert.ok(plat.ua.includes('Chrome/153.0.0.0'), `${key} UA contains Chrome 153`);
    assert.ok(plat.platform, `${key} has platform`);
    assert.ok(plat.uadPlatform, `${key} has uadPlatform`);
    assert.ok(plat.platformVersion, `${key} has platformVersion`);
  }
  assert.equal(SPOOF_PLATFORMS.win64.platform, 'Win32');
  assert.equal(SPOOF_PLATFORMS.win64.uadPlatform, 'Windows');
  assert.equal(SPOOF_PLATFORMS.win64.platformVersion, '15.0.0');

  assert.equal(SPOOF_PLATFORMS.linux64.platform, 'Linux x86_64');
  assert.equal(SPOOF_PLATFORMS.linux64.uadPlatform, 'Linux');
  assert.equal(SPOOF_PLATFORMS.linux64.platformVersion, '6.6.0');

  assert.equal(SPOOF_PLATFORMS.macos64.platform, 'MacIntel');
  assert.equal(SPOOF_PLATFORMS.macos64.uadPlatform, 'macOS');
  assert.equal(SPOOF_PLATFORMS.macos64.platformVersion, '14.5.0');
});

test('getSpoofProfile generates correct browser and platform profiles', () => {
  // Chrome on Windows 11
  const chromeWin = getSpoofProfile('chrome', 'win64');
  assert.ok(chromeWin.ua.includes('Windows NT 10.0; Win64; x64'));
  assert.ok(chromeWin.ua.includes('Chrome/153.0.0.0'));
  assert.equal(chromeWin.vendor, 'Google Inc.');
  assert.equal(chromeWin.hasUad, true);
  assert.ok(chromeWin.brands.some(b => b.brand === 'Google Chrome'));

  // Edge on macOS
  const edgeMac = getSpoofProfile('edge', 'macos64');
  assert.ok(edgeMac.ua.includes('Macintosh; Intel Mac OS X 10_15_7'));
  assert.ok(edgeMac.ua.includes('Edg/153.0.0.0'));
  assert.equal(edgeMac.hasUad, true);
  assert.ok(edgeMac.brands.some(b => b.brand === 'Microsoft Edge'));

  // Firefox on Linux
  const firefoxLinux = getSpoofProfile('firefox', 'linux64');
  assert.ok(firefoxLinux.ua.includes('X11; Linux x86_64; rv:135.0'));
  assert.ok(firefoxLinux.ua.includes('Firefox/135.0'));
  assert.equal(firefoxLinux.vendor, '');
  assert.equal(firefoxLinux.hasUad, false);
  assert.equal(firefoxLinux.hasChromeObj, false);

  // Safari on Windows
  const safariWin = getSpoofProfile('safari', 'win64');
  assert.ok(safariWin.ua.includes('Version/18.3 Safari/605.1.15'));
  assert.equal(safariWin.vendor, 'Apple Computer, Inc.');
  assert.equal(safariWin.hasUad, false);
  assert.equal(safariWin.hasChromeObj, false);
});

test('toolbar markup contains split button for focus toggle and settings shortcut', () => {
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  assert.ok(html.includes('class="toolbar-split"'), 'contains toolbar-split');
  assert.ok(html.includes('id="focus-toggle"'), 'contains focus-toggle');
  assert.ok(html.includes('id="focus-settings-shortcut"'), 'contains focus-settings-shortcut');
  assert.ok(html.includes('data-icon="chevron-down"'), 'contains chevron-down icon');
});

test('app.js and styles.css render card layout and custom toggle switches', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(__dirname, '../renderer/styles.css'), 'utf8');

  assert.ok(appJs.includes('openSettingsSection(\x27spoof\x27)'), 'wires shortcut to spoof settings');
  assert.ok(appJs.includes('settings-spoof'), 'renders spoof section');
  assert.ok(appJs.includes('spoof-card'), 'uses spoof-card layout');
  assert.ok(appJs.includes('spoof-os-platform'), 'renders OS platform switch');
  assert.ok(appJs.includes('spoof-platform'), 'renders OS platform select dropdown');
  assert.ok(appJs.includes('spoof-browser-identity'), 'renders browser identity switch');
  assert.ok(appJs.includes('spoof-browser'), 'renders browser select dropdown');

  // Verify CSS contains .spoof-card and .switch-input
  assert.ok(stylesCss.includes('.spoof-card'), 'styles.css defines .spoof-card');
  assert.ok(stylesCss.includes('.switch-input'), 'styles.css defines .switch-input');
  assert.ok(stylesCss.includes('.switch-input:checked'), 'styles.css styles checked state');
});

test('each spoofing feature can be independently deactivated via spoofOptions', async () => {
  const rules = [{ host: 'example.com', focus: true }];

  // 1. When focusVisibility is false, document.hasFocus and visibilityState are NOT overridden
  {
    let hasFocusCalled = false;
    const document = Object.create({
      hasFocus() { hasFocusCalled = true; return false; },
      location: { href: 'https://example.com' }
    });
    const window = {
      addEventListener() {},
      removeEventListener() {}
    };
    const context = vm.createContext({ document, window, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { focusVisibility: false }), context);
    assert.equal(document.hasFocus(), false);
    assert.equal(hasFocusCalled, true);
    assert.equal(document.visibilityState, undefined);
  }

  // 2. When fullscreen is false, fullscreenElement is NOT overridden
  {
    const document = Object.create({
      hasFocus() { return true; },
      location: { href: 'https://example.com' }
    });
    const window = {
      addEventListener() {},
      removeEventListener() {}
    };
    const context = vm.createContext({ document, window, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { fullscreen: false }), context);
    assert.equal(document.fullscreenElement, undefined);
  }

  // 3. When osPlatform is true with win64 (default) and browser is chrome (default)
  {
    const document = Object.create({
      hasFocus() { return true; },
      location: { href: 'https://example.com' }
    });
    const window = {
      addEventListener() {},
      removeEventListener() {}
    };
    const navigator = {
      userAgent: '',
      appVersion: '',
      platform: 'Linux x86_64'
    };
    const context = vm.createContext({ document, window, navigator, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { osPlatform: true, platform: 'win64', browser: 'chrome' }), context);
    assert.equal(navigator.userAgent, SPOOF_PLATFORMS.win64.ua);
    assert.equal(navigator.platform, 'Win32');
    const uad = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
    assert.equal(uad.platform, 'Windows');
    assert.equal(uad.platformVersion, '15.0.0');
    assert.ok(window.chrome);
  }

  // 4. Browser spoofing as Firefox
  {
    const document = Object.create({
      hasFocus() { return true; },
      location: { href: 'https://example.com' }
    });
    const window = {
      chrome: { fake: true },
      addEventListener() {},
      removeEventListener() {}
    };
    const navigator = {
      userAgent: '',
      appVersion: '',
      platform: 'Linux x86_64'
    };
    const context = vm.createContext({ document, window, navigator, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { osPlatform: true, platform: 'win64', browser: 'firefox' }), context);
    assert.ok(navigator.userAgent.includes('Firefox/135.0'));
    assert.equal(navigator.vendor, '');
    assert.equal(navigator.userAgentData, undefined);
    assert.equal(window.chrome, undefined);
  }

  // 5. Browser spoofing as Microsoft Edge
  {
    const document = Object.create({
      hasFocus() { return true; },
      location: { href: 'https://example.com' }
    });
    const window = {
      addEventListener() {},
      removeEventListener() {}
    };
    const navigator = {
      userAgent: '',
      appVersion: '',
      platform: 'Linux x86_64'
    };
    const context = vm.createContext({ document, window, navigator, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { osPlatform: true, platform: 'win64', browser: 'edge' }), context);
    assert.ok(navigator.userAgent.includes('Edg/153.0.0.0'));
    assert.equal(navigator.vendor, 'Google Inc.');
    assert.ok(navigator.userAgentData);
    assert.ok(navigator.userAgentData.brands.some(b => b.brand === 'Microsoft Edge'));
    assert.ok(window.chrome);
  }

  // 6. Browser spoofing as Apple Safari
  {
    const document = Object.create({
      hasFocus() { return true; },
      location: { href: 'https://example.com' }
    });
    const window = {
      chrome: { fake: true },
      addEventListener() {},
      removeEventListener() {}
    };
    const navigator = {
      userAgent: '',
      appVersion: '',
      platform: 'Linux x86_64'
    };
    const context = vm.createContext({ document, window, navigator, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { osPlatform: true, platform: 'macos64', browser: 'safari' }), context);
    assert.ok(navigator.userAgent.includes('Version/18.3 Safari/605.1.15'));
    assert.equal(navigator.vendor, 'Apple Computer, Inc.');
    assert.equal(navigator.userAgentData, undefined);
    assert.equal(window.chrome, undefined);
  }
});

test('FocusController setEmulation passes correct userAgent and userAgentMetadata for all browsers and platforms', async () => {
  const { FocusController } = require('../electron/focus.cjs');
  let currentSpoof = { osPlatform: true, platform: 'win64', browserIdentity: true, browser: 'edge' };
  const controller = new FocusController({
    getRules: () => [{ host: 'example.com', focus: true }],
    getSpoofOptions: () => currentSpoof
  });

  const sentCommands = [];
  const fakeState = {
    closed: false,
    webContents: {
      isDestroyed: () => false,
      session: { getUserAgent: () => 'Original/1.0' },
      debugger: {
        isAttached: () => true,
        sendCommand: async (method, params) => {
          sentCommands.push({ method, params });
          return {};
        }
      }
    },
    frameSessions: new Map()
  };

  // 1. Edge on win64
  await controller.setEmulation(fakeState, true);
  let metricsOverride = sentCommands.find(c => c.method === 'Emulation.setDeviceMetricsOverride');
  assert.ok(metricsOverride, 'setDeviceMetricsOverride sent');
  assert.equal(metricsOverride.params.width, 1920);
  assert.equal(metricsOverride.params.height, 1080);
  assert.equal(metricsOverride.params.screenWidth, 1920);
  assert.equal(metricsOverride.params.screenHeight, 1080);
  let override = sentCommands.find(c => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(override, 'setUserAgentOverride command sent');
  assert.ok(override.params.userAgent.includes('Edg/153.0.0.0'), 'UA contains Edge 153');
  assert.ok(override.params.userAgent.includes('Windows NT 10.0; Win64; x64'), 'UA contains Windows token');
  assert.ok(override.params.userAgentMetadata, 'userAgentMetadata present for Edge');
  assert.ok(override.params.userAgentMetadata.brands.some(b => b.brand === 'Microsoft Edge'));

  // 2. Firefox on linux64 (no userAgentMetadata)
  sentCommands.length = 0;
  currentSpoof = { osPlatform: true, platform: 'linux64', browserIdentity: true, browser: 'firefox' };
  await controller.setEmulation(fakeState, true);
  override = sentCommands.find(c => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(override.params.userAgent.includes('Firefox/135.0'), 'UA contains Firefox 135');
  assert.ok(override.params.userAgent.includes('X11; Linux x86_64'), 'UA contains Linux token');
  assert.equal(override.params.userAgentMetadata, undefined, 'no userAgentMetadata for Firefox');

  // 3. Safari on macos64 (no userAgentMetadata)
  sentCommands.length = 0;
  currentSpoof = { osPlatform: true, platform: 'macos64', browserIdentity: true, browser: 'safari' };
  await controller.setEmulation(fakeState, true);
  override = sentCommands.find(c => c.method === 'Emulation.setUserAgentOverride');
  assert.ok(override.params.userAgent.includes('Version/18.3 Safari/605.1.15'), 'UA contains Safari 18.3');
  assert.ok(override.params.userAgent.includes('Macintosh; Intel Mac OS X 10_15_7'), 'UA contains Mac token');
  assert.equal(override.params.userAgentMetadata, undefined, 'no userAgentMetadata for Safari');

  // 4. Disabled emulation restores defaultUA and clears device metrics
  sentCommands.length = 0;
  await controller.setEmulation(fakeState, false);
  let clearMetrics = sentCommands.find(c => c.method === 'Emulation.clearDeviceMetricsOverride');
  assert.ok(clearMetrics, 'clearDeviceMetricsOverride sent');
  override = sentCommands.find(c => c.method === 'Emulation.setUserAgentOverride');
  assert.equal(override.params.userAgent, 'Original/1.0', 'restores default userAgent');
  assert.equal(override.params.userAgentMetadata, undefined);
});

test('electron/preload.cjs includes spoof-save in allowed actions Set', () => {
  const fs = require('fs');
  const path = require('path');
  const content = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8');
  assert.ok(content.includes("'spoof-save'"), 'preload.cjs actions includes spoof-save');
});

test('fullscreen lock embeds 1920x1080 true fullscreen resolution spoofing and suppresses resize events', () => {
  const rules = [{ host: 'exam.test', focus: true }];
  const Element = function() {};
  Element.prototype.clientWidth = 800;
  Element.prototype.clientHeight = 600;

  const docProto = { hasFocus() { return true; } };
  const Document = function() {};
  Document.prototype = docProto;

  const document = Object.create(docProto);
  document.documentElement = Object.create(Element.prototype);
  document.body = Object.create(Element.prototype);
  document.location = { href: 'https://exam.test/quiz' };

  const windowListeners = new Map();
  const screen = {
    width: 1366,
    height: 768,
    availWidth: 1366,
    availHeight: 728,
    availLeft: 0,
    availTop: 0,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: 'portrait-primary', angle: 90 }
  };
  const visualViewport = { width: 1024, height: 700, scale: 1 };
  const VisualViewport = function() {};
  VisualViewport.prototype = Object.getPrototypeOf(visualViewport);
  const ScreenOrientation = function() {};
  ScreenOrientation.prototype = Object.getPrototypeOf(screen.orientation);

  const window = {
    screen,
    visualViewport,
    innerWidth: 1024,
    innerHeight: 700,
    outerWidth: 1024,
    outerHeight: 740,
    devicePixelRatio: 1.25,
    screenX: 20,
    screenY: 30,
    addEventListener(type, fn) {
      const set = windowListeners.get(type) || new Set();
      set.add(fn);
      windowListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      windowListeners.get(type)?.delete(fn);
    },
    matchMedia(q) {
      return { matches: false, media: q };
    }
  };

  const Screen = function() {};
  Screen.prototype = Object.getPrototypeOf(screen);

  const context = vm.createContext({ document, window, screen, Screen, visualViewport, VisualViewport, ScreenOrientation, Element, Document, URL, DOMException });

  // 1. Before spoof mode, resolution is native/custom
  assert.equal(window.innerWidth, 1024);
  assert.equal(screen.width, 1366);

  // 2. Apply spoof mode with fullscreen: true
  const res = vm.runInContext(buildFocusScript(rules, { fullscreen: true }), context);
  assert.equal(res, true);

  // 3. Screen and window dimensions are locked to 1920x1080 Full HD
  assert.equal(screen.width, 1920);
  assert.equal(screen.height, 1080);
  assert.equal(screen.availWidth, 1920);
  assert.equal(screen.availHeight, 1080);
  assert.equal(screen.availLeft, 0);
  assert.equal(screen.availTop, 0);
  assert.equal(window.innerWidth, 1920);
  assert.equal(window.innerHeight, 1080);
  assert.equal(window.outerWidth, 1920);
  assert.equal(window.outerHeight, 1080);
  assert.equal(window.devicePixelRatio, 1);
  assert.equal(window.screenX, 0);
  assert.equal(window.screenY, 0);

  // 4. documentElement and body clientWidth/clientHeight and visualViewport report 1920x1080
  assert.equal(document.documentElement.clientWidth, 1920);
  assert.equal(document.documentElement.clientHeight, 1080);
  assert.equal(document.body.clientWidth, 1920);
  assert.equal(document.body.clientHeight, 1080);
  assert.equal(window.visualViewport.width, 1920);
  assert.equal(window.visualViewport.height, 1080);
  assert.equal(screen.orientation.type, 'landscape-primary');
  assert.equal(screen.orientation.angle, 0);

  // 5. matchMedia matches fullscreen and 1920x1080 queries
  assert.equal(window.matchMedia('(display-mode: fullscreen)').matches, true);
  assert.equal(window.matchMedia('(width: 1920px)').matches, true);
  assert.equal(window.matchMedia('(min-width: 1920px)').matches, true);
  assert.equal(window.matchMedia('(height: 1080px)').matches, true);

  // 6. Trusted resize event (e.g. from Ctrl+F window switch) is suppressed
  let stopped = false;
  const resizeEvt = { type: 'resize', isTrusted: true, stopImmediatePropagation: () => { stopped = true; } };
  for (const fn of windowListeners.get('resize') || []) fn(resizeEvt);
  assert.equal(stopped, true, 'trusted resize event stopped');

  // 7. Disabling restores original properties
  vm.runInContext(buildFocusScript([]), context);
  assert.equal(screen.width, 1366);
  assert.equal(screen.height, 768);
  assert.equal(window.innerWidth, 1024);
  assert.equal(window.innerHeight, 700);
});

test('screenshare cursor containment parks pointer ~1cm from exit side during tab cast and restores on return', () => {
  const rules = [{ host: 'exam.test', focus: true }];
  const docListeners = new Map();
  const winListeners = new Map();

  let appendedHost = null;
  const body = {
    appendChild(el) { el.parentNode = this; appendedHost = el; return el; },
    removeChild(el) { if (appendedHost === el) { appendedHost = null; el.parentNode = null; } }
  };

  const document = {
    body,
    documentElement: body,
    location: { href: 'https://exam.test/quiz' },
    hasFocus() { return true; },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        setAttribute(k, v) { this[k] = v; },
        appendChild(child) { this.children = this.children || []; this.children.push(child); return child; },
        parentNode: null
      };
      el.attachShadow = () => el;
      return el;
    },
    addEventListener(type, fn) {
      const set = docListeners.get(type) || new Set();
      set.add(fn);
      docListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    }
  };
  body.parentNode = document;

  const window = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(type, fn) {
      const set = winListeners.get(type) || new Set();
      set.add(fn);
      winListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    }
  };

  const context = vm.createContext({ document, window, URL, DOMException });
  vm.runInContext(buildFocusScript(rules, { screenshareCursor: true }), context);

  // Simulate mouse movement inside tab
  for (const fn of winListeners.get('mousemove') || []) {
    fn({ clientX: 1900, clientY: 450 });
  }

  // Simulate cursor leaving the tab (mouseleave on document)
  for (const fn of docListeners.get('mouseleave') || []) {
    fn({ type: 'mouseleave' });
  }

  assert.ok(appendedHost, 'cursor host element created and appended');
  const pointerEl = appendedHost.children?.find(c => c.className === 'prism-cast-pointer');
  assert.ok(pointerEl, 'pointer element exists inside host');
  assert.equal(pointerEl.style.display, 'block');

  // Since cursor was at x=1900, y=450 on a 1920x1080 view, closest edge is RIGHT
  // Parked at x = 1920 - 38 = 1882, y = 450
  assert.equal(pointerEl.style.transform, 'translate3d(1882px, 450px, 0)');
  assert.ok(pointerEl.innerHTML.includes('<svg'), 'contains SVG pointer arrow');

  // When mouse re-enters (mousemove inside tab), stuck cursor hides
  for (const fn of winListeners.get('mousemove') || []) {
    fn({ clientX: 1500, clientY: 500 });
  }
  assert.equal(pointerEl.style.display, 'none');

  // Move near top edge (500, 10) and leave: should park at top (500, 38)
  for (const fn of winListeners.get('mousemove') || []) {
    fn({ clientX: 500, clientY: 10 });
  }
  for (const fn of docListeners.get('mouseleave') || []) {
    fn({ type: 'mouseleave' });
  }
  assert.equal(pointerEl.style.display, 'block');
  assert.equal(pointerEl.style.transform, 'translate3d(500px, 38px, 0)');

  // Disabling spoof mode cleans up host from DOM
  vm.runInContext(buildFocusScript([]), context);
  assert.equal(appendedHost, null, 'cursor host removed on disable');
});
