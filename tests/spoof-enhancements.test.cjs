const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_PREFERENCES, normalizeSpoof, SUPPORTED_SPOOF_PLATFORMS } = require('../electron/preferences.cjs');
const { buildFocusScript, getChromeUserAgent, SPOOF_PLATFORMS } = require('../electron/focus.cjs');

test('DEFAULT_PREFERENCES includes spoof with all features enabled and platform win64', () => {
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
    platform: 'macos64'
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

  // Invalid platform defaults to win64
  const invalidPlat = normalizeSpoof({ platform: 'android' });
  assert.equal(invalidPlat.platform, 'win64');

  // Linux platform
  const linuxPlat = normalizeSpoof({ platform: 'linux64' });
  assert.equal(linuxPlat.platform, 'linux64');
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

test('toolbar markup contains split button for focus toggle and settings shortcut', () => {
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  assert.ok(html.includes('class="toolbar-split"'), 'contains toolbar-split');
  assert.ok(html.includes('id="focus-toggle"'), 'contains focus-toggle');
  assert.ok(html.includes('id="focus-settings-shortcut"'), 'contains focus-settings-shortcut');
  assert.ok(html.includes('data-icon="chevron-down"'), 'contains chevron-down icon');
});

test('app.js wires focus settings shortcut to spoof section in preferences', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  assert.ok(appJs.includes('openSettingsSection(\x27spoof\x27)'), 'wires shortcut to spoof settings');
  assert.ok(appJs.includes('settings-spoof'), 'renders spoof section');
  assert.ok(appJs.includes('spoof-os-platform'), 'renders OS platform switch');
  assert.ok(appJs.includes('spoof-platform'), 'renders OS platform select dropdown');
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

  // 3. When osPlatform is false, navigator.userAgent keeps original OS
  {
    const origUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
    const document = Object.create({
      hasFocus() { return true; },
      location: { href: 'https://example.com' }
    });
    const window = {
      addEventListener() {},
      removeEventListener() {}
    };
    const navigator = {
      userAgent: origUA,
      appVersion: origUA,
      platform: 'Linux x86_64'
    };
    const context = vm.createContext({ document, window, navigator, URL, DOMException });
    vm.runInContext(buildFocusScript(rules, { osPlatform: false }), context);
    assert.ok(navigator.userAgent.includes('Linux x86_64'));
    assert.equal(navigator.platform, 'Linux x86_64');
  }

  // 4. When osPlatform is true with win64 (default), reports Windows 11 x64
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
    vm.runInContext(buildFocusScript(rules, { osPlatform: true, platform: 'win64' }), context);
    assert.equal(navigator.userAgent, SPOOF_PLATFORMS.win64.ua);
    assert.equal(navigator.platform, 'Win32');
    const uad = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
    assert.equal(uad.platform, 'Windows');
    assert.equal(uad.platformVersion, '15.0.0');
  }

  // 5. When osPlatform is true with macos64, reports macOS x64
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
    vm.runInContext(buildFocusScript(rules, { osPlatform: true, platform: 'macos64' }), context);
    assert.equal(navigator.userAgent, SPOOF_PLATFORMS.macos64.ua);
    assert.equal(navigator.platform, 'MacIntel');
    const uad = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
    assert.equal(uad.platform, 'macOS');
    assert.equal(uad.platformVersion, '14.5.0');
  }
});
