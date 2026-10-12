'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let application, shell, profile, url;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(request.url === '/frame'
    ? '<textarea id="nested"></textarea>'
    : `<!doctype html><meta charset="utf-8"><title>Clipboard typing fixture</title>
      <form><input id="input"><textarea id="text"></textarea><button>Submit</button></form>
      <div id="editor" contenteditable="true"></div><iframe src="/frame"></iframe>
      <script>window.inputs = []; window.submits = 0;
      document.addEventListener('input', e => inputs.push({value:e.target.value, time:Date.now(), trusted:e.isTrusted}));
      document.querySelector('form').onsubmit = e => { e.preventDefault(); submits++; };</script>`);
});
async function wait(check, label, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await check()) return; await delay(30); }
  throw new Error(`Timed out: ${label}`);
}
const invoke = (action, payload = {}) => shell.evaluate(({action, payload}) => window.prism.invoke(action, payload), {action, payload});
const page = source => application.evaluate(({webContents}, {url, source}) => webContents.getAllWebContents().find(wc => wc.getURL() === url).executeJavaScript(source), {url, source});
async function shortcut(text) {
  await application.evaluate(async ({clipboard, BrowserWindow, webContents}, {url, text}) => {
    if (text !== null) await clipboard.writeText(text);
    BrowserWindow.getAllWindows()[0].focus();
    const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url);
    wc.focus();
    await new Promise(resolve => setTimeout(resolve, 150));
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
    wc.sendInputEvent({type:'keyDown', keyCode:'9', modifiers});
    wc.sendInputEvent({type:'keyUp', keyCode:'9', modifiers});
  }, {url, text});
}
(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-typing-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/`;
  try {
    const env = {...process.env, PRISM_PROFILE:profile}; delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({executablePath:require('electron'), args:[path.resolve(__dirname, '..')], env});
    await application.evaluate(async ({clipboard}) => { globalThis.__prismTypingClipboard = await clipboard.read(); });
    shell = await application.firstWindow();
    await shell.waitForFunction(() => Boolean(window.prism));
    await wait(async () => (await invoke('get-state')).activeTabId, 'initial tab');
    assert.equal((await invoke('get-state')).typing.speed, 1);
    await shell.locator('#proxy-shortcut').click();
    await shell.locator('[data-settings-section="typing"]').click();
    const slider = shell.getByRole('slider', {name:'Speed', exact:true});
    await slider.focus();
    await slider.press('ArrowRight');
    await wait(async () => (await invoke('get-state')).typing.speed === 1.25, 'keyboard speed change saved');
    assert.equal(await slider.getAttribute('aria-valuetext'), '1.25×');
    assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'browser-state.json'), 'utf8')).typing.speed, 1.25);
    await shell.screenshot({path:path.join(os.tmpdir(), 'prism-typing-settings.png')});
    await invoke('typing-save', {typing:{speed:1}});
    console.log('PASS accessible speed slider, keyboard adjustment and profile persistence');
    await invoke('navigate', {url});
    await wait(() => application.evaluate(({webContents}, url) => webContents.getAllWebContents().some(wc => wc.getURL() === url && !wc.isLoading()), url), 'fixture');
    await page('document.querySelector("#input").focus(); document.querySelector("#input").value="replace"; document.querySelector("#input").select()');
    await shortcut('Hi é👩🏽‍💻!');
    await wait(async () => await page('document.querySelector("#input").value') === 'Hi é👩🏽‍💻!', 'Unicode and selection');
    const inputs = await page('inputs');
    assert.equal(inputs.length, 6, 'one native input event per grapheme');
    assert.ok(inputs.every(event => event.trusted), 'native trusted input events');
    assert.ok(new Set(inputs.slice(1).map((event, i) => Math.round((event.time - inputs[i].time) / 10))).size > 1, 'varied timing');
    console.log('PASS native input events, Unicode graphemes, selection replacement, varied timing');

    await page('document.querySelector("#text").focus()');
    await shortcut('a\r\nb\tc');
    await wait(async () => await page('document.querySelector("#text").value') === 'a\nb\tc', 'multiline text');
    assert.equal(await page('submits'), 0);
    await page('document.querySelector("#editor").focus()');
    await shortcut('Edit');
    await wait(async () => await page('document.querySelector("#editor").textContent') === 'Edit', 'contenteditable');
    await page('document.querySelector("iframe").contentDocument.querySelector("textarea").focus()');
    await shortcut('Frame');
    await wait(async () => await page('document.querySelector("iframe").contentDocument.querySelector("textarea").value') === 'Frame', 'iframe editor');
    console.log('PASS multiline, tab characters, contenteditable and iframe without form submission');

    await page('document.querySelector("#input").value=""; document.querySelector("#input").focus()');
    await shortcut('long clipboard text that must stop');
    await wait(async () => (await page('document.querySelector("#input").value')).length >= 2, 'typing started');
    await application.evaluate(({webContents}, url) => webContents.getAllWebContents().find(wc => wc.getURL() === url).sendInputEvent({type:'keyDown', keyCode:'Escape'}), url);
    const stopped = await page('document.querySelector("#input").value');
    await delay(700);
    assert.equal(await page('document.querySelector("#input").value'), stopped);
    await shortcut('another long string');
    await shortcut(null);
    await delay(500);
    assert.equal(await page('document.querySelector("#input").value'), stopped);
    console.log('PASS Escape and shortcut toggle cancellation');

    await shortcut('must not leak into another tab');
    await invoke('tab-new');
    await delay(600);
    assert.equal(await page('document.querySelector("#input").value'), stopped);
    await shell.locator('#address').focus();
    await shell.locator('#address').fill('');
    await application.evaluate(async ({clipboard, BrowserWindow}) => { await clipboard.writeText('shell'); const win = BrowserWindow.getAllWindows()[0]; win.focus(); win.webContents.focus(); });
    await delay(150);
    await application.evaluate(({BrowserWindow}) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
      wc.sendInputEvent({type:'keyDown', keyCode:'9', modifiers});
      wc.sendInputEvent({type:'keyUp', keyCode:'9', modifiers});
    });
    await wait(async () => await shell.locator('#address').inputValue() === 'shell', 'shell field');
    console.log('PASS tab switch cancellation and address bar typing');
  } catch (error) {
    if (shell) console.error(await shell.evaluate(() => ({address:document.querySelector('#address').value, active:document.activeElement.id})).catch(() => null));
    if (application) console.error(await application.evaluate(async ({BrowserWindow, webContents}, url) => {
      const wc = webContents.getAllWebContents().find(wc => wc.getURL() === url);
      return {windowFocused:BrowserWindow.getAllWindows()[0].isFocused(), pageFocused:wc?.isFocused(), fields:wc && await wc.executeJavaScript('({input:document.querySelector("#input").value, text:document.querySelector("#text").value, active:document.activeElement.id})')};
    }, url).catch(() => null));
    console.error(error);
    throw error;
  } finally {
    if (application) {
      await application.evaluate(async ({clipboard}) => { if (globalThis.__prismTypingClipboard) await clipboard.write(globalThis.__prismTypingClipboard); }).catch(() => {});
      await application.close();
    }
    await new Promise(resolve => server.close(resolve));
    if (profile) await fs.rm(profile, {recursive:true, force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
