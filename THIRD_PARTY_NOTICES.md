# Third-party notices

Prism Browser 1.3.1 combines the original MIT-licensed Prism source (see `LICENSE`) with GPL-3.0-only Adblock Plus core. This combined distribution is provided under GNU GPL version 3; see `COPYING`. The source archive contains the application, vendored filtering source, filter data, and the scripts needed to build it. Distribute this source alongside packaged builds.

## Adblock Plus core

- Project: https://github.com/adblockplus/adblockpluscore
- Imported package: `adblockpluscore@0.11.1`, https://registry.npmjs.org/adblockpluscore/-/adblockpluscore-0.11.1.tgz
- Copyright: eyeo GmbH and the contributors identified in the upstream files.
- License: GPL-3.0-only. Full text: `electron/vendor/adblockpluscore/COPYING`.
- Unmodified upstream `lib/` and `data/` directories are included, with upstream README, release notes and package metadata. Prism calls the standalone FilterEngine, not the extension host or subscription downloader. Upstream build tools and their dependencies are neither installed nor used.
- This is a pinned older core release (the unscoped npm package is deprecated). It supports the subset documented in the README. Review upstream core changes before updating it; npm audit does not audit this vendored source.

Prism is an independent project, not an official Adblock Plus application. Adblock Plus names remain the property of their respective owners.

## EasyList

- Source: https://easylist.to/easylist/easylist.txt
- Version: 202609100709, modified September 10, 2026 at 07:09 UTC.
- Authors: The EasyList authors.
- License: distributed here under the GNU GPL v3 option of EasyList's dual licensing: https://easylist.to/pages/licence.html
- Unmodified source: `electron/adblock-data/easylist.txt`
- SHA-256: `a970eee8bb1718d2ba00b3e483b78a159f354c37cef58f30666cb821652e7186`

The bundled list is loaded locally; Prism does not subscribe to automatic updates, Acceptable Ads, or telemetry. Updating the bundled file requires rebuilding the app. Only supported blocking, exception and standard cosmetic filters are loaded.

## Electron and development tools

Electron 44.3.0 is MIT-licensed and includes Chromium, Node.js and other components with their own notices, shipped with the Electron runtime. The source package lock pins Electron, electron-builder and Playwright. Their licenses are supplied by their respective distributions. Development tools are not added as runtime dependencies.
