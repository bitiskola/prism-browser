'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['get-state','search-save','proxy-save','adblock-save','tab-new','tab-close','tab-activate','tab-reorder','navigate','back','forward','reload','stop','viewport','bookmark-toggle','history-clear','rules-save','focus-retry','network-list','network-detail','network-clear','network-pause','network-export','cookies-list','cookies-export','cookies-import','site-data-clear','downloads-list','download-cancel','download-show','find','find-stop','zoom','devtools','window-minimize','window-maximize','window-close']);
const events = new Set(['state','network-entry','network-removed','network-cleared','network-status','toast','shortcut','find-result']);
contextBridge.exposeInMainWorld('prism', Object.freeze({
  invoke(action, payload = {}) {
    if (!actions.has(action)) return Promise.reject(new Error('Unsupported action.'));
    return ipcRenderer.invoke('prism:action', action, payload);
  },
  on(event, callback) {
    if (!events.has(event) || typeof callback !== 'function') return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(`prism:${event}`, listener);
    return () => ipcRenderer.removeListener(`prism:${event}`, listener);
  }
}));
