'use strict';

const { DEFAULT_PREFERENCES, normalizeProxy, normalizeProxyHost } = require('./preferences.cjs');

function sessionProxyConfig(config) {
  return config.enabled ? {
    mode: 'fixed_servers',
    proxyRules: `${config.type}://${config.host}:${config.port}`,
    proxyBypassRules: config.bypass,
  } : { mode: 'direct' };
}

function sameEndpoint(left, right) {
  return left.host === right.host && left.port === right.port && left.type === right.type;
}

/**
 * One controller per browsing session. Await apply() before creating browsing tabs.
 * Only getConfig() contains credentials; keep it in the main process. Use
 * publicProxyConfig() for persistence and snapshot() for safe runtime status.
 * app.on('login', (event, contents, details, info, callback) => {
 *   // The caller must restrict contents.session to this controller's session.
 *   controller.handleLogin(event, info, callback, details);
 * });
 */
class ProxyController {
  constructor({ session }) {
    if (!session || typeof session.setProxy !== 'function' || typeof session.closeAllConnections !== 'function') {
      throw new Error('ProxyController requires an Electron browsing session.');
    }
    this.session = session;
    this._config = normalizeProxy(DEFAULT_PREFERENCES.proxy);
    this._authConfig = null;
    this._active = false;
    this._initialized = false;
    this._credentialStatus = 'none';
    this._error = '';
    this._queue = Promise.resolve();
  }

  getConfig() { return { ...this._config }; }

  snapshot() {
    return {
      configured: Boolean(this._config.host),
      active: this._active,
      credentialStatus: this._credentialStatus,
      ...(this._error ? { error: this._error } : {}),
    };
  }

  apply(input) {
    let candidate;
    try { candidate = normalizeProxy(input); }
    catch (error) { return Promise.reject(error); }
    const keepUsername = !Object.hasOwn(input, 'username');
    const keepPassword = !Object.hasOwn(input, 'password');
    const pending = this._queue.then(async () => {
      const prior = this._config;
      const next = { ...candidate };
      if (sameEndpoint(next, prior)) {
        if (keepUsername) next.username = prior.username;
        if (keepPassword) next.password = prior.password;
      }
      if (this._initialized && !this._error && JSON.stringify(next) === JSON.stringify(prior)) return this.snapshot();
      const priorActive = this._active;
      const priorStatus = this._credentialStatus;
      this._authConfig = null;
      try {
        await this.session.setProxy(sessionProxyConfig(next));
        if (typeof this.session.clearAuthCache === 'function') await this.session.clearAuthCache();
        await this.session.closeAllConnections();
      } catch {
        // A failed update must not silently turn an existing proxy into a direct connection.
        let restored = false;
        try {
          await this.session.setProxy(sessionProxyConfig(prior));
          if (typeof this.session.clearAuthCache === 'function') await this.session.clearAuthCache();
          await this.session.closeAllConnections();
          restored = true;
        } catch { /* Expose uncertainty instead of claiming a proxy is active. */ }
        this._active = restored ? priorActive : false;
        this._authConfig = restored ? prior : null;
        this._credentialStatus = priorStatus;
        this._error = restored
          ? 'Could not apply proxy settings. The previous connection settings were restored.'
          : 'Could not apply or restore proxy settings. Restart the browser before browsing.';
        throw new Error(this._error);
      }
      this._config = next;
      this._authConfig = next;
      this._active = next.enabled;
      this._initialized = true;
      this._credentialStatus = next.type === 'socks5' ? 'unsupported' : (next.username || next.password ? 'session' : 'none');
      this._error = '';
      return this.snapshot();
    });
    // A rejected operation must not poison later saves or race a subsequent setProxy().
    this._queue = pending.catch(() => {});
    return pending;
  }

  handleLogin(event, authInfo, callback, details = {}) {
    if (authInfo?.isProxy !== true) return false;
    const config = this._authConfig;
    let matching = false;
    try {
      // Electron may report IPv6 authentication hosts with or without brackets.
      const host = typeof authInfo.host === 'string' && authInfo.host.includes(':') && !authInfo.host.startsWith('[')
        ? `[${authInfo.host}]` : authInfo.host;
      matching = Boolean(config?.enabled && ['http', 'https'].includes(config.type)
        && normalizeProxyHost(host) === config.host && authInfo.port === config.port);
    } catch { /* Malformed or unrelated auth challenges never receive credentials. */ }
    event.preventDefault();
    if (matching && details.firstAuthAttempt === false) {
      this._credentialStatus = 'rejected';
      callback();
    } else if (matching && (config.username || config.password)) {
      callback(config.username, config.password);
    } else {
      if (matching) this._credentialStatus = 'required';
      callback();
    }
    return true;
  }
}

module.exports = { ProxyController, sessionProxyConfig };
