# Prism Browser

A small desktop browser with a dedicated persistent profile, a modern dark interface, configurable search and proxy, Adblock Plus filtering, and per-site network and focus controls. Built with Electron and Chromium. The desktop app opens real websites in native `WebContentsView` tabs.

## Run

Install **Node.js 22.12 or newer** and run these commands in this folder:

```sh
npm ci
npm start
```

The first launch downloads the Electron runtime from its official distribution. Supported desktop targets are Windows, macOS, and Linux. Linux needs a graphical desktop and Chromium's sandbox support. Keep sandbox support enabled.

On the Linux desktop used to build this project, the following uses its existing system sandbox helper:

```sh
CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox npm start
```

Use that command only when this system helper exists on your computer. Other desktops normally use their own Chromium sandbox setup. The supplied Linux AppImage can similarly inherit `CHROME_DEVEL_SANDBOX`. A sandbox startup error requires a working host sandbox configuration, rather than a `--no-sandbox` launch.

```sh
npm test                 # Policy, focus, proxy, search and filtering unit tests
npm run test:integration # Real Electron browser regression tests
npm run test:upgrade     # Real local proxy, auth, search and ad blocker tests
npm run test:spoof       # Native keys, clipboard, selection and tab/window focus
npm run test:frame-focus # Cross-origin frame focus, reload, dynamic frames and opt-out
npm run test:activation  # Live activation, blocked tabs, failures and reconnects
npm run test:spoof-ui    # Delayed saves, repeated clicks, status and retry UI
npm run test:favicons    # Session cookies, reloads, SVG icons and fallbacks
npm run test:ui          # Compact tabs and immediate new-tab typing
npm run test:desktop     # Native Ctrl+T focus handoff and custom window icon
npm run pack             # Unpacked desktop app for this operating system
npm run dist             # Installer/AppImage for this operating system
npm run dist:deb         # Debian package (requires libfuse2 at runtime)
npm run dist:win         # Windows NSIS installer
npm run build:deb        # Install locked dependencies and build a Debian package
npm run build:win        # Install locked dependencies and build a Windows installer
npm run preview          # Interactive UI preview at http://127.0.0.1:4317
```

The web preview is clearly labeled and cannot browse or capture real websites. Use the Electron app for those features. Packaging is configured for NSIS on Windows, DMG on macOS, and AppImage on Linux. Installer signing, automatic updates, and extension installation are not included.

## Build a Debian installer

On Linux with Node.js 22.12 or newer and npm installed, run:

```sh
./build_deb.sh
```

The script works from any working directory, installs dependencies using `npm ci`, explicitly downloads/extracts the matching Electron runtime, and builds the package for the host architecture. Internet access is needed for uncached dependencies and packaging tools. The installer is saved in `dist/` (on x64: `prism-browser_1.3.2_amd64.deb`), includes the Prism icon, and declares `libfuse2` as a runtime dependency. It does not install or publish the package. The older `build-deb.sh` name remains available. You can also run `npm run build:deb` from this folder.

## Build a Windows installer

On Windows with Node.js 22.12 or newer and npm installed, open Command Prompt or PowerShell in this folder and run:

```bat
build_win.bat
```

The script installs the locked dependencies, prepares the matching Windows Electron runtime, and builds an unsigned NSIS installer with the Prism icon. The installer is saved in `dist\`. Internet access is needed for uncached dependencies and NSIS packaging tools. You can also run `npm run build:win` from this folder.

## Browse

- Address/search bar, tabs, back/forward, reload/stop, page zoom and find.
- Press **Ctrl+9** (**Command+9** on macOS) to type clipboard text into the focused field with varied character timing and natural pauses. Press the shortcut again or Escape to stop; manual typing, clicking, switching tabs, navigation, or leaving the window also cancels it. Works in page editors and Prism's own fields, preserves Unicode, and inserts line breaks without submitting forms. Adjust **Settings → Typing → Speed** from 0.25× to 3×; the speed saves automatically and keeps the timing random.
- Persistent cookies, local storage, IndexedDB, service-worker storage and cache in a separate profile.
- Bookmarks, history, saved site rules, and restored tab URLs.
- Downloads with progress, cancellation and “show in folder”.
- Native context menus and site permission prompts for supported capabilities.
- Cookie inspection with profile-wide or per-site JSON export/import, plus a per-host action to clear stored site data.

Tabs can be dragged to reorder them and shrink as more are opened, down to favicon-only buttons; all 30 supported tabs fit on one row at the minimum window width. Hover for a title, click an icon to switch, and use middle-click or Ctrl+W to close compact tabs. When a tab is too narrow for its title, its close button appears on the selected or hovered tab. New tabs focus the search field immediately, preserving typing while the native tab starts. Favicons load through the browsing session with its cookies and proxy settings, stay visible through reloads, and change only after a replacement decodes. A globe appears when a site provides no usable icon.

The profile location is shown under **Site controls and settings**. It uses Electron's normal per-user application data directory and is separate from Chrome/Edge profiles. Expiring persistent cookies survive restarts; session-only cookies retain normal Chromium session semantics. Browser login sessions can still expire or be revoked by the website. Cookies are managed by Chromium, not copied into the app's JSON settings file.

Open **Inspect cookies** from settings to view the current selection. On a new tab, **Export all cookies** and **Import cookies** operate on the whole Prism profile. On a website, **Export this site** and **Import for this site** operate on that host and its subdomains. Files use a bounded, versioned JSON format and are written with owner-only permissions where the operating system supports them. Name, value, host-only/domain scope, path, security flags, SameSite policy and expiry are retained; Chromium metadata that Electron 44 cannot set is omitted. Cookie values are credentials; protect exported files accordingly.

For an isolated test profile:

```sh
# Linux/macOS
PRISM_PROFILE=/absolute/path/to/test-profile npm start

# PowerShell
$env:PRISM_PROFILE = 'C:\\path\\to\\test-profile'
npm start
```

## Inspect selected websites

1. Open **Site controls and settings**, then **Add website**.
2. Enter a hostname such as `example.com`. Enable subdomains only if wanted.
3. Turn on **Monitor traffic** and visit or reload the site.
4. Open the network inspector. Select a request to see its headers, payload, response, timing or stream messages.

The inspector selects by the **top-level page hostname**. A selected page's third-party requests are included, because they are part of that page's communication. Other top-level sites are excluded, including when a redirect leaves the selected hostname. Rules apply across HTTP/HTTPS and all ports for that hostname. Exact hosts are the default; `example.com` does not match `badexample.com`.

Capture includes browser-visible HTTP/HTTPS requests, request/response headers, available request/response bodies, WebSocket frames and server-sent events. Dedicated workers and child frames are included when Chromium exposes their targets. Shared/service-worker background targets are excluded because they can serve unrelated pages. Responses served through workers may still appear as page requests.

This is a browser inspector, not an operating-system packet sniffer. It does not capture other applications, DNS packets, arbitrary WebRTC/UDP traffic, or every browser background service. Chromium may omit evicted, streamed, binary, cached or oversized bodies. The UI explains missing/truncated bodies. Capture does not require a proxy or a custom certificate authority.

Capture stays in memory until you explicitly export a HAR file. Limits: **1,000 requests**, roughly **20 MiB** retained records, **256 KiB** per body, and the latest **200 stream messages** within a 256 KiB message budget per request. Old records are evicted. The HAR includes custom stream-message fields. Headers and payloads can contain signed-in session data, so export only the captures you intend to save or share.

When a top-level redirect leaves a selected site, the initial request may have no final status or response metadata because capture stops as soon as its scope changes.

Pause affects new capture; Clear discards the current capture. Opening full Developer Tools temporarily suspends capture and focus controls for that tab; they reconnect when Developer Tools closes.

## Search engine

Open **Browser settings → Search**. Choose DuckDuckGo, Google, Bing, Brave Search, Startpage, or a custom HTTPS search URL containing exactly one `{query}` placeholder in the path or query. For example, `https://example.com/search?q={query}`. The choice applies to both search bars and survives restarts. Search terms are URL-encoded, so punctuation cannot inject extra parameters.

## Proxy

Use the **Proxy** shortcut beside **Spoof mode**, or open **Browser settings → Proxy**. Enter your existing proxy's protocol, hostname and port, set bypass rules, enable it and click **Apply proxy settings**. HTTP, HTTPS and unauthenticated SOCKS5 endpoints are supported. HTTP and HTTPS proxies also accept optional username/password authentication.

The endpoint, enabled switch and bypass list persist. **Usernames and passwords last only for this app session** and are never saved in the settings JSON or returned to the shell. Reenter them after restarting. Leaving authentication untouched keeps current session credentials; “Clear saved session credentials” removes them. Changing the endpoint clears credentials. Authentication is scoped to the configured proxy host/port; website login challenges never receive proxy credentials.

This controls Chromium's website connections, not other applications or all network protocols. It is not a VPN or IP anonymity guarantee: WebRTC/UDP and some DNS traffic can differ. Bypassed destinations connect directly, and Chromium implicitly bypasses loopback by default. To include loopback in a proxy test, use Chromium's `<-loopback>` bypass token. A fixed proxy has no automatic DIRECT fallback. The “active” indicator means settings were applied, not that the remote proxy passed a connectivity test. Authentication failures are shown separately.

Applying a proxy suspends network activity while old connections and authentication are cleared. Reload open pages to reconnect. If a change cannot be applied or restored, the browsing session stays offline and new web requests are blocked until settings are successfully applied; active downloads are cancelled on that fatal failure.

## Ad blocker

The toolbar **Ad blocker** button turns filtering on or off for the whole browser. Its adjacent arrow opens settings. Filtering is powered by the actual **Adblock Plus core** with an offline EasyList snapshot, not a simulated counter. This integrates the filtering engine rather than installing the Chrome extension; Electron only implements part of the extension API.

- **Allowlisted websites:** filtering is bypassed while browsing these top-level hosts or their subdomains. The allowlist takes priority over both EasyList and custom blocked domains.
- **Blocked request domains:** extra destination hosts, including subdomains, whose requests and direct visits are blocked while filtering is enabled. Enter hostnames separated by commas or newlines.
- Turning the master switch off stops both EasyList and custom blocking. The count is the number blocked this app session. Reload to restore resources that were already blocked; existing cosmetic CSS is removed immediately when disabled or allowlisted.

The bundled list was modified September 10, 2026. It contains 78,613 supported rules in this build. This integration handles request blocking, ABP exceptions, resource type/domain/third-party matching, and standard cosmetic hiding in the main frame. It does not run snippets, procedural cosmetics, response-header/rewrite rules, or child-frame cosmetic hiding. Unattributable worker requests are allowed because their top-level site cannot reliably be determined. It cannot promise to remove every ad, especially ads embedded in first-party content. There are no automatic filter updates, Acceptable Ads subscription, or telemetry. To update filters, replace `electron/adblock-data/easylist.txt` from its official source, update its notice, run the tests and rebuild.

References: [Adblock Plus core](https://github.com/adblockplus/adblockpluscore), [EasyList](https://easylist.to/), [Electron extension support](https://www.electronjs.org/docs/latest/api/extensions). Upstream source and licensing details are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Spoof mode: focus, selection and keyboard listeners

Enable **Spoof mode** for the current website or its site rule. Selected documents report `document.hasFocus() === true`, `document.hidden === false`, and `document.visibilityState === 'visible'`. The controller registers document-start overrides, intercepts trusted page-level blur/visibility events, and uses Chromium's focus emulation when frame scope permits, including in separate iframe renderers. Document properties and their normal prototype accessors agree. Live changes notify the page using synthetic focus/visibility events. Focus transitions between inputs keep working.

The toolbar shows **Applying…** while a change is being applied and turns green only after the page confirms the document controls. Repeated clicks are blocked during that operation. If application fails, the reason and a **Retry spoof mode** action appear in the footer. Retry reconnects disconnected page tools while preserving the saved rule. Full Developer Tools temporarily pauses spoof mode; close it to resume. A stalled background tab no longer holds up the current tab's activation, and changing unrelated rules no longer briefly drops native focus emulation.

When checking a focus-event test page, enable the mode, wait for the green state, and reload once to clear its earlier event log. Then look for newly added BLUR events when switching away. Enabling can emit a FOCUS notification; events logged before activation remain part of that page's history.

- Page keyboard, selection and clipboard listeners are suppressed for trusted `keydown`, `keyup`, `keypress`, `selectionchange`, `selectstart`, `select`, `copy`, `cut` and `paste` events. Native typing, text selection and Ctrl+C/Ctrl+V remain available.
- Trusted mouse and pointer enter, leave, over and out listeners are suppressed, including on page elements. Cursor movement and click handlers keep working; hover controls driven by these boundary events may need spoof mode turned off.
- Common Selection API readers report an empty selection; input and textarea selection offsets are masked. Chromium retains the actual selection for native copying and editing.
- Primary mouse/pointer-down cancellation and `user-select: none` restrictions on the clicked text are relaxed so selection and input focus work. Ordinary click handlers keep running. This does not remove disabled form controls or arbitrary overlays.

Disabling restores the normal document properties, listeners and changed selection styles. A selected top-level website includes its embedded frames, even when they use another hostname (for example, CodePen's result frame). The embedded hostname is not enabled in unrelated tabs. On an unselected top-level website, an embedded frame can still match its own site rule without enabling its parent or sibling frames. Reload after enabling to improve initial listener coverage; frames in another renderer process can run initial scripts before page tools attach. Repeated controller refreshes preserve capture-listener ordering.

Keyboard-driven websites and rich-text editors may need spoof mode turned off. Input values and `beforeinput`, `input` and `change` events remain observable so ordinary editing works; this mode cannot conceal content changes or every way a page can infer an interaction.

**This is best effort.** It cannot guarantee that every website considers a background tab focused. Unusual page code, function-integrity checks, OS-level observations, fullscreen state, worker timers, timer throttling and frame-transition races can still differ. It does not spoof every browser signal, make synthetic events trusted, or guarantee that assessment software will not detect a tab/window change. No claims are made about compatibility with Redmenta or any particular assessment system. It does not disable Chromium security boundaries to hide those differences.

## Isolation and implementation

Untrusted web pages run with Chromium renderer sandboxing, context isolation, no Node.js integration, no privileged preload, and normal web security/TLS validation. Only the local browser shell receives a narrow IPC bridge, and every IPC request is checked against the shell's exact main frame. Remote pages cannot load local files or execute `javascript:` addresses through the address bar. Site permissions start denied and supported requests use an explicit native prompt.

This is an independent browser profile with renderer isolation, **not a virtual machine or a malware-analysis environment**. The browser can still connect to the network, request permission, and download files. It is a small browser project rather than a replacement for every feature of Chrome: no password manager, account sync, extension store, DRM guarantee, or automatic security updates. Update Electron regularly when continuing development.

- `electron/main.cjs`: window, profile, tab, permission and IPC lifecycle.
- `electron/network.cjs`: scoped CDP network capture and HAR snapshots.
- `electron/focus.cjs`: reversible document patches and native focus emulation.
- `electron/policy.cjs`: URL and host boundary validation.
- `electron/preferences.cjs` and `electron/proxy.cjs`: validated search and session proxy settings.
- `electron/adblock.cjs`: scoped Adblock Plus filtering and cosmetic CSS lifecycle.
- `electron/favicon.cjs`: bounded session-based icon fetching and PNG conversion; SVG fallback uses a separate sandboxed, network-blocked decoder instead of changing website security policies.
- `renderer/`: dependency-free shell UI.
- `tests/` and `scripts/integration.cjs`: automated regression checks.

Primary API references: [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [persistent sessions](https://www.electronjs.org/docs/latest/api/session), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [CDP Network](https://chromedevtools.github.io/devtools-protocol/tot/Network/), [CDP focus emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setFocusEmulationEnabled).

## Validation

Validation details are recorded in `VALIDATION.md`. Unit tests, real Electron browser checks and UI checks use isolated profiles and local fixture services. Proxy tests never forward requests upstream. Sandbox mode remains enabled. Linux AppImage and Debian packaging are supported; the Debian package declares `libfuse2` as a runtime dependency. Windows/macOS packaging is configured but has not been run here.

The Linux launcher and native window use the custom Prism icon, with a matching `prism-browser.desktop` identity. Install or upgrade the Debian build with `sudo apt install ./dist/prism-browser_1.3.2_amd64.deb`, then fully quit and reopen Prism. The package declares Electron's desktop runtime libraries as well as `libfuse2`. The editable icon is `build/icon.svg`; PNG assets are included, and `npm run icons` regenerates them when ImageMagick is installed.

## License

The original Prism source remains MIT-licensed (`LICENSE`). The assembled 1.3.2 app includes GPL-3.0-only Adblock Plus core and is distributed under GPL version 3 (`COPYING`); provide the matching source archive with packaged builds. See `THIRD_PARTY_NOTICES.md` for upstream attribution and exact versions.
