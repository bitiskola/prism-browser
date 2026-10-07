'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');

// Hold desktop IPC open to reproduce repeated toggles and late state snapshots.
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1360,height:850}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://prism-ui.local/**',async route=>{
      const file=new URL(route.request().url()).pathname.slice(1)||'index.html';
      if(!['index.html','app.js','styles.css'].includes(file))return route.abort();
      await route.fulfill({body:fs.readFileSync(path.join(__dirname,'../renderer',file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
    });
    await page.addInitScript(()=>{
      const listeners={},calls=[];let pending;
      let state={tabs:[{id:'a',url:'https://focus.example/test',title:'Focus test',focusStatus:{status:'inactive',error:''}},{id:'b',url:'https://second.example/',title:'Other tab',focusStatus:{status:'inactive',error:''}}],activeTabId:'a',rules:[],bookmarks:[],history:[],downloads:[]};
      const publish=update=>{state={...state,...update};listeners.state?.(structuredClone(state));};
      window.__spoofUI={calls,publish,state:()=>state,
        settle:({reject=false,status='active',stale=false,restoreError=false}={})=>{
          const request=pending;pending=null;
          if(reject){request.reject(new Error('Fixture: rule save failed'));return;}
          const rules=request.action==='rules-save'?request.payload.rules:state.rules;
          const tabs=state.tabs.map(tab=>{const host=new URL(tab.url).hostname,configured=rules.some(rule=>rule.focus&&(rule.host===host||(rule.includeSubdomains&&host.endsWith('.'+rule.host))));return {...tab,focusStatus:{status:restoreError?'error':configured?status:'inactive',error:restoreError?'Fixture: restore failed':status==='error'?'Fixture: debugger unavailable':''}};});
          publish({rules,tabs});
          request.resolve(stale?{...structuredClone(state),activeTabId:request.started.activeTabId}:structuredClone(state));
        }
      };
      window.prism={on:(event,callback)=>listeners[event]=callback,invoke:async(action,payload={})=>{
        calls.push({action,payload});
        if(action==='get-state')return structuredClone(state);
        if(action==='network-list'||action==='cookies-list')return [];
        if(action==='rules-save'||action==='focus-retry')return new Promise((resolve,reject)=>{pending={action,payload,resolve,reject,started:structuredClone(state)};});
        if(action==='tab-activate')publish({activeTabId:payload.id});
      }};
    });
    await page.goto('https://prism-ui.local/');
    await page.waitForFunction(()=>document.querySelectorAll('.tab').length===2);
    const focus=page.locator('#focus-toggle');
    const calls=()=>page.evaluate(()=>window.__spoofUI.calls.filter(call=>call.action==='rules-save').length);
    const clearToasts=()=>page.evaluate(()=>document.querySelector('#toast-region').replaceChildren());
    const settle=options=>page.evaluate(options=>window.__spoofUI.settle(options),options);
    await focus.click();
    await page.evaluate(()=>{document.querySelector('#focus-toggle').click();document.querySelector('#focus-toggle').click();});
    assert.equal(await calls(),1,'rapid repeated clicks submit a single rule mutation');
    assert.equal(await focus.isDisabled(),true);
    assert.equal(await focus.getAttribute('aria-busy'),'true');
    assert.equal(await focus.getAttribute('aria-pressed'),'false','pending is not reported active');
    assert.match(await page.locator('#site-status').textContent(),/Applying spoof mode/);
    assert.equal(await page.locator('.toast').count(),0,'no success before controls apply');
    await page.getByRole('button',{name:'Site controls and settings',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Add a website',exact:true}).isDisabled(),true,'settings share the rule-save guard');
    await page.evaluate(()=>{const data=window.__spoofUI;data.publish({rules:data.calls.find(call=>call.action==='rules-save').payload.rules,tabs:data.state().tabs.map(tab=>tab.id==='a'?{...tab,focusStatus:{status:'applying',error:''}}:tab)});});
    assert.equal(await page.locator('[data-rule-switch][data-field="focus"]').isDisabled(),true,'newly rendered rule switch stays guarded');
    await settle();
    await page.waitForFunction(()=>document.querySelector('#focus-toggle').getAttribute('aria-pressed')==='true');
    assert.equal(await focus.isDisabled(),false);
    assert.match(await page.locator('.toast').last().textContent(),/Spoof mode active for focus.example/);

    // Failed disabling leaves the active state intact and never claims success.
    await clearToasts();await focus.click();await settle({reject:true});
    await page.waitForFunction(()=>!document.querySelector('#focus-toggle').disabled);
    assert.equal(await focus.getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('.toast.error').textContent(),/rule save failed/);
    assert.doesNotMatch(await page.locator('#toast-region').textContent(),/disabled for/);

    // A configured rule is not proof that its page controls were applied.
    await clearToasts();
    await page.evaluate(()=>{const data=window.__spoofUI;data.publish({tabs:data.state().tabs.map(tab=>tab.id==='a'?{...tab,focusStatus:{status:'error',error:'Fixture: debugger unavailable'}}:tab)});});
    assert.equal(await focus.getAttribute('aria-pressed'),'false');
    assert.equal(await page.locator('#focus-retry').isVisible(),true);
    assert.match(await page.locator('#site-status').textContent(),/debugger unavailable/);
    await focus.click();
    assert.equal(await page.evaluate(()=>window.__spoofUI.calls.filter(call=>call.action==='focus-retry').length),1);
    assert.equal(await calls(),2,'retry preserves the saved rule');
    await settle();await page.waitForFunction(()=>document.querySelector('#focus-toggle').getAttribute('aria-pressed')==='true');
    await clearToasts();await focus.click();await settle({restoreError:true});
    await page.waitForFunction(()=>!document.querySelector('#focus-toggle').disabled);
    assert.equal(await focus.getAttribute('aria-pressed'),'false');
    assert.match(await page.locator('#site-status').textContent(),/Could not turn off spoof mode/);
    assert.doesNotMatch(await page.locator('#toast-region').textContent(),/disabled for/,'runtime restoration failure cannot claim a successful disable');
    assert.equal(await page.locator('#focus-retry').isVisible(),true,'an off rule still offers restoration retry');
    await page.locator('#focus-retry').click();await settle();
    await page.waitForFunction(()=>!document.querySelector('#focus-toggle').disabled);
    assert.match(await page.locator('.toast').last().textContent(),/disabled for focus.example/);
    await page.evaluate(()=>{const data=window.__spoofUI;data.publish({rules:[{id:'suspended-rule',host:'focus.example',focus:true,monitor:false,includeSubdomains:false}],tabs:data.state().tabs.map(tab=>tab.id==='a'?{...tab,focusStatus:{status:'suspended',error:''}}:tab)});});
    assert.match(await page.locator('#site-status').textContent(),/close DevTools/);
    assert.equal(await focus.getAttribute('aria-pressed'),'false');

    // Switching tabs while saving must not redirect the rule or roll the UI back.
    await page.evaluate(()=>{const data=window.__spoofUI;data.publish({rules:[],tabs:data.state().tabs.map(tab=>({...tab,focusStatus:{status:'inactive',error:''}}))});});
    await clearToasts();await focus.click();
    await page.locator('[data-tab="b"]').click();
    assert.equal(await page.locator('[data-tab="b"]').getAttribute('aria-selected'),'true');
    await settle({stale:true});
    await page.waitForFunction(()=>!document.querySelector('#focus-toggle').disabled);
    assert.equal(await page.locator('[data-tab="b"]').getAttribute('aria-selected'),'true','late save response cannot undo selected tab');
    assert.equal(await focus.getAttribute('aria-pressed'),'false','another site never borrows saved tab status');
    assert.equal(await page.evaluate(()=>window.__spoofUI.state().rules[0].host),'focus.example','captured host is preserved');
    assert.match(await page.locator('.toast').textContent(),/focus.example/);

    // Modal submit uses the same serialization and remains usable after failure.
    await page.getByRole('button',{name:'Add a website',exact:true}).click();
    await page.locator('#rule-host').fill('modal.example');
    const countBefore=await calls();
    await page.locator('#rule-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
    assert.equal(await calls(),countBefore+1);
    assert.equal(await page.locator('#rule-host').isDisabled(),true);
    await settle({reject:true});
    await page.waitForFunction(()=>!document.querySelector('#rule-host').disabled);
    assert.equal(await page.locator('#modal').isVisible(),true);
    assert.equal(await page.locator('#rule-host').inputValue(),'modal.example');
    await page.getByRole('button',{name:'Cancel',exact:true}).click();

    // An attach failure while the saved rule is off must not trap the toolbar
    // in a retry-off loop. Its next click should save an enabled rule once.
    await page.evaluate(()=>{const data=window.__spoofUI;data.publish({activeTabId:'a',rules:[],tabs:data.state().tabs.map(tab=>tab.id==='a'?{...tab,focusStatus:{status:'error',error:'Fixture: initial attach failed'}}:tab)});});
    const beforeEnable=await calls(),beforeRetry=await page.evaluate(()=>window.__spoofUI.calls.filter(call=>call.action==='focus-retry').length);
    assert.equal(await focus.getAttribute('aria-label'),'Enable spoof mode for this site');
    await focus.click();await page.evaluate(()=>document.querySelector('#focus-toggle').click());
    assert.equal(await calls(),beforeEnable+1,'off/error toolbar enables exactly once');
    assert.equal(await page.evaluate(()=>window.__spoofUI.calls.filter(call=>call.action==='focus-retry').length),beforeRetry,'off/error toolbar does not retry an off rule');
    assert.equal(await page.evaluate(()=>window.__spoofUI.calls.filter(call=>call.action==='rules-save').at(-1).payload.rules.find(rule=>rule.host==='focus.example').focus),true);
    await settle();await page.waitForFunction(()=>document.querySelector('#focus-toggle').getAttribute('aria-pressed')==='true');

    // Old preview fixtures without runtime status keep their saved-rule behavior.
    await page.evaluate(()=>{const data=window.__spoofUI;data.publish({activeTabId:'a',tabs:data.state().tabs.map(({focusStatus,...tab})=>tab)});});
    assert.equal(await focus.getAttribute('aria-pressed'),'true');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({passed:true,checks:['serialized rapid toggles','pending amber status without false success','toolbar/settings shared guard','failed disable retains active state','runtime error shown with retry','retry leaves rule enabled','failed restoration remains visible and retryable','DevTools suspension message','tab and host preserved across delayed response','modal save guard and rejection recovery','initial off/error toolbar enables rule','preview compatibility','no renderer exceptions']}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
