'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { FocusController, buildFocusScript } = require('../electron/focus.cjs');
const { ClipboardTyping } = require('../electron/clipboard-typing.cjs');

function createDOMContext(url = 'https://example.com') {
  const windowListeners = new Map();
  const docListeners = new Map();

  class Element {
    constructor(tag, type = 'text') {
      this.nodeType = 1;
      this.tagName = tag.toUpperCase();
      this.type = type;
      this.value = '';
      this.readOnly = false;
      this.disabled = false;
      this.isContentEditable = false;
      this.style = { getPropertyValue: () => '', setProperty: () => {}, removeProperty: () => {}, getPropertyPriority: () => '' };
    }
  }

  const document = {
    location: { href: url, ancestorOrigins: [] },
    hasFocus: () => true,
    hidden: false,
    visibilityState: 'visible',
    activeElement: null,
    addEventListener(type, fn) {
      const set = docListeners.get(type) || new Set();
      set.add(fn);
      docListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    }
  };

  const window = {
    addEventListener(type, fn) {
      const set = windowListeners.get(type) || new Set();
      set.add(fn);
      windowListeners.set(type, set);
    },
    removeEventListener(type, fn) {
      windowListeners.get(type)?.delete(fn);
    }
  };

  const context = vm.createContext({
    document,
    window,
    URL,
    DOMException,
    HTMLElement: Element,
    HTMLInputElement: class extends Element { constructor() { super('INPUT'); } },
    HTMLTextAreaElement: class extends Element { constructor() { super('TEXTAREA'); } },
    KeyboardEvent: class {
      constructor(type, opts = {}) {
        Object.assign(this, opts);
        this.type = type;
        this.isTrusted = true;
      }
    }
  });

  return {
    document,
    window,
    windowListeners,
    docListeners,
    Element,
    apply(rules) {
      return vm.runInContext(buildFocusScript(rules), context);
    },
    dispatch(type, target, keyProps = {}) {
      let stopped = false;
      let prevented = false;
      const event = {
        type,
        target,
        isTrusted: true,
        stopImmediatePropagation() { stopped = true; },
        preventDefault() { prevented = true; },
        composedPath: () => [target],
        button: keyProps.button !== undefined ? keyProps.button : 0,
        ...keyProps
      };
      for (const fn of windowListeners.get(type) || []) {
        if (stopped) break;
        fn(event);
      }
      return { stopped, prevented, event };
    }
  };
}

test('keyboard listeners: non-textbox target blocks all keys', () => {
  const dom = createDOMContext();
  dom.apply([{ host: 'example.com', focus: true }]);

  const div = new dom.Element('DIV');
  dom.document.activeElement = div;

  // Even normal characters are blocked when not writing in a textbox
  const resChar = dom.dispatch('keydown', div, { key: 'a' });
  assert.equal(resChar.stopped, true, 'character outside textbox is blocked');

  const resEsc = dom.dispatch('keydown', div, { key: 'Escape' });
  assert.equal(resEsc.stopped, true, 'Escape outside textbox is blocked');
});

test('keyboard listeners: inside textbox, only actual written characters are allowed, non-characters blocked', () => {
  const dom = createDOMContext();
  dom.apply([{ host: 'example.com', focus: true }]);

  const input = new dom.Element('INPUT', 'text');
  dom.document.activeElement = input;

  // Single characters allowed
  for (const ch of ['a', 'Z', '5', '!', ' ', 'á', 'ő']) {
    const kd = dom.dispatch('keydown', input, { key: ch });
    assert.equal(kd.stopped, false, `character ${ch} allowed on keydown`);
    const kp = dom.dispatch('keypress', input, { key: ch });
    assert.equal(kp.stopped, false, `character ${ch} allowed on keypress`);
    const ku = dom.dispatch('keyup', input, { key: ch });
    assert.equal(ku.stopped, false, `character ${ch} allowed on keyup`);
  }

  // Non-character keys blocked
  for (const nonChar of ['Escape', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Control', 'Alt', 'Shift', 'F1', 'Home']) {
    const res = dom.dispatch('keydown', input, { key: nonChar });
    assert.equal(res.stopped, true, `non-character key ${nonChar} blocked`);
  }

  // Combinations like Ctrl+A, Ctrl+C, Ctrl+V, Alt+A, Meta+A blocked
  for (const combo of [
    { key: 'a', ctrlKey: true },
    { key: 'c', ctrlKey: true },
    { key: 'v', ctrlKey: true },
    { key: 'a', metaKey: true },
    { key: 'f', altKey: true }
  ]) {
    const res = dom.dispatch('keydown', input, combo);
    assert.equal(res.stopped, true, `combo key=${combo.key} blocked`);
  }
});

test('keyboard listeners: Enter key allowed in textarea / contenteditable but blocked in single line input', () => {
  const dom = createDOMContext();
  dom.apply([{ host: 'example.com', focus: true }]);

  const input = new dom.Element('INPUT', 'text');
  const resInput = dom.dispatch('keydown', input, { key: 'Enter' });
  assert.equal(resInput.stopped, true, 'Enter in text input blocked from listeners');

  const textarea = new dom.Element('TEXTAREA');
  const resTextarea = dom.dispatch('keydown', textarea, { key: 'Enter' });
  assert.equal(resTextarea.stopped, false, 'Enter in textarea allowed');

  const editableDiv = new dom.Element('DIV');
  editableDiv.isContentEditable = true;
  const resDiv = dom.dispatch('keydown', editableDiv, { key: 'Enter' });
  assert.equal(resDiv.stopped, false, 'Enter in contenteditable allowed');
});

test('copy, cut, and paste events are completely hidden in spoof mode', () => {
  const dom = createDOMContext();
  dom.apply([{ host: 'example.com', focus: true }]);

  for (const type of ['copy', 'cut', 'paste', 'beforecopy', 'beforecut', 'beforepaste']) {
    const res = dom.dispatch(type, dom.document);
    assert.equal(res.stopped, true, `${type} is stopped from reaching site`);
  }

  // oncopy, oncut, onpaste are neutralized
  assert.equal(dom.window.oncopy, null);
  dom.window.oncopy = () => 'test';
  assert.equal(dom.window.oncopy, null);
  assert.equal(dom.document.oncopy, null);
  dom.document.oncopy = () => 'test';
  assert.equal(dom.document.oncopy, null);
});

test('right click: contextmenu is blocked from website listeners and preventDefault is neutralized', () => {
  const dom = createDOMContext();
  dom.apply([{ host: 'example.com', focus: true }]);

  const res = dom.dispatch('contextmenu', dom.document, { button: 2 });
  assert.equal(res.stopped, true, 'contextmenu blocked from website listeners');

  // Attempting to call preventDefault on contextmenu event does nothing
  res.event.preventDefault();
  assert.equal(res.prevented, false, 'preventDefault on contextmenu neutralized so menu always opens');

  // oncontextmenu is neutralized
  assert.equal(dom.window.oncontextmenu, null);
  dom.window.oncontextmenu = () => false;
  assert.equal(dom.window.oncontextmenu, null);
  assert.equal(dom.document.oncontextmenu, null);
  dom.document.oncontextmenu = () => false;
  assert.equal(dom.document.oncontextmenu, null);
});

test('fake paste: reports keypress/keydown/keyup for typed clipboard characters', async () => {
  const executedScripts = [];
  const inserted = [];
  const wc = new EventEmitter();
  wc.executeJavaScript = async code => { executedScripts.push(code); };
  wc.insertText = async text => { inserted.push(text); };

  const typing = new ClipboardTyping({
    readText: async () => 'Hi!',
    canType: () => true,
    notify: () => {}
  });

  await typing.toggle(wc);
  // Wait for typing to complete
  await new Promise(resolve => setTimeout(resolve, 500));
  typing.stop();

  assert.deepEqual(inserted, ['H', 'i', '!']);
  assert.equal(executedScripts.length >= 3, true, 'executeJavaScript called for each character');
  // Check that the script dispatches keydown, keypress, and keyup
  for (const script of executedScripts) {
    assert.ok(script.includes("'keydown'"));
    assert.ok(script.includes("'keypress'"));
    assert.ok(script.includes("'keyup'"));
    assert.ok(script.includes('__prism_allowed__'));
  }
});
