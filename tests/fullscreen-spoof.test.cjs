'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { buildFocusScript } = require('../electron/focus.cjs');

function createMockPage(url = 'https://example.com/test') {
  const windowListeners = new Map();
  const docListeners = new Map();

  const Element = function() {};
  Element.prototype.requestFullscreen = async function() { return Promise.resolve(); };
  Element.prototype.webkitRequestFullscreen = async function() { return Promise.resolve(); };

  const docProto = {
    hasFocus() { return false; }
  };
  Object.defineProperties(docProto, {
    hidden: { get: () => true, configurable: true },
    visibilityState: { get: () => 'hidden', configurable: true },
    fullscreenElement: { get: () => null, configurable: true },
    fullscreen: { get: () => false, configurable: true }
  });

  const Document = function() {};
  Document.prototype = docProto;
  docProto.exitFullscreen = async function() { return Promise.resolve(); };
  docProto.webkitExitFullscreen = async function() { return Promise.resolve(); };

  const document = Object.create(docProto);
  document.documentElement = Object.create(Element.prototype);
  document.documentElement.tagName = 'HTML';
  document.body = Object.create(Element.prototype);
  document.body.tagName = 'BODY';
  document.location = { href: url, ancestorOrigins: [] };
  document.addEventListener = (type, fn, opts) => {
    const set = docListeners.get(type) || new Set();
    set.add(fn);
    docListeners.set(type, set);
  };
  document.removeEventListener = (type, fn) => {
    docListeners.get(type)?.delete(fn);
  };

  const window = {
    addEventListener(type, fn, opts) {
      const set = windowListeners.get(type) || new Set();
      set.add(fn);
      windowListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      windowListeners.get(type)?.delete(fn);
    },
    matchMedia(query) {
      return {
        matches: false,
        media: query
      };
    }
  };

  const context = vm.createContext({
    document,
    window,
    Element,
    Document,
    URL,
    DOMException
  });

  return {
    document,
    window,
    Element,
    Document,
    windowListeners,
    docListeners,
    apply: rules => vm.runInContext(buildFocusScript(rules), context),
    dispatchWindow(type, isTrusted = true) {
      let stopped = false;
      const event = { type, target: window, isTrusted, stopImmediatePropagation() { stopped = true; } };
      for (const fn of windowListeners.get(type) || []) fn(event);
      return stopped;
    },
    dispatchDoc(type, isTrusted = true) {
      let stopped = false;
      const event = { type, target: document, isTrusted, stopImmediatePropagation() { stopped = true; } };
      for (const fn of docListeners.get(type) || []) fn(event);
      return stopped;
    }
  };
}

test('spoof mode keeps page reporting fullscreen continuously and suppresses fullscreen events', async () => {
  const page = createMockPage('https://bitdiak.hu/exams/student/22/screen/');

  // 1. Before spoof mode, page reports non-fullscreen
  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.document.fullscreen, false);
  assert.equal(page.window.matchMedia('(display-mode: fullscreen)').matches, false);

  // 2. Enable spoof mode for bitdiak.hu
  const enabled = page.apply([{ host: 'bitdiak.hu', focus: true }]);
  assert.equal(enabled, true);

  // 3. Page now continuously reports fullscreen mode
  assert.equal(page.document.fullscreenElement, page.document.documentElement);
  assert.equal(page.document.webkitFullscreenElement, page.document.documentElement);
  assert.equal(page.document.webkitCurrentFullScreenElement, page.document.documentElement);
  assert.equal(page.document.fullscreen, true);
  assert.equal(page.document.webkitIsFullScreen, true);
  assert.equal(page.document.fullscreenEnabled, true);
  assert.equal(page.document.webkitFullscreenEnabled, true);
  assert.equal(page.window.matchMedia('(display-mode: fullscreen)').matches, true);

  // 4. Element requestFullscreen updates activeFsElement and resolves without throwing
  const testElement = Object.create(page.Element.prototype);
  testElement.tagName = 'DIV';
  testElement.id = 'exam-canvas';
  await testElement.requestFullscreen();
  assert.equal(page.document.fullscreenElement, testElement);

  // 5. Calling exitFullscreen resolves without error, and fullscreenElement STILL reports documentElement
  await page.document.exitFullscreen();
  assert.equal(page.document.fullscreenElement, testElement);
  assert.equal(page.document.fullscreen, true);

  // 6. When browser window exits or enters fullscreen, fullscreenchange / webkitfullscreenchange events are suppressed
  assert.equal(page.dispatchWindow('fullscreenchange'), true, 'window fullscreenchange must be stopped');
  assert.equal(page.dispatchDoc('fullscreenchange'), true, 'doc fullscreenchange must be stopped');
  assert.equal(page.dispatchWindow('webkitfullscreenchange'), true, 'window webkitfullscreenchange must be stopped');
  assert.equal(page.dispatchDoc('webkitfullscreenchange'), true, 'doc webkitfullscreenchange must be stopped');
  assert.equal(page.dispatchWindow('fullscreenerror'), true, 'window fullscreenerror must be stopped');
  assert.equal(page.dispatchDoc('fullscreenerror'), true, 'doc fullscreenerror must be stopped');

  // 7. Disabling spoof mode restores original properties
  page.apply([]);
  assert.equal(page.document.fullscreenElement, null);
  assert.equal(page.document.fullscreen, false);
  assert.equal(page.window.matchMedia('(display-mode: fullscreen)').matches, false);
});

test('shortcut logic: Ctrl+F toggles fullscreen, Escape exits only when fullscreen is active', () => {
  function handleInputShortcut(input, isFullScreen, toggleFs, exitFs) {
    if (!input || input.type !== 'keyDown') return { handled: false };
    const key = (input.key || '').toLowerCase();
    const mod = Boolean(input.control || input.meta);

    // Ctrl+F / Cmd+F or F11 toggles fullscreen
    if (key === 'f11' || (mod && key === 'f')) {
      toggleFs();
      return { handled: true, action: 'toggle' };
    }

    // Escape exits fullscreen ONLY when currently in fullscreen
    if (key === 'escape' && isFullScreen) {
      exitFs();
      return { handled: true, action: 'exit' };
    }

    return { handled: false };
  }

  let fullScreen = false;
  const toggle = () => { fullScreen = !fullScreen; };
  const exit = () => { fullScreen = false; };

  // 1. Ctrl+F toggles fullscreen ON
  let res = handleInputShortcut({ type: 'keyDown', control: true, key: 'f' }, fullScreen, toggle, exit);
  assert.equal(res.handled, true);
  assert.equal(res.action, 'toggle');
  assert.equal(fullScreen, true);

  // 2. Escape when in fullscreen exits fullscreen
  res = handleInputShortcut({ type: 'keyDown', control: false, key: 'Escape' }, fullScreen, toggle, exit);
  assert.equal(res.handled, true);
  assert.equal(res.action, 'exit');
  assert.equal(fullScreen, false);

  // 3. Escape when NOT in fullscreen does nothing (not handled, does not enter fullscreen)
  res = handleInputShortcut({ type: 'keyDown', control: false, key: 'Escape' }, fullScreen, toggle, exit);
  assert.equal(res.handled, false);
  assert.equal(fullScreen, false);

  // 4. macOS Cmd+F toggles fullscreen ON
  res = handleInputShortcut({ type: 'keyDown', meta: true, key: 'F' }, fullScreen, toggle, exit);
  assert.equal(res.handled, true);
  assert.equal(res.action, 'toggle');
  assert.equal(fullScreen, true);

  // 5. Cmd+F toggles fullscreen OFF
  res = handleInputShortcut({ type: 'keyDown', meta: true, key: 'f' }, fullScreen, toggle, exit);
  assert.equal(res.handled, true);
  assert.equal(res.action, 'toggle');
  assert.equal(fullScreen, false);

  // 6. Ctrl+8 is no longer a shortcut (fake fullscreen reverted)
  res = handleInputShortcut({ type: 'keyDown', control: true, key: '8' }, fullScreen, toggle, exit);
  assert.equal(res.handled, false);
  assert.equal(fullScreen, false);
});
