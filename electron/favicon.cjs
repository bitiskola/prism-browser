'use strict';

const { createHash } = require('node:crypto');

// Favicon URLs arrive from untrusted pages. Keep the renderer limited to
// ordinary web images and small data images, so a page cannot turn a tab icon
// into a navigation or script injection surface.
const MAX_FAVICON_URL_LENGTH = 1024 * 1024;
const REMOTE_SCHEMES = new Set(['http:', 'https:']);
const DATA_IMAGE = /^data:(image\/(?:png|gif|jpe?g|webp|x-icon|svg\+xml))(?:;[^,]*)?,/i;

function normalizeFaviconURL(value) {
  if (typeof value !== 'string') return '';
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_FAVICON_URL_LENGTH) return '';

  if (/^data:/i.test(candidate)) return DATA_IMAGE.test(candidate) ? candidate : '';
  if (candidate.length > 8192) return '';
  try {
    const url = new URL(candidate);
    if (!REMOTE_SCHEMES.has(url.protocol) || !url.hostname || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function pickFaviconURL(favicons) {
  if (!Array.isArray(favicons)) return '';
  for (const favicon of favicons) {
    const safe = normalizeFaviconURL(favicon);
    if (safe) return safe;
  }
  return '';
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PNG_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 7000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;

function pageOrigin(value) {
  try { const url = new URL(value); return REMOTE_SCHEMES.has(url.protocol) ? url.origin : ''; } catch { return ''; }
}

function faviconCandidates(values, pageURL) {
  const candidates = Array.isArray(values) ? values.slice(0, 12).map(normalizeFaviconURL).filter(Boolean) : [];
  const origin = pageOrigin(pageURL);
  if (origin) candidates.push(`${origin}/favicon.ico`);
  return [...new Set(candidates)];
}

function dataImageBytes(value) {
  const comma = value.indexOf(',');
  const metadata = value.slice(0, comma);
  const content = value.slice(comma + 1);
  const bytes = /;base64$/i.test(metadata) ? Buffer.from(content, 'base64') : Buffer.from(decodeURIComponent(content));
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Invalid favicon size.');
  return { bytes, mime: metadata.slice(5).split(';')[0] };
}

async function readImageResponse(response, signal) {
  if (!response.ok || !response.body) throw new Error('Favicon unavailable.');
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error('Favicon too large.'); }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Favicon canceled.');
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) throw new Error('Favicon too large.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (!total) throw new Error('Empty favicon.');
  return { bytes: Buffer.concat(chunks, total), mime: response.headers.get('content-type')?.split(';')[0] || 'image/x-icon' };
}

// Rasterize formats NativeImage cannot decode (notably SVG on Linux) in an
// owned, sandboxed decoder document. Never run decoding inside the website:
// its CSP may forbid data images, and its policy must remain unchanged.
function createImageDecoder(nativeImage, getDecoderContents) {
  return async (bytes, { mime }) => {
    let decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty() && /^image\/(?:svg\+xml|x-icon|vnd\.microsoft\.icon|gif|webp)$/i.test(mime) && getDecoderContents) {
      const webContents = await getDecoderContents();
      if (!webContents || webContents.isDestroyed()) return '';
      const source = `data:${mime};base64,${bytes.toString('base64')}`;
      const result = await webContents.executeJavaScriptInIsolatedWorld(1003, [{ code: `new Promise(resolve => {
        const image = new Image();
        const timer = setTimeout(() => { image.src = ''; resolve(''); }, 3000);
        image.onload = () => {
          clearTimeout(timer);
          if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096) return resolve('');
          const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
          try { canvas.getContext('2d').drawImage(image, 0, 0, 32, 32); resolve(canvas.toDataURL('image/png')); } catch { resolve(''); }
        };
        image.onerror = () => { clearTimeout(timer); resolve(''); };
        image.src = ${JSON.stringify(source)};
      })` }]);
      if (typeof result !== 'string' || !result.startsWith('data:image/png;base64,') || result.length > MAX_PNG_BYTES * 2) return '';
      decoded = nativeImage.createFromDataURL(result);
    }
    if (decoded.isEmpty()) return '';
    const { width, height } = decoded.getSize();
    if (!width || !height || width > 4096 || height > 4096) return '';
    const png = decoded.resize({ width: 32, height: 32, quality: 'good' }).toPNG();
    return png.length && png.length <= MAX_PNG_BYTES ? `data:image/png;base64,${png.toString('base64')}` : '';
  };
}

class FaviconController {
  constructor({ session, decode, canFetch = () => true, onChange = () => {} }) {
    this.session = session;
    this.decode = decode;
    this.canFetch = canFetch;
    this.onChange = onChange;
    this.tabs = new Map();
    this.cache = new Map();
  }

  attach(webContents, id) {
    this.detach(id);
    const state = { id, webContents, url: webContents.getURL(), origin: pageOrigin(webContents.getURL()), icon: '', revision: 0, request: null };
    state.onNavigation = (event, url, inPlace, isMainFrame) => {
      if (!(event.isMainFrame ?? isMainFrame) || (event.isSameDocument ?? inPlace)) return;
      this.navigate(state, event.url ?? url);
    };
    state.onCommitted = (event, url) => {
      const next = event.url ?? url ?? webContents.getURL();
      if (state.url !== next) this.navigate(state, next);
    };
    state.onIcons = (_event, values) => {
      if (pageOrigin(webContents.getURL()) !== state.origin) return;
      void this.load(state, values);
    };
    state.onFinished = () => { if (!state.icon && !state.request && pageOrigin(webContents.getURL()) === state.origin) void this.load(state, []); };
    state.onDestroyed = () => this.detach(id);
    webContents.on('did-start-navigation', state.onNavigation);
    webContents.on('did-redirect-navigation', state.onNavigation);
    webContents.on('did-navigate', state.onCommitted);
    webContents.on('page-favicon-updated', state.onIcons);
    webContents.on('did-finish-load', state.onFinished);
    webContents.once('destroyed', state.onDestroyed);
    this.tabs.set(id, state);
  }

  navigate(state, nextURL) {
    state.revision++;
    state.request?.abort(); state.request = null;
    const origin = pageOrigin(nextURL);
    state.url = nextURL;
    if (origin !== state.origin || !origin) { state.icon = ''; this.onChange(state.id, ''); }
    state.origin = origin;
  }

  async fetchImage(url, pageURL, signal) {
    if (/^data:/i.test(url)) return dataImageBytes(url);
    for (let redirects = 0; redirects <= 5; redirects++) {
      if (signal.aborted || !this.canFetch()) throw new Error('Favicon networking paused.');
      const response = await this.session.fetch(url, { credentials: 'include', referrer: pageURL, redirect: 'manual', signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const next = location && normalizeFaviconURL(new URL(location, url).href);
        if (!next || !/^https?:/i.test(next)) throw new Error('Unsupported favicon redirect.');
        url = next;
        continue;
      }
      return readImageResponse(response, signal);
    }
    throw new Error('Too many favicon redirects.');
  }

  async load(state, values) {
    if (!state.origin || !this.canFetch()) return;
    state.request?.abort();
    const request = new AbortController();
    state.request = request;
    const revision = ++state.revision;
    const pageURL = state.url;
    const valid = () => !request.signal.aborted && this.tabs.get(state.id) === state && state.revision === revision && this.canFetch();
    const timer = setTimeout(() => request.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    try {
      for (const candidate of faviconCandidates(values, pageURL)) {
        if (!valid()) return;
        const key = `${state.origin}|${createHash('sha256').update(candidate).digest('hex')}`;
        const cached = this.cache.get(key);
        let icon = cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.icon : '';
        if (!icon) {
          try {
            const image = await this.fetchImage(candidate, pageURL, request.signal);
            if (!valid()) return;
            icon = await this.decode(image.bytes, { mime: image.mime });
            if (!valid()) return;
            if (!/^data:image\/png;base64,[a-z\d+/=]+$/i.test(icon) || icon.length > MAX_PNG_BYTES * 2) continue;
            this.cache.delete(key);
            this.cache.set(key, { icon, at: Date.now() });
            while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
          } catch { continue; }
        }
        if (!valid()) return;
        state.icon = icon;
        this.onChange(state.id, icon);
        return;
      }
      // A transient error or empty favicon event must not remove a valid icon.
    } finally { clearTimeout(timer); if (state.request === request) state.request = null; }
  }

  cancelAll() {
    for (const state of this.tabs.values()) { state.revision++; state.request?.abort(); state.request = null; }
  }

  detach(id) {
    const state = this.tabs.get(id);
    if (!state) return;
    this.tabs.delete(id); state.revision++; state.request?.abort();
    for (const [event, listener] of [['did-start-navigation', state.onNavigation], ['did-redirect-navigation', state.onNavigation], ['did-navigate', state.onCommitted], ['page-favicon-updated', state.onIcons], ['did-finish-load', state.onFinished], ['destroyed', state.onDestroyed]]) state.webContents.removeListener(event, listener);
  }
}

module.exports = { MAX_FAVICON_URL_LENGTH, MAX_IMAGE_BYTES, normalizeFaviconURL, pickFaviconURL, faviconCandidates, createImageDecoder, FaviconController };
