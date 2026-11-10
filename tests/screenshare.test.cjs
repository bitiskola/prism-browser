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

test('screenshare WebCodecs crop/scale pipeline transforms scaled down tab video without blank margins', async () => {
  const vm = require('node:vm');
  const { buildFocusScript } = require('../electron/focus.cjs');

  const listeners = new Map();
  const document = Object.create({ hasFocus() { return false; } });
  document.location = { href: 'https://testsite.example/call' };

  class MockMediaStreamTrack {
    constructor() {
      this.readyState = 'live';
      this.enabled = true;
      this.listeners = new Map();
    }
    getSettings() { return { displaySurface: 'browser', width: 1536, height: 960 }; }
    getCapabilities() { return { displaySurface: 'browser' }; }
    get label() { return 'Google Chrome Tab'; }
    stop() { this.readyState = 'ended'; }
    addEventListener(type, fn) {
      const set = this.listeners.get(type) || new Set();
      set.add(fn);
      this.listeners.set(type, set);
    }
  }

  class MockStream {
    constructor(tracks = []) {
      this._tracks = [...tracks];
    }
    getVideoTracks() { return [...this._tracks]; }
    getTracks() { return [...this._tracks]; }
    removeTrack(track) { this._tracks = this._tracks.filter(t => t !== track); }
    addTrack(track) { this._tracks.push(track); }
  }

  class MockVideoFrame {
    constructor(source, init = {}) {
      this.source = source;
      this.visibleRect = init.visibleRect || { x: 0, y: 0, width: source.displayWidth, height: source.displayHeight };
      this.displayWidth = init.displayWidth || source.displayWidth;
      this.displayHeight = init.displayHeight || source.displayHeight;
      this.codedWidth = source.codedWidth || 1536;
      this.codedHeight = source.codedHeight || 960;
      this.closed = false;
    }
    close() { this.closed = true; }
  }

  let capturedTransformer = null;
  class MockTransformStream {
    constructor(transformer) {
      capturedTransformer = transformer;
      this.readable = {
        pipeTo: async (writable) => {}
      };
      this.writable = {};
    }
  }

  class MockMediaStreamTrackProcessor {
    constructor({ track }) {
      this.track = track;
      this.readable = {
        pipeThrough: (transform) => transform.readable
      };
    }
  }

  class MockMediaStreamTrackGenerator extends MockMediaStreamTrack {
    constructor({ kind }) {
      super();
      this.kind = kind;
      this.writable = {};
    }
  }

  const origTrack = new MockMediaStreamTrack();
  const origStream = new MockStream([origTrack]);
  const originalGetDisplayMedia = async () => origStream;

  const window = {
    addEventListener(type, fn) { const set = listeners.get(type) || new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    MediaStreamTrackProcessor: MockMediaStreamTrackProcessor,
    MediaStreamTrackGenerator: MockMediaStreamTrackGenerator,
    VideoFrame: MockVideoFrame,
    TransformStream: MockTransformStream,
    __prism_report_display_surface: 'browser',
    __prism_tab_scale: 0.825
  };
  const navigator = {
    mediaDevices: {
      getDisplayMedia: originalGetDisplayMedia
    }
  };

  const context = vm.createContext({
    document,
    window,
    navigator,
    URL,
    DOMException,
    MediaStreamTrackProcessor: MockMediaStreamTrackProcessor,
    MediaStreamTrackGenerator: MockMediaStreamTrackGenerator,
    VideoFrame: MockVideoFrame,
    TransformStream: MockTransformStream,
    performance: { now: () => clock }
  });
  let clock = 1000;
  const rules = [{ host: 'testsite.example', focus: true }];

  vm.runInContext(buildFocusScript(rules), context);

  const stream = await context.navigator.mediaDevices.getDisplayMedia();
  const videoTracks = stream.getVideoTracks();
  assert.equal(videoTracks.length, 1);
  const transformedTrack = videoTracks[0];
  assert.ok(transformedTrack instanceof MockMediaStreamTrackGenerator);
  assert.equal(transformedTrack.getSettings().displaySurface, 'browser');

  // Verify transformer crops frame according to scale and restores full display dimensions
  assert.ok(capturedTransformer, 'transformer was created');
  const enqueued = [];
  const fakeController = {
    enqueue(item) { enqueued.push(item); }
  };
  const inputFrame = new MockVideoFrame({
    displayWidth: 1536,
    displayHeight: 960,
    codedWidth: 1536,
    codedHeight: 960
  });

  await capturedTransformer.transform(inputFrame, fakeController);
  assert.equal(enqueued.length, 1);
  const outFrame = enqueued[0];
  assert.equal(outFrame.displayWidth, 1536);
  assert.equal(outFrame.displayHeight, 960);
  assert.equal(outFrame.visibleRect.width, Math.round(1536 * 0.825));
  assert.equal(outFrame.visibleRect.height, Math.round(960 * 0.825));
  assert.equal(inputFrame.closed, true);

  // Verify direct seamless transition when switching to fullscreen (scale = 1) without zoom in-out artifact
  context.window.__prism_tab_scale = 1.0;
  const nextFrame = new MockVideoFrame({
    displayWidth: 1536,
    displayHeight: 960,
    codedWidth: 1536,
    codedHeight: 960
  });
  await capturedTransformer.transform(nextFrame, fakeController);
  assert.equal(enqueued.length, 2);
  const transitionFrame = enqueued[1];
  assert.equal(transitionFrame, nextFrame, 'fullscreen frame is passed directly without zoom effect');

  // While the main process resizes the shared tab, frames are dropped (the
  // viewer keeps the last good frame) instead of being cropped with a scale
  // that is out of step with what Chromium painted.
  context.window.__prism_tab_scale_hold_until = clock + 1500;
  const heldFrame = new MockVideoFrame({ displayWidth: 1600, displayHeight: 900, codedWidth: 1600, codedHeight: 900 });
  await capturedTransformer.transform(heldFrame, fakeController);
  assert.equal(enqueued.length, 2, 'held frame is not forwarded');
  assert.equal(heldFrame.closed, true, 'held frame is released');

  // Release with the new scale: frames flow again, cropped with it.
  context.window.__prism_tab_scale = 0.5;
  context.window.__prism_tab_scale_hold_until = clock + 80;
  clock += 81;
  const resumedFrame = new MockVideoFrame({ displayWidth: 1536, displayHeight: 960, codedWidth: 1536, codedHeight: 960 });
  await capturedTransformer.transform(resumedFrame, fakeController);
  assert.equal(enqueued.length, 3);
  assert.equal(enqueued[2].visibleRect.width, 768);
  assert.equal(enqueued[2].displayWidth, 1536);
});

test('tab screenshare resolution and aspect ratio only apply when spoof mode is active for the tab', () => {
  function computeLayoutBounds(viewport, isSpoofed, targetRes) {
    const availX = Math.max(0, Math.round(viewport.x));
    const availY = Math.max(0, Math.round(viewport.y));
    const availW = Math.max(0, Math.round(viewport.width));
    const availH = Math.max(0, Math.round(viewport.height));
    const shouldFitAspect = Boolean(isSpoofed);
    if (shouldFitAspect) {
      const targetW = targetRes?.width || 1920;
      const targetH = targetRes?.height || 1080;
      const scale = Math.min(availW / targetW, availH / targetH);
      const fitW = Math.max(1, Math.round(targetW * scale));
      const fitH = Math.max(1, Math.round(targetH * scale));
      const offsetX = Math.round((availW - fitW) / 2);
      const offsetY = Math.round((availH - fitH) / 2);
      return { x: availX + offsetX, y: availY + offsetY, width: fitW, height: fitH, scale };
    }
    return { x: availX, y: availY, width: availW, height: availH, scale: 1 };
  }

  function computeTabScale(isTabSpoofed, focusController, tabId, targetRes) {
    return (isTabSpoofed && focusController && typeof focusController.computeScale === 'function')
      ? focusController.computeScale(tabId, targetRes)
      : 1;
  }

  const viewport = { x: 0, y: 72, width: 1200, height: 728 };
  const targetRes = { width: 1920, height: 1080 };
  const mockFocus = {
    computeScale(id, res) {
      return 1200 / res.width;
    }
  };

  // Scenario 1: Tab screenshare with spoof mode completely OFF
  const boundsOff = computeLayoutBounds(viewport, false, targetRes);
  assert.deepEqual(boundsOff, { x: 0, y: 72, width: 1200, height: 728, scale: 1 });
  const scaleOff = computeTabScale(false, mockFocus, 'tab-1', targetRes);
  assert.equal(scaleOff, 1, 'scale is 1 when spoof mode is off');

  // Scenario 2: Tab screenshare with spoof mode ON
  const boundsOn = computeLayoutBounds(viewport, true, targetRes);
  assert.notDeepEqual(boundsOn, { x: 0, y: 72, width: 1200, height: 728, scale: 1 });
  const scaleOn = computeTabScale(true, mockFocus, 'tab-1', targetRes);
  assert.equal(scaleOn, 1200 / 1920, 'scale is computed when spoof mode is on');
});

function overlayFixture({ focused = false, visible = true } = {}) {
  const calls = [];
  const wc = {
    isDestroyed: () => false,
    isFocused: () => focused,
    focus() { calls.push('focus'); },
  };
  const view = {
    webContents: wc,
    getVisible: () => visible,
    setVisible(v) { calls.push(`visible:${v}`); },
  };
  return { tab: { view }, calls };
}

test('capture cursor overlay reset hides and re-shows the shared view in one tick', () => {
  const { resetCaptureCursorOverlay } = require('../electron/cast-sync.cjs');
  const { tab, calls } = overlayFixture();
  assert.equal(resetCaptureCursorOverlay(tab, { windowFocused: true, focusSpoofed: false }), true);
  // A hidden->visible WebContents change makes Chromium re-create its capture
  // cursor tracker in the idle state, removing the pointer stuck at the edge.
  assert.deepEqual(calls, ['visible:false', 'visible:true']);
});

test('capture cursor overlay reset restores keyboard focus only for focus-spoofed tabs', () => {
  const { resetCaptureCursorOverlay } = require('../electron/cast-sync.cjs');
  const spoofed = overlayFixture({ focused: true });
  assert.equal(resetCaptureCursorOverlay(spoofed.tab, { windowFocused: true, focusSpoofed: true }), true);
  assert.deepEqual(spoofed.calls, ['visible:false', 'visible:true', 'focus']);

  // A plain page would observe the blur/focus pair; keep Chromium's default.
  const plain = overlayFixture({ focused: true });
  assert.equal(resetCaptureCursorOverlay(plain.tab, { windowFocused: true, focusSpoofed: false }), true);
  assert.deepEqual(plain.calls, []);
});

test('capture cursor overlay reset waits for drags and skips inactive windows or hidden views', () => {
  const { resetCaptureCursorOverlay } = require('../electron/cast-sync.cjs');
  const dragging = overlayFixture();
  dragging.tab.mouseButtonDown = true;
  assert.equal(resetCaptureCursorOverlay(dragging.tab, { windowFocused: true, focusSpoofed: true }), false, 'retried after release');
  assert.deepEqual(dragging.calls, []);
  dragging.tab.mouseButtonDown = false;
  assert.equal(resetCaptureCursorOverlay(dragging.tab, { windowFocused: true, focusSpoofed: true }), true);
  assert.deepEqual(dragging.calls, ['visible:false', 'visible:true']);

  const inactive = overlayFixture();
  assert.equal(resetCaptureCursorOverlay(inactive.tab, { windowFocused: false, focusSpoofed: true }), true);
  assert.deepEqual(inactive.calls, []);

  const hidden = overlayFixture({ visible: false });
  assert.equal(resetCaptureCursorOverlay(hidden.tab, { windowFocused: true, focusSpoofed: true }), true);
  assert.deepEqual(hidden.calls, []);
});

test('shared tab resize holds the screencast, applies bounds with metrics in one tick, then releases', async () => {
  const { runSharedResize } = require('../electron/cast-sync.cjs');
  const log = [];
  const tab = {
    id: 7,
    view: { setBounds(b) { log.push(`bounds:${b.width}`); } },
    pendingBounds: { x: 0, y: 0, width: 1280, height: 720 },
  };
  let resolveMetrics;
  const deps = {
    hold: async () => { log.push('hold'); },
    release: () => { log.push('release'); },
    isAlive: () => true,
    updateMetrics: id => {
      // The override must be sent in the same tick as setBounds.
      log.push(`metrics:${id}`);
      return new Promise(r => { resolveMetrics = r; });
    },
  };
  const run = runSharedResize(tab, deps);
  await new Promise(r => setImmediate(r));
  assert.deepEqual(log, ['hold', 'bounds:1280', 'metrics:7']);

  // A second layout during the transition only queues the newest bounds.
  tab.pendingBounds = { x: 0, y: 0, width: 1920, height: 1080 };
  await runSharedResize(tab, deps);
  assert.deepEqual(log, ['hold', 'bounds:1280', 'metrics:7'], 'no concurrent run');

  resolveMetrics();
  await new Promise(r => setImmediate(r));
  resolveMetrics();
  await run;
  assert.deepEqual(log, ['hold', 'bounds:1280', 'metrics:7', 'hold', 'bounds:1920', 'metrics:7', 'release']);
  assert.equal(tab.resizeRunning, false);
});

test('shared tab resize always releases the hold, even when the tab is gone', async () => {
  const { runSharedResize } = require('../electron/cast-sync.cjs');
  const log = [];
  const tab = { id: 1, view: { setBounds() { log.push('bounds'); } }, pendingBounds: { width: 1, height: 1 } };
  await runSharedResize(tab, { hold: async () => log.push('hold'), release: () => log.push('release'), isAlive: () => false, updateMetrics: async () => log.push('metrics') });
  assert.deepEqual(log, ['hold', 'release']);
});
