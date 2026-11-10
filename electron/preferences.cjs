'use strict';

const { isIP } = require('node:net');
const { domainToASCII } = require('node:url');

const SEARCH_ENGINES = Object.freeze([
  { id: 'duckduckgo', name: 'DuckDuckGo' },
  { id: 'google', name: 'Google' },
  { id: 'bing', name: 'Bing' },
  { id: 'brave', name: 'Brave Search' },
  { id: 'startpage', name: 'Startpage' },
  { id: 'custom', name: 'Custom search engine' },
].map(Object.freeze));

const SEARCH_TEMPLATES = Object.freeze({
  duckduckgo: 'https://duckduckgo.com/?q={query}',
  google: 'https://www.google.com/search?q={query}',
  bing: 'https://www.bing.com/search?q={query}',
  brave: 'https://search.brave.com/search?q={query}',
  startpage: 'https://www.startpage.com/sp/search?query={query}',
});

const DEFAULT_PREFERENCES = Object.freeze({
  general: Object.freeze({
    restoreTabs: true,
  }),
  theme: Object.freeze({
    accentColor: '#b49bf8',
    hideLogo: false,
    hideModuleText: false,
    mode: 'dark',
  }),
  shortcuts: Object.freeze({
    typing: 'Ctrl+9',
    fullscreen: 'Ctrl+F',
  }),
  typing: Object.freeze({ speed: 1 }),
  search: Object.freeze({ engine: 'google', customTemplate: '' }),
  spoof: Object.freeze({
    focusVisibility: true,
    fullscreen: true,
    keyboard: true,
    clipboardEvents: true,
    rightClick: true,
    selection: true,
    screenshare: true,
    screenshareCursor: true,
    osPlatform: true,
    platform: 'win64',
    browserIdentity: true,
    browser: 'chrome',
  }),
  proxy: Object.freeze({
    enabled: false, type: 'http', host: '', port: 8080,
    bypass: 'localhost,127.0.0.1,[::1]', username: '', password: '',
  }),
});

function objectInput(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} settings.`);
  return value;
}

function normalizeGeneral(input = DEFAULT_PREFERENCES.general) {
  objectInput(input, 'general');
  const restoreTabs = input.restoreTabs !== false;
  return { restoreTabs };
}

function normalizeTheme(input = DEFAULT_PREFERENCES.theme) {
  objectInput(input, 'theme');
  const accentColor = typeof input.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.accentColor.trim())
    ? input.accentColor.trim().toLowerCase()
    : DEFAULT_PREFERENCES.theme.accentColor;
  const hideLogo = Boolean(input.hideLogo);
  const hideModuleText = Boolean(input.hideModuleText);
  const mode = input.mode === 'light' ? 'light' : 'dark';
  return { accentColor, hideLogo, hideModuleText, mode };
}

const VALID_SHORTCUT_KEYS = new Set([
  '0','1','2','3','4','5','6','7','8','9',
  'a','b','c','d','e','f','g','h','i','j','k','l','m','n','o','p','q','r','s','t','u','v','w','x','y','z',
  'space','enter','tab','escape','backspace','delete','insert','home','end','pageup','pagedown',
  'arrowup','arrowdown','arrowleft','arrowright'
]);
for (let i = 1; i <= 24; i++) VALID_SHORTCUT_KEYS.add('f' + i);

function parseShortcut(shortcutStr) {
  if (typeof shortcutStr !== 'string') return null;
  const parts = shortcutStr.trim().split('+').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  let ctrl = false;
  let alt = false;
  let shift = false;
  let meta = false;
  let key = null;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'cmdorctrl') {
      ctrl = true;
    } else if (low === 'cmd' || low === 'command' || low === 'meta') {
      meta = true;
    } else if (low === 'alt' || low === 'option') {
      alt = true;
    } else if (low === 'shift') {
      shift = true;
    } else {
      key = low;
    }
  }
  if (!key || !VALID_SHORTCUT_KEYS.has(key)) return null;
  if (!ctrl && !alt && !meta && !/^f\d{1,2}$/i.test(key)) return null;
  return { ctrl, alt, shift, meta, key };
}

function formatShortcut(shortcutStr) {
  const parsed = parseShortcut(shortcutStr);
  if (!parsed) return null;
  const parts = [];
  if (parsed.ctrl) parts.push('Ctrl');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  if (parsed.meta) parts.push('Cmd');
  let k = parsed.key;
  if (k.length === 1) k = k.toUpperCase();
  else if (/^f\d{1,2}$/i.test(k)) k = k.toUpperCase();
  else k = k[0].toUpperCase() + k.slice(1);
  parts.push(k);
  return parts.join('+');
}

function matchesShortcut(parsed, input) {
  if (!parsed || !input) return false;
  const isDarwin = process.platform === 'darwin';

  const eventCtrl = Boolean(input.control ?? input.ctrlKey);
  const eventMeta = Boolean(input.meta ?? input.metaKey);
  const eventAlt = Boolean(input.alt ?? input.altKey);
  const eventShift = Boolean(input.shift ?? input.shiftKey);
  const eventKey = String(input.key || '').toLowerCase();
  const eventCode = String(input.code || '').toLowerCase();

  let modMatches = false;
  if (parsed.ctrl && !parsed.meta) {
    modMatches = isDarwin ? (eventMeta || eventCtrl) : eventCtrl;
  } else if (parsed.meta && !parsed.ctrl) {
    modMatches = eventMeta;
  } else if (parsed.ctrl && parsed.meta) {
    modMatches = eventCtrl && eventMeta;
  } else {
    modMatches = !eventCtrl && !eventMeta;
  }

  if (!modMatches) return false;
  if (parsed.alt !== eventAlt) return false;
  if (parsed.shift !== eventShift) return false;

  const pKey = parsed.key.toLowerCase();
  if (eventKey === pKey) return true;
  if (eventCode === `key${pKey}`) return true;
  if (eventCode === `digit${pKey}`) return true;
  if (pKey === 'space' && (eventKey === ' ' || eventCode === 'space')) return true;

  return false;
}

function normalizeShortcuts(input = DEFAULT_PREFERENCES.shortcuts) {
  objectInput(input, 'shortcuts');
  const typing = typeof input.typing === 'string' && formatShortcut(input.typing)
    ? formatShortcut(input.typing)
    : DEFAULT_PREFERENCES.shortcuts.typing;
  const fullscreen = typeof input.fullscreen === 'string' && formatShortcut(input.fullscreen)
    ? formatShortcut(input.fullscreen)
    : DEFAULT_PREFERENCES.shortcuts.fullscreen;
  return { typing, fullscreen };
}

function normalizeTyping(input = DEFAULT_PREFERENCES.typing) {
  objectInput(input, 'typing');
  const speed = input.speed ?? 1;
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 3) {
    throw new Error('Choose a typing speed between 0.25× and 3×.');
  }
  return { speed };
}

const SUPPORTED_SPOOF_PLATFORMS = Object.freeze(['win64', 'linux64', 'macos64']);
const SUPPORTED_SPOOF_BROWSERS = Object.freeze(['chrome', 'edge', 'firefox', 'safari']);

function normalizeSpoof(input = DEFAULT_PREFERENCES.spoof) {
  objectInput(input, 'spoof');
  const platform = typeof input.platform === 'string' && SUPPORTED_SPOOF_PLATFORMS.includes(input.platform)
    ? input.platform
    : 'win64';
  const browser = typeof input.browser === 'string' && SUPPORTED_SPOOF_BROWSERS.includes(input.browser)
    ? input.browser
    : 'chrome';
  return {
    focusVisibility: input.focusVisibility !== false,
    fullscreen: input.fullscreen !== false,
    keyboard: input.keyboard !== false,
    clipboardEvents: input.clipboardEvents !== false,
    rightClick: input.rightClick !== false,
    selection: input.selection !== false,
    screenshare: input.screenshare !== false,
    screenshareCursor: input.screenshareCursor !== false,
    osPlatform: input.osPlatform !== false,
    platform,
    browserIdentity: input.browserIdentity !== false,
    browser,
  };
}

function normalizeTemplate(value, required) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Use a search URL of at most 2048 characters.');
  const template = value.trim();
  if (!template && !required) return '';
  if ((template.match(/\{query\}/g) || []).length !== 1) throw new Error('The custom search URL must contain exactly one {query}.');
  if (/[\u0000-\u0020\u007f\\]/u.test(template) || !/^https:\/\//i.test(template)) {
    throw new Error('Use an absolute HTTPS search URL without spaces or backslashes.');
  }
  const authority = template.match(/^https:\/\/([^/?#]*)/i)?.[1] || '';
  const placeholder = template.indexOf('{query}');
  if (!authority || authority.includes('{query}') || (template.includes('#') && placeholder > template.indexOf('#'))) {
    throw new Error('Put {query} in the URL path or query, never in the hostname or fragment.');
  }
  let parsed;
  try { parsed = new URL(template.replace('{query}', 'prism-search-query')); }
  catch { throw new Error('Enter a valid custom HTTPS search URL.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || authority.includes('@')) {
    throw new Error('Use an HTTPS search URL without embedded credentials.');
  }
  return template;
}

function normalizeSearch(input = DEFAULT_PREFERENCES.search) {
  objectInput(input, 'search');
  const engine = input.engine === undefined ? 'google' : input.engine;
  if (!SEARCH_ENGINES.some(item => item.id === engine)) throw new Error('Choose a supported search engine.');
  return { engine, customTemplate: normalizeTemplate(input.customTemplate ?? '', engine === 'custom') };
}

function searchURL(query, search = DEFAULT_PREFERENCES.search) {
  const settings = normalizeSearch(search);
  const template = settings.engine === 'custom' ? settings.customTemplate : SEARCH_TEMPLATES[settings.engine];
  // Encode the whole input so it cannot add a query parameter, fragment or URL authority.
  const encoded = encodeURIComponent(String(query ?? '').toWellFormed());
  return new URL(template.replace('{query}', encoded)).href;
}

function normalizeProxyHost(value) {
  if (typeof value !== 'string' || value.length > 253) throw new Error('Use a proxy hostname, IPv4 address, or bracketed IPv6 address.');
  const host = value.trim();
  if (!host || /[\s/@?#\\,;=%]/u.test(host)) throw new Error('Enter only the proxy host, without a URL, port, path, or credentials.');
  if (host.startsWith('[')) {
    if (!host.endsWith(']') || isIP(host.slice(1, -1)) !== 6) throw new Error('Enter a valid IPv6 address in brackets.');
    return new URL(`http://${host}`).hostname;
  }
  if (host.includes(':') || host.includes('[') || host.includes(']')) throw new Error('Enter the port separately; put IPv6 addresses in brackets.');
  const ascii = domainToASCII(host).toLowerCase().replace(/\.$/, '');
  if (!ascii || ascii.length > 253 || !ascii.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) {
    throw new Error('Enter a valid proxy hostname.');
  }
  if (/^[\d.]+$/.test(ascii) && isIP(ascii) !== 4) throw new Error('Enter an IPv4 address with four decimal parts.');
  return ascii;
}

function normalizePort(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value))) throw new Error('Proxy port must be an integer from 1 to 65535.');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Proxy port must be an integer from 1 to 65535.');
  return port;
}

function normalizeBypassRule(raw) {
  const rule = raw.trim();
  if (rule === '<local>' || rule === '<-loopback>') return rule;
  if (/[\s@?#\\;=%<>]/u.test(rule)) throw new Error('Use comma-separated proxy bypass hostnames or Chromium host patterns.');
  // Chromium uses unbracketed IP addresses for CIDR rules, including IPv6 ranges.
  const cidr = rule.match(/^([^/]+)\/(\d+)$/);
  if (cidr) {
    const version = isIP(cidr[1]);
    const prefix = Number(cidr[2]);
    if (!version || prefix < 0 || prefix > (version === 4 ? 32 : 128)) throw new Error('Enter a valid IP address and CIDR prefix for the proxy bypass rule.');
    return `${cidr[1].toLowerCase()}/${prefix}`;
  }
  const parts = rule.match(/^(?:(https?|wss?):\/\/)?(\[[^\]]+\]|[^/:]+)(?::(\d+))?$/i);
  if (!parts) throw new Error('Proxy bypass rules use hostnames, optional ports and schemes, or IP ranges; paths are not supported.');
  const scheme = parts[1] ? `${parts[1].toLowerCase()}://` : '';
  const port = parts[3] ? `:${normalizePort(parts[3])}` : '';
  let pattern = parts[2];
  if (pattern.startsWith('[')) pattern = normalizeProxyHost(pattern);
  else if (pattern.includes('*') || pattern.startsWith('.')) {
    pattern = pattern.toLowerCase();
    if (pattern.length > 253 || !/^[a-z\d.*-]+$/.test(pattern) || pattern.includes('..') || !/[a-z\d*]/.test(pattern)) {
      throw new Error('Enter a valid hostname pattern for the proxy bypass rule.');
    }
  } else pattern = normalizeProxyHost(pattern);
  return `${scheme}${pattern}${port}`;
}

function normalizeBypass(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Use a proxy bypass list of at most 4096 characters.');
  const rules = value.split(/[,\r\n]/).map(rule => rule.trim()).filter(Boolean);
  if (rules.length > 100) throw new Error('Use up to 100 proxy bypass rules.');
  // Preserve ordering: <-loopback> is subtractive and can make rule order meaningful.
  return rules.map(normalizeBypassRule).join(',');
}

function normalizeProxy(input = DEFAULT_PREFERENCES.proxy) {
  objectInput(input, 'proxy');
  const type = input.type === undefined ? 'http' : input.type;
  if (!['http', 'https', 'socks5'].includes(type)) throw new Error('Choose HTTP, HTTPS, or SOCKS5 for the proxy type.');
  const hostInput = input.host === undefined ? '' : input.host;
  const host = hostInput === '' ? '' : normalizeProxyHost(hostInput);
  const enabled = input.enabled === true;
  if (enabled && !host) throw new Error('Configure a proxy host before enabling the proxy.');
  const username = input.username === undefined ? '' : input.username;
  const password = input.password === undefined ? '' : input.password;
  if ([username, password].some(value => typeof value !== 'string' || value.length > 1024 || /[\u0000-\u001f\u007f]/u.test(value))) {
    throw new Error('Proxy credentials must be text without control characters, up to 1024 characters each.');
  }
  if (username.includes(':')) throw new Error('The proxy username cannot contain a colon.');
  if (type === 'socks5' && (username || password)) throw new Error('Chromium does not support SOCKS5 username/password authentication. Use an unauthenticated SOCKS5 or HTTP(S) proxy.');
  return {
    enabled, type, host, port: normalizePort(input.port === undefined ? 8080 : input.port),
    bypass: normalizeBypass(input.bypass === undefined ? DEFAULT_PREFERENCES.proxy.bypass : input.bypass),
    username, password,
  };
}

// This is the only proxy shape suitable for renderer state or JSON persistence.
function publicProxyConfig(config) {
  const { username, password, ...settings } = normalizeProxy(config);
  return settings;
}

module.exports = {
  SEARCH_ENGINES, DEFAULT_PREFERENCES, normalizeGeneral, normalizeTheme, normalizeShortcuts, parseShortcut, formatShortcut, matchesShortcut, normalizeSearch, searchURL, normalizeTyping,
  normalizeSpoof, SUPPORTED_SPOOF_PLATFORMS, SUPPORTED_SPOOF_BROWSERS,
  normalizeProxy, publicProxyConfig, normalizeProxyHost,
};
