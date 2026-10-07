const icons = {
  route:'M5 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4M19 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4M7 6h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8', 'chevron-down':'m7 10 5 5 5-5',
  plus:'M12 5v14M5 12h14',minus:'M5 12h14',close:'m6 6 12 12M18 6 6 18',square:'M5 5h14v14H5z',
  'arrow-left':'m12 5-7 7 7 7M5 12h14','arrow-right':'m12 5 7 7-7 7M5 12h14','arrow-up':'m5 12 7-7 7 7M12 5v14','arrow-down':'m5 12 7 7 7-7M12 5v14','arrow-up-right':'M6 18 18 6M6 6h12v12',
  reload:'M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 12a8 8 0 0 0-1-5',search:'M21 21l-5-5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',
  star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',bookmark:'M6 4h12v17l-6-4-6 4Z',
  focus:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  panel:'M3 4h18v16H3zM15 4v16',activity:'M3 12h4l3-8 4 16 3-8h4',history:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-16-2 20',
  settings:'m9 3 1-1h4l1 3 3 1 3 1v4l-2 1v3l1 3-3 2-3-1-3 1-2 1-3-2v-3l-1-3-2-2 2-3 2 1 2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  sliders:'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6',lock:'M6 10h12v11H6zM8 10V7a4 4 0 1 1 8 0v3',globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  pause:'M8 5v14M16 5v14',play:'m6 3 15 9-15 9Z',trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',export:'M12 15V3m-5 5 5-5 5 5M4 14v7h16v-7',cookie:'M20 12a8 8 0 1 1-8-8c0 3 1 4 4 4 0 3 1 4 4 4M8 9h.01M7 14h.01M12 17h.01M12 12h.01',
  check:'m5 12 4 4L19 6',alert:'m12 3 10 18H2Zm0 6v5m0 3h.01',stop:'M5 5h14v14H5z',folder:'M3 6h7l2 3h9v12H3z',edit:'m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z',wifi:'M3 7a15 15 0 0 1 18 0M6 11a10 10 0 0 1 12 0M9 15a5 5 0 0 1 6 0M12 19h.01',circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',prism:'m12 3 10 18H2zM12 3l2 18M2 21l13-10',
};
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.globe}"/></svg>`;
const paintIcons = (scope = document) => $$('[data-icon]', scope).forEach(el => { el.innerHTML = icon(el.dataset.icon); });
const uid = () => crypto.randomUUID();
const preview = !window.prism;
const defaultSearch={engine:'duckduckgo',customTemplate:''};
const defaultProxy={enabled:false,type:'http',host:'',port:8080,bypass:'localhost,127.0.0.1,[::1]',credentialStatus:'none',active:false,error:''};
const defaultAdblock={enabled:true,allowlist:[],blocklist:[],blockedCount:0,ready:false,error:'',engineName:'Adblock Plus core'};
const searchEngines={duckduckgo:['DuckDuckGo','https://duckduckgo.com/?q={query}'],google:['Google','https://www.google.com/search?q={query}'],bing:['Bing','https://www.bing.com/search?q={query}'],brave:['Brave Search','https://search.brave.com/search?q={query}'],startpage:['Startpage','https://www.startpage.com/sp/search?query={query}'],custom:['Custom search engine','']};
const settingsDrafts={};
let state = { tabs:[],activeTabId:null,bookmarks:[],history:[],downloads:[],rules:[],profilePath:'',networkPaused:false,networkCount:0,search:{...defaultSearch},proxy:{...defaultProxy},adblock:{...defaultAdblock} };
let pane = 'network';
let entries = [];
let selectedEntry = null;
let detailTab = 'overview';
let requestFilter = '';
let typeFilter = 'All';
let detailLoading = false;
const captureStatus = new Map();
let viewportTimer;
let lastBounds = '';
let lastHomeSignature = '';
let paneSignature = '';
let pendingNewTabSearch = null;
let requestedSearchTabId = null;
let pendingRulesSave = null;
let stateEventVersion = 0;
const activeTab = () => state.tabs.find(tab => tab.id === state.activeTabId);
const isHome = () => !activeTab()?.url || activeTab().url === 'about:blank' || activeTab().url === 'prism://newtab';
const hostname = url => { try { return new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; } };
const safeURL = (value, search=state.search) => { const text = String(value).trim(); if (!text) return 'about:blank'; if (/^https?:\/\//i.test(text)) return text; if (/^localhost(?::\d+)?(?:\/|$)/i.test(text) || /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text)) return `https://${text}`; const template=search?.engine==='custom'?search.customTemplate:searchEngines[search?.engine]?.[1]||searchEngines.duckduckgo[1]; return template.replaceAll('{query}',encodeURIComponent(text)); };
const sizeLabel = value => !Number.isFinite(Number(value)) ? '—' : Number(value) < 1024 ? `${Number(value)} B` : Number(value) < 1048576 ? `${(Number(value)/1024).toFixed(1)} KB` : `${(Number(value)/1048576).toFixed(1)} MB`;
const dateLabel = value => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString([], { month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' }); };
const rulesFor = url => { const host = hostname(url); return state.rules.filter(rule => host === rule.host || (rule.includeSubdomains && host.endsWith(`.${rule.host}`))); };
function focusState(tab=activeTab()) {
  const configured=rulesFor(tab?.url).some(rule=>rule.focus);
  const pending=pendingRulesSave?.tabId===tab?.id && pendingRulesSave?.url===tab?.url && pendingRulesSave?.focus!==undefined;
  if(pending)return {configured,status:'applying',error:'',message:pendingRulesSave.focus?'Applying spoof mode…':'Turning off spoof mode…'};
  const runtime=tab?.focusStatus || {status:tab?.focusError?'error':configured?'active':'inactive',error:tab?.focusError||''};
  const status=configured||runtime.status==='error'?runtime.status:'inactive';
  const messages={inactive:'Spoof mode is off',applying:'Applying spoof mode…',active:'Spoof mode active for this site',error:'Spoof mode could not be applied',unavailable:'Spoof mode is unavailable',suspended:'Spoof mode paused · close DevTools to resume'};
  return {configured,status,error:runtime.error||'',warning:runtime.warning||'',message:!configured&&status==='error'?'Could not turn off spoof mode · retry or reload this page':messages[status]||messages.unavailable};
}
function renderRulePending() {
  const pending=Boolean(pendingRulesSave);
  $$('[data-rule-switch],[data-remove-rule],[data-edit-rule],[data-action="add-rule"],#rule-form input,#rule-form button[type="submit"]').forEach(button=>{button.disabled=pending;});
  $('#rule-form')?.setAttribute('aria-busy',String(pending));
}
function toast(message, error = false) { const item = document.createElement('div'); item.className = `toast${error ? ' error' : ''}`; item.textContent = typeof message === 'string' ? message : message?.message || 'Done'; $('#toast-region').append(item); setTimeout(() => item.remove(), 4800); }

function makePreviewBridge() {
  let saved; try { saved = JSON.parse(localStorage.getItem('prism-preview') || '{}'); } catch { saved = {}; }
  const data = { tabs:[{id:uid(),url:'about:blank',title:'New tab',loading:false,zoom:1}],activeTabId:null,bookmarks:saved.bookmarks || [],history:saved.history || [],rules:saved.rules || [],downloads:[],profilePath:'Desktop preview · settings stored in this browser',networkPaused:false,networkCount:0,search:{...defaultSearch,...saved.search},proxy:{...defaultProxy,...saved.proxy,active:false,credentialStatus:'none'},adblock:{...defaultAdblock,...saved.adblock,ready:false,blockedCount:0} }; data.activeTabId = data.tabs[0].id;
  const listeners = {};
  const publish = () => { const {enabled,type,host,port,bypass}=data.proxy;localStorage.setItem('prism-preview', JSON.stringify({bookmarks:data.bookmarks,history:data.history,rules:data.rules,search:data.search,proxy:{enabled,type,host,port,bypass},adblock:{enabled:data.adblock.enabled,allowlist:data.adblock.allowlist,blocklist:data.adblock.blocklist}})); listeners.state?.(structuredClone(data)); };
  return { on(event, callback) { listeners[event] = callback; },async invoke(action, payload = {}) {
    const current = data.tabs.find(tab => tab.id === data.activeTabId);
    switch (action) {
      case 'get-state': return structuredClone(data);
      case 'tab-new': { const tab = {id:uid(),url:payload.url ? safeURL(payload.url) : 'about:blank',title:'New tab',zoom:1}; data.tabs.push(tab);data.activeTabId=tab.id;break; }
      case 'tab-close': data.tabs=data.tabs.filter(tab=>tab.id!==payload.id); if (!data.tabs.length) data.tabs.push({id:uid(),url:'about:blank',title:'New tab',zoom:1}); if(!data.tabs.some(tab=>tab.id===data.activeTabId)) data.activeTabId=data.tabs.at(-1).id;break;
      case 'tab-activate': data.activeTabId=payload.id;break;
      case 'navigate': current.url=safeURL(payload.url);current.title=hostname(current.url)||'New tab';break;
      case 'rules-save': data.rules=payload.rules;break;
      case 'search-save': data.search={...payload.search};break;
      case 'proxy-save': {const {enabled,type,host,port,bypass}=payload.proxy;data.proxy={...defaultProxy,enabled,type,host,port,bypass};break;}
      case 'adblock-save': data.adblock={...data.adblock,...payload.adblock};break;
      case 'bookmark-toggle': if (current.url==='about:blank') return; { const index=data.bookmarks.findIndex(item=>item.url===current.url); if(index<0) data.bookmarks.push({url:current.url,title:current.title});else data.bookmarks.splice(index,1); } break;
      case 'history-clear': data.history=[];break;
      case 'network-pause': data.networkPaused=payload.paused;break;
      case 'network-list': case 'cookies-list': case 'downloads-list': return [];
      case 'cookies-export': case 'cookies-import':
        toast('Cookie export and import are available in the desktop app.');
        return {ok:false, canceled:true, unavailable:true};
      case 'network-clear': return {ok:true};
      case 'network-export': toast('Open the desktop app to capture and export real network traffic.');return;
      case 'viewport': return;
      case 'zoom': current.zoom=Math.max(.25,Math.min(3,(current.zoom||1)+payload.delta));break;
      default: toast('This control is available in the desktop app.');return;
    } publish(); return structuredClone(data);
  } };
}
const bridge = window.prism || makePreviewBridge();
async function invoke(action, payload) { try { const result = await bridge.invoke(action, payload); if (result?.error && !result?.tabs) throw new Error(typeof result.error==='string' ? result.error : result.error.message || 'The action could not be completed.'); return result; } catch (error) { toast(error.message || 'Something went wrong.', true); return undefined; } }
function requestViewport() { clearTimeout(viewportTimer);viewportTimer=setTimeout(sendViewport, 30); }
function sendViewport() { const rect=$('#viewport').getBoundingClientRect();const bounds={x:Math.round(rect.x),y:Math.round(rect.y),width:Math.max(0,Math.floor(rect.width)),height:Math.max(0,Math.floor(rect.height)),visible:!isHome() && !$('#modal').open && !activeTab()?.error && !preview}; const signature=JSON.stringify(bounds);if(signature===lastBounds)return;lastBounds=signature;invoke('viewport',bounds); }

function renderState(next) {
  if (!next || !Array.isArray(next.tabs)) return;
  const previousIds = new Set(state.tabs.map(tab => tab.id));
  if(next.activeTabId!==state.activeTabId)lastBounds='';
  state = {...state,...next}; state.rules ||= [];state.bookmarks ||= [];state.history ||= [];state.downloads ||= [];
  state.search={...defaultSearch,...state.search};state.proxy={...defaultProxy,...state.proxy};state.adblock={...defaultAdblock,...state.adblock};
  renderTabs();renderChrome();renderHome();
  const signature=JSON.stringify([pane,state.rules,state.downloads,state.bookmarks,state.history,state.activeTabId,activeTab()?.url,state.networkPaused,state.profilePath,state.search,state.proxy,{enabled:state.adblock.enabled,allowlist:state.adblock.allowlist,blocklist:state.adblock.blocklist}]);
  if(signature!==paneSignature){paneSignature=signature;renderPane();}
  if(pane==='settings')renderSettingsStatus();
  renderRulePending();
  if (isHome() && (!previousIds.has(state.activeTabId) || requestedSearchTabId === state.activeTabId)) focusNewTabSearch(state.activeTabId);
  requestViewport();
}
function renderTabs() {
  const strip = $('#tabs');
  const existing = new Map([...strip.children].map(node => [node.dataset.tabId, node]));
  state.tabs.forEach((tab, index) => {
    let node = existing.get(tab.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'tab';node.dataset.tabId = tab.id;node.setAttribute('role', 'presentation');
      node.innerHTML = `<button class="tab-label" role="tab"><span class="tab-symbol"><span class="tab-fallback"></span><img class="tab-favicon" alt="" aria-hidden="true" hidden></span><span class="tab-title"></span></button><button class="tab-close" title="Close tab">${icon('close')}</button>`;
    }
    existing.delete(tab.id);
    const selected = tab.id === state.activeTabId;
    const label = $('.tab-label', node), image = $('.tab-favicon', node);
    const title = tab.title || hostname(tab.url) || 'New tab';
    node.classList.toggle('active', selected);node.classList.toggle('loading', !!tab.loading);
    label.dataset.tab = tab.id;label.setAttribute('aria-selected', String(selected));label.setAttribute('aria-label', title);label.tabIndex = selected ? 0 : -1;
    label.title = `${title}${tab.url && tab.url !== 'about:blank' ? `\n${tab.url}` : ''}\nMiddle-click to close · Ctrl+W closes the active tab`;
    $('.tab-title', node).textContent = title;
    const close = $('.tab-close', node);close.dataset.closeTab = tab.id;close.setAttribute('aria-label', `Close ${title}`);close.tabIndex = selected ? 0 : -1;
    const fallback = tab.loading ? 'reload' : hostname(tab.url) ? 'globe' : 'prism';
    const fallbackNode = $('.tab-fallback', node);
    if (fallbackNode.dataset.icon !== fallback) {fallbackNode.dataset.icon = fallback;fallbackNode.innerHTML = icon(fallback);}
    let site = '';
    try {const url = new URL(tab.url);if (url.protocol === 'http:' || url.protocol === 'https:') site = url.origin;} catch {}
    if (node.dataset.site !== site) {image.hidden = true;image.removeAttribute('src');delete image.dataset.source;node.classList.remove('has-favicon');}
    node.dataset.site = site;
    // The main process fetches icons through the browsing session and supplies local
    // image data. Keep the previous decoded icon until its replacement is ready.
    const source = /^data:image\/png(?:;|,)/i.test(String(tab.favicon || '')) ? tab.favicon : '';
    if (source && source !== image.dataset.source) {
      image.dataset.source = source;
      const candidate = new Image();
      candidate.onload = () => {if (image.dataset.source !== source) return;image.src = source;image.hidden = false;node.classList.add('has-favicon');};
      candidate.onerror = () => {if (image.dataset.source === source) delete image.dataset.source;};
      candidate.src = source;
    }
    if (strip.children[index] !== node) strip.insertBefore(node, strip.children[index] || null);
  });
  existing.forEach(node => node.remove());
  strip.style.width = `${state.tabs.length * 223}px`;
  updateTabDensity();
}
function updateTabDensity() {
  const strip = $('#tabs'), count = state.tabs.length || 1;
  const available = strip.getBoundingClientRect().width;
  const width = available / count;
  strip.classList.toggle('compact-tabs', width < 105);
  strip.classList.toggle('icon-tabs', width < 48);
  const wrapped = count * 22 > available + 1;
  strip.classList.toggle('wrapped-tabs', wrapped);
  $('.titlebar').classList.toggle('wrapped-tabs', wrapped);
}
function focusNewTabSearch(tabId) {
  if (tabId !== state.activeTabId || !isHome()) {requestedSearchTabId = tabId;return;}
  requestedSearchTabId = null;
  if ($('#modal').open) return;
  const search = $('#home-address');
  // Capture what was typed into the always-visible address field while the new
  // native tab was being created; never clear a draft on ordinary state updates.
  if (pendingNewTabSearch) search.value = $('#address').value;
  else if (search.dataset.tabId !== tabId) search.value = '';
  search.dataset.tabId = tabId;
  const navigateTo = pendingNewTabSearch?.navigateTo;
  pendingNewTabSearch = null;
  search.focus({preventScroll:true});
  search.setSelectionRange(search.value.length, search.value.length);
  if (navigateTo !== undefined) invoke('navigate', {url:navigateTo});
}
function prepareNewTabSearch() {
  if ($('#modal').open) return null;
  if (pendingNewTabSearch) return pendingNewTabSearch;
  const request = {};
  pendingNewTabSearch = request;
  $('#address').value = '';$('#address').focus({preventScroll:true});
  return request;
}
async function newBlankTab() {
  const request = prepareNewTabSearch();
  const result = await invoke('tab-new');
  if (result?.tabs) renderState(result);
  if (pendingNewTabSearch === request) pendingNewTabSearch = null;
}
function submitSearch(field) {
  if (pendingNewTabSearch) {pendingNewTabSearch.navigateTo = field.value;return;}
  field.blur();
  invoke('navigate', {url:field.value});
}
function renderChrome() {
  const tab=activeTab();const home=isHome();
  if(document.activeElement!==$('#address')) $('#address').value=home?'':tab?.url||'';
  $('#address-icon').innerHTML=icon(home?'search':tab?.url?.startsWith('https:')?'lock':'globe');
  $('#address-security').textContent=home?'NEW TAB':tab?.url?.startsWith('https:')?'HTTPS':'HTTP';
  $('#back').disabled=!tab?.canGoBack;$('#forward').disabled=!tab?.canGoForward;
  $('#reload').innerHTML=icon(tab?.loading?'stop':'reload');$('#reload').title=tab?.loading?'Stop loading':'Reload (Ctrl+R)';
  const bookmarked=state.bookmarks.some(item=>item.url===tab?.url);$('#bookmark-toggle').classList.toggle('active',bookmarked);$('#bookmark-toggle').disabled=home;$('#bookmark-toggle').setAttribute('aria-label',bookmarked?'Remove bookmark':'Bookmark this page');
  const focus=focusState(tab),focusButton=$('#focus-toggle');
  const retry=['error','unavailable','suspended'].includes(focus.status),toolbarRetry=focus.configured&&retry;
  focusButton.classList.toggle('active',focus.status==='active');focusButton.classList.toggle('tool-pending',['applying','suspended'].includes(focus.status));focusButton.classList.toggle('tool-error',['error','unavailable'].includes(focus.status));
  focusButton.setAttribute('aria-pressed',String(focus.status==='active'));focusButton.setAttribute('aria-busy',String(focus.status==='applying'));focusButton.disabled=Boolean(pendingRulesSave)||focus.status==='applying';
  focusButton.setAttribute('aria-label',toolbarRetry?'Retry spoof mode for this site':`${focus.configured?'Disable':'Enable'} spoof mode for this site`);
  $('.toolbar-label',focusButton).textContent=focus.status==='applying'?'Applying…':toolbarRetry?'Retry spoof':'Spoof mode';
  focusButton.title=[focus.message,focus.error||focus.warning,toolbarRetry?'Click to retry; turn off the rule in Site settings':retry?'Click to enable spoof mode; use the status-bar retry to restore the page controls':'Best-effort focus, visibility, selection, and keyboard listener controls for this site'].filter(Boolean).join(' · ');
  const proxy=state.proxy;const proxyAuthError=['required','rejected'].includes(proxy.credentialStatus);$('#proxy-shortcut').classList.toggle('active',!!proxy.active&&!proxyAuthError);$('#proxy-shortcut').classList.toggle('tool-error',!!proxy.error||proxyAuthError);$('#proxy-indicator').className=`tool-indicator ${proxy.error||proxyAuthError?'error':proxy.active?'on':proxy.enabled?'pending':''}`;$('#proxy-shortcut').title=`Proxy: ${proxy.error?'configuration error':proxyAuthError?'authentication needs attention':proxy.active?`${proxy.type.toUpperCase()} · ${proxy.host}:${proxy.port}`:proxy.enabled?'configured, inactive':'direct connection'} · Open settings`;
  const blocker=state.adblock;const allowlisted=blocker.allowlist.some(host=>hostname(tab?.url)===host||hostname(tab?.url).endsWith(`.${host}`));$('#adblock-toggle').classList.toggle('active',blocker.enabled&&blocker.ready&&!allowlisted);$('#adblock-toggle').classList.toggle('tool-error',!!blocker.error);$('#adblock-toggle').setAttribute('aria-pressed',String(blocker.enabled));$('#adblock-count').textContent=blocker.enabled?blocker.blockedCount>999?'999+':String(blocker.blockedCount):'off';$('#adblock-toggle').title=`Ad blocker ${!blocker.enabled?'off':allowlisted?'paused on this allowlisted website':blocker.ready?'on':preview?'available in desktop app':'initializing'} · ${blocker.blockedCount} requests blocked this session · Click to ${blocker.enabled?'disable':'enable'} globally`;$('#adblock-toggle').setAttribute('aria-label',`${blocker.enabled?'Disable':'Enable'} ad blocker globally`);
  const engineName=searchEngines[state.search.engine]?.[0]||'DuckDuckGo';$('#address').placeholder=`Search ${engineName==='Custom search engine'?'the web':engineName} or enter an address`;$('#home-address').placeholder=`Search ${engineName==='Custom search engine'?'the web':engineName} or enter a URL`;
  $('#zoom-label').textContent=`${Math.round((tab?.zoom||1)*100)}%`;
  $('#request-count').textContent=`${state.networkCount ?? entries.length} request${(state.networkCount??entries.length)===1?'':'s'}`;
  const focusMessage=[focus.message,focus.error||focus.warning].filter(Boolean).join(' · ');
  $('#site-status').textContent=home?'Ready to explore':focus.status!=='inactive'?focusMessage:tab?.loading?'Loading…':rulesFor(tab?.url).some(rule=>rule.monitor)?'Monitoring this site':hostname(tab?.url);
  $('#site-status').title=focus.status!=='inactive'?focusMessage:'';$('#site-status').classList.toggle('status-error',['error','unavailable'].includes(focus.status));$('#site-status').classList.toggle('status-pending',['applying','suspended'].includes(focus.status));
  $('#focus-retry').hidden=!retry;$('#focus-retry').disabled=Boolean(pendingRulesSave);$('#focus-retry').title=focus.status==='suspended'?'Close the website’s DevTools, then retry spoof mode':'Retry applying the saved spoof rule';
  $('#newtab').hidden=!home;$('#viewport').hidden=home||Boolean(tab?.error)||preview;
  $('#downloads-badge').hidden=!state.downloads.some(item=>item.state==='progressing'||item.state==='in-progress');
  $('#profile-status').textContent=preview?'Desktop UI preview':'Persistent local session';
  $('#preview-label').innerHTML=`<span class="status-dot"></span>${preview?'DESKTOP PREVIEW':'LOCAL PROFILE'}`;
  const showError=!home&&(preview||tab?.error);$('#page-error').hidden=!showError;
  if(showError) $('#page-error').innerHTML=`<div><span>${icon(preview?'globe':'alert')}</span><h2>${preview?'Your next stop is in the desktop app.':'This page couldn’t be opened.'}</h2><p>${preview?'This is an interactive preview of Prism’s interface. Launch the Electron app to browse real websites with persistent sessions and site-scoped inspection.':escape(typeof tab.error==='string'?tab.error:tab.error?.description||'The website may be unavailable. Check the address and try again.')}</p><p class="muted">${escape(tab?.url)}</p><button class="secondary-button" id="error-home">${icon('arrow-left')} Back to a new tab</button>${!preview?'<button class="primary-button" id="error-retry">Try again</button>':''}</div>`;
}
function renderHome() {
  const signature=JSON.stringify(state.bookmarks);if(signature===lastHomeSignature)return;lastHomeSignature=signature;
  const defaultShortcuts=[{title:'GitHub',url:'https://github.com',letter:'G'},{title:'Wikipedia',url:'https://wikipedia.org',letter:'W'},{title:'MDN Web Docs',url:'https://developer.mozilla.org',letter:'M'},{title:'Hacker News',url:'https://news.ycombinator.com',letter:'Y'}];
  const shortcuts=(state.bookmarks.length?state.bookmarks:defaultShortcuts).slice(0,4);
  $('#shortcuts').innerHTML=shortcuts.map(item=>`<button class="shortcut" data-navigate="${escape(item.url)}" title="${escape(item.url)}"><span class="shortcut-icon">${escape(item.letter||item.title?.[0]?.toUpperCase()||hostname(item.url)[0]?.toUpperCase()||'↗')}</span><span class="shortcut-name">${escape(item.title||hostname(item.url))}</span></button>`).join('');
}
function panelHeader(title, symbol, actions='') { return `<div class="panel-header"><span class="panel-title">${icon(symbol)}${title}</span><div class="panel-actions">${actions}<button class="icon-button" data-action="close-pane" aria-label="Close panel" title="Close panel">${icon('close')}</button></div></div>`; }
function openPane(next) { pane=pane===next?null:next;renderPane();requestViewport(); }
function forcePane(next) {pane=next;renderPane();requestViewport();}
function renderPane() {
  const panel=$('#side-panel');panel.hidden=!pane;$$('[data-pane]').forEach(button=>button.classList.toggle('active',button.dataset.pane===pane));$('#tools-toggle').classList.toggle('active',!!pane);
  $('#app').classList.toggle('has-panel',Boolean(pane));
  if(!pane){requestViewport();return;}
  if(pane==='network')renderNetwork();else if(pane==='settings')renderSettings();else renderCollection(pane);
  requestViewport();
}
function renderNetwork() {
  const enabled=state.rules.filter(rule=>rule.monitor).length;const current=hostname(activeTab()?.url);const watching=rulesFor(activeTab()?.url).some(rule=>rule.monitor);
  const status=captureStatus.get(state.activeTabId);const detached=watching&&status&&status.attached===false;
  $('#side-panel').innerHTML=panelHeader('Network inspector','activity',`<button class="icon-button" data-action="network-export" aria-label="Export captured traffic" title="Export captured traffic">${icon('export')}</button>`)+`
    <div class="panel-section">
      <div class="monitor-banner"><span>${icon('shield')}</span><div><h3>${enabled?'Scoped to your selected sites':'Capture on your terms'}</h3><p>${enabled?`${enabled} site rule${enabled===1?'':'s'} enabled. Other websites stay outside your capture.`:'Network activity is only recorded for websites you explicitly select.'}</p><button data-action="${current&&!watching?'monitor-current':'site-rules'}">${current&&!watching?'Monitor this site':'Configure selected sites'}${icon('arrow-right')}</button></div></div>
      <div class="capture-controls"><span class="capture-state ${enabled&&!state.networkPaused&&!detached?'on':''}" title="${escape(detached?status.reason||'Capture is detached for this tab. Close developer tools and reload to reconnect.':'')}"><span class="status-dot"></span>${state.networkPaused?'Capture paused':detached?'Capture detached for this tab':enabled?'Listening for requests':'Waiting for a selected site'}</span><div class="capture-control-buttons"><button class="icon-button" data-action="pause-capture" title="${state.networkPaused?'Resume':'Pause'} capture" aria-label="${state.networkPaused?'Resume':'Pause'} capture">${icon(state.networkPaused?'play':'pause')}</button><button class="icon-button" data-action="clear-capture" title="Clear captured traffic" aria-label="Clear captured traffic">${icon('trash')}</button></div></div>
      <div class="panel-search">${icon('search')}<input id="request-search" aria-label="Filter network requests" placeholder="Filter requests…" value="${escape(requestFilter)}"></div><div class="network-tabs">${['All','Fetch / XHR','JS','CSS','WS'].map(type=>`<button class="chip ${type===typeFilter?'active':''}" data-filter="${type}">${type}</button>`).join('')}</div>
    </div><div class="network-table-head"><span>REQUEST</span><span>STATUS</span><span>TIME</span></div><div id="network-list" class="network-list"></div><div id="network-detail" class="details" hidden></div>
    <div id="network-help" class="empty-network-steps"><h3 class="micro-label">A WINDOW INTO THE WEB</h3><ol><li><span class="step-number">1</span>Select a website in site controls</li><li><span class="step-number">2</span>Enable monitoring and visit the site</li><li><span class="step-number">3</span>Explore requests, responses, and sockets</li></ol></div><div class="panel-footer"><span>${icon('lock')}Local capture</span><span id="capture-total">${entries.length} requests captured</span></div>`;
  renderNetworkList();renderDetails();
}
function requestMatches(entry) {const type=String(entry.type||'').toLowerCase();return (!requestFilter||`${entry.url} ${entry.method} ${entry.status}`.toLowerCase().includes(requestFilter.toLowerCase()))&&(typeFilter==='All'||typeFilter==='Fetch / XHR'&&['fetch','xhr'].includes(type)||typeFilter==='JS'&&['script','javascript'].includes(type)||typeFilter==='CSS'&&['stylesheet','css'].includes(type)||typeFilter==='WS'&&['websocket','ws'].includes(type));}
function renderNetworkList() {
  const list=$('#network-list');if(!list)return;
  const filtered=entries.filter(requestMatches);
  list.innerHTML=filtered.length?filtered.map(entry=>{let name='';try{const url=new URL(entry.url);name=url.pathname.split('/').filter(Boolean).at(-1)||url.hostname;}catch{name=entry.url||'Request';}return `<button class="network-row ${selectedEntry?.id===entry.id?'selected':''}" data-request="${escape(entry.id)}" title="${escape(entry.url)}"><span><span class="request-name">${escape(name)}</span><span class="request-host">${escape(entry.method||'GET')} · ${escape(hostname(entry.url))}</span></span><span class="request-status ${entry.error||entry.status>=400?'error':''}">${escape(entry.error?'ERR':entry.status||'…')}</span><span class="request-time">${entry.duration==null?'…':Number(entry.duration)>=1000?`${(Number(entry.duration)/1000).toFixed(1)}s`:`${Math.round(Number(entry.duration))}ms`}</span></button>`;}).join(''):`<div class="network-empty"><div class="empty-illustration">${icon('activity')}</div><h3>${entries.length?'No matching requests':state.networkPaused?'Capture is paused':'Nothing to inspect. Yet.'}</h3><p>${entries.length?'Try another filter to find a request.':state.networkPaused?'Resume capture to record new activity on your selected websites.':'Select a website and start browsing.<br>Your network activity will appear here.'}</p></div>`;
  $('#network-help').hidden=Boolean(entries.length||selectedEntry);$('#capture-total').textContent=`${entries.length} requests captured`;
}
async function selectRequest(id) {selectedEntry=entries.find(entry=>entry.id===id)||null;detailLoading=true;detailTab='overview';renderNetworkList();renderDetails();const detail=await invoke('network-detail',{id});if(selectedEntry?.id===id){selectedEntry={...selectedEntry,...(detail?.entry||detail||{})};detailLoading=false;renderDetails();}}
function renderDetails() {
  const target=$('#network-detail');if(!target)return;target.hidden=!selectedEntry;if(!selectedEntry)return;
  const tabs=['overview','request','response','headers','frames'];
  target.innerHTML=`<div class="detail-header"><span>Request details</span><button class="icon-button" data-action="close-detail" aria-label="Close request details">${icon('close')}</button></div><div class="detail-tabs">${tabs.map(item=>`<button class="detail-tab ${detailTab===item?'active':''}" data-detail-tab="${item}">${item==='frames'?'WebSocket':item[0].toUpperCase()+item.slice(1)}</button>`).join('')}</div><div class="detail-content">${detailHTML(selectedEntry)}</div>`;
}
function detailHTML(entry) {
  const pair=(key,value)=>`<div class="detail-pair"><span>${escape(key)}</span><span>${escape(value??'—')}</span></div>`;
  const headers=(label,values)=>`<h4 class="detail-label">${label}</h4>${Object.entries(values||{}).map(([key,value])=>pair(key,Array.isArray(value)?value.join(', '):value)).join('')||'<p class="details-note">No headers available.</p>'}`;
  if(detailTab==='overview')return pair('URL',entry.url)+pair('Page',entry.pageUrl)+pair('Method',entry.method)+pair('Status',entry.status||'Pending')+pair('Type',entry.type)+pair('Duration',entry.duration==null?'Pending':`${Math.round(Number(entry.duration))} ms`)+pair('Transferred',sizeLabel(entry.size))+pair('Started',dateLabel(entry.startTime))+(entry.error?pair('Error',entry.error):'');
  if(detailLoading)return '<p class="details-note">Loading captured details…</p>';
  if(detailTab==='headers')return headers('Request headers',entry.requestHeaders)+headers('Response headers',entry.responseHeaders);
  if(detailTab==='request')return `<h4 class="detail-label">Request body</h4><pre>${escape(entry.postData||'This request has no captured body.')}</pre>`;
  if(detailTab==='response'){let body=entry.responseBody;if(typeof body==='object'&&body!==null)body=JSON.stringify(body,null,2);if(body&&entry.mimeType?.includes('json'))try{body=JSON.stringify(JSON.parse(body),null,2);}catch{}return `<h4 class="detail-label">${escape(entry.mimeType||'Response body')}${entry.bodyBase64?' · Base64 encoded':''}</h4>${entry.bodyNote?`<p class="details-note">${escape(entry.bodyNote)}</p>`:''}<pre>${escape(body||'No response body is available for this request.')}</pre>`;}
  const frames=entry.frames||[];return frames.length?frames.map(frame=>`<div class="frame"><div class="frame-meta">${escape(frame.direction||frame.type||'Frame')} · ${escape(frame.kind||'WebSocket')}${frame.timestamp!=null?` · ${Number(frame.timestamp).toFixed(3)}s`:''}${frame.opcode!=null?` · opcode ${escape(frame.opcode)}`:''}</div><pre>${escape(frame.payloadData??frame.payload??frame.data??'')}</pre></div>`).join(''):'<p class="details-note">No WebSocket or event-stream messages captured for this request.</p>';
}
function renderSettings() {
  const previousScroll=$('.settings-scroll')?.scrollTop||0;const focusedId=document.activeElement?.closest('.settings-form')?document.activeElement.id:null;const selection=focusedId&&typeof document.activeElement.selectionStart==='number'?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
  const currentHost=hostname(activeTab()?.url);
  const search={...state.search,...settingsDrafts.search};const proxy={...state.proxy,...settingsDrafts.proxy};const blocker={...state.adblock,...settingsDrafts.adblock};
  $('#side-panel').innerHTML=panelHeader('Browser settings','sliders')+`<p class="panel-subtitle">Make the web feel more like yours.</p><nav class="settings-nav" aria-label="Settings sections"><button data-settings-section="search">Search</button><button data-settings-section="proxy">Proxy</button><button data-settings-section="adblock">Ad blocker</button><button data-settings-section="sites">Sites</button></nav><div class="panel-scroll settings-scroll">
    ${preview?'<div class="preview-notice">Interactive desktop preview. Proxy routing, ad blocking, browsing, and spoof mode run in the Electron app.</div>':''}
    <section id="settings-search" class="settings-section" tabindex="-1"><h3 class="section-label">SEARCH & NAVIGATION</h3><form id="search-settings-form" class="settings-card settings-form"><div class="settings-heading"><span class="settings-symbol">${icon('search')}</span><div><h3>Your default search engine</h3><p>Used by the address bar and new tab search.</p></div></div><label class="field-label" for="search-engine">Search engine</label><select class="field-input" id="search-engine">${Object.entries(searchEngines).map(([value,[label]])=>`<option value="${value}" ${search.engine===value?'selected':''}>${label}</option>`).join('')}</select><div id="custom-search-fields" ${search.engine==='custom'?'':'hidden'}><label class="field-label" for="search-template">Custom search URL</label><input class="field-input" id="search-template" type="text" placeholder="https://example.com/search?q={query}" value="${escape(search.customTemplate)}" autocomplete="off" spellcheck="false"><p class="field-help">Use an HTTPS URL with <code>{query}</code> where the search words should go.</p></div><button type="submit" class="primary-button full-width">Save search engine</button></form></section>
    <section id="settings-proxy" class="settings-section" tabindex="-1"><h3 class="section-label">CONNECTION</h3><form id="proxy-settings-form" class="settings-card settings-form"><div class="settings-heading"><span class="settings-symbol mint">${icon('route')}</span><div><h3>Proxy connection</h3><p>Route this browser’s website requests through your proxy.</p></div></div><label class="setting-line form-switch"><span>Use proxy</span><input id="proxy-enabled" type="checkbox" class="switch-input" ${proxy.enabled?'checked':''}></label><div id="proxy-runtime-status" class="settings-status" role="status"></div><div class="field-grid proxy-address"><div><label class="field-label" for="proxy-type">Protocol</label><select id="proxy-type" class="field-input">${['http','https','socks5'].map(type=>`<option value="${type}" ${proxy.type===type?'selected':''}>${type.toUpperCase()}</option>`).join('')}</select></div><div><label class="field-label" for="proxy-port">Port</label><input class="field-input" id="proxy-port" type="number" min="1" max="65535" value="${Number(proxy.port)||8080}" inputmode="numeric"></div></div><label class="field-label" for="proxy-host">Proxy hostname or IP address</label><input id="proxy-host" class="field-input" placeholder="proxy.example.com" value="${escape(proxy.host)}" autocomplete="off" spellcheck="false"><label class="field-label" for="proxy-bypass">Bypass proxy for</label><textarea id="proxy-bypass" class="field-input" rows="2" spellcheck="false" placeholder="localhost, 127.0.0.1, [::1]">${escape(proxy.bypass)}</textarea><p class="field-help">Separate hosts or patterns with commas. These addresses connect directly.</p><details class="settings-disclosure" ${settingsDrafts.proxy?.authTouched?'open':''}><summary>Authentication <span>optional · this session</span></summary><div class="authentication-fields"><p id="proxy-auth-help">HTTP and HTTPS proxy credentials stay in memory. Reenter them after restarting Prism. SOCKS5 authentication is unsupported.</p><label class="field-label" for="proxy-username">Username</label><input id="proxy-username" class="field-input" autocomplete="off" spellcheck="false" placeholder="${state.proxy.credentialStatus==='session'?'Leave blank to keep current session':'Proxy username'}" ${proxy.type==='socks5'?'disabled':''}><label class="field-label" for="proxy-password">Password</label><input id="proxy-password" class="field-input" type="password" autocomplete="new-password" placeholder="${state.proxy.credentialStatus==='session'?'Leave blank to keep current session':'Proxy password'}" ${proxy.type==='socks5'?'disabled':''}><label class="checkbox-label"><input id="proxy-clear-auth" type="checkbox" ${proxy.clearAuth?'checked':''}>Clear session credentials</label></div></details><button class="primary-button full-width" type="submit">Apply proxy settings</button><p class="form-footnote">Saved endpoints return on restart. Apply changes, then reload open pages to use the new connection.</p></form></section>
    <section id="settings-adblock" class="settings-section" tabindex="-1"><h3 class="section-label">CONTENT BLOCKING</h3><form id="adblock-settings-form" class="settings-card settings-form"><div class="settings-heading"><span class="settings-symbol">${icon('shield')}</span><div><h3>Ad blocker</h3><p>Powered by Adblock Plus core with bundled EasyList.</p></div></div><label class="setting-line form-switch"><span>Block ads and unwanted requests<small>Master switch for all blocking rules.</small></span><input id="adblock-enabled" type="checkbox" class="switch-input" ${blocker.enabled?'checked':''}></label><div id="adblock-runtime-status" class="settings-status" role="status"></div><label for="adblock-allowlist" class="field-label">Allowlisted websites</label><textarea id="adblock-allowlist" class="field-input" rows="3" spellcheck="false" placeholder="example.com\nnews.example.org">${escape(blocker.allowlist.join('\n'))}</textarea><p class="field-help">No filtering while browsing these websites or their subdomains. Allowlist takes priority over blocked domains.</p><label for="adblock-blocklist" class="field-label">Blocked request domains</label><textarea id="adblock-blocklist" class="field-input" rows="3" spellcheck="false" placeholder="ads.example.com\ntracker.example.org">${escape(blocker.blocklist.join('\n'))}</textarea><p class="field-help">Extra domains to block, including subdomains and direct visits. Enter one hostname per line, or separate with commas.</p><button class="primary-button full-width" type="submit">Save ad blocker settings</button><p class="form-footnote">Reload open pages to apply changes to content already loaded. Built in using the Adblock Plus core library.</p></form></section>
    <section id="settings-sites" class="settings-section" tabindex="-1"><h3 class="section-label">SELECTED WEBSITES <span class="muted">${state.rules.length}</span></h3><button class="secondary-button full-width add-site-button" data-action="add-rule">${icon('plus')} Add a website</button><div>${state.rules.length?state.rules.map(rule=>`<div class="rule-item"><div class="rule-heading"><span class="rule-host" title="${escape(rule.host)}">${escape(rule.host)}</span><div class="panel-actions"><button class="icon-button" data-edit-rule="${escape(rule.id)}" aria-label="Edit ${escape(rule.host)}" title="Edit rule">${icon('edit')}</button><button class="icon-button" data-remove-rule="${escape(rule.id)}" aria-label="Remove ${escape(rule.host)}" title="Remove rule">${icon('trash')}</button></div></div><div class="rule-scope">${rule.includeSubdomains?'Includes subdomains':'Exact host only'}</div><div class="rule-toggles"><label><button class="switch" role="switch" aria-label="Monitor ${escape(rule.host)}" aria-checked="${!!rule.monitor}" data-rule-switch="${escape(rule.id)}" data-field="monitor"></button>Monitor</label><label><button class="switch" role="switch" aria-label="Spoof mode for ${escape(rule.host)}" aria-checked="${!!rule.focus}" data-rule-switch="${escape(rule.id)}" data-field="focus"></button>Spoof mode</label></div></div>`).join(''):'<div class="settings-card"><h3>A clean slate.</h3><p>Add a website to enable monitoring or spoof mode. Rules apply only to the hosts you select.</p></div>'}</div><div class="settings-card"><h3>Spoof mode · page controls</h3><p>Selected sites report a visible, focused document. Selection, keyboard, and clipboard event listeners are suppressed, and mouse-down restrictions on text selection and input focus are relaxed. Some page shortcuts and controls may stop working.</p><p>These overrides are best effort. Sites can still observe other activity signals; this mode cannot guarantee that switching tabs or windows is undetectable.</p><h3>Network monitoring</h3><p>Capture requests, headers, available bodies, and WebSocket frames initiated by selected sites in this browser.</p></div></section>
    <section id="settings-profile" class="settings-section"><h3 class="section-label">YOUR LOCAL PROFILE</h3><div class="settings-card"><h3>Sessions that stay with you</h3><p>Cookies and site storage are kept in a separate profile between launches.</p><p class="profile-path">${escape(state.profilePath||'Managed by Prism on this device')}</p><button class="secondary-button full-width" data-action="view-cookies">${icon('cookie')}Inspect cookies${currentHost?' for this site':''}</button>${currentHost?`<button class="danger-button full-width" data-action="clear-site-data">Clear data for ${escape(currentHost)}</button>`:''}</div></section>
    </div><div class="panel-footer"><span>${icon('lock')}Your browser preferences</span><span>Stored on this device</span></div>`;
  if(settingsDrafts.proxy){$('#proxy-username').value=settingsDrafts.proxy.username||'';$('#proxy-password').value=settingsDrafts.proxy.password||'';}
  $('#search-settings-form').addEventListener('submit',saveSearchSettings);$('#proxy-settings-form').addEventListener('submit',saveProxySettings);$('#adblock-settings-form').addEventListener('submit',saveAdblockSettings);
  renderSettingsStatus();
  renderRulePending();
  $('.settings-scroll').scrollTop=previousScroll;if(focusedId){const field=document.getElementById(focusedId);field?.focus({preventScroll:true});if(selection)field?.setSelectionRange(...selection);}
}
function renderSettingsStatus() {
  const proxyStatus=$('#proxy-runtime-status');if(proxyStatus){const proxy=state.proxy;const authError=['required','rejected'].includes(proxy.credentialStatus);proxyStatus.classList.toggle('is-error',!!proxy.error||authError);proxyStatus.classList.toggle('is-active',!!proxy.active&&!authError);proxyStatus.textContent=preview?'Preview only · no proxy routing':proxy.error?proxy.error:proxy.credentialStatus==='required'?'Proxy requires authentication. Enter your credentials below.':proxy.credentialStatus==='rejected'?'Proxy authentication failed. Check your username and password.':proxy.active?`Active · ${proxy.type.toUpperCase()} ${proxy.host}:${proxy.port}${proxy.credentialStatus==='session'?' · session credentials set':''}`:proxy.enabled?'Proxy configured · not active':'Direct connection · proxy is off';}
  const blockerStatus=$('#adblock-runtime-status');if(blockerStatus){const blocker=state.adblock;blockerStatus.classList.toggle('is-error',!!blocker.error);blockerStatus.classList.toggle('is-active',blocker.enabled&&blocker.ready);blockerStatus.textContent=preview?'Preview only · no requests blocked':blocker.error?blocker.error:!blocker.enabled?'Ad blocking is off':blocker.ready?`${Number(blocker.blockedCount).toLocaleString()} requests blocked this session${blocker.filterCount?` · ${Number(blocker.filterCount).toLocaleString()} filters`:''}`:'Preparing filter lists…';}
}
function openSettingsSection(section) {forcePane('settings');const target=$(`#settings-${section}`);target?.scrollIntoView({block:'start'});target?.focus({preventScroll:true});}
const parseDomains=value=>[...new Set(value.split(/[\n,;]+/).map(item=>item.trim()).filter(Boolean))];
function captureSettingsDraft(target) {
  if(target.closest('#search-settings-form')){settingsDrafts.search={engine:$('#search-engine').value,customTemplate:$('#search-template').value};$('#custom-search-fields').hidden=$('#search-engine').value!=='custom';}
  if(target.closest('#proxy-settings-form')){settingsDrafts.proxy={enabled:$('#proxy-enabled').checked,type:$('#proxy-type').value,host:$('#proxy-host').value,port:$('#proxy-port').value,bypass:$('#proxy-bypass').value,username:$('#proxy-username').value,password:$('#proxy-password').value,clearAuth:$('#proxy-clear-auth').checked,authTouched:settingsDrafts.proxy?.authTouched||['proxy-username','proxy-password'].includes(target.id)};const socks=$('#proxy-type').value==='socks5';$('#proxy-username').disabled=socks;$('#proxy-password').disabled=socks;}
  if(target.closest('#adblock-settings-form'))settingsDrafts.adblock={enabled:$('#adblock-enabled').checked,allowlist:parseDomains($('#adblock-allowlist').value),blocklist:parseDomains($('#adblock-blocklist').value)};
}
async function savePreference(key,value,action,message) {
  const scroll=$('.settings-scroll')?.scrollTop||0;const result=await invoke(action,{[key]:value});if(result===undefined)return false;
  delete settingsDrafts[key];if(result.tabs)renderState(result);else if(result.state)renderState(result.state);else {const next=await invoke('get-state');if(next?.tabs)renderState(next);}
  if(pane==='settings'){renderSettings();$('.settings-scroll').scrollTop=scroll;}renderChrome();toast(preview?`${message} Preview preferences saved.`:message);return true;
}
async function saveSearchSettings(event) {
  event.preventDefault();const search={engine:$('#search-engine').value,customTemplate:$('#search-template').value.trim()};
  if(search.engine==='custom'){try{const url=new URL(search.customTemplate.replaceAll('{query}','test'));if(url.protocol!=='https:'||url.username||url.password||!search.customTemplate.includes('{query}'))throw new Error();}catch{toast('Use a valid HTTPS search URL containing {query}, without embedded credentials.',true);$('#search-template').focus();return;}}
  await savePreference('search',search,'search-save','Default search engine saved.');
}
async function saveProxySettings(event) {
  event.preventDefault();captureSettingsDraft($('#proxy-host'));const draft=settingsDrafts.proxy;const proxy={enabled:draft.enabled,type:draft.type,host:draft.host.trim(),port:Number(draft.port),bypass:draft.bypass.trim()};
  if(proxy.enabled&&(!proxy.host||!Number.isInteger(proxy.port)||proxy.port<1||proxy.port>65535)){toast('Enter a proxy hostname and a port between 1 and 65535.',true);return;}
  if(draft.clearAuth||proxy.type==='socks5'){proxy.username='';proxy.password='';}else if(draft.authTouched){proxy.username=draft.username;proxy.password=draft.password;}
  await savePreference('proxy',proxy,'proxy-save','Proxy settings applied.');
}
async function saveAdblockSettings(event) {event.preventDefault();captureSettingsDraft($('#adblock-enabled'));await savePreference('adblock',settingsDrafts.adblock,'adblock-save','Ad blocker settings saved.');}
async function toggleAdblock() {
  const button=$('#adblock-toggle');button.disabled=true;const adblock={enabled:!state.adblock.enabled,allowlist:state.adblock.allowlist,blocklist:state.adblock.blocklist};
  try{const result=await invoke('adblock-save',{adblock});if(result!==undefined){if(settingsDrafts.adblock)settingsDrafts.adblock.enabled=adblock.enabled;if(result.tabs)renderState(result);else {const next=await invoke('get-state');if(next?.tabs)renderState(next);}toast(`Ad blocker ${adblock.enabled?'enabled':'disabled'}${preview?' in preview':''}.`);}}finally{button.disabled=false;}
}
function renderCollection(kind) {
  const names={bookmarks:['Bookmarks','bookmark'],history:['History','history'],downloads:['Downloads','download']};const [title,symbol]=names[kind];const items=state[kind]||[];
  const collection=[...items];
  $('#side-panel').innerHTML=panelHeader(title,symbol)+`<div class="list-toolbar"><span>${items.length} ${kind==='downloads'?'download':kind==='history'?'visit':'bookmark'}${items.length===1?'':'s'}</span>${kind==='history'&&items.length?'<button class="text-button" data-action="clear-history">Clear history</button>':''}</div><div class="panel-scroll">${items.length?collection.map(item=>kind==='downloads'?`<div class="collection-item"><span class="shortcut-icon">${icon('download')}</span><div class="collection-main"><span class="collection-title">${escape(item.name||item.filename||'Download')}</span><span class="collection-meta download-meta">${escape(item.state||'Starting')} · ${sizeLabel(item.receivedBytes)}${item.totalBytes?` / ${sizeLabel(item.totalBytes)}`:''}</span>${['progressing','in-progress','paused'].includes(item.state)?`<progress class="progress-native" max="${Number(item.totalBytes)||1}" value="${Number(item.receivedBytes)||0}" aria-label="Download progress"></progress>`:''}</div><button class="icon-button" data-download-id="${escape(item.id)}" data-download-action="${['progressing','in-progress','paused'].includes(item.state)?'download-cancel':'download-show'}" title="${['progressing','in-progress','paused'].includes(item.state)?'Cancel download':'Show in folder'}" aria-label="${['progressing','in-progress','paused'].includes(item.state)?'Cancel download':'Show in folder'}">${icon(['progressing','in-progress','paused'].includes(item.state)?'close':'folder')}</button></div>`:`<div class="collection-item"><span class="shortcut-icon">${escape(item.title?.[0]?.toUpperCase()||hostname(item.url)[0]?.toUpperCase()||'↗')}</span><button class="collection-main" data-navigate="${escape(item.url)}" title="${escape(item.url)}"><span class="collection-title">${escape(item.title||hostname(item.url)||item.url)}</span><span class="collection-meta">${escape(kind==='history'?`${hostname(item.url)} · ${dateLabel(item.visitedAt)}`:hostname(item.url))}</span></button><button class="icon-button" data-new-url="${escape(item.url)}" title="Open in new tab" aria-label="Open in new tab">${icon('arrow-up-right')}</button></div>`).join(''):`<div class="empty-list"><span>${icon(symbol)}</span><h3>${kind==='bookmarks'?'Good finds belong here.':kind==='history'?'Your journey starts here.':'Nothing downloaded yet.'}</h3><p>${kind==='bookmarks'?'Click the star in the address bar to save a page. Your bookmarks become new-tab shortcuts.':kind==='history'?'The pages you visit will appear here, stored in your local profile.':'Files you download will appear here with their progress.'}</p></div>`}</div><div class="panel-footer"><span>${icon('lock')}Local to this profile</span></div>`;
}
async function acceptRuleResult(result, startedAt) {
  // State broadcasts can arrive while IPC is outstanding, including a change
  // to the active tab. Never replace them with the invocation's older snapshot.
  if(startedAt===stateEventVersion&&(result?.tabs||result?.state?.tabs)){renderState(result.tabs?result:result.state);return;}
  const syncVersion=stateEventVersion;const latest=await invoke('get-state');
  if(syncVersion===stateEventVersion&&latest?.tabs)renderState(latest);
}
async function saveRules(rules, context={}) {
  if(pendingRulesSave)return false;
  const tab=activeTab(),host=hostname(tab?.url);
  const nextFocus=rules.some(rule=>(host===rule.host||(rule.includeSubdomains&&host.endsWith(`.${rule.host}`)))&&rule.focus);
  const changedFocus=nextFocus!==rulesFor(tab?.url).some(rule=>rule.focus);
  pendingRulesSave={tabId:tab?.id,url:tab?.url,...(changedFocus?{focus:nextFocus}:{}),...context};
  const startedAt=stateEventVersion;renderChrome();renderRulePending();
  try {
    const result=await invoke('rules-save',{rules});if(result===undefined)return false;
    await acceptRuleResult(result,startedAt);return true;
  } finally {pendingRulesSave=null;renderChrome();renderRulePending();}
}
function reportFocusResult(tabId,host) {
  const tab=state.tabs.find(item=>item.id===tabId);
  if(!tab||hostname(tab.url)!==host)return;
  const focus=focusState(tab);
  if(focus.status==='active')toast(`Spoof mode active for ${host}.`);
  else if(focus.status==='inactive')toast(`Spoof mode disabled for ${host}.`);
  else if(['error','unavailable','suspended'].includes(focus.status))toast([focus.message,focus.error].filter(Boolean).join(' · '),true);
}
async function retryFocus() {
  if(pendingRulesSave)return;
  const tab=activeTab();if(!tab||!hostname(tab.url))return;
  const host=hostname(tab.url);pendingRulesSave={tabId:tab.id,url:tab.url,focus:focusState(tab).configured};
  const startedAt=stateEventVersion;renderChrome();renderRulePending();
  let applied=false;
  try{const result=await invoke('focus-retry',{id:tab.id});if(result!==undefined){await acceptRuleResult(result,startedAt);applied=true;}}
  finally{pendingRulesSave=null;renderChrome();renderRulePending();}
  if(applied)reportFocusResult(tab.id,host);
}
async function toggleSite(field) {
  if(pendingRulesSave)return;
  const tab=activeTab(),host=hostname(tab?.url);if(!host){forcePane('settings');ruleModal(undefined,field);return;}
  const matched=rulesFor(tab.url),exact=state.rules.find(rule=>rule.host===host),effective=matched.some(rule=>rule[field]);
  if(field==='focus'&&effective&&['error','unavailable','suspended'].includes(focusState(tab).status)){await retryFocus();return;}
  if(effective){const inherited=matched.find(rule=>rule[field]&&rule.host!==host);if(inherited){ruleModal(inherited);toast(`This setting is inherited from ${inherited.host}. Edit its rule to change it.`);return;}}
  const context={tabId:tab.id,url:tab.url,...(field==='focus'?{focus:!effective}:{})};
  const rules=effective?state.rules.map(rule=>matched.includes(rule)?{...rule,[field]:false}:rule):exact?state.rules.map(rule=>rule.id===exact.id?{...rule,[field]:true}:rule):[...state.rules,{id:uid(),host,includeSubdomains:false,monitor:field==='monitor',focus:field==='focus'}];
  if(await saveRules(rules,context)){
    if(field==='focus')reportFocusResult(tab.id,host);
    else toast(`${field==='focus'?'Spoof mode':'Monitoring'} ${effective?'disabled':'enabled'} for ${host}.`);
  }
}
function showModal(html) {$('#modal-content').innerHTML=html;$('#modal').showModal();sendViewport();}
function closeModal() {$('#modal').close();requestViewport();}
function ruleModal(existing, enabledField='monitor') {
  if(pendingRulesSave)return;
  const host=existing?.host||hostname(activeTab()?.url);const monitor=existing?existing.monitor:enabledField==='monitor';const focus=existing?existing.focus:enabledField==='focus';
  showModal(`<div class="modal-header"><h2>${existing?'Edit website':'Add a website'}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><form id="rule-form" class="modal-body"><p>Choose exactly where Prism can monitor activity or apply spoof mode.</p><label class="field-label" for="rule-host">Website hostname</label><input class="field-input" id="rule-host" placeholder="example.com" value="${escape(host)}" required autocomplete="off" spellcheck="false"><p class="field-help">Enter a hostname or paste a website URL. No wildcards needed.</p><label class="checkbox-label"><input type="checkbox" id="rule-subdomains" ${existing?.includeSubdomains?'checked':''}>Include all subdomains</label><label class="checkbox-label"><input type="checkbox" id="rule-monitor" ${monitor?'checked':''}>Monitor network activity</label><label class="checkbox-label"><input type="checkbox" id="rule-focus" ${focus?'checked':''}>Spoof focus and visibility; suppress selection and keyboard listeners</label><div id="rule-error" class="modal-error" role="alert"></div><div class="modal-footer"><button type="button" class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">${existing?'Save changes':'Add website'}</button></div></form>`);
  $('#rule-form').addEventListener('submit',async event=>{event.preventDefault();if(pendingRulesSave)return;let normalized;try{const raw=$('#rule-host').value.trim();const url=new URL(raw.includes('://')?raw:`https://${raw}`);normalized=url.hostname.toLowerCase().replace(/\.$/,'');if(!normalized||normalized.includes('*')||!['https:','http:'].includes(url.protocol))throw new Error();}catch{$('#rule-error').textContent='Enter a valid website hostname, such as example.com.';return;}if(state.rules.some(rule=>rule.host===normalized&&rule.id!==existing?.id)){$('#rule-error').textContent='A rule for this hostname already exists. Edit the existing rule instead.';return;}const rule={id:existing?.id||uid(),host:normalized,includeSubdomains:$('#rule-subdomains').checked,monitor:$('#rule-monitor').checked,focus:$('#rule-focus').checked};const rules=existing?state.rules.map(item=>item.id===existing.id?rule:item):[...state.rules,rule];const targetTab=activeTab();if(await saveRules(rules)){closeModal();if((rule.focus||existing?.focus!==rule.focus)&&targetTab&&(hostname(targetTab.url)===rule.host||(rule.includeSubdomains&&hostname(targetTab.url).endsWith(`.${rule.host}`))))reportFocusResult(targetTab.id,hostname(targetTab.url));else toast(`Site controls saved for ${normalized}.`);}});
  $('#rule-host').focus();
}
function shortcutModal() {
  showModal(`<div class="modal-header"><h2>Add a shortcut</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><form id="shortcut-form" class="modal-body"><p>Open a website, then use the star in the address bar to save it to your shortcuts.</p><label for="shortcut-url" class="field-label">Website address</label><input class="field-input" id="shortcut-url" placeholder="https://example.com" required autofocus autocomplete="off"><div class="modal-footer"><button type="button" class="secondary-button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Open website</button></div></form>`);
  $('#shortcut-form').addEventListener('submit',event=>{event.preventDefault();const url=$('#shortcut-url').value;closeModal();invoke('navigate',{url});});$('#shortcut-url').focus();
}
function cookieHostForScope(scope) { return scope==='site' ? hostname(activeTab()?.url) : ''; }
async function exportCookieScope(scope) {
  const host=cookieHostForScope(scope); const result=await invoke('cookies-export',host?{host}:{});
  if(result?.ok) closeModal();
}
async function importCookieScope(scope) {
  const host=cookieHostForScope(scope); const result=await invoke('cookies-import',host?{host}:{});
  if(result && !result.canceled && !result.unavailable){closeModal();await cookiesModal();}
}
async function cookiesModal() {
  const url=isHome()?undefined:activeTab()?.url;const scope=url?'site':'all';const host=hostname(url);const result=await invoke('cookies-list',url?{url}:{});if(result===undefined)return;const cookies=Array.isArray(result)?result:result.cookies||[];
  const description=url?`Cookies for ${escape(host)}. Exporting this site includes its subdomains.`:'Cookies stored in your Prism profile. Export creates a portable JSON file you can import later.';
  const exportLabel=scope==='site'?'Export this site':'Export all cookies';const importLabel=scope==='site'?'Import for this site':'Import cookies';
  showModal(`<div class="modal-header"><h2>Stored cookies</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body"><p>${description} Values stay local to this inspector.</p><div class="cookie-list">${cookies.length?cookies.map(cookie=>`<details class="cookie-item"><summary>${escape(cookie.name)} <span class="muted">· ${escape(cookie.domain)}</span></summary><pre>${escape(JSON.stringify(cookie,null,2))}</pre></details>`).join(''):'<p>No cookies are stored for this selection.</p>'}</div><div class="modal-footer cookie-actions"><button class="secondary-button" data-cookie-export="${scope}">${icon('export')}${exportLabel}</button><button class="primary-button" data-cookie-import="${scope}">${icon('folder')}${importLabel}</button><button class="secondary-button" data-action="close-modal">Close</button></div></div>`);
}
function confirmModal(title,description,buttonText,action) {showModal(`<div class="modal-header"><h2>${escape(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body"><p>${escape(description)}</p><div class="modal-footer"><button class="secondary-button" data-action="close-modal">Cancel</button><button class="danger-button" id="confirm-action">${escape(buttonText)}</button></div></div>`);$('#confirm-action').addEventListener('click',async()=>{closeModal();await action();});}
const actions = {
  'close-pane':()=>{pane=null;renderPane();},'site-rules':()=>openSettingsSection('sites'),'add-rule':()=>ruleModal(),
  'monitor-current':()=>toggleSite('monitor'),'pause-capture':()=>invoke('network-pause',{paused:!state.networkPaused}),
  'clear-capture':async()=>{const result=await invoke('network-clear');if(result!==undefined){entries=[];selectedEntry=null;state.networkCount=0;renderChrome();renderNetwork();}},
  'network-export':()=>invoke('network-export'),'close-detail':()=>{selectedEntry=null;renderNetworkList();renderDetails();},
  'clear-history':()=>confirmModal('Clear browsing history?','This removes the list of visited pages from your Prism profile.','Clear history',()=>invoke('history-clear')),
  'view-cookies':cookiesModal,'clear-site-data':()=>{const host=hostname(activeTab()?.url);confirmModal('Clear this site’s data?',`Remove cookies and storage for ${host}? You may be signed out of this website.`,'Clear site data',async()=>{await invoke('site-data-clear',{host});toast(`Site data cleared for ${host}.`);});},
  'close-modal':closeModal,
};
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;const d=button.dataset;
  if(d.cookieExport){await exportCookieScope(d.cookieExport);return;}
  if(d.cookieImport){await importCookieScope(d.cookieImport);return;}
  if(d.action){await actions[d.action]?.();return;}
  if(d.settingsSection){openSettingsSection(d.settingsSection);return;}
  if(d.pane){openPane(d.pane);return;}if(d.openPane){forcePane(d.openPane);return;}
  if(d.tab){await invoke('tab-activate',{id:d.tab});return;}if(d.closeTab){await invoke('tab-close',{id:d.closeTab});return;}
  if(d.navigate){await invoke('navigate',{url:d.navigate});return;}if(d.newUrl){await invoke('tab-new',{url:d.newUrl});return;}
  if(d.filter){typeFilter=d.filter;$$('[data-filter]').forEach(el=>el.classList.toggle('active',el.dataset.filter===typeFilter));renderNetworkList();return;}
  if(d.request){await selectRequest(d.request);return;}if(d.detailTab){detailTab=d.detailTab;renderDetails();return;}
  if((d.editRule||d.removeRule||d.ruleSwitch)&&pendingRulesSave)return;
  if(d.editRule){ruleModal(state.rules.find(rule=>rule.id===d.editRule));return;}
  if(d.removeRule){await saveRules(state.rules.filter(rule=>rule.id!==d.removeRule));return;}
  if(d.ruleSwitch){await saveRules(state.rules.map(rule=>rule.id===d.ruleSwitch?{...rule,[d.field]:!rule[d.field]}:rule));return;}
  if(d.downloadAction){await invoke(d.downloadAction,{id:d.downloadId});return;}
  if(button.id==='error-home'){await newBlankTab();return;}if(button.id==='error-retry')await invoke('reload');
});
document.addEventListener('input',event=>{if(event.target.id==='request-search'){requestFilter=event.target.value;renderNetworkList();}if(event.target.closest('.settings-form'))captureSettingsDraft(event.target);});
document.addEventListener('change',event=>{if(event.target.closest('.settings-form'))captureSettingsDraft(event.target);});
$('#new-tab').addEventListener('click',newBlankTab);
$('#brand-home').addEventListener('click',event=>{event.preventDefault();newBlankTab();});
$('#tabs').addEventListener('auxclick',event=>{if(event.button!==1)return;const tab=event.target.closest('[data-tab-id]');if(tab){event.preventDefault();invoke('tab-close',{id:tab.dataset.tabId});}});
$('#tabs').addEventListener('mousedown',event=>{if(event.button===1)event.preventDefault();});
$('#tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const index=state.tabs.findIndex(tab=>tab.id===event.target.dataset.tab);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?state.tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+state.tabs.length)%state.tabs.length;const tab=state.tabs[next];invoke('tab-activate',{id:tab.id});$$('.tab-label').find(button=>button.dataset.tab===tab.id)?.focus();});
$('#back').addEventListener('click',()=>invoke('back'));$('#forward').addEventListener('click',()=>invoke('forward'));$('#reload').addEventListener('click',()=>invoke(activeTab()?.loading?'stop':'reload'));
$('#address-form').addEventListener('submit',event=>{event.preventDefault();submitSearch($('#address'));});$('#address').addEventListener('focus',()=>{if(!pendingNewTabSearch)$('#address').select();});
$('#home-search').addEventListener('submit',event=>{event.preventDefault();submitSearch($('#home-address'));});
$('#bookmark-toggle').addEventListener('click',async()=>{const was=state.bookmarks.some(item=>item.url===activeTab()?.url);await invoke('bookmark-toggle');toast(was?'Bookmark removed.':'Page saved to bookmarks.');});
$('#focus-retry').addEventListener('click',retryFocus);
$('#focus-toggle').addEventListener('click',()=>toggleSite('focus'));$('#tools-toggle').addEventListener('click',()=>openPane(pane||'network'));
$('#proxy-shortcut').addEventListener('click',()=>openSettingsSection('proxy'));$('#adblock-toggle').addEventListener('click',toggleAdblock);$('#adblock-settings-shortcut').addEventListener('click',()=>openSettingsSection('adblock'));
$('#shortcut-add').addEventListener('click',shortcutModal);$('#open-devtools').addEventListener('click',()=>invoke('devtools'));
['window-minimize','window-maximize','window-close'].forEach(action=>$('#'+action).addEventListener('click',()=>invoke(action)));
$('#zoom-out').addEventListener('click',()=>invoke('zoom',{delta:-.1}));$('#zoom-in').addEventListener('click',()=>invoke('zoom',{delta:.1}));
function openFind(){$('#find-bar').hidden=false;$('#main-surface').classList.add('find-open');$('#find-input').focus();requestViewport();}
function closeFind(){$('#find-bar').hidden=true;$('#main-surface').classList.remove('find-open');invoke('find-stop');requestViewport();}
$('#find-close').addEventListener('click',closeFind);$('#find-input').addEventListener('input',()=>invoke('find',{text:$('#find-input').value}));$('#find-input').addEventListener('keydown',event=>{if(event.key==='Enter')invoke('find',{text:$('#find-input').value,forward:!event.shiftKey});if(event.key==='Escape')closeFind();});$('#find-next').addEventListener('click',()=>invoke('find',{text:$('#find-input').value,forward:true}));$('#find-previous').addEventListener('click',()=>invoke('find',{text:$('#find-input').value,forward:false}));
document.addEventListener('keydown',event=>{const modifier=event.ctrlKey||event.metaKey;if(!modifier)return;const key=event.key.toLowerCase();if(['l','k','t','w','r','f'].includes(key)){event.preventDefault();if(key==='l'||key==='k'){$('#address').focus();$('#address').select();}if(key==='t')newBlankTab();if(key==='w')invoke('tab-close',{id:state.activeTabId});if(key==='r')invoke('reload');if(key==='f')openFind();}if(key==='+'||key==='='){event.preventDefault();invoke('zoom',{delta:.1});}if(key==='-'){event.preventDefault();invoke('zoom',{delta:-.1});}if(key==='0'){event.preventDefault();invoke('zoom',{delta:1-(activeTab()?.zoom||1)});}});
$('#modal').addEventListener('close',requestViewport);$('#modal').addEventListener('cancel',()=>requestViewport());
window.addEventListener('resize',requestViewport);new ResizeObserver(requestViewport).observe($('#viewport'));new ResizeObserver(updateTabDensity).observe($('#tabs'));
bridge.on('state',next=>{stateEventVersion++;renderState(next);});
bridge.on('toast',message=>toast(message?.message||message,Boolean(message?.error)));
bridge.on('network-entry',entry=>{if(!entry?.id)return;const index=entries.findIndex(item=>item.id===entry.id);if(index<0)entries.push(entry);else entries[index]={...entries[index],...entry};if(entries.length>1500)entries.splice(0,entries.length-1500);state.networkCount=Math.max(state.networkCount||0,entries.length);if(selectedEntry?.id===entry.id){selectedEntry={...selectedEntry,...entry};renderDetails();}if(pane==='network')renderNetworkList();$('#request-count').textContent=`${state.networkCount} requests`;});
bridge.on('network-removed',payload=>{const removed=new Set(payload?.ids||[]);entries=entries.filter(entry=>!removed.has(entry.id));if(removed.has(selectedEntry?.id))selectedEntry=null;state.networkCount=entries.length;if(pane==='network'){renderNetworkList();renderDetails();}renderChrome();});
bridge.on('network-cleared',()=>{entries=[];selectedEntry=null;state.networkCount=0;if(pane==='network'){renderNetworkList();renderDetails();}renderChrome();});
bridge.on('network-status',status=>{if(status?.tabId)captureStatus.set(status.tabId,status);if(pane==='network')renderNetwork();});
bridge.on('find-result',result=>{if(!$('#find-bar').hidden)$('#find-input').setAttribute('title',`${result?.activeMatchOrdinal||0} of ${result?.matches||0} matches`);});
bridge.on('shortcut',command=>{const action=typeof command==='string'?command:command?.action;if(action==='address'){$('#address').focus();$('#address').select();}if(action==='find')openFind();if(action==='prepare-new-tab-search')prepareNewTabSearch();if(action==='new-tab-search')focusNewTabSearch(command?.tabId||state.activeTabId);});
paintIcons();
const initial=await invoke('get-state');renderState(initial||state);
const captured=await invoke('network-list');entries=Array.isArray(captured)?captured:captured?.entries||[];if(pane==='network')renderNetwork();requestViewport();
