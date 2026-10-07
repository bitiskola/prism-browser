# Validation record

This record describes Prism Browser 1.3.1 on Linux with Electron 44.3.0. Regression tests use disposable profiles and local fixture servers; the activation suite was also run against the user-reported public focus-test page. Unchanged feature suites retained from 1.3.0 are marked below. The Chromium sandbox remains enabled; no `--no-sandbox` switch is supplied.

## Automated checks

| Check | Result | Coverage |
| --- | --- | --- |
| `npm test` | 110 passed | URL policy, focus/selection/listener restoration, actual application status, frame timeouts and stale results, native emulation continuity, network capture, search, proxy, Adblock Plus, cookies and favicon handling |
| `npm run test:integration` | 11 passed | Real Electron navigation, tab favicon propagation, POST bodies, WebSocket/SSE capture, pause/resume, scoped focus controls, redirects, isolation, cookies/storage/bookmarks/tabs across relaunch |
| `npm run test:upgrade` | 11 passed in 1.3.0 | Real loopback proxy routing, six search providers, encoded queries, HTTP proxy 407 credentials, origin 401 isolation, direct mode, bundled EasyList request blocking, allow/block precedence, failed proxy recovery, and persisted settings |
| `npm run test:spoof` | 6 groups passed | Native typing, Ctrl/C/V and clipboard, selection masking, blocked mouse-down and CSS selection restoration, functional buttons/internal input blur, tab and second-window switching, and live opt-out |
| `npm run test:favicons` | 6 groups passed in 1.3.0 | Cookie-protected PNG, reload retention, clearing the state and rendered icon on cross-origin navigation, strict-CSP SVG rasterization, decoder isolation/network denial with website CSP unchanged, and `/favicon.ico` fallback |
| `npm run test:ui` | 15 checks passed | 30 tabs on one row at 1000px, favicon click targets and titles, keyboard/middle-click tab controls, immediate new-tab typing and early Enter, pending draft preserved through refocus, stable reload icons, origin changes, settings/modal focus retention and overflow wrapping |
| `npm run test:desktop` | 4 groups passed | Actual app version and sandbox, custom icon asset/native window property, guest Ctrl+T with immediate native typing, and new-tab button typing |
| `npm run test:activation` | 7 groups passed | Live toolbar activation with pre-existing window handlers, tab/window switching, blocked background renderer, unchanged focus during unrelated rule saves, injection failure/retry, debugger reconnect, DevTools suspension, repeated off/on cycles and relaunch |
| `npm run test:spoof-ui` | 13 checks passed | Delayed/failed saves, duplicate clicks, applying/active/error/suspended states, recovery, failed disable, enabling from an off/error state, and preserving the current tab while older IPC completes |

The upgrade fixture proxy never forwards requests to an external server. Its HTTPS CONNECT endpoint returns a local 502 response so search tests verify routing without contacting search providers. Integration launchers poll IPC from Node until the active tab is ready; an asynchronous Playwright `waitForFunction` predicate returns a truthy Promise and does not reliably poll the resolved condition.

The activation regression also passed with `PRISM_FOCUS_TEST_URL=https://www.proginosko.com/test/WindowFocusEvents.html`. It compares the page's own log before and after native tab/window switches, and verifies that an unrelated site-rule update does not add BLUR/FOCUS entries. Earlier log entries are not erased by enabling the mode.

## Package checks

- `node --check` passes for all Electron, renderer and integration JavaScript files.
- There are no npm runtime dependencies. The vendored filter engine is outside npm audit coverage.
- The runtime uses the vendored `adblockpluscore@0.11.1` source under `electron/vendor/adblockpluscore/` and the bundled EasyList snapshot under `electron/adblock-data/`.
- A Linux AppImage build is produced with Electron's sandbox helper available through `CHROME_DEVEL_SANDBOX=/opt/google/chrome/chrome-sandbox`; the packaged executable starts with the sandbox enabled and Adblock Plus ready. Windows and macOS targets are configured but were not run in this Linux environment.
- The Debian package declares `libfuse2` plus Electron's default desktop libraries in its dependency metadata. Its `prism-browser.desktop` launcher, window identity and hicolor icons use Prism branding. The runtime includes `build/icon.png` inside its asar.
- The desktop check can verify the release executable with `PRISM_TEST_EXECUTABLE="$PWD/dist/linux-unpacked/prism-browser" npm run test:desktop`. On Linux it selects X11 for the `_NET_WM_ICON` and `WM_CLASS` property checks; the normal app also supports its default display backend.

## Scope notes

The proxy is Chromium session routing for website traffic, not a VPN. SOCKS5 is unauthenticated because Chromium does not expose SOCKS5 username/password authentication through this API. Proxy credentials remain in main-process memory for the current run and are intentionally omitted from `browser-state.json`, renderer state, and website authentication callbacks.

Spoof mode changes selected page focus/visibility and selection read APIs, suppresses trusted key/selection/clipboard listeners, and relaxes primary mouse-down selection restrictions with reversible hooks. Native clipboard and editing remain available. Input values and beforeinput/input/change events remain visible; rich-text editors may need the mode disabled. Existing cached native references, arbitrary overlays or disabled controls, OS/timer/fullscreen/worker signals and unusual page code remain outside any guarantee. No assessment-service compatibility or undetectability is claimed. Adblock Plus integration covers request blocking, exceptions, resource/domain matching, and standard main-frame cosmetic CSS; snippets, procedural cosmetics, response-header/rewrite rules, and unattributable worker contexts are outside this integration.
