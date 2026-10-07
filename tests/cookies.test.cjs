'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FORMAT, VERSION, MAX_COOKIES, MAX_FILE_BYTES,
  normalizeCookieHost, normalizeCookie, normalizeCookieExport,
  makeCookieExport, cookieSetDetails, parseCookieExportText,
} = require('../electron/cookies.cjs');

test('cookie export uses an explicit versioned format and preserves browser flags', () => {
  const output = makeCookieExport([{
    name: 'session', value: 'opaque-token', domain: '.Example.com', path: '/account',
    secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 2_000_000_000,
  }], { host: 'example.com' });
  assert.equal(output.format, FORMAT);
  assert.equal(output.version, VERSION);
  assert.equal(output.scope, 'site');
  assert.equal(output.host, 'example.com');
  assert.match(output.exportedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(output.cookies[0], {
    name: 'session', value: 'opaque-token', domain: '.example.com', path: '/account',
    secure: true, httpOnly: true, sameSite: 'lax', expirationDate: 2_000_000_000,
    url: 'https://example.com/account',
  });
  assert.deepEqual(cookieSetDetails(output.cookies[0]), {
    url: 'https://example.com/account', name: 'session', value: 'opaque-token',
    path: '/account', secure: true, httpOnly: true, sameSite: 'lax', domain: '.example.com',
    expirationDate: 2_000_000_000,
  });
});

test('session cookies retain session semantics and imports preserve host-only semantics without arbitrary fields', () => {
  const result = normalizeCookieExport({
    format: FORMAT, version: VERSION, scope: 'all', cookies: [{
      name: 'temp', value: '', domain: 'localhost', path: '/', session: true,
      arbitrary: 'discard me', hostOnly: true,
    }],
  });
  assert.deepEqual(result.cookies[0], {
    name: 'temp', value: '', domain: 'localhost', path: '/', secure: false, httpOnly: false,
    sameSite: 'unspecified', url: 'http://localhost/', hostOnly: true, session: true,
  });
  assert.equal(Object.hasOwn(result.cookies[0], 'arbitrary'), false);
  assert.deepEqual(cookieSetDetails(result.cookies[0]), {
    url: 'http://localhost/', name: 'temp', value: '', path: '/', secure: false,
    httpOnly: false, sameSite: 'unspecified',
  });
});

test('domains, URLs and IPv6 literals are canonicalized with matching boundaries', () => {
  assert.equal(normalizeCookieHost(' .EXAMPLE.com. '), '.example.com');
  assert.equal(normalizeCookieHost('[0:0:0:0:0:0:0:1]'), '[::1]');
  assert.equal(normalizeCookie({ name: 'id', value: '1', domain: '.example.com', url: 'https://a.example.com/' }).domain, '.example.com');
  assert.throws(() => normalizeCookie({ name: 'id', value: '1', domain: '.example.com', url: 'https://evil.example/' }), /does not match/);
  assert.throws(() => normalizeCookie({ name: 'id', value: '1', domain: '.example.com', secure: true, url: 'http://example.com/' }), /HTTPS/);
});

test('cookie records reject active schemes, credentials, controls, malformed fields and unsafe sizes', () => {
  const invalid = [
    { name: 'a;b', value: '1', domain: 'example.com' },
    { name: 'a', value: '1\n2', domain: 'example.com' },
    { name: 'a', value: '1', domain: 'bad domain' },
    { name: 'a', value: '1', domain: 'example.com', path: 'relative' },
    { name: 'a', value: '1', domain: 'example.com', url: 'javascript:alert(1)' },
    { name: 'a', value: '1', domain: 'example.com', url: 'https://user:secret@example.com/' },
    { name: 'a', value: '1', domain: 'example.com', secure: 'true' },
    { name: 'a', value: '1', domain: 'example.com', sameSite: 'none' },
    { name: 'a', value: '1', domain: 'example.com', expirationDate: Infinity },
    { name: 'a', value: '1', domain: 'example.com', expirationDate: -1 },
    { name: 'a', value: '1', domain: 'example.com', expirationDate: 253402300800 },
  ];
  for (const cookie of invalid) assert.throws(() => normalizeCookie(cookie), undefined, JSON.stringify(cookie));
  assert.throws(() => normalizeCookie({ name: 'a', value: 'x'.repeat(4097), domain: 'example.com' }), /value/);
  assert.throws(() => normalizeCookie({ name: 'a', value: '1', domain: 'example.com', path: `/${'x'.repeat(2048)}` }), /path/);
});

test('site exports reject cookies outside their selected host family', () => {
  const base = { format: FORMAT, version: VERSION, scope: 'site', host: 'example.com', cookies: [] };
  assert.throws(() => normalizeCookieExport({ ...base, cookies: [{ name: 'id', value: '1', domain: 'evil.test' }] }), /another website/);
  assert.doesNotThrow(() => normalizeCookieExport({ ...base, cookies: [{ name: 'id', value: '1', domain: '.example.com' }] }));
  assert.doesNotThrow(() => normalizeCookieExport({ ...base, cookies: [{ name: 'id', value: '1', domain: 'sub.example.com' }] }));
});

test('imports validate file shape, version, scope and bounded cookie count', () => {
  const valid = JSON.stringify({ format: FORMAT, version: VERSION, scope: 'all', cookies: [] });
  assert.deepEqual(parseCookieExportText(valid).cookies, []);
  for (const value of [null, '{}', JSON.stringify({ format: 'other', version: VERSION, scope: 'all', cookies: [] }),
    JSON.stringify({ format: FORMAT, version: 2, scope: 'all', cookies: [] }),
    JSON.stringify({ format: FORMAT, version: VERSION, scope: 'selected', cookies: [] }),
    JSON.stringify({ format: FORMAT, version: VERSION, scope: 'site', cookies: [] }),
    JSON.stringify({ format: FORMAT, version: VERSION, scope: 'all', cookies: {} })]) {
    assert.throws(() => parseCookieExportText(value), undefined, String(value));
  }
  assert.throws(() => normalizeCookieExport({ format: FORMAT, version: VERSION, scope: 'all', cookies: Array.from({ length: MAX_COOKIES + 1 }, () => ({ name: 'a', value: '1', domain: 'example.com' })) }), /10000/);
  assert.throws(() => parseCookieExportText('x'.repeat(MAX_FILE_BYTES + 1)), /too large/);
});

test('cookie exports never place raw cookie values in the import result metadata', () => {
  const output = makeCookieExport([{ name: 'auth', value: 'secret-token', domain: 'example.com' }]);
  assert.equal(output.exportedAt.includes('secret-token'), false);
  assert.equal(JSON.stringify({ format: output.format, version: output.version, scope: output.scope, exportedAt: output.exportedAt }).includes('secret-token'), false);
});
