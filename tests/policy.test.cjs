'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHost, matchesRule, normalizeRules, navigationURL, isWebURL } = require('../electron/policy.cjs');

test('site rules canonicalize casing, terminal dots, IDNs and URL input', () => {
  assert.equal(normalizeHost('  Example.COM.  '), 'example.com');
  assert.equal(normalizeHost('https://Example.COM:8443/'), 'example.com');
  assert.equal(normalizeHost('bücher.example'), 'xn--bcher-kva.example');
  assert.equal(normalizeHost('http://localhost:8080'), 'localhost');
  assert.equal(normalizeHost('[::1]'), '[::1]');
});

test('site rules reject credentials, active/local schemes, paths, query strings and wildcards', () => {
  for (const input of ['', '   ', '*.example.com', 'exa mple.com', 'https://user:password@example.com',
    'javascript:alert(1)', 'file:///tmp/page.html', 'ftp://example.com', 'https://example.com/path',
    'example.com?tracking=1', 'example.com#fragment', 'x'.repeat(2049), null, 12]) {
    assert.throws(() => normalizeHost(input), undefined, String(input));
  }
});

test('exact matching cannot capture suffix lookalikes, credential host confusion or extra subdomains', () => {
  const rule = { host: 'Example.com' };
  for (const url of ['https://example.com/', 'http://example.com:8080/a', 'https://EXAMPLE.COM./a']) {
    assert.equal(matchesRule(url, rule), true, url);
  }
  for (const url of ['https://sub.example.com', 'https://notexample.com', 'https://example.com.evil.test',
    'https://example.com@evil.test', 'file://example.com/path', 'data:text/html,example.com', 'about:blank', 'not a URL']) {
    assert.equal(matchesRule(url, rule), false, url);
  }
});

test('subdomain matching requires an actual DNS label boundary and explicit boolean opt-in', () => {
  const rule = { host: 'example.com', includeSubdomains: true };
  assert.equal(matchesRule('https://a.b.example.com/', rule), true);
  assert.equal(matchesRule('https://notexample.com/', rule), false);
  assert.equal(matchesRule('https://example.com.other/', rule), false);
  assert.equal(matchesRule('https://sub.example.com/', { ...rule, includeSubdomains: 'true' }), false);
  assert.equal(matchesRule('https://bücher.example/', { host: 'xn--bcher-kva.example' }), true);
});

test('rule normalization keeps only supported fields and does not coerce feature switches', () => {
  const source = [{ host: 'https://EXAMPLE.com/', includeSubdomains: true, monitor: 'true', focus: 1, id: 'forged', arbitrary: 'ignored' }];
  assert.deepEqual(normalizeRules(source), [{ id: 'example.com', host: 'example.com', includeSubdomains: true, monitor: false, focus: false }]);
  assert.equal(source[0].host, 'https://EXAMPLE.com/');
  assert.deepEqual(normalizeRules([{ host: 'example.com', monitor: true, focus: true }])[0], {
    id: 'example.com', host: 'example.com', includeSubdomains: false, monitor: true, focus: true,
  });
});

test('rules reject duplicate canonical hosts and enforce the rule count limit', () => {
  assert.throws(() => normalizeRules([{ host: 'EXAMPLE.com' }, { host: 'https://example.com./' }]), /already exists/);
  assert.throws(() => normalizeRules([{ host: 'bücher.example' }, { host: 'xn--bcher-kva.example' }]), /already exists/);
  assert.throws(() => normalizeRules(Array.from({ length: 201 }, (_, i) => ({ host: `site${i}.example` }))), /200/);
  assert.throws(() => normalizeRules({ host: 'example.com' }), /200/);
  assert.deepEqual(normalizeRules([]), []);
});

test('address bar admits HTTP(S), blank page, local fixtures and ordinary domain names', () => {
  assert.equal(navigationURL(' https://Example.COM/path?q=hello#part '), 'https://example.com/path?q=hello#part');
  assert.equal(navigationURL('example.com'), 'https://example.com/');
  assert.equal(navigationURL('example.com:8443/path'), 'https://example.com:8443/path');
  assert.equal(navigationURL('localhost:8123/path'), 'http://localhost:8123/path');
  assert.equal(navigationURL('127.0.0.1:8123'), 'http://127.0.0.1:8123/');
  assert.equal(navigationURL('[::1]:8123'), 'http://[::1]:8123/');
  assert.equal(navigationURL('about:blank'), 'about:blank');
  assert.equal(navigationURL(''), 'about:blank');
});

test('address bar cannot navigate to executable/local/application schemes or embedded credentials', () => {
  for (const input of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd', 'view-source:https://example.com', 'chrome://settings', 'devtools://devtools',
    'about:config', 'mailto:person@example.com', 'ws://example.com', 'https://user:secret@example.com']) {
    assert.throws(() => navigationURL(input), undefined, input);
  }
});

test('search text is escaped into the search provider query', () => {
  const text = 'cats & dogs #pictures';
  const result = new URL(navigationURL(text));
  assert.equal(result.origin, 'https://duckduckgo.com');
  assert.equal(result.searchParams.get('q'), text);
  assert.equal(result.hash, '');
  assert.equal([...result.searchParams].length, 1);
});

test('protocol guard permits only web URLs and rejects malformed values', () => {
  for (const url of ['https://example.com', 'http://localhost:8080']) assert.equal(isWebURL(url), true);
  for (const url of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/plain,hello', 'about:blank', 'ws://example.com', 'example.com', '', null]) {
    assert.equal(isWebURL(url), false, String(url));
  }
});
