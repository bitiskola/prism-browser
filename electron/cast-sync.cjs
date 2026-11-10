'use strict';

// Helpers that keep a tab-only screencast clean while the shared tab changes.
// They take their Electron dependencies as arguments so they can be unit tested.

// Chromium draws the real pointer into tab captures (MouseCursorOverlayController)
// using native mouse events on the captured view only. Once the pointer leaves the
// view it gets no further events, so the pointer stays drawn at the exit point
// until a 2 s idle timer hides it. (webContents.sendInputEvent goes straight to
// the renderer and never reaches that tracker.) Hiding and re-showing the view
// in the same tick changes the WebContents visibility, which makes Chromium
// re-create the tracker in its idle state: the captured pointer disappears
// immediately. A captured page keeps its page visibility, so no
// visibilitychange reaches the site, and no frame is painted in between.
//
// Returns false when the reset should be retried later (a drag is in progress).
function resetCaptureCursorOverlay(tab, { windowFocused, focusSpoofed }) {
  const view = tab?.view;
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return true;
  if (typeof view.getVisible === 'function' && !view.getVisible()) return true;
  // A drag (e.g. text selection) that left the view still owns the mouse and
  // Chromium keeps tracking it; hiding the view would cancel the drag.
  if (tab.mouseButtonDown) return false;
  // Restoring focus inside an inactive window could activate it; skip instead.
  if (!windowFocused) return true;
  const hadFocus = wc.isFocused();
  // Hiding moves keyboard focus away; it is restored below. Spoof mode's focus
  // controls hide that blur/focus pair from the site. A plain tab would see it
  // (and lose open dropdowns), so keep Chromium's 2 s default there.
  if (hadFocus && !focusSpoofed) return true;
  view.setVisible(false);
  view.setVisible(true);
  if (hadFocus) wc.focus();
  return true;
}

// Resizing the shared, fullscreen-locked tab (entering/exiting fullscreen) used
// to set the new view bounds first and the matching emulation scale later, and
// the requester learned the new crop scale later still. Chromium captured frames
// in between at a different size and with the old scale, which showed up as a
// brief zoom glitch in the screencast even though the locked resolution never
// changed. Here the requester drops frames while the change is in flight, and
// the bounds and emulation override are applied in the same tick.
//
// deps.hold(): ask the requester to drop frames (resolves once delivered or timed out)
// deps.release(): let the requester resume (queued after the scale broadcast)
// deps.isAlive(tab): whether the tab still exists
// deps.updateMetrics(tabId): sends the emulation override synchronously, then
//   resolves after the compositor applied it and the new crop scale was broadcast
async function runSharedResize(tab, deps) {
  if (tab.resizeRunning) return;
  tab.resizeRunning = true;
  try {
    while (tab.pendingBounds) {
      await deps.hold();
      const bounds = tab.pendingBounds;
      tab.pendingBounds = null;
      if (!deps.isAlive(tab)) break;
      tab.view.setBounds(bounds);
      await deps.updateMetrics(tab.id);
    }
  } catch { /* A destroyed tab or detached debugger simply ends the resize. */ } finally {
    tab.resizeRunning = false;
    deps.release();
  }
}

module.exports = { resetCaptureCursorOverlay, runSharedResize };
