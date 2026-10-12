@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Missing Node.js. Install Node.js 22.12 or newer, then retry. 1>&2
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Missing npm. Install Node.js 22.12 or newer with npm, then retry. 1>&2
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);const delta=v[0]-22||v[1]-12;if(Math.sign(delta)===-1){console.error('Node.js 22.12 or newer is required; found '+process.versions.node+'.');process.exit(1)}"
if errorlevel 1 exit /b 1

rem Avoid inherited Electron settings selecting a missing or mismatched runtime.
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "ELECTRON_OVERRIDE_DIST_PATH="
set "ELECTRON_INSTALL_PLATFORM="
set "ELECTRON_INSTALL_ARCH="
set "npm_config_platform="
set "npm_config_arch="

call npm ci --include=dev --ignore-scripts=false
if errorlevel 1 exit /b 1

echo Preparing Electron runtime...
node node_modules\electron\install.js
if errorlevel 1 exit /b 1

call npm run dist:win -- --publish never --config.electronDist=node_modules/electron/dist
if errorlevel 1 exit /b 1

echo.
echo Windows NSIS installer written to %CD%\dist\
exit /b 0
