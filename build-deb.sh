#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Build this Debian package on Linux." >&2
  exit 1
fi

for command in node npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. Install Node.js 22.12 or newer with npm, then retry." >&2
    exit 1
  fi
done

node <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Node.js 22.12 or newer is required; found ${process.versions.node}.`);
  process.exit(1);
}
NODE

# Install the locked development tools.
unset ELECTRON_RUN_AS_NODE ELECTRON_SKIP_BINARY_DOWNLOAD ELECTRON_OVERRIDE_DIST_PATH
npm ci --include=dev --ignore-scripts=false

# Electron 44 downloads its runtime on first use, not during npm ci.
# Packaging with electronDist needs that runtime to exist beforehand.
echo "Preparing Electron runtime..."
node node_modules/electron/install.js

# Reuse that runtime instead of downloading Electron again during packaging.
# package.json supplies the Prism icons and the libfuse2 runtime dependency.
npm run dist:deb -- --publish never --config.electronDist="$project_dir/node_modules/electron/dist"

printf '\nDebian installer written to %s/dist/\n' "$project_dir"
