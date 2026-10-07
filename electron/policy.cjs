'use strict';

const { searchURL } = require('./preferences.cjs');

function normalizeHost(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a hostname, such as example.com.');
  let input = value.trim();
  if (!input || /[\s*]/.test(input)) throw new Error('Enter an exact hostname; use the subdomains switch for subdomains.');
  const url = new URL(input.includes('://') ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP and HTTPS sites are supported.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Site rules use hostnames, without paths or queries.');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('Enter a valid hostname.');
  return host;
}

function matchesRule(value, rule) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const target = normalizeHost(rule.host);
    return host === target || (rule.includeSubdomains === true && host.endsWith(`.${target}`));
  } catch { return false; }
}

function normalizeRules(rules) {
  if (!Array.isArray(rules) || rules.length > 200) throw new Error('Use up to 200 site rules.');
  const seen = new Set();
  return rules.map(rule => {
    const host = normalizeHost(rule.host);
    if (seen.has(host)) throw new Error(`A rule for ${host} already exists.`);
    seen.add(host);
    return { id: host, host, includeSubdomains: rule.includeSubdomains === true, monitor: rule.monitor === true, focus: rule.focus === true };
  });
}

function navigationURL(value, search) {
  const input = String(value || '').trim().slice(0, 8192);
  if (!input || input === 'about:blank') return 'about:blank';
  // URLs with active or local schemes must never reach a privileged renderer.
  if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^https?:/i.test(input) && !/^(localhost|[\w.-]+\.[\w.-]+):\d+([/?#]|$)/i.test(input)) {
    throw new Error('Only HTTP and HTTPS addresses can be opened.');
  }
  let candidate = input;
  if (!/^https?:\/\//i.test(input)) {
    if (!/\s/.test(input) && (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(input))) candidate = `http://${input}`;
    else if (!/\s/.test(input) && /^[^/]+\.[^/]+/.test(input)) candidate = `https://${input}`;
    else return searchURL(input, search);
  }
  const url = new URL(candidate);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP or HTTPS address without embedded credentials.');
  return url.href;
}

function isWebURL(value) { try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; } }
module.exports = { normalizeHost, matchesRule, normalizeRules, navigationURL, isWebURL };
