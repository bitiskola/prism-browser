'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getChromeUserAgent } = require('../electron/focus.cjs');
const { handleDisplayMediaSelection } = require('../electron/screenshare.cjs');

test('getChromeUserAgent removes Electron and sets Chrome version to 153', () => {
  const linuxUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) PrismBrowser/1.3.2 Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36';
  const winUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36';
  const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Electron/44.3.0 Safari/537.36';

  const cleanLinux = getChromeUserAgent(linuxUA);
  assert.equal(cleanLinux, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
  assert.equal(cleanLinux.includes('Electron'), false);
  assert.equal(cleanLinux.includes('PrismBrowser'), false);
  assert.equal(cleanLinux.includes('Chrome/153.0.0.0'), true);

  const cleanWin = getChromeUserAgent(winUA);
  assert.equal(cleanWin, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
  assert.equal(cleanWin.includes('Electron'), false);

  const cleanMac = getChromeUserAgent(macUA);
  assert.equal(cleanMac, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36');
  assert.equal(cleanMac.includes('Electron'), false);

  const fallback = getChromeUserAgent('');
  assert.equal(fallback.includes('Chrome/153.0.0.0'), true);
  assert.equal(fallback.includes('Electron'), false);
});

test('screenshare handler supports full screen sharing', () => {
  const screens = [
    { id: 'screen:1:0:s', name: 'Entire screen', thumbnail: 'data:image/png;base64,123' },
    { id: 'screen:2:0:s', name: 'Second Display', thumbnail: 'data:image/png;base64,456' },
  ];
  const tabs = [];

  // Selecting first screen
  const stream1 = handleDisplayMediaSelection({ type: 'screen', id: 'screen:1:0:s' }, screens, tabs, { videoRequested: true });
  assert.deepEqual(stream1, {
    video: { id: 'screen:1:0:s', name: 'Entire screen' }
  });

  // Selecting second screen
  const stream2 = handleDisplayMediaSelection({ type: 'screen', id: 'screen:2:0:s' }, screens, tabs, { videoRequested: true });
  assert.deepEqual(stream2, {
    video: { id: 'screen:2:0:s', name: 'Second Display' }
  });

  // Fallback to first screen if id not matched
  const streamFallback = handleDisplayMediaSelection({ type: 'screen', id: 'unknown-screen' }, screens, tabs, { videoRequested: true });
  assert.deepEqual(streamFallback, {
    video: { id: 'screen:1:0:s', name: 'Entire screen' }
  });

  // Empty screens
  const streamEmpty = handleDisplayMediaSelection({ type: 'screen', id: 'screen:1' }, [], tabs, { videoRequested: true });
  assert.equal(streamEmpty, null);
});

test('screenshare handler supports tab sharing and attaches unattached views to prevent timeouts', () => {
  const frame1 = { id: 'frame-1' };
  const frame2 = { id: 'frame-2' };
  let boundsSet = null;
  const view1 = {
    setBounds(b) { boundsSet = b; },
    webContents: { isDestroyed: () => false, mainFrame: frame1 }
  };
  const view2 = {
    setBounds() {},
    webContents: { isDestroyed: () => false, mainFrame: frame2 }
  };

  const addedViews = [];
  const mockWin = {
    isDestroyed: () => false,
    contentView: {
      children: [view2],
      addChildView(v, idx) { addedViews.push({ v, idx }); this.children.push(v); }
    }
  };
  const viewport = { x: 0, y: 50, width: 800, height: 600 };

  const tabs = [
    { id: 'tab-1', title: 'First Tab', url: 'https://site1.example', view: view1 },
    { id: 'tab-2', title: 'Second Tab', url: 'https://site2.example', view: view2 },
  ];

  // User selects Tab 1 with audio requested & enabled
  const result1 = handleDisplayMediaSelection(
    { type: 'tab', id: 'tab-1', audio: true },
    [],
    tabs,
    { audioRequested: true, videoRequested: true },
    mockWin,
    viewport
  );

  assert.deepEqual(result1, {
    video: frame1,
    audio: frame1,
    enableLocalEcho: true
  });
  // Verify view1 was attached to mockWin.contentView and bounds were set
  assert.equal(addedViews.length, 1);
  assert.equal(addedViews[0].v, view1);
  assert.deepEqual(boundsSet, viewport);

  // User selects Tab 2 with audio disabled
  const result2 = handleDisplayMediaSelection(
    { type: 'tab', id: 'tab-2', audio: false },
    [],
    tabs,
    { audioRequested: true, videoRequested: true },
    mockWin,
    viewport
  );
  assert.deepEqual(result2, {
    video: frame2
  });

  // User cancels
  const resultCancel = handleDisplayMediaSelection(null, [], tabs, { audioRequested: true, videoRequested: true });
  assert.equal(resultCancel, null);

  // Destroyed tab
  const destroyedTab = [{ id: 'tab-x', title: 'X', view: { webContents: { isDestroyed: () => true, mainFrame: null } } }];
  const resultDestroyed = handleDisplayMediaSelection({ type: 'tab', id: 'tab-x' }, [], destroyedTab, { audioRequested: true, videoRequested: true });
  assert.equal(resultDestroyed, null);
});

test('spoofing is conditional on spoof mode being enabled', () => {
  const electronUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) PrismBrowser/1.3.2 Chrome/132.0.6834.196 Electron/44.3.0 Safari/537.36';
  const rules = [{ host: 'spoofed.example', focus: true, includeSubdomains: true }];

  function checkSpoof(url, activeRules) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      return activeRules.some(r => host === r.host || (r.includeSubdomains && host.endsWith(`.${r.host}`)));
    } catch { return false; }
  }

  // When spoof mode is off for normal.example
  assert.equal(checkSpoof('https://normal.example', rules), false);
  // Default UA remains Electron 44
  assert.equal(electronUA.includes('Electron/44'), true);

  // When spoof mode is on for spoofed.example
  assert.equal(checkSpoof('https://spoofed.example/path', rules), true);
  assert.equal(checkSpoof('https://sub.spoofed.example/path', rules), true);
  const spoofedUA = getChromeUserAgent(electronUA);
  assert.equal(spoofedUA.includes('Chrome/153.0.0.0'), true);
  assert.equal(spoofedUA.includes('Electron'), false);
});

test('screenshare report surface mapping respects dropdown when spoof mode is active and actual selection when spoof mode is off', () => {
  function computeTargetSurface(selection, isSpoofActive) {
    if (isSpoofActive && selection?.reportAs) {
      return (selection.reportAs === 'screen') ? 'monitor' : 'browser';
    } else if (!isSpoofActive && selection) {
      return (selection.type === 'screen') ? 'monitor' : 'browser';
    }
    return null;
  }

  // Spoof mode ACTIVE:
  // 1. User picks full screen, but selects "Single tab" in dropdown
  assert.equal(computeTargetSurface({ type: 'screen', id: 'screen:1', reportAs: 'tab' }, true), 'browser');

  // 2. User picks tab, but selects "Full screen" in dropdown
  assert.equal(computeTargetSurface({ type: 'tab', id: 'tab:1', reportAs: 'screen' }, true), 'monitor');

  // 3. User picks full screen, selects "Full screen" in dropdown
  assert.equal(computeTargetSurface({ type: 'screen', id: 'screen:1', reportAs: 'screen' }, true), 'monitor');

  // 4. User picks tab, selects "Single tab" in dropdown
  assert.equal(computeTargetSurface({ type: 'tab', id: 'tab:1', reportAs: 'tab' }, true), 'browser');

  // Spoof mode OFF:
  // User picks full screen, should always report monitor regardless of reportAs
  assert.equal(computeTargetSurface({ type: 'screen', id: 'screen:1', reportAs: 'tab' }, false), 'monitor');
  assert.equal(computeTargetSurface({ type: 'screen', id: 'screen:1' }, false), 'monitor');

  // User picks tab, should always report browser regardless of reportAs
  assert.equal(computeTargetSurface({ type: 'tab', id: 'tab:1', reportAs: 'screen' }, false), 'browser');
  assert.equal(computeTargetSurface({ type: 'tab', id: 'tab:1' }, false), 'browser');
});

test('screenshare displaySurface spoofing in page intercepts getDisplayMedia and patches track settings/capabilities/label', async () => {
  const vm = require('node:vm');
  const { buildFocusScript } = require('../electron/focus.cjs');

  const listeners = new Map();
  const document = Object.create({ hasFocus() { return false; } });
  document.location = { href: 'https://testsite.example/call' };

  class MockMediaStreamTrack {
    constructor(initialSurface = 'monitor', initialLabel = 'screen:0:0') {
      this._surface = initialSurface;
      this._label = initialLabel;
    }
    getSettings() {
      return { displaySurface: this._surface, width: 1920, height: 1080 };
    }
    getCapabilities() {
      return { displaySurface: this._surface };
    }
    get label() {
      return this._label;
    }
    clone() {
      return new MockMediaStreamTrack(this._surface, this._label);
    }
  }

  const origTrack = new MockMediaStreamTrack('monitor', 'screen:0:0');
  let requestedConstraints = null;
  const originalGetDisplayMedia = async (constraints) => {
    requestedConstraints = constraints;
    return {
      getVideoTracks: () => [origTrack],
      getTracks: () => [origTrack]
    };
  };

  const window = {
    addEventListener(type, fn) { const set = listeners.get(type) || new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    MediaStreamTrack: MockMediaStreamTrack
  };
  const navigator = {
    mediaDevices: {
      getDisplayMedia: originalGetDisplayMedia
    }
  };

  const context = vm.createContext({ document, window, navigator, URL, DOMException });
  const rules = [{ host: 'testsite.example', focus: true }];

  // Apply spoof mode
  vm.runInContext(buildFocusScript(rules), context);
  assert.notEqual(navigator.mediaDevices.getDisplayMedia, originalGetDisplayMedia);

  // Scenario 1: Website calls getDisplayMedia and main process set __prism_report_display_surface = 'browser' (sharing screen, reporting tab)
  context.window.__prism_report_display_surface = 'browser';
  const stream1 = await context.navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'monitor', width: { max: 1280 }, height: { max: 720 } } // strict and downscaling constraints should be stripped
  });
  const track1 = stream1.getVideoTracks()[0];
  assert.equal(track1.getSettings().displaySurface, 'browser');
  assert.equal(track1.getSettings().logicalSurface, true);
  assert.equal(track1.getCapabilities().displaySurface, 'browser');
  assert.equal(track1.label, 'Google Chrome Tab');

  // Verify strict displaySurface constraint and downscale constraints were stripped
  assert.equal(requestedConstraints.video.displaySurface, undefined);
  assert.equal(requestedConstraints.video.width, undefined);
  assert.equal(requestedConstraints.video.height, undefined);

  // Cloned track should also inherit spoofed surface
  const clonedTrack = track1.clone();
  assert.equal(clonedTrack.getSettings().displaySurface, 'browser');
  assert.equal(clonedTrack.label, 'Google Chrome Tab');

  // Scenario 2: Main process set __prism_report_display_surface = 'monitor' (sharing tab, reporting screen)
  context.window.__prism_report_display_surface = 'monitor';
  const stream2 = await context.navigator.mediaDevices.getDisplayMedia();
  const track2 = stream2.getVideoTracks()[0];
  assert.equal(track2.getSettings().displaySurface, 'monitor');
  assert.equal(track2.getCapabilities().displaySurface, 'monitor');
  assert.equal(track2.label, 'screen:0:0');

  // Scenario 3: Opt-out / disable restores original getDisplayMedia
  vm.runInContext(buildFocusScript([]), context);
  assert.equal(navigator.mediaDevices.getDisplayMedia, originalGetDisplayMedia);
});

test('tab visibility in layout hides all tabs when viewport is not visible (modal open) to prevent covering dialogs', () => {
  function computeTabVisibility(tab, activeTabId, sharedTabId, viewportVisible) {
    const isShared = (tab.id === sharedTabId);
    return Boolean(viewportVisible && ((tab.id === activeTabId && tab.url !== 'about:blank' && !tab.error) || isShared));
  }

  const tab1 = { id: 'tab-1', url: 'https://site1.example', error: '' };
  const tab2 = { id: 'tab-2', url: 'https://site2.example', error: '' };

  // When viewport is visible (no modal open):
  // User is on tab 2, sharing tab 1
  assert.equal(computeTabVisibility(tab2, 'tab-2', 'tab-1', true), true, 'active tab is visible');
  assert.equal(computeTabVisibility(tab1, 'tab-2', 'tab-1', true), true, 'shared tab is visible');

  // When a modal opens (viewport.visible is false):
  // Both active tab AND shared tab MUST be hidden so modal is not covered
  assert.equal(computeTabVisibility(tab2, 'tab-2', 'tab-1', false), false, 'active tab is hidden when modal is open');
  assert.equal(computeTabVisibility(tab1, 'tab-2', 'tab-1', false), false, 'shared tab is hidden when modal is open');
  assert.equal(computeTabVisibility(tab1, 'tab-1', 'tab-1', false), false, 'active shared tab is hidden when modal is open');
});

test('screenshare track ended listener logs __prism_screenshare_ended__ for cleanup', async () => {
  const vm = require('node:vm');
  const { buildFocusScript } = require('../electron/focus.cjs');

  const listeners = new Map();
  const trackListeners = new Map();
  const document = Object.create({ hasFocus() { return false; } });
  document.location = { href: 'https://call.example' };

  const consoleLogs = [];
  const fakeConsole = {
    info: (...args) => consoleLogs.push(args.join(' '))
  };

  class MockTrack {
    getSettings() { return { displaySurface: 'monitor' }; }
    getCapabilities() { return { displaySurface: 'monitor' }; }
    get label() { return 'screen:0:0'; }
    addEventListener(type, fn) {
      const set = trackListeners.get(type) || new Set();
      set.add(fn);
      trackListeners.set(type, set);
    }
  }

  const mockTrack = new MockTrack();
  const window = {
    addEventListener(type, fn) { const set = listeners.get(type) || new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    console: fakeConsole,
    MediaStreamTrack: MockTrack
  };
  const navigator = {
    mediaDevices: {
      getDisplayMedia: async () => ({
        getVideoTracks: () => [mockTrack],
        getTracks: () => [mockTrack]
      })
    }
  };

  const context = vm.createContext({ document, window, navigator, console: fakeConsole, URL, DOMException });
  vm.runInContext(buildFocusScript([{ host: 'call.example', focus: true }]), context);

  const stream = await context.navigator.mediaDevices.getDisplayMedia();
  assert.ok(trackListeners.has('ended'), 'track has ended listener attached');

  // Trigger ended event
  for (const fn of trackListeners.get('ended')) fn();
  assert.ok(consoleLogs.includes('__prism_screenshare_ended__'), 'emitted screenshare ended log');
});
