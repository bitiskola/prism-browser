'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { FocusController, buildFocusScript } = require('../electron/focus.cjs');

function page(url, ancestorOrigins = []) {
  const listeners = new Map();
  let nativeFocused = false;
  const prototype = { hasFocus() { return nativeFocused; } };
  Object.defineProperties(prototype, {
    hidden: { get: () => true, configurable: true },
    visibilityState: { get: () => 'hidden', configurable: true },
  });
  const document = Object.create(prototype);
  document.location = { href: url, ancestorOrigins };
  const window = {
    addEventListener(type, fn) { const set = listeners.get(type) || new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
  };
  const context = vm.createContext({ document, window, URL, DOMException });
  return {
    document, window, listeners,
    setNativeFocus: value => { nativeFocused = value; },
    apply: rules => vm.runInContext(buildFocusScript(rules), context),
    evaluate: source => vm.runInContext(source, context),
    dispatch(type, target, isTrusted = true) {
      let stopped = false;
      const event = { type, target, isTrusted, stopImmediatePropagation() { stopped = true; } };
      for (const fn of listeners.get(type) || []) fn(event);
      return stopped;
    },
  };
}

test('selected document reports focus and visibility, and disabling restores descriptors', () => {
  const fixture = page('https://example.com/path');
  const original = Object.getOwnPropertyDescriptors(fixture.document);
  assert.equal(fixture.apply([{ host: 'example.com', focus: true }]), true);
  assert.equal(fixture.document.hasFocus(), true);
  assert.equal(fixture.document.hidden, false);
  assert.equal(fixture.document.visibilityState, 'visible');
  assert.equal(fixture.document.webkitHidden, false);
  assert.equal(fixture.document.webkitVisibilityState, 'visible');
  assert.equal(Object.getOwnPropertyDescriptor(fixture.document, 'hidden').configurable, true);
  assert.equal(fixture.apply([]), false);
  assert.equal(fixture.document.hasFocus(), false);
  assert.equal(fixture.document.hidden, true);
  assert.deepEqual(Object.getOwnPropertyDescriptors(fixture.document), original);
  assert.equal([...fixture.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
});

test('nonselected, lookalike and non-HTTP documents never get overrides', () => {
  const rules = [{ host: 'example.com', focus: true, includeSubdomains: true }];
  for (const url of ['https://other.com/', 'https://notexample.com/', 'https://example.com.evil.test/', 'file://example.com/a', 'about:blank', 'data:text/html,example.com']) {
    const fixture = page(url);
    assert.equal(fixture.apply(rules), false, url);
    assert.equal(fixture.document.hasFocus(), false, url);
    assert.equal(fixture.listeners.size, 0, url);
  }
});

test('subdomains are optional, normalized, and constrained by dot boundaries', () => {
  const fixture = page('https://Sub.Example.com.:443/test');
  assert.equal(fixture.apply([{ host: 'example.com', focus: true }]), false);
  assert.equal(fixture.apply([{ host: 'EXAMPLE.COM.', focus: true, includeSubdomains: true }]), true);
  assert.equal(fixture.apply([{ host: 'example.com', focus: false, includeSubdomains: true }]), false);
});

test('a selected top-level site includes cross-origin and opaque embedded documents', () => {
  const rules = [{ host: 'example.com', focus: true }];
  for (const url of ['https://video.other.test', 'about:blank', 'about:srcdoc', 'data:text/html,frame', 'blob:https://other.test/id']) {
    const iframe = page(url, ['https://nested.other.test', 'https://example.com']);
    assert.equal(iframe.apply(rules), true, url);
    assert.equal(iframe.document.hasFocus(), true, url);
    assert.equal(iframe.dispatch('blur', iframe.window), true, url);
    assert.equal(iframe.apply([]), false, url);
    assert.equal(iframe.document.hasFocus(), false, url);
    assert.equal(iframe.listeners.get('blur').size, 0, url);
  }
});

test('frame inheritance respects top-level host boundaries and does not spread embedded-only rules', () => {
  const rules = [{ host: 'example.com', focus: true }];
  for (const top of ['https://other.test', 'https://example.com.evil.test', 'https://notexample.com', 'null']) {
    assert.equal(page('https://child.test', ['https://example.com', top]).apply(rules), false, top);
  }
  const iframe = page('https://child.test', ['https://sub.example.com']);
  assert.equal(iframe.apply(rules), false);
  assert.equal(iframe.apply([{ ...rules[0], includeSubdomains: true }]), true);
  assert.equal(page('https://example.com', ['https://other.test']).apply(rules), true, 'own frame rule still works');
  assert.equal(page('https://child.test').apply(rules), false, 'standalone embedded host remains unselected');
});

test('trusted page blur and visibility are suppressed while input and synthetic events survive', () => {
  const fixture = page('https://example.com');
  fixture.apply([{ host: 'example.com', focus: true }]);
  assert.equal(fixture.dispatch('blur', fixture.window), true);
  assert.equal(fixture.dispatch('focusout', fixture.document), true);
  assert.equal(fixture.dispatch('visibilitychange', fixture.document), true);
  assert.equal(fixture.dispatch('webkitvisibilitychange', fixture.document), true);
  assert.equal(fixture.dispatch('focus', fixture.window), true);
  assert.equal(fixture.dispatch('focusin', fixture.window), true);
  fixture.setNativeFocus(true);
  assert.equal(fixture.dispatch('blur', { tagName: 'INPUT' }), false);
  assert.equal(fixture.dispatch('focusout', { tagName: 'INPUT' }), false);
  fixture.setNativeFocus(false);
  assert.equal(fixture.dispatch('blur', { tagName: 'INPUT' }), true);
  assert.equal(fixture.dispatch('visibilitychange', fixture.document, false), false);
});

test('reapplying is idempotent and current-context navigation away restores originals', () => {
  const fixture = page('https://example.com');
  const originalFocus = () => false;
  Object.defineProperty(fixture.document, 'hasFocus', { value: originalFocus, configurable: true, enumerable: true });
  const originalDescriptor = Object.getOwnPropertyDescriptor(fixture.document, 'hasFocus');
  const rules = [{ host: 'example.com', focus: true }];
  fixture.apply(rules);
  const firstListeners = [...fixture.listeners].map(([name, set]) => [name, [...set]]);
  fixture.apply(rules);
  assert.deepEqual([...fixture.listeners].map(([name, set]) => [name, [...set]]), firstListeners);
  assert.equal([...fixture.listeners.values()].reduce((n, set) => n + set.size, 0), 25);
  fixture.document.location.href = 'https://other.test';
  fixture.apply(rules);
  assert.deepEqual(Object.getOwnPropertyDescriptor(fixture.document, 'hasFocus'), originalDescriptor);
});

test('trusted key, selection and clipboard listeners are suppressed without canceling browser defaults', () => {
  const fixture = page('https://example.com');
  fixture.apply([{ host: 'example.com', focus: true }]);
  for (const type of ['keydown', 'keyup', 'keypress', 'selectionchange', 'selectstart', 'select', 'copy', 'cut', 'paste']) {
    assert.equal(fixture.dispatch(type, fixture.document), true, type);
    assert.equal(fixture.dispatch(type, fixture.document, false), false, `synthetic ${type}`);
  }
  for (const type of ['input', 'beforeinput', 'change', 'click']) {
    assert.equal(fixture.dispatch(type, fixture.document), false, `${type} remains functional`);
  }
  fixture.apply([]);
  assert.equal(fixture.dispatch('keydown', fixture.document), false);
});

test('trusted cursor boundary events are suppressed until spoof mode is disabled', () => {
  const fixture = page('https://example.com');
  const rules = [{ host: 'example.com', focus: true }];
  fixture.apply(rules);
  fixture.apply(rules);
  const types = ['mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout'];
  for (const type of types) {
    for (const target of [fixture.window, fixture.document, { tagName: 'BUTTON' }]) {
      assert.equal(fixture.dispatch(type, target), true, type);
      assert.equal(fixture.dispatch(type, target, false), false, `synthetic ${type}`);
    }
  }
  for (const type of ['mousemove', 'pointermove', 'mousedown', 'pointerdown', 'mouseup', 'pointerup', 'click']) {
    assert.equal(fixture.dispatch(type, fixture.document), false, `${type} remains functional`);
  }
  fixture.apply([]);
  for (const type of types) assert.equal(fixture.dispatch(type, fixture.document), false, `restored ${type}`);
});

test('selection masking leaves native selection and input setters intact, then restores all prototypes', () => {
  const fixture = page('https://example.com');
  class Selection {
    constructor() { this.text = 'real selected text'; }
    get anchorNode() { return fixture.document; }
    get rangeCount() { return 1; }
    get isCollapsed() { return false; }
    get type() { return 'Range'; }
    toString() { return this.text; }
    getRangeAt() { return { nativeRange: true }; }
    containsNode() { return true; }
    getComposedRanges() { return [{ nativeRange: true }]; }
    removeAllRanges() { this.text = ''; }
  }
  class Input {
    constructor(ownerDocument) { this.ownerDocument = ownerDocument; this.start = 2; this.end = 8; }
    get selectionStart() { return this.start; }
    set selectionStart(value) { this.start = value; }
    get selectionEnd() { return this.end; }
    set selectionEnd(value) { this.end = value; }
    get selectionDirection() { return 'forward'; }
  }
  const native = new Selection();
  const other = new Selection();
  fixture.window.Selection = Selection;
  fixture.window.HTMLInputElement = Input;
  fixture.window.getSelection = () => native;
  const selectedInput = new Input(fixture.document);
  const otherInput = new Input({});
  const selectionDescriptors = Object.getOwnPropertyDescriptors(Selection.prototype);
  const inputDescriptors = Object.getOwnPropertyDescriptors(Input.prototype);
  fixture.apply([{ host: 'example.com', focus: true }]);
  assert.equal(native.toString(), '');
  assert.equal(native.rangeCount, 0);
  assert.equal(native.anchorNode, null);
  assert.equal(native.type, 'None');
  assert.equal(native.isCollapsed, true);
  assert.equal(native.containsNode(), false);
  assert.equal(native.getComposedRanges().length, 0);
  assert.throws(() => native.getRangeAt(0), error => error.name === 'IndexSizeError');
  assert.equal(other.toString(), 'real selected text');
  assert.equal(other.rangeCount, 1);
  assert.equal(selectedInput.selectionStart, 0);
  assert.equal(selectedInput.selectionEnd, 0);
  assert.equal(selectedInput.selectionDirection, 'none');
  assert.equal(otherInput.selectionStart, 2);
  selectedInput.selectionStart = 4;
  assert.equal(selectedInput.start, 4, 'native setter still works');
  assert.equal(native.text, 'real selected text', 'actual selection is untouched');
  fixture.apply([]);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Selection.prototype), selectionDescriptors);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Input.prototype), inputDescriptors);
  assert.equal(native.toString(), 'real selected text');
  assert.equal(selectedInput.selectionStart, 4);
});

test('only trusted primary-button down cancellation is ignored and click handlers are untouched', () => {
  const fixture = page('https://example.com');
  fixture.apply([{ host: 'example.com', focus: true }]);
  for (const [isTrusted, button, expected] of [[true, 0, false], [true, 2, true], [false, 0, true]]) {
    let canceled = false;
    const event = {isTrusted, button, target:fixture.document, preventDefault() {canceled=true;}};
    for (const listener of fixture.listeners.get('mousedown')) listener(event);
    event.preventDefault();
    assert.equal(canceled, expected);
  }
  assert.equal(fixture.listeners.has('click'), false);
});

test('malformed rules do not become script code or broaden host selection', () => {
  const fixture = page('https://example.com');
  for (const host of ['example.com/extra', 'example.com?foo', 'example.com#x', 'example.com:444', 'evil@example.com', '"); globalThis.injected = true; //']) {
    assert.equal(fixture.apply([{ host, focus: true }]), false);
  }
});

function contents(url, extraFrames = []) {
  const wc = new EventEmitter();
  const commands = [];
  let serial = 0;
  const makeFrame = (frameUrl, child = false) => {
    const fixture = page(frameUrl);
    return { url: frameUrl, executions: [], async executeJavaScript(source) {
      this.executions.push(source);
      fixture.document.location.href = this.url;
      fixture.document.location.ancestorOrigins = child ? [new URL(wc.mainFrame.url).origin] : [];
      // Notifications are covered by real Electron integration tests.
      if (source.startsWith('(() => { document.dispatchEvent')) return;
      return fixture.evaluate(source);
    }, isDestroyed: () => false };
  };
  wc.mainFrame = makeFrame(url);
  wc.mainFrame.framesInSubtree = [wc.mainFrame, ...extraFrames.map(url => makeFrame(url, true))];
  wc.isDestroyed = () => false;
  wc.debugger = {
    isAttached: () => true,
    async sendCommand(method, params = {}) {
      commands.push({ method, params });
      return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: `script-${++serial}` } : {};
    },
  };
  return { wc, commands };
}

test('controller installs main-world script, refreshes rules, restores and leaves debugger ownership alone', async () => {
  let rules = [{ host: 'example.com', focus: true }];
  const { wc, commands } = contents('https://example.com');
  const controller = new FocusController({ getRules: () => rules });
  await controller.attach(wc, 'tab-1');
  const initial = commands.find(command => command.method === 'Page.addScriptToEvaluateOnNewDocument');
  assert.equal(initial.params.worldName, undefined);
  assert.equal(commands.at(-1).params.enabled, true);
  const originalCount = commands.filter(command => command.method === 'Page.addScriptToEvaluateOnNewDocument').length;
  await controller.refresh('tab-1');
  assert.equal(commands.filter(command => command.method === 'Page.addScriptToEvaluateOnNewDocument').length, originalCount);
  rules = [];
  await controller.refresh('tab-1');
  assert.equal(commands.at(-1).params.enabled, false);
  assert.ok(commands.some(command => command.method === 'Page.removeScriptToEvaluateOnNewDocument'));
  assert.ok(wc.mainFrame.executions.includes(buildFocusScript([])));
  assert.match(wc.mainFrame.executions.at(-1), /dispatchEvent/);
  await controller.detach('tab-1');
  assert.equal(wc.eventNames().length, 0);
  assert.equal(controller.tabs.size, 0);
  assert.equal(commands.some(command => command.method.startsWith('Target.')), false);
});

test('top-level rules cover every frame and native emulation suspends on navigation away', async () => {
  let rules = [{ host: 'example.com', focus: true }];
  const { wc, commands } = contents('https://example.com', ['https://other.test']);
  const controller = new FocusController({ getRules: () => rules });
  await controller.attach(wc, 'tab');
  assert.equal(commands.at(-1).params.enabled, true);
  const child = wc.mainFrame.framesInSubtree[1];
  assert.ok(child.executions.some(script => script.startsWith('(() => { document.dispatchEvent')));
  rules = [...rules, { host: 'unrelated.test', focus: true }];
  await controller.refresh('tab');
  assert.equal(commands.at(-1).params.enabled, true);
  wc.emit('did-start-navigation');
  assert.equal(commands.at(-1).method, 'Emulation.setFocusEmulationEnabled');
  assert.equal(commands.at(-1).params.enabled, false);
  wc.mainFrame.url = 'https://unselected.test';
  await controller.refresh('tab');
  assert.equal(commands.at(-1).params.enabled, false);
  assert.equal(controller.getStatus('tab').status, 'inactive');
  assert.equal(controller.tabs.get('tab').appliedFrames.get(child), false);
  await controller.detach('tab');
});

test('DevTools debugger loss still restores the page and a later attach installs a fresh controller', async () => {
  const rules = [{ host: 'example.com', focus: true }];
  const { wc, commands } = contents('https://example.com');
  const fixture = page('https://example.com');
  let attached = true;
  wc.debugger.isAttached = () => attached;
  wc.mainFrame.executeJavaScript = async source => vm.runInContext(source, vm.createContext({
    document: fixture.document, window: fixture.window, URL,
  }));
  const controller = new FocusController({ getRules: () => rules });
  await controller.attach(wc, 'tab');
  assert.equal(fixture.document.hasFocus(), true);
  const originalListenerCount = wc.eventNames().reduce((count, name) => count + wc.listenerCount(name), 0);
  attached = false;
  const beforeDetach = commands.length;
  await controller.detach('tab');
  assert.equal(commands.length, beforeDetach, 'no CDP calls after the debugger disconnects');
  assert.equal(fixture.document.hasFocus(), false, 'restoration uses WebFrameMain even with no debugger');
  assert.equal(wc.eventNames().length, 0);
  attached = true;
  await controller.attach(wc, 'tab');
  assert.equal(fixture.document.hasFocus(), true);
  assert.equal(wc.eventNames().reduce((count, name) => count + wc.listenerCount(name), 0), originalListenerCount);
  assert.equal(commands.filter(command => command.method === 'Page.addScriptToEvaluateOnNewDocument').length, 2);
  await controller.detach('tab');
  assert.equal(fixture.document.hasFocus(), false);
});

test('prototype access agrees with selected document while other receivers stay native', () => {
  const fixture = page('https://example.com');
  const proto = Object.getPrototypeOf(fixture.document);
  const original = Object.getOwnPropertyDescriptors(proto);
  const otherDocument = Object.create(proto);
  otherDocument.location = { href: 'https://unselected.test' };
  fixture.apply([{ host: 'example.com', focus: true }]);
  assert.equal(proto.hasFocus.call(fixture.document), true);
  assert.equal(Object.getOwnPropertyDescriptor(proto, 'hidden').get.call(fixture.document), false);
  assert.equal(Object.getOwnPropertyDescriptor(proto, 'visibilityState').get.call(fixture.document), 'visible');
  assert.equal(proto.hasFocus.call(otherDocument), false);
  assert.equal(otherDocument.hidden, true);
  fixture.apply([]);
  assert.deepEqual(Object.getOwnPropertyDescriptors(proto), original);
});

test('embedded-only rules leave the top-level page and sibling frames unselected', async () => {
  const { wc, commands } = contents('https://unselected.test', ['https://example.com', 'https://sibling.test']);
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}] });
  await controller.attach(wc, 'frame-test');
  assert.equal(commands.at(-1).params.enabled, false);
  assert.equal(controller.getStatus('frame-test').status, 'inactive');
  for (const frame of [wc.mainFrame, wc.mainFrame.framesInSubtree[2]]) {
    assert.ok(frame.executions.every(script => !script.startsWith('(() => { document.dispatchEvent')));
  }
  assert.ok(wc.mainFrame.framesInSubtree[1].executions.some(script => script.startsWith('(() => { document.dispatchEvent')));
  await controller.detach('frame-test');
});

test('failed application or removal in an inherited cross-origin frame is reported', async () => {
  let rules = [{ host: 'example.com', focus: true }];
  const { wc } = contents('https://example.com', ['https://child.test']);
  const child = wc.mainFrame.framesInSubtree[1];
  const execute = child.executeJavaScript;
  const controller = new FocusController({ getRules: () => rules });
  child.executeJavaScript = async () => false;
  await assert.rejects(controller.attach(wc, 'tab'), /could not be applied/);
  assert.equal(controller.getStatus('tab').status, 'error');
  child.executeJavaScript = execute;
  await controller.refresh('tab');
  assert.equal(controller.getStatus('tab').status, 'active');
  rules = [];
  child.executeJavaScript = async () => { throw new Error('Child unavailable'); };
  await assert.rejects(controller.refresh('tab'), /Child unavailable/);
  assert.equal(controller.getStatus('tab').status, 'error');
  child.executeJavaScript = execute;
  await controller.refresh('tab');
  assert.equal(controller.getStatus('tab').status, 'inactive');
  await controller.detach('tab');
});

test('controller exposes applied state and reports missing controllers instead of successful activation', async () => {
  let rules = [{ host: 'example.com', focus: true }];
  const { wc } = contents('https://example.com');
  const updates = [];
  const controller = new FocusController({ getRules: () => rules, onStatus: (status, id) => updates.push({ ...status, id }) });
  assert.equal(controller.getStatus('missing').status, 'unavailable');
  await assert.rejects(controller.refresh('missing'), /not attached/);
  await controller.attach(wc, 'tab');
  assert.deepEqual(controller.getStatus('tab'), { status: 'active', error: '', warning: '' });
  assert.ok(updates.some(update => update.status === 'applying' && update.id === 'tab'));
  rules = [];
  await controller.refresh('tab');
  assert.equal(controller.getStatus('tab').status, 'inactive');
  await controller.detach('tab');
  assert.equal(controller.getStatus('tab').status, 'unavailable');
});

test('selected-frame injection failures are visible and a successful retry clears the error', async () => {
  const { wc } = contents('https://example.com');
  const errors = [];
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}], onError: error => errors.push(error) });
  await controller.attach(wc, 'tab');
  const originalExecute = wc.mainFrame.executeJavaScript;
  wc.mainFrame.executeJavaScript = async () => { throw new Error('Renderer unavailable'); };
  await assert.rejects(controller.refresh('tab'), /Renderer unavailable/);
  assert.equal(controller.getStatus('tab').status, 'error');
  assert.match(controller.getStatus('tab').error, /Renderer unavailable/);
  assert.equal(errors.length, 1);
  wc.mainFrame.executeJavaScript = originalExecute;
  await controller.refresh('tab');
  assert.deepEqual(controller.getStatus('tab'), { status: 'active', error: '', warning: '' });
  await controller.detach('tab');
});

test('unresponsive frame execution is bounded and does not leave activation pending forever', async () => {
  const { wc } = contents('https://example.com');
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}], executionTimeout: 20 });
  await controller.attach(wc, 'tab');
  const originalExecute = wc.mainFrame.executeJavaScript;
  wc.mainFrame.executeJavaScript = () => new Promise(() => {});
  await assert.rejects(controller.refresh('tab'), /did not respond/);
  assert.equal(controller.getStatus('tab').status, 'error');
  wc.mainFrame.executeJavaScript = originalExecute;
  await controller.detach('tab');
});

test('navigation invalidates pending activation before it can publish a stale active state', async () => {
  const { wc } = contents('https://example.com');
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}] });
  await controller.attach(wc, 'tab');
  const originalExecute = wc.mainFrame.executeJavaScript;
  let finish;
  wc.mainFrame.executeJavaScript = () => new Promise(resolve => { finish = resolve; });
  const applying = controller.refresh('tab');
  await new Promise(resolve => setImmediate(resolve));
  wc.emit('did-start-navigation');
  finish(true);
  await applying;
  assert.equal(controller.getStatus('tab').status, 'applying');
  wc.mainFrame.url = 'https://unselected.test';
  wc.mainFrame.executeJavaScript = originalExecute;
  await controller.refresh('tab');
  assert.equal(controller.getStatus('tab').status, 'inactive');
  await controller.detach('tab');
});

test('saving an unrelated rule does not emit extra focus notifications to an unchanged selected page', async () => {
  let rules = [{host:'example.com',focus:true}];
  const { wc, commands } = contents('https://example.com');
  const controller = new FocusController({ getRules: () => rules });
  await controller.attach(wc, 'tab');
  const commandCount = commands.length;
  const notifications = () => wc.mainFrame.executions.filter(source => source.startsWith('(() => { document.dispatchEvent')).length;
  assert.equal(notifications(), 1);
  rules = [...rules, {host:'other.test',focus:true}];
  await controller.refresh('tab');
  await controller.refresh('tab');
  assert.equal(notifications(), 1);
  const updates = commands.slice(commandCount).filter(command => command.method === 'Emulation.setFocusEmulationEnabled');
  assert.ok(updates.length > 0);
  assert.ok(updates.every(command => command.params.enabled), 'unrelated rule changes keep native focus continuously enabled');
  rules = [];
  await controller.refresh('tab');
  assert.equal(notifications(), 2);
  await controller.detach('tab');
});

test('unavailable native emulation is an explicit warning while document controls remain active', async () => {
  const { wc } = contents('https://example.com');
  const sendCommand = wc.debugger.sendCommand;
  wc.debugger.sendCommand = async (method, params) => {
    if (method === 'Emulation.setFocusEmulationEnabled') throw new Error('Unsupported');
    return sendCommand(method, params);
  };
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}] });
  await controller.attach(wc, 'tab');
  assert.equal(controller.getStatus('tab').status, 'active');
  assert.equal(controller.getStatus('tab').error, '');
  assert.match(controller.getStatus('tab').warning, /Native focus emulation is unavailable.*Unsupported/);
  await controller.detach('tab');
});

test('unexpected debugger loss is visible and is not reported as a successful refresh', async () => {
  const { wc } = contents('https://example.com');
  const debuggerEvents = new EventEmitter();
  wc.debugger.on = debuggerEvents.on.bind(debuggerEvents);
  wc.debugger.removeListener = debuggerEvents.removeListener.bind(debuggerEvents);
  let attached = true;
  wc.debugger.isAttached = () => attached;
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}] });
  await controller.attach(wc, 'tab');
  attached = false;
  debuggerEvents.emit('detach');
  assert.equal(controller.getStatus('tab').status, 'unavailable');
  await assert.rejects(controller.refresh('tab'), /disconnected/);
  assert.equal(controller.getStatus('tab').status, 'error');
  await controller.detach('tab');
  assert.equal(debuggerEvents.listenerCount('detach'), 0);
});

test('a selected document that did not accept its patch is reported as an activation failure', async () => {
  const { wc } = contents('https://example.com');
  wc.mainFrame.executeJavaScript = async () => false;
  const errors = [];
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}], onError: error => errors.push(error) });
  await assert.rejects(controller.attach(wc, 'tab'), /could not be applied/);
  assert.equal(controller.getStatus('tab').status, 'error');
  assert.equal(errors.length, 1, 'attach does not report the same refresh failure twice');
  await controller.detach('tab');
});

test('detaching during frame injection never publishes the stale completed activation', async () => {
  const { wc } = contents('https://example.com');
  const updates = [];
  const controller = new FocusController({ getRules: () => [{host:'example.com',focus:true}], onStatus: status => updates.push(status.status) });
  await controller.attach(wc, 'tab');
  const originalExecute = wc.mainFrame.executeJavaScript;
  let finish;
  wc.mainFrame.executeJavaScript = () => new Promise(resolve => { finish = resolve; });
  const applying = controller.refresh('tab');
  await new Promise(resolve => setImmediate(resolve));
  const detaching = controller.detach('tab');
  wc.mainFrame.executeJavaScript = originalExecute;
  const before = [...updates];
  finish(true);
  await Promise.all([applying, detaching]);
  assert.deepEqual(updates, before);
  assert.equal(controller.getStatus('tab').status, 'unavailable');
});
