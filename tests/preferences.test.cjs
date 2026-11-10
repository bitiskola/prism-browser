'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SEARCH_ENGINES, DEFAULT_PREFERENCES, normalizeGeneral, normalizeTheme, normalizeShortcuts, parseShortcut, matchesShortcut,
  normalizeSearch, searchURL, normalizeProxy, publicProxyConfig, normalizeTyping,
} = require('../electron/preferences.cjs');

test('search preferences default to Google and list each supported engine once', () => {
  assert.deepEqual(normalizeSearch(), { engine: 'google', customTemplate: '' });
  assert.deepEqual(SEARCH_ENGINES.map(item => item.id), ['duckduckgo', 'google', 'bing', 'brave', 'startpage', 'custom']);
  assert.ok(SEARCH_ENGINES.every(item => typeof item.name === 'string'));
  assert.throws(() => normalizeSearch({ engine: 'constructor' }), /supported/);
  assert.throws(() => normalizeSearch({ engine: '__proto__' }), /supported/);
  assert.throws(() => normalizeSearch(null), /Invalid/);
});

test('all preset search engines encode one search value without adding parameters or fragments', () => {
  const query = 'cats & dogs #images / café ?next=https://evil.test';
  const engines = [
    ['duckduckgo', 'duckduckgo.com', 'q'], ['google', 'www.google.com', 'q'],
    ['bing', 'www.bing.com', 'q'], ['brave', 'search.brave.com', 'q'],
    ['startpage', 'www.startpage.com', 'query'],
  ];
  for (const [engine, host, parameter] of engines) {
    const url = new URL(searchURL(query, { engine }));
    assert.equal(url.hostname, host);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.searchParams.get(parameter), query);
    assert.equal(url.searchParams.size, 1);
    assert.equal(url.hash, '');
  }
});

test('custom search URL accepts one path or query placeholder, with fixed parameters retained', () => {
  const settings = normalizeSearch({ engine: 'custom', customTemplate: ' https://search.example/find?term={query}&lang=en ' });
  assert.equal(settings.customTemplate, 'https://search.example/find?term={query}&lang=en');
  const url = new URL(searchURL('one & two#three', settings));
  assert.equal(url.searchParams.get('term'), 'one & two#three');
  assert.equal(url.searchParams.get('lang'), 'en');
  assert.equal(url.hash, '');
  assert.equal(searchURL('hello/world', { engine: 'custom', customTemplate: 'https://search.example/search/{query}?lang=en' }), 'https://search.example/search/hello%2Fworld?lang=en');
});

test('custom search cannot move input into authority, credentials, fragments, or an active scheme', () => {
  const invalid = [
    '', 'https://search.example/', 'https://search.example/?q={query}&again={query}',
    'http://search.example/?q={query}', 'javascript:alert("{query}")', '/search?q={query}',
    'https://{query}.example/', 'https://search.example:{query}/', 'https://{query}@search.example/',
    'https://person:secret@search.example/?q={query}', 'https://@search.example/?q={query}',
    'https://search.example/#q={query}', 'https://search.example/?q=fixed#{query}',
    'https://search.example\\@evil.test/?q={query}', 'https://search.example/\n?q={query}',
    'https://search.example/?q={query}\u0000', 'https://search.example/?q={query}' + 'x'.repeat(2048),
  ];
  for (const customTemplate of invalid) assert.throws(() => normalizeSearch({ engine: 'custom', customTemplate }), undefined, customTemplate);
  assert.throws(() => normalizeSearch({ engine: 'custom', customTemplate: 42 }), /URL/);
});

test('custom templates are validated even when stored for a currently inactive provider', () => {
  assert.throws(() => normalizeSearch({ engine: 'google', customTemplate: 'javascript:{query}' }), /HTTPS/);
  assert.equal(new URL(searchURL('\ud800', { engine: 'google' })).searchParams.get('q'), '\ufffd');
});

test('proxy normalization canonicalizes DNS, IDN and bracketed IPv6 and keeps a separate integer port', () => {
  assert.deepEqual(normalizeProxy(), DEFAULT_PREFERENCES.proxy);
  assert.equal(normalizeProxy({ host: ' Proxy.EXAMPLE. ' }).host, 'proxy.example');
  assert.equal(normalizeProxy({ host: 'proxy.example', port: '3128' }).host, 'proxy.example');
  assert.equal(normalizeProxy({ host: 'proxy.example', port: '3128' }).port, 3128);
  assert.equal(normalizeProxy({ host: 'bücher.example' }).host, 'xn--bcher-kva.example');
  assert.equal(normalizeProxy({ enabled: true, type: 'socks5', host: '[0:0:0:0:0:0:0:1]', port: 1080 }).host, '[::1]');
  assert.equal(normalizeProxy({ enabled: 'true', host: '127.0.0.1' }).enabled, false);
});

test('proxy endpoints cannot smuggle credentials, fallback rules, ports, URLs or control characters', () => {
  for (const host of ['http://proxy.example', 'user:password@proxy.example', 'proxy.example:8080', 'proxy.example/path',
    'proxy.example,direct://', 'proxy.example;https=evil.test', 'proxy.example?x=1', 'proxy.example#part',
    'proxy.example\\evil.test', 'proxy.\nexample', '%65vil.test', '::1', '[::1]:3128', '[bad::ip]',
    '*', '-bad.example', 'bad..example', null, 123, 'a'.repeat(254)]) {
    assert.throws(() => normalizeProxy({ enabled: true, host }), undefined, String(host));
  }
  assert.throws(() => normalizeProxy({ enabled: true }), /host/);
  assert.throws(() => normalizeProxy({ type: 'pac' }), /HTTP/);
  for (const port of [0, 65536, -1, 1.5, '80;DIRECT', '8e3', ' 8080', true, null, '']) {
    assert.throws(() => normalizeProxy({ host: 'proxy.example', port }), /port/);
  }
});

test('proxy bypass lists preserve documented Chromium forms and order', () => {
  const bypass = ' LocalHost,127.0.0.1,[0:0::1]\n*.example.com,https://x.*.y.com:99,.internal,10.0.0.0/8,fefe:13::abc/33,<local>,<-loopback>,127.0.0.1';
  assert.equal(normalizeProxy({ bypass }).bypass,
    'localhost,127.0.0.1,[::1],*.example.com,https://x.*.y.com:99,.internal,10.0.0.0/8,fefe:13::abc/33,<local>,<-loopback>,127.0.0.1');
  assert.equal(normalizeProxy({ bypass: '' }).bypass, '');
  for (const invalid of ['example.com;direct://', 'http://user:secret@example.com', 'example.com/path', 'example.com?x=1',
    '10.0.0.0/33', 'fefe::/129', '[fefe::]/40', 'javascript://example.com', '<anything>', 'bad rule', 'host:0']) {
    assert.throws(() => normalizeProxy({ bypass: invalid }), undefined, invalid);
  }
  assert.throws(() => normalizeProxy({ bypass: 'x'.repeat(4097) }), /4096/);
  assert.throws(() => normalizeProxy({ bypass: Array.from({ length: 101 }, (_, i) => `host${i}`).join(',') }), /100/);
});

test('proxy public preferences contain no username or password, and credentials are not put in the endpoint', () => {
  const source = normalizeProxy({ enabled: true, type: 'https', host: 'proxy.example', port: 443, username: 'person', password: 'secret' });
  const result = publicProxyConfig(source);
  assert.equal(Object.hasOwn(result, 'username'), false);
  assert.equal(Object.hasOwn(result, 'password'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(source.password, 'secret');
  assert.equal(result.host, 'proxy.example');
});

test('SOCKS5 authentication and malformed credential inputs are rejected explicitly', () => {
  assert.throws(() => normalizeProxy({ type: 'socks5', username: 'person', password: 'secret' }), /does not support/);
  for (const input of [{ username: 'name:part' }, { password: 'bad\nvalue' }, { username: 1 }, { password: 'x'.repeat(1025) }]) {
    assert.throws(() => normalizeProxy(input));
  }
});

test('typing speed defaults safely and rejects invalid saved or IPC values', () => {
  assert.deepEqual(normalizeTyping(), {speed:1});
  assert.deepEqual(normalizeTyping({}), {speed:1});
  for (const speed of [0.25, 1, 2, 3]) assert.deepEqual(normalizeTyping({speed}), {speed});
  for (const speed of [0, -1, 3.25, NaN, Infinity, '2', true]) assert.throws(() => normalizeTyping({speed}));
  for (const input of [null, [], 'fast']) assert.throws(() => normalizeTyping(input));
});

test('general preferences default safely and handle reopen tabs boolean', () => {
  assert.deepEqual(normalizeGeneral(), { restoreTabs: true });
  assert.deepEqual(normalizeGeneral({}), { restoreTabs: true });
  assert.deepEqual(normalizeGeneral({ restoreTabs: false }), { restoreTabs: false });
  assert.deepEqual(normalizeGeneral({ restoreTabs: true }), { restoreTabs: true });
  for (const input of [null, [], 'general']) assert.throws(() => normalizeGeneral(input));
});

test('theme preferences default safely and normalize accent colors, mode and booleans', () => {
  assert.deepEqual(normalizeTheme(), {
    accentColor: '#b49bf8',
    hideLogo: false,
    hideModuleText: false,
    mode: 'dark',
  });
  assert.deepEqual(normalizeTheme({}), {
    accentColor: '#b49bf8',
    hideLogo: false,
    hideModuleText: false,
    mode: 'dark',
  });
  assert.deepEqual(normalizeTheme({ accentColor: '#ff0055', hideLogo: true, hideModuleText: true, mode: 'light' }), {
    accentColor: '#ff0055',
    hideLogo: true,
    hideModuleText: true,
    mode: 'light',
  });
  assert.deepEqual(normalizeTheme({ accentColor: '#ABCDEF' }), {
    accentColor: '#abcdef',
    hideLogo: false,
    hideModuleText: false,
    mode: 'dark',
  });
  assert.deepEqual(normalizeTheme({ accentColor: 'invalid' }), {
    accentColor: '#b49bf8',
    hideLogo: false,
    hideModuleText: false,
    mode: 'dark',
  });
  for (const input of [null, [], 'theme']) assert.throws(() => normalizeTheme(input));
});

test('shortcut preferences default safely and normalize key combinations', () => {
  assert.deepEqual(normalizeShortcuts(), { typing: 'Ctrl+9', fullscreen: 'Ctrl+F' });
  assert.deepEqual(normalizeShortcuts({}), { typing: 'Ctrl+9', fullscreen: 'Ctrl+F' });
  assert.deepEqual(normalizeShortcuts({ typing: 'Alt+9', fullscreen: 'Ctrl+Shift+F' }), {
    typing: 'Alt+9',
    fullscreen: 'Ctrl+Shift+F',
  });
  assert.deepEqual(normalizeShortcuts({ typing: 'invalid', fullscreen: '' }), {
    typing: 'Ctrl+9',
    fullscreen: 'Ctrl+F',
  });
  for (const input of [null, [], 'shortcuts']) assert.throws(() => normalizeShortcuts(input));
});

test('parseShortcut and matchesShortcut validate input and DOM keyboard events', () => {
  const parsedTyping = parseShortcut('Ctrl+9');
  assert.deepEqual(parsedTyping, { ctrl: true, alt: false, shift: false, meta: false, key: '9' });
  assert.equal(matchesShortcut(parsedTyping, { ctrlKey: true, key: '9' }), true);
  assert.equal(matchesShortcut(parsedTyping, { ctrlKey: false, key: '9' }), false);
  assert.equal(matchesShortcut(parsedTyping, { ctrlKey: true, altKey: true, key: '9' }), false);

  const parsedFull = parseShortcut('Ctrl+F');
  assert.equal(matchesShortcut(parsedFull, { ctrlKey: true, key: 'f' }), true);
  assert.equal(matchesShortcut(parsedFull, { ctrlKey: true, key: 'F' }), true);
  assert.equal(matchesShortcut(parsedFull, { ctrlKey: true, shiftKey: true, key: 'f' }), false);

  const parsedF11 = parseShortcut('F11');
  assert.equal(matchesShortcut(parsedF11, { key: 'F11' }), true);
  assert.equal(matchesShortcut(parsedF11, { ctrlKey: true, key: 'F11' }), false);
});
