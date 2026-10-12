'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ClipboardTyping } = require('../electron/clipboard-typing.cjs');

function fixture(readText) {
  const messages = [], inserted = [];
  const wc = new EventEmitter();
  wc.insertText = async text => inserted.push(text);
  const typing = new ClipboardTyping({readText, canType:() => true, notify:message => messages.push(message)});
  typing.attach(wc);
  return {typing, wc, messages, inserted};
}

test('asynchronous clipboard read can be cancelled without starting a stale run', async () => {
  let resolve;
  const {typing, wc, inserted} = fixture(() => new Promise(done => {resolve = done;}));
  const pending = typing.toggle(wc);
  assert.ok(typing.run);
  await typing.toggle(wc);
  resolve('clipboard');
  await pending;
  assert.equal(typing.run, null);
  assert.deepEqual(inserted, []);
});

test('empty clipboard and rejected reads are handled without throwing', async () => {
  for (const readText of [async () => '', async () => {throw new Error('read failed');}]) {
    const {typing, wc, messages} = fixture(readText);
    await typing.toggle(wc);
    assert.equal(typing.run, null);
    assert.equal(messages.length, 1);
  }
});

test('manual input and page lifecycle changes cancel pending clipboard reads', async () => {
  for (const event of ['did-start-navigation', 'blur', 'destroyed', 'render-process-gone', 'before-mouse-event', 'before-input-event']) {
    let resolve;
    const {typing, wc} = fixture(() => new Promise(done => {resolve = done;}));
    const pending = typing.toggle(wc);
    wc.emit(event, {preventDefault() {}}, {type:event === 'before-mouse-event' ? 'mouseDown' : 'keyDown', key:'Tab'});
    resolve('clipboard');
    await pending;
    assert.equal(typing.run, null, event);
  }
});

test('timing has jitter and longer punctuation pauses', () => {
  const {typing} = fixture(async () => '');
  typing.random = () => 0.5;
  assert.ok(typing.delay('.') > typing.delay(' '));
  assert.ok(typing.delay(' ') > typing.delay('a'));
  const first = typing.delay('a');
  typing.random = () => 0.8;
  assert.notEqual(typing.delay('a'), first);
});

test('speed scales character timing and pauses while preserving randomness', () => {
  const {typing} = fixture(async () => '');
  typing.random = () => 0.5;
  const normal = typing.delay('a'), punctuation = typing.delay('.');
  typing.getSpeed = () => 2;
  assert.equal(typing.delay('a'), Math.round(normal / 2));
  assert.equal(typing.delay('.'), Math.round(punctuation / 2));
  typing.random = () => 0.8;
  assert.notEqual(typing.delay('a'), Math.round(normal / 2));
  typing.getSpeed = () => 0.25;
  typing.random = () => 0.5;
  assert.equal(typing.delay('a'), normal * 4);
});
