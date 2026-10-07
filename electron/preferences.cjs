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
  search: Object.freeze({ engine: 'duckduckgo', customTemplate: '' }),
  proxy: Object.freeze({
    enabled: false, type: 'http', host: '', port: 8080,
    bypass: 'localhost,127.0.0.1,[::1]', username: '', password: '',
  }),
});

function objectInput(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} settings.`);
  return value;
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
  const engine = input.engine === undefined ? 'duckduckgo' : input.engine;
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
  SEARCH_ENGINES, DEFAULT_PREFERENCES, normalizeSearch, searchURL,
  normalizeProxy, publicProxyConfig, normalizeProxyHost,
};
