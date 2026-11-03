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

  // 4. Disabled emulation restores defaultUA
  sentCommands.length = 0;
  await controller.setEmulation(fakeState, false);
  override = sentCommands.find(c => c.method === 'Emulation.setUserAgentOverride');
  assert.equal(override.params.userAgent, 'Original/1.0', 'restores default userAgent');
  assert.equal(override.params.userAgentMetadata, undefined);
});
