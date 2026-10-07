'use strict';

// Native Chromium input tests against a local fixture; no production websites.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');

const project = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let app;
let shell;
let url;
let clipboard;
const cursorEvents = ['mouseenter','mouseleave','mouseover','mouseout','pointerenter','pointerleave','pointerover','pointerout'];
const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html' });
  response.end(`<!doctype html><html><head><style>
    body{margin:40px;font:20px sans-serif}input{font-size:20px;width:320px;margin:12px}
    #selection{user-select:none!important;display:inline-block}button{padding:16px}
  </style></head><body><input id="first"><input id="second"><p><span id="selection">Native selection survives</span></p><button id="button">Working button</button>
  <script>
    window.seen=[]; window.clicked=0;
    for(const type of ['keydown','keyup','keypress','selectionchange','selectstart','select','copy','cut','paste','blur','focusout','visibilitychange'])
      window.addEventListener(type,event=>window.seen.push({type,target:event.target.id||event.target.nodeName||'window'}),true);
    window.cursorSeen=[];
    for(const type of ${JSON.stringify(cursorEvents)}) {
      for(const target of [window,document,document.querySelector('#button')]) {
        for(const capture of [true,false]) target.addEventListener(type,event=>window.cursorSeen.push({type,trusted:event.isTrusted}),capture);
      }
      document.querySelector('#button')['on'+type]=event=>window.cursorSeen.push({type,trusted:event.isTrusted});
    }
    document.addEventListener('mousedown',event=>event.preventDefault());
    document.querySelector('#button').addEventListener('click',()=>window.clicked++);
    window.ready=true;
  </script></body></html>`);
});

async function wait(check, label) {
  let lastError;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const result = await check(); if (result) return result; } catch (error) { lastError = error; }
    await delay(75);
  }
  throw new Error(`Timed out: ${label}${lastError ? ` (${lastError.message})` : ''}`);
}
async function invoke(action, payload = {}) {
  return shell.evaluate(({action, payload}) => window.prism.invoke(action, payload), {action, payload});
}
async function page(expression) {
  return app.evaluate(async ({webContents}, {url, expression}) => {
    const wc = webContents.getAllWebContents().find(value => value.getURL() === url);
    return wc.executeJavaScript(expression, false);
  }, {url, expression});
}
async function input(events) {
  await app.evaluate(({webContents}, {url, events}) => {
    const wc = webContents.getAllWebContents().find(value => value.getURL() === url);
    wc.focus();
    for (const event of events) wc.sendInputEvent(event);
  }, {url, events});
  await delay(120);
}
async function key(keyCode, modifiers = []) {
  await input([{type:'keyDown',keyCode,modifiers}, {type:'keyUp',keyCode,modifiers}]);
}
async function click(selector) {
  const point = await page(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  await input([{type:'mouseDown',button:'left',clickCount:1,...point}, {type:'mouseUp',button:'left',clickCount:1,...point}]);
}
async function moveCursorAcrossButton() {
  const point = await page('(() => {const r=document.querySelector("#button").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  await input([{type:'mouseMove',x:1,y:1}]);
  await page('window.cursorSeen=[]');
  await input([{type:'mouseMove',...point}]);
  await input([{type:'mouseMove',x:1,y:1}]);
  await input([{type:'mouseLeave',x:1,y:1}]);
}
async function assertCursorRestored() {
  await moveCursorAcrossButton();
  const restored = await page('cursorSeen.filter(event=>event.trusted).map(event=>event.type)');
  for (const type of cursorEvents) assert.ok(restored.includes(type), `${type} restored after disabling`);
}
async function run() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'prism-spoof-'));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/fixture`;
    const env = {...process.env, PRISM_PROFILE:profile, DISPLAY:process.env.DISPLAY || ':0'};
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({executablePath:require('electron'),args:[project],env});
    shell = await app.firstWindow();
    await shell.waitForFunction(() => Boolean(window.prism));
    await wait(async () => (await invoke('get-state')).activeTabId, 'initial browser tab');
    await app.evaluate(async ({clipboard, ClipboardItem}) => {
      // Items returned by read() are live read handles, not writable snapshots.
      // Materialize every exposed format before tests alter either clipboard.
      // Keep payloads only in main-process memory, never in runner output/logs.
      // https://www.electronjs.org/docs/latest/api/clipboard-item
      const snapshot = async board => {
        const records = [];
        for (const item of await board.read()) {
          const record = Object.create(null);
          for (const type of item.types) {
            const payload = await item.getType(type);
            record[type] = type === 'electron application/bookmark'
              ? {title:payload.title, url:payload.url}
              : new Blob([await payload.arrayBuffer()], {type:payload.type});
          }
          // Empty clipboards can return one read item with no MIME types.
          if (Object.keys(record).length) records.push(record);
        }
        return records;
      };
      const same = async (expected, actual) => {
        if (expected.length !== actual.length) return false;
        for (let index = 0; index < expected.length; index++) {
          const a = expected[index], b = actual[index];
          const keys = Object.keys(a).sort();
          if (JSON.stringify(keys) !== JSON.stringify(Object.keys(b).sort())) return false;
          for (const type of keys) {
            if (type === 'electron application/bookmark') {
              if (a[type].title !== b[type].title || a[type].url !== b[type].url) return false;
            } else if (!Buffer.from(await a[type].arrayBuffer()).equals(Buffer.from(await b[type].arrayBuffer()))) return false;
          }
        }
        return true;
      };
      const saved = [{name:'system', board:clipboard, records:await snapshot(clipboard)}];
      if (clipboard.selection) saved.push({name:'selection', board:clipboard.selection, records:await snapshot(clipboard.selection)});
      globalThis.__prismRestoreTestClipboard = async () => {
        const results = await Promise.allSettled(saved.map(async ({name, board, records}) => {
          try {
            if (records.length) await board.write(records.map(record => new ClipboardItem(record)));
            else board.clear();
            if (!await same(records, await snapshot(board))) throw new Error('Not all clipboard formats round-tripped unchanged.');
          } catch (error) { throw new Error(`${name} clipboard: ${error.message}`); }
        }));
        const errors = results.filter(result => result.status === 'rejected').map(result => result.reason.message);
        if (errors.length) throw new Error(errors.join(' '));
      };
    });
    clipboard = true;
    // Verify preservation by writing only the original content before native
    // copy/paste or selection tests are allowed to put fixture text there.
    await app.evaluate(() => globalThis.__prismRestoreTestClipboard());
    if (process.env.PRISM_CLIPBOARD_CHECK_ONLY === '1') {
      console.log('PASS clipboard preservation round-trip for all exposed formats and supported selection clipboard');
      return;
    }
    await invoke('rules-save', {rules:[{host:'127.0.0.1',focus:true,monitor:false,includeSubdomains:false}]});
    await invoke('navigate', {url});
    await wait(() => page('window.ready'), 'fixture loaded');
    await wait(() => page('document.hasFocus() && !document.hidden'), 'mode applied');

    // The same rule refreshes after page listeners have been installed. It must
    // not move protection behind those listeners in the capture phase.
    await invoke('rules-save', {rules:[{host:'127.0.0.1',focus:true,monitor:false,includeSubdomains:false}]});
    await moveCursorAcrossButton();
    assert.deepEqual(await page('cursorSeen'), [], 'trusted cursor boundaries never reach capture, bubble or property handlers');
    await page('button.dispatchEvent(new MouseEvent("mouseenter"))');
    assert.equal(await page('cursorSeen.some(event=>event.type==="mouseenter" && !event.trusted)'), true, 'synthetic cursor events remain functional');
    console.log('PASS trusted mouse and pointer boundaries suppressed after repeated refresh');
    if (process.env.PRISM_CURSOR_CHECK_ONLY === '1') {
      await click('#button');
      assert.equal(await page('window.clicked'), 1, 'click handlers remain functional');
      await invoke('rules-save', {rules:[]});
      await assertCursorRestored();
      console.log('PASS native cursor boundaries restored on live opt-out and click handlers preserved');
      return;
    }
    await page('window.seen=[]');
    await click('#first');
    assert.equal(await page('document.activeElement.id'), 'first', 'mousedown cancellation cannot block native focus');
    await input(['a','b','c'].flatMap(keyCode => [{type:'keyDown',keyCode}, {type:'char',keyCode}, {type:'keyUp',keyCode}]));
    assert.equal(await page('document.querySelector("#first").value'), 'abc', 'native typing remains functional');
    await key('Control');
    await page('document.querySelector("#first").select()');
    assert.deepEqual(await page('({start:first.selectionStart,end:first.selectionEnd,direction:first.selectionDirection})'), {start:0,end:0,direction:'none'});
    await key('C', ['control']);
    assert.equal(await app.evaluate(({clipboard}) => clipboard.readText()), 'abc', 'native Ctrl+C sees the real selection');
    await page('first.value=""');
    await app.evaluate(({clipboard}) => clipboard.writeText('native paste'));
    await key('V', ['control']);
    assert.equal(await page('first.value'), 'native paste', 'native Ctrl+V still pastes');
    const blocked = await page('seen.filter(event=>["keydown","keyup","keypress","selectionchange","selectstart","select","copy","cut","paste"].includes(event.type))');
    assert.deepEqual(blocked, [], 'site capture listeners see no protected trusted events');
    console.log('PASS native typing, Control/C/V, selection masking and copy/paste after repeated refresh');

    await page('window.seen=[]');
    await click('#second');
    assert.equal(await page('seen.some(event=>event.type==="blur" && event.target==="first")'), true, 'internal input blur remains functional');
    await click('#button');
    assert.equal(await page('window.clicked'), 1, 'click handlers remain functional');
    console.log('PASS input focus transitions and normal button click handlers');

    const points = await page('(() => {const r=document.querySelector("#selection").getBoundingClientRect();return {x:Math.round(r.x+2),y:Math.round(r.y+r.height/2),end:Math.round(r.right-2)};})()');
    await input([{type:'mouseDown',button:'left',clickCount:1,x:points.x,y:points.y}]);
    for (let x = points.x + 10; x < points.end; x += 10) await input([{type:'mouseMove',button:'left',x,y:points.y}]);
    await input([{type:'mouseMove',button:'left',x:points.end,y:points.y},{type:'mouseUp',button:'left',clickCount:1,x:points.end,y:points.y}]);
    assert.equal(await page('getComputedStyle(document.querySelector("#selection")).userSelect'), 'text');
    assert.deepEqual(await page('({text:String(getSelection()),count:getSelection().rangeCount,anchor:getSelection().anchorNode})'), {text:'',count:0,anchor:null});
    assert.equal(await page('(() => {try{getSelection().getRangeAt(0);return "unexpected";}catch(error){return error.name;}})()'), 'IndexSizeError');
    await key('C', ['control']);
    assert.match(await app.evaluate(({clipboard}) => clipboard.readText()), /Native selection survives/, 'native mouse selection copies despite user-select:none');
    console.log('PASS native drag selection, CSS restriction override and hidden selection reads');

    await page('window.seen=[]');
    const state = await invoke('get-state');
    await invoke('tab-new');
    await delay(250);
    assert.deepEqual(await page('({focus:document.hasFocus(),hidden:document.hidden,visibility:document.visibilityState})'), {focus:true,hidden:false,visibility:'visible'});
    assert.deepEqual(await page('seen.filter(event=>["blur","focusout","visibilitychange"].includes(event.type))'), [], 'tab switching does not expose protected events');
    await invoke('tab-activate', {id:state.activeTabId});
    console.log('PASS selected page focus state across browser-tab switch');

    await page('window.seen=[]');
    const otherWindowId = await app.evaluate(({BrowserWindow}) => {
      const other = new BrowserWindow({width:320,height:200,show:true});
      other.focus();
      return other.id;
    });
    await delay(250);
    assert.deepEqual(await page('({focus:document.hasFocus(),hidden:document.hidden,visibility:document.visibilityState})'), {focus:true,hidden:false,visibility:'visible'});
    assert.deepEqual(await page('seen.filter(event=>["blur","focusout","visibilitychange"].includes(event.type))'), [], 'window switching does not expose protected events');
    await app.evaluate(({BrowserWindow}, id) => { BrowserWindow.fromId(id)?.close(); BrowserWindow.getAllWindows()[0]?.focus(); }, otherWindowId);
    console.log('PASS selected page focus state across native window switch');

    await invoke('rules-save', {rules:[]});
    await assertCursorRestored();
    assert.equal(await page('getComputedStyle(document.querySelector("#selection")).userSelect'), 'none', 'original selection style restored');
    assert.match(await page('(() => {const r=document.createRange();r.selectNodeContents(document.querySelector("#button"));getSelection().removeAllRanges();getSelection().addRange(r);return String(getSelection());})()'), /Working button/, 'native selected text becomes readable again');
    assert.equal(await page('first.focus();first.setSelectionRange(1,3);first.selectionEnd'), 3, 'native input selection becomes readable again');
    await page('first.focus();window.seen=[]');
    await key('Control');
    assert.equal(await page('seen.some(event=>event.type==="keydown")'), true, 'native listeners work after disabling');
    console.log('PASS complete live opt-out restoration');
  } finally {
    if (app) {
      if (clipboard) await app.evaluate(async () => {
        await globalThis.__prismRestoreTestClipboard();
        delete globalThis.__prismRestoreTestClipboard;
      }).catch(error => { console.warn(`Could not restore the test clipboard: ${error.message}`); process.exitCode = 1; });
      await app.close();
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
