'use strict';
const {chromium} = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// Exercise the actual renderer with a delayed desktop bridge. This makes the
// new-tab IPC race repeatable without modifying a real browser profile.
(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1000,height:760}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://prism-ui.local/**', async route => {
      const file = new URL(route.request().url()).pathname.slice(1) || 'index.html';
      if (!['index.html','app.js','styles.css'].includes(file)) return route.abort();
      await route.fulfill({body:fs.readFileSync(path.join(__dirname,'../renderer',file)), contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
    });
    await page.addInitScript(() => {
      const listeners = {};
      let nextId = 2;
      let state = {tabs:[{id:'tab-1',url:'about:blank',title:'New tab',zoom:1}],activeTabId:'tab-1',rules:[],bookmarks:[],history:[],downloads:[]};
      const publish = update => {state={...state,...update};listeners.state?.(structuredClone(state));};
      window.__prismUI = {publish, state:()=>state, emit:(name,data)=>listeners[name]?.(data)};
      window.prism = {
        on:(event, callback)=>{listeners[event]=callback;},
        invoke:async (action, payload={}) => {
          if (action==='get-state') return structuredClone(state);
          if (['network-list','cookies-list'].includes(action)) return [];
          if (action==='tab-new') {
            listeners.shortcut?.({action:'prepare-new-tab-search'});
            await new Promise(resolve=>setTimeout(resolve,220));
            const tab={id:`tab-${nextId++}`,url:'about:blank',title:'New tab',zoom:1};
            publish({tabs:[...state.tabs,tab],activeTabId:tab.id});
            listeners.shortcut?.({action:'new-tab-search',tabId:tab.id});
          } else if(action==='tab-activate') publish({activeTabId:payload.id});
          else if(action==='tab-close') {
            const index=state.tabs.findIndex(tab=>tab.id===payload.id);
            const tabs=state.tabs.filter(tab=>tab.id!==payload.id);
            const activeTabId=state.activeTabId===payload.id?tabs[index] ? tabs[index].id : tabs[index-1]?.id:state.activeTabId;
            publish({tabs,activeTabId});
          } else if(action==='tab-reorder') {
            const sourceIndex=state.tabs.findIndex(tab=>tab.id===payload.id);
            const targetIndex=payload.beforeId===null?-1:state.tabs.findIndex(tab=>tab.id===payload.beforeId);
            if(sourceIndex>=0 && (payload.beforeId===null || targetIndex>=0) && payload.id!==payload.beforeId) {
              const tabs=state.tabs.slice(), [source]=tabs.splice(sourceIndex,1);
              const insertAt=payload.beforeId===null?tabs.length:tabs.findIndex(tab=>tab.id===payload.beforeId);
              tabs.splice(insertAt,0,source);
              publish({tabs});
            }
          } else if(action==='navigate') publish({tabs:state.tabs.map(tab=>tab.id===state.activeTabId?{...tab,url:payload.url,title:payload.url}:tab)});
          else return;
          return structuredClone(state);
        }
      };
    });
    await page.goto('https://prism-ui.local/');
    await page.waitForFunction(()=>document.activeElement?.id==='home-address');
    await page.locator('#new-tab').click();
    await page.keyboard.type('fast typing');
    await page.waitForFunction(()=>document.activeElement?.id==='home-address'&&document.querySelector('#home-address').value==='fast typing');
    await page.evaluate(()=>window.__prismUI.publish({networkCount:42}));
    assert.equal(await page.locator('#home-address').inputValue(),'fast typing');
    await page.locator('#new-tab').click();
    await page.keyboard.type('prefix ');
    await page.evaluate(()=>{const address=document.querySelector('#address');address.blur();address.focus();});
    await page.keyboard.type('suffix');
    await page.waitForFunction(()=>document.activeElement?.id==='home-address'&&document.querySelector('#home-address').value==='prefix suffix');
    await page.keyboard.press('Control+t');
    await page.keyboard.type('shortcut draft');
    await page.waitForFunction(()=>document.activeElement?.id==='home-address'&&document.querySelector('#home-address').value==='shortcut draft');

    // Native website shortcut: shell is focused before the new state exists.
    await page.evaluate(()=>window.__prismUI.emit('shortcut',{action:'prepare-new-tab-search'}));
    await page.keyboard.type('native draft');
    await page.evaluate(()=>{
      const state=window.__prismUI.state(),tab={id:'native-tab',url:'about:blank',title:'New tab'};
      window.__prismUI.publish({tabs:[...state.tabs,tab],activeTabId:tab.id});
      window.__prismUI.emit('shortcut',{action:'new-tab-search',tabId:tab.id});
    });
    assert.equal(await page.locator('#home-address').inputValue(),'native draft');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'home-address');
    await page.locator('#new-tab').click();
    await page.keyboard.type('https://quick.example/');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>window.__prismUI.state().tabs.find(tab=>tab.id===window.__prismUI.state().activeTabId)?.url==='https://quick.example/');
    assert.equal(await page.evaluate(()=>window.__prismUI.state().tabs.find(tab=>tab.id==='native-tab').url),'about:blank','early Enter navigates only the newly created tab');

    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    await page.evaluate(png=>{
      const tabs=Array.from({length:30},(_,i)=>({id:`many-${i}`,url:`https://site${i}.example/page`,title:`Website ${i+1}`,favicon:png}));
      window.__prismUI.publish({tabs,activeTabId:'many-0'});
    },png);
    await page.waitForFunction(()=>[...document.querySelectorAll('.tab-favicon')].every(image=>!image.hidden&&image.naturalWidth>0));
    const geometry=await page.locator('.tab').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,right:r.right};}));
    assert.equal(new Set(geometry.map(r=>r.y)).size,1,'30 tabs remain on one row at 1000px');
    assert.ok(geometry.every(r=>r.width>=21&&r.x>=0&&r.right<=1000),'every compact tab stays visible');
    assert.equal(await page.locator('#tabs').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'tab strip does not require swiping');
    assert.equal(await page.locator('.tab-title').first().isVisible(),false,'densest tabs display icons only');
    await page.locator('[data-tab="many-29"]').click();
    assert.equal(await page.locator('[data-tab="many-29"]').getAttribute('aria-selected'),'true','favicon is a clickable tab target');
    assert.match(await page.locator('[data-tab="many-29"]').getAttribute('aria-label'),/Website 30/);
    assert.equal(await page.locator('[data-tab-id="many-29"] .tab-close').isVisible(),true,'selected compact tabs expose their close button');
    assert.equal(await page.locator('[data-tab-id="many-0"] .tab-close').isVisible(),false,'inactive compact tabs keep close buttons hidden');
    await page.locator('[data-tab="many-29"]').dragTo(page.locator('[data-tab="many-0"]'));
    await page.waitForFunction(()=>[...document.querySelectorAll('#tabs > .tab')].map(node=>node.dataset.tabId)[0]==='many-29');
    assert.equal(await page.locator('[data-tab="many-29"]').getAttribute('aria-selected'),'true','reordering preserves the active tab');
    assert.equal(await page.locator('[data-tab="many-29"] .tab-favicon').count(),1,'reordering preserves the tab contents');
    await page.locator('[data-tab="many-28"]').hover();
    assert.equal(await page.locator('[data-tab-id="many-28"] .tab-close').isVisible(),true,'hovered compact tabs expose their close button');
    const closeIcon=await page.locator('[data-tab-id="many-28"] .tab-close svg').boundingBox();
    await page.mouse.click(closeIcon.x+closeIcon.width/2,closeIcon.y+closeIcon.height/2);
    assert.equal(await page.locator('.tab').count(),29,'hover close removes an inactive tab without selecting it');
    assert.equal(await page.locator('[data-tab="many-29"]').getAttribute('aria-selected'),'true','closing an inactive tab keeps the active tab');
    await page.locator('[data-tab="many-15"]').click({button:'middle'});
    assert.equal(await page.locator('.tab').count(),28,'middle-click closes icon-only tabs');
    await page.keyboard.press('Control+w');
    assert.equal(await page.locator('.tab').count(),27,'Ctrl+W closes the selected icon-only tab');
    await page.locator('[data-tab="many-0"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-tab="many-1"]').getAttribute('aria-selected'),'true');

    await page.evaluate(()=>{
      window.__retainedIcon=document.querySelector('[data-tab="many-0"] .tab-favicon');
      const state=window.__prismUI.state();
      window.__prismUI.publish({tabs:state.tabs.map(tab=>tab.id==='many-0'?{...tab,loading:true,favicon:''}:tab)});
    });
    assert.equal(await page.evaluate(()=>window.__retainedIcon===document.querySelector('[data-tab="many-0"] .tab-favicon')&&!window.__retainedIcon.hidden&&window.__retainedIcon.naturalWidth>0),true,'reload retains the decoded image node');
    await page.evaluate(()=>{const state=window.__prismUI.state();window.__prismUI.publish({tabs:state.tabs.map(tab=>tab.id==='many-0'?{...tab,loading:false,favicon:'data:image/png;base64,broken'}:tab)});});
    await page.waitForFunction(()=>!document.querySelector('[data-tab="many-0"] .tab-favicon').dataset.source);
    assert.equal(await page.locator('[data-tab="many-0"] .tab-favicon').isVisible(),true,'failed replacement keeps the old icon');
    await page.evaluate(()=>{const state=window.__prismUI.state();window.__prismUI.publish({tabs:state.tabs.map(tab=>tab.id==='many-0'?{...tab,url:'https://site0.example:8443/page',favicon:''}:tab)});});
    assert.equal(await page.locator('[data-tab="many-0"] .tab-favicon').isVisible(),false,'same host on a different port clears the previous origin icon');
    await page.evaluate(png=>{const state=window.__prismUI.state();window.__prismUI.publish({tabs:state.tabs.map(tab=>tab.id==='many-0'?{...tab,favicon:png}:tab)});},png);
    await page.waitForFunction(()=>!document.querySelector('[data-tab="many-0"] .tab-favicon').hidden);
    await page.evaluate(()=>{const state=window.__prismUI.state();window.__prismUI.publish({tabs:state.tabs.map(tab=>tab.id==='many-0'?{...tab,url:'https://different.example/',favicon:''}:tab)});});
    assert.equal(await page.locator('[data-tab="many-0"] .tab-favicon').isVisible(),false,'cross-site navigation clears stale icon');

    await page.getByRole('button',{name:'Site controls and settings',exact:true}).click();
    await page.locator('#search-engine').focus();
    await page.evaluate(()=>window.__prismUI.publish({networkCount:43}));
    assert.equal(await page.evaluate(()=>document.activeElement.id),'search-engine','background state does not steal settings focus');
    await page.getByRole('button',{name:'Add a website',exact:true}).click();
    await page.locator('#rule-host').fill('draft.example');
    await page.evaluate(()=>window.__prismUI.publish({networkCount:44}));
    assert.equal(await page.evaluate(()=>document.activeElement.id),'rule-host','background state does not steal modal focus');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    if(process.env.PRISM_UI_SCREENSHOT) await page.screenshot({path:process.env.PRISM_UI_SCREENSHOT});

    await page.evaluate(png=>{
      const tabs=Array.from({length:70},(_,i)=>({id:`overflow-${i}`,url:`https://site${i}.example/`,title:`Website ${i+1}`,favicon:png}));
      window.__prismUI.publish({tabs,activeTabId:'overflow-0'});
    },png);
    await page.waitForFunction(()=>document.querySelector('#tabs').classList.contains('wrapped-tabs'));
    const wrapped=await page.locator('.tab').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right};}));
    assert.ok(new Set(wrapped.map(r=>r.y)).size>1,'larger tab counts wrap after reaching favicon-only width');
    assert.ok(wrapped.every(r=>r.x>=0&&r.right<=1000),'overflow rows remain inside the window');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:['new-tab immediate typing','pending draft survives native refocus','Ctrl+T draft retention','native shortcut focus handoff','early Enter targets the new tab','30 tabs at 1000px','compact selected and hovered close buttons','drag tab reorder with active/icon retention','middle-click and Ctrl+W close','arrow-key tab navigation','stable icon through reload','failed replacement fallback','cross-origin icon reset including port changes','settings/modal focus retention','70-tab wrap fallback','no renderer exceptions']}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
