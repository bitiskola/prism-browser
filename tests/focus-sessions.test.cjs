'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { FocusController } = require('../electron/focus.cjs');
const { NetworkMonitor } = require('../electron/network.cjs');

function fixture() {
  const commands = [];
  const errors = [];
  const wc = new EventEmitter();
  const debuggerApi = new EventEmitter();
  const document = Object.create({ hasFocus() { return false; } });
  document.location = { href: 'https://selected.test/' };
  const listeners = new Map();
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  const context = vm.createContext({ document, window, URL, DOMException });
  const frame = {
    url: document.location.href,
    isDestroyed: () => false,
    async executeJavaScript(source) {
      if (source.startsWith('(() => { document.dispatchEvent')) return;
      return vm.runInContext(source, context);
    },
  };
  frame.framesInSubtree = [frame];
  wc.mainFrame = frame;
  wc.isDestroyed = () => false;
  wc.debugger = debuggerApi;
  debuggerApi.isAttached = () => true;
  let scriptSerial = 0;
  debuggerApi.sendCommand = async (method, params = {}, sessionId = '') => {
    const command = { method, params, sessionId };
    commands.push(command);
    if (method === 'Page.addScriptToEvaluateOnNewDocument') {
      command.identifier = `script-${++scriptSerial}`;
      return { identifier: command.identifier };
    }
    return {};
  };
  let rules = [{ host: 'selected.test', focus: true }];
  const makeController = (sessions = []) => new FocusController({
    getRules: () => rules,
    getFrameSessions: tabId => {
      assert.equal(tabId, 'tab');
      return sessions;
    },
    onError: error => errors.push(error),
  });
  return {
    wc, commands, errors, makeController,
    setRules(value) { rules = value; },
    attachSession(sessionId, type = 'iframe', parentSessionId = '') {
      debuggerApi.emit('message', {}, 'Target.attachedToTarget', {
        sessionId, targetInfo: { type, targetId: `target-${sessionId}` },
      }, parentSessionId);
    },
    detachSession(sessionId) {
      debuggerApi.emit('message', {}, 'Target.detachedFromTarget', { sessionId });
    },
  };
}

const commandsFor = (fixture, sessionId, method) => fixture.commands.filter(command =>
  command.sessionId === sessionId && command.method === method);

test('existing iframe sessions receive document scripts and native focus emulation', async () => {
  const f = fixture();
  const controller = f.makeController(['existing-frame']);
  try {
    await controller.attach(f.wc, 'tab');
    for (const sessionId of ['', 'existing-frame']) {
      assert.equal(commandsFor(f, sessionId, 'Page.enable').length, 1);
      const scripts = commandsFor(f, sessionId, 'Page.addScriptToEvaluateOnNewDocument');
      assert.equal(scripts.length, 1);
      assert.equal(scripts[0].params.worldName, undefined, 'website controls must run in the main world');
      assert.equal(commandsFor(f, sessionId, 'Emulation.setFocusEmulationEnabled').at(-1).params.enabled, true);
    }
    assert.deepEqual(controller.getStatus('tab'), { status: 'active', error: '', warning: '' });
    assert.equal(f.commands.some(command => command.method === 'Target.setAutoAttach'), false,
      'the focus controller must leave shared target auto-attachment to the network monitor');
  } finally { await controller.detach('tab'); }
});

test('new nested iframe sessions are initialized without a rule change while workers are ignored', async () => {
  const f = fixture();
  const controller = f.makeController();
  try {
    await controller.attach(f.wc, 'tab');
    const rootScript = commandsFor(f, '', 'Page.addScriptToEvaluateOnNewDocument')[0];
    f.attachSession('child');
    await controller.refresh('tab');
    f.attachSession('grandchild', 'iframe', 'child');
    f.attachSession('worker', 'worker');
    f.attachSession('shared-worker', 'shared_worker');
    await controller.refresh('tab');
    await controller.refresh('tab');
    for (const sessionId of ['child', 'grandchild']) {
      const scripts = commandsFor(f, sessionId, 'Page.addScriptToEvaluateOnNewDocument');
      assert.equal(scripts.length, 1, `${sessionId} should keep one script across unchanged refreshes`);
      assert.equal(scripts[0].params.source, rootScript.params.source);
      assert.equal(commandsFor(f, sessionId, 'Emulation.setFocusEmulationEnabled').at(-1).params.enabled, true);
    }
    assert.equal(commandsFor(f, '', 'Page.addScriptToEvaluateOnNewDocument').length, 1);
    assert.equal(f.commands.some(command => ['worker', 'shared-worker'].includes(command.sessionId)), false);
  } finally { await controller.detach('tab'); }
});

test('rule changes replace each iframe script and disabling clears native focus in every session', async () => {
  const f = fixture();
  const controller = f.makeController(['child']);
  try {
    await controller.attach(f.wc, 'tab');
    const originalScripts = new Map(['', 'child'].map(sessionId => [sessionId,
      commandsFor(f, sessionId, 'Page.addScriptToEvaluateOnNewDocument')[0].identifier]));
    f.setRules([]);
    await controller.refresh('tab');
    for (const sessionId of ['', 'child']) {
      assert.ok(commandsFor(f, sessionId, 'Page.removeScriptToEvaluateOnNewDocument')
        .some(command => command.params.identifier === originalScripts.get(sessionId)));
      assert.equal(commandsFor(f, sessionId, 'Page.addScriptToEvaluateOnNewDocument').length, 2);
      assert.equal(commandsFor(f, sessionId, 'Emulation.setFocusEmulationEnabled').at(-1).params.enabled, false);
    }
    assert.equal(controller.getStatus('tab').status, 'inactive');
  } finally { await controller.detach('tab'); }
});

test('detached iframe sessions are no longer used and controller detach restores surviving sessions', async () => {
  const f = fixture();
  const controller = f.makeController(['gone', 'remaining']);
  await controller.attach(f.wc, 'tab');
  assert.equal(f.wc.debugger.listenerCount('message'), 1);
  f.detachSession('gone');
  const before = f.commands.length;
  await controller.refresh('tab');
  const remainingScripts = new Map(['', 'remaining'].map(sessionId => [sessionId,
    commandsFor(f, sessionId, 'Page.addScriptToEvaluateOnNewDocument').at(-1).identifier]));
  await controller.detach('tab');
  assert.equal(f.commands.slice(before).some(command => command.sessionId === 'gone'), false);
  for (const sessionId of ['', 'remaining']) {
    assert.equal(commandsFor(f, sessionId, 'Emulation.setFocusEmulationEnabled').at(-1).params.enabled, false);
    assert.ok(commandsFor(f, sessionId, 'Page.removeScriptToEvaluateOnNewDocument')
      .some(command => command.params.identifier === remainingScripts.get(sessionId)));
  }
  assert.equal(f.wc.debugger.listenerCount('message'), 0);
  assert.equal(f.wc.debugger.listenerCount('detach'), 0);
  assert.equal(f.wc.eventNames().length, 0);
});

test('native emulation failure in a live iframe is visible as a warning and clears on retry', async () => {
  const f = fixture();
  const sendCommand = f.wc.debugger.sendCommand;
  let failChild = true;
  f.wc.debugger.sendCommand = async (method, params, sessionId) => {
    if (failChild && sessionId === 'child' && method === 'Emulation.setFocusEmulationEnabled') {
      throw new Error('Child emulation unavailable');
    }
    return sendCommand(method, params, sessionId);
  };
  const controller = f.makeController(['child']);
  try {
    await controller.attach(f.wc, 'tab');
    assert.equal(controller.getStatus('tab').status, 'active');
    assert.match(controller.getStatus('tab').warning, /Child emulation unavailable/);
    failChild = false;
    await controller.refresh('tab');
    assert.deepEqual(controller.getStatus('tab'), { status: 'active', error: '', warning: '' });
  } finally { await controller.detach('tab'); }
});

test('a child detached during script installation does not leave activation in an error state', { timeout: 2000 }, async () => {
  const f = fixture();
  const controller = f.makeController();
  const sendCommand = f.wc.debugger.sendCommand;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  let rejectInstallation;
  f.wc.debugger.sendCommand = (method, params, sessionId) => {
    if (sessionId === 'fleeting' && method === 'Page.addScriptToEvaluateOnNewDocument') {
      signalStarted();
      return new Promise((_, reject) => { rejectInstallation = reject; });
    }
    return sendCommand(method, params, sessionId);
  };
  try {
    await controller.attach(f.wc, 'tab');
    f.attachSession('fleeting');
    const refreshing = controller.refresh('tab');
    await started;
    f.detachSession('fleeting');
    rejectInstallation(new Error('No session with given id'));
    await refreshing;
    assert.equal(controller.getStatus('tab').status, 'active');
    assert.equal(controller.getStatus('tab').warning, '');
    assert.deepEqual(f.errors, []);
  } finally {
    rejectInstallation?.(new Error('Fixture cleanup'));
    await controller.detach('tab');
  }
});

test('network iframe registry survives capture epochs and bootstraps focus before clearing on disconnect', async () => {
  const f = fixture();
  f.wc.getURL = () => f.wc.mainFrame.url;
  const monitor = new NetworkMonitor();
  const controller = new FocusController({
    getRules: () => [{ host: 'selected.test', focus: true }],
    getFrameSessions: tabId => monitor.getFrameSessions(tabId),
  });
  const attach = (sessionId, type = 'iframe', parentSessionId = '') => monitor.handleMessage('tab',
    'Target.attachedToTarget', { sessionId, targetInfo: { type } }, parentSessionId);
  try {
    await monitor.attach(f.wc, 'tab');
    await attach('initial');
    f.wc.emit('did-start-navigation', {
      url: 'https://selected.test/next', isMainFrame: true, isSameDocument: false,
    });
    await attach('during-navigation');
    await monitor.handleMessage('tab', 'Page.frameNavigated', {
      frame: { id: 'main', url: 'https://selected.test/next', loaderId: 'next-loader' },
    });
    await attach('under-stale-parent', 'iframe', 'initial');
    await attach('worker', 'worker');
    assert.deepEqual(monitor.getFrameSessions('tab'), ['initial', 'during-navigation', 'under-stale-parent']);
    assert.equal(monitor.tabs.get('tab').sessions.has('during-navigation'), false,
      'capture epoch filtering remains independent of iframe connection tracking');
    assert.equal(monitor.tabs.get('tab').sessions.has('under-stale-parent'), false);
    await controller.attach(f.wc, 'tab');
    for (const sessionId of monitor.getFrameSessions('tab')) {
      assert.equal(commandsFor(f, sessionId, 'Page.addScriptToEvaluateOnNewDocument').length, 1);
      assert.equal(commandsFor(f, sessionId, 'Emulation.setFocusEmulationEnabled').at(-1).params.enabled, true);
    }
    f.detachSession('during-navigation');
    assert.deepEqual(monitor.getFrameSessions('tab'), ['initial', 'under-stale-parent']);
    f.wc.debugger.emit('detach', {}, 'target closed');
    assert.deepEqual(monitor.getFrameSessions('tab'), []);
    assert.equal(controller.getStatus('tab').status, 'unavailable');
  } finally {
    await controller.detach('tab');
    monitor.detach('tab');
  }
  assert.deepEqual(monitor.getFrameSessions('tab'), []);
  assert.equal(f.wc.debugger.listenerCount('message'), 0);
});
