'use strict';

const { normalizeHost, isWebURL } = require('./policy.cjs');

// Cookie exports contain session credentials by design. Keep the format small,
// explicit and bounded so a malformed or unexpectedly large file cannot make
// the browser import arbitrary data or consume unbounded memory.
const FORMAT = 'prism-cookie-export';
const VERSION = 1;
const MAX_COOKIES = 10_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_NAME_BYTES = 512;
const MAX_VALUE_BYTES = 4096;
const MAX_DOMAIN_BYTES = 512;
const MAX_PATH_BYTES = 2048;
const MAX_URL_BYTES = 4096;
const MAX_EXPIRATION = 253402300799; // 9999-12-31T23:59:59Z, in Unix seconds.
const SAME_SITE = new Set(['unspecified', 'no_restriction', 'lax', 'strict']);

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function stringField(value, label, maxBytes, { allowEmpty = true } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || Buffer.byteLength(value, 'utf8') > maxBytes ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid cookie ${label}.`);
  }
  return value;
}

function normalizeCookieHost(value) {
  if (typeof value !== 'string') throw new Error('Invalid cookie domain.');
  const input = value.trim();
  if (!input || input.length > MAX_DOMAIN_BYTES || /[\s\u0000-\u001f\u007f/@?#\\]/u.test(input)) {
    throw new Error('Invalid cookie domain.');
  }
  const dotted = input.startsWith('.');
  const bare = input.replace(/^\.+/, '');
  if (!bare || (dotted && input.startsWith('..'))) throw new Error('Invalid cookie domain.');
  let host;
  try {
    // URL.hostnames retain brackets for IPv6 literals; policy normalization
    // expects the same URL form rather than a bare colon separated address.
    const hostInput = bare.includes(':') && !bare.startsWith('[') ? `[${bare}]` : bare;
    host = normalizeHost(hostInput);
  } catch { throw new Error('Invalid cookie domain.'); }
  return `${dotted ? '.' : ''}${host}`;
}

function normalizeCookieURL(value, label = 'URL') {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_URL_BYTES || !isWebURL(value)) {
    throw new Error(`Invalid cookie ${label}.`);
  }
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.hash) throw new Error(`Invalid cookie ${label}.`);
  return parsed.href;
}

function cookieHost(cookie, fallbackHost) {
  if (cookie.domain) return normalizeCookieHost(cookie.domain).replace(/^\./, '');
  if (fallbackHost) return normalizeCookieHost(fallbackHost).replace(/^\./, '');
  throw new Error('Cookie must include a domain.');
}

function cookieDomainInScope(domain, host) {
  const cookieName = normalizeCookieHost(domain).replace(/^\./, '').toLowerCase();
  const siteName = normalizeCookieHost(host).replace(/^\./, '').toLowerCase();
  return cookieName === siteName || cookieName.endsWith(`.${siteName}`);
}

function formatHost(host) {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function cookieURL(cookie, fallbackHost) {
  const host = formatHost(cookieHost(cookie, fallbackHost));
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`;
}

/**
 * Convert an Electron Cookie object (or an imported cookie record) into the
 * portable subset accepted by session.cookies.set. Unsupported unknown
 * properties are discarded; host-only semantics are retained separately and
 * reproduced by omitting the domain at import time.
 * The URL is retained in the export because Electron does not return one from
 * cookies.get and cookies.set always requires one.
 */
function normalizeCookie(value, { fallbackHost = '', requireURL = false } = {}) {
  const input = plainObject(value, 'cookie record');
  const name = stringField(input.name, 'name', MAX_NAME_BYTES);
  if (/[;=]/u.test(name)) throw new Error('Invalid cookie name.');
  const cookieValue = stringField(input.value, 'value', MAX_VALUE_BYTES);
  const domain = input.domain === undefined ? undefined : normalizeCookieHost(input.domain);
  const hostOnly = input.hostOnly === undefined ? undefined : input.hostOnly;
  if (hostOnly !== undefined && typeof hostOnly !== 'boolean') throw new Error('Invalid cookie hostOnly flag.');
  if (hostOnly === false && !domain) throw new Error('Cookie hostOnly=false requires a domain.');
  const path = input.path === undefined ? '/' : stringField(input.path, 'path', MAX_PATH_BYTES, { allowEmpty: false });
  if (!path.startsWith('/')) throw new Error('Invalid cookie path.');
  const secure = input.secure === undefined ? false : input.secure;
  const httpOnly = input.httpOnly === undefined ? false : input.httpOnly;
  if (typeof secure !== 'boolean' || typeof httpOnly !== 'boolean') throw new Error('Invalid cookie flags.');
  const sameSite = input.sameSite === undefined ? 'unspecified' : input.sameSite;
  if (typeof sameSite !== 'string' || !SAME_SITE.has(sameSite)) throw new Error('Invalid cookie SameSite policy.');
  const session = input.session === undefined ? input.expirationDate === undefined : input.session;
  if (typeof session !== 'boolean') throw new Error('Invalid cookie session flag.');
  let expirationDate;
  if (input.expirationDate !== undefined) {
    if (typeof input.expirationDate !== 'number' || !Number.isFinite(input.expirationDate) ||
        input.expirationDate < 0 || input.expirationDate > MAX_EXPIRATION) throw new Error('Invalid cookie expiration.');
    expirationDate = input.expirationDate;
  }
  const url = input.url === undefined ? cookieURL({ domain, path, secure }, fallbackHost) : normalizeCookieURL(input.url);
  const parsedURL = new URL(url);
  const host = parsedURL.hostname.toLowerCase().replace(/\.$/, '');
  if (domain) {
    const domainHost = domain.replace(/^\./, '').toLowerCase();
    const sameHost = host === domainHost;
    const subdomain = host.endsWith(`.${domainHost}`);
    if (!sameHost && !subdomain) throw new Error('Cookie URL does not match its domain.');
    if (secure && parsedURL.protocol !== 'https:') throw new Error('Secure cookies require an HTTPS URL.');
  }
  // session cookies must not carry an expiry into Chromium; persistent cookies
  // without one are safe to import as session cookies.
  const output = { name, value: cookieValue, path, secure, httpOnly, sameSite, url };
  if (domain) output.domain = domain;
  if (hostOnly !== undefined) output.hostOnly = hostOnly;
  if (!session && expirationDate !== undefined) output.expirationDate = expirationDate;
  if (session) output.session = true;
  return output;
}

function normalizeCookieExport(value) {
  const input = plainObject(value, 'cookie export');
  if (input.format !== FORMAT || input.version !== VERSION) throw new Error('Unsupported cookie export format.');
  if (input.scope !== 'all' && input.scope !== 'site') throw new Error('Invalid cookie export scope.');
  const host = input.scope === 'site' ? normalizeCookieHost(input.host).replace(/^\./, '') : undefined;
  if (!Array.isArray(input.cookies) || input.cookies.length > MAX_COOKIES) throw new Error(`Cookie exports support up to ${MAX_COOKIES} cookies.`);
  const cookies = input.cookies.map(cookie => normalizeCookie(cookie, { fallbackHost: host, requireURL: true }));
  if (host) {
    for (const cookie of cookies) {
      if (!cookieDomainInScope(cookie.domain || host, host)) {
        throw new Error('Site cookie export contains a cookie for another website.');
      }
    }
  }
  return { format: FORMAT, version: VERSION, scope: input.scope, ...(host ? { host } : {}), cookies };
}

function makeCookieExport(cookies, { host } = {}) {
  if (!Array.isArray(cookies) || cookies.length > MAX_COOKIES) throw new Error(`Cookie exports support up to ${MAX_COOKIES} cookies.`);
  const siteHost = host === undefined ? undefined : normalizeCookieHost(host).replace(/^\./, '');
  const normalized = cookies.map(cookie => normalizeCookie(cookie, { fallbackHost: siteHost }));
  const scoped = siteHost ? normalized.filter(cookie => cookieDomainInScope(cookie.domain || siteHost, siteHost)) : normalized;
  if (siteHost && scoped.length !== normalized.length) throw new Error('Site cookie export contains a cookie for another website.');
  return { format: FORMAT, version: VERSION, scope: siteHost ? 'site' : 'all', ...(siteHost ? { host: siteHost } : {}), exportedAt: new Date().toISOString(), cookies: scoped };
}

function cookieSetDetails(cookie) {
  // session.cookies.set rejects unknown Cookie fields, so make the boundary
  // explicit and keep export metadata out of Chromium's API.
  const details = { url: cookie.url, name: cookie.name, value: cookie.value, path: cookie.path,
    secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite };
  if (cookie.domain && cookie.hostOnly !== true) details.domain = cookie.domain;
  if (cookie.expirationDate !== undefined && !cookie.session) details.expirationDate = cookie.expirationDate;
  return details;
}

function parseCookieExportText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) throw new Error('Cookie export is too large.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Cookie export is not valid JSON.'); }
  return normalizeCookieExport(parsed);
}

module.exports = {
  FORMAT, VERSION, MAX_COOKIES, MAX_FILE_BYTES, MAX_EXPIRATION,
  normalizeCookieHost, normalizeCookieURL, normalizeCookie, normalizeCookieExport,
  makeCookieExport, cookieSetDetails, parseCookieExportText, cookieDomainInScope,
};
