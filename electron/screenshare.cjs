'use strict';

function handleDisplayMediaSelection(selection, screens, availableTabs, request, win = null, viewport = null) {
  if (!selection || typeof selection !== 'object' || !selection.type) {
    return null;
  }

  if (selection.type === 'screen') {
    const screenList = Array.isArray(screens) ? screens : [];
    const screen = screenList.find(s => s && s.id === selection.id) || screenList[0];
    if (!screen || !screen.id) return null;
    const streams = {
      video: { id: screen.id, name: screen.name || 'Entire screen' }
    };
    if (process.platform === 'win32' && request?.audioRequested && selection.audio) {
      streams.audio = 'loopback';
    }
    return streams;
  }

  if (selection.type === 'tab') {
    const tabList = Array.isArray(availableTabs) ? availableTabs : [];
    const chosen = tabList.find(t => t && t.id === selection.id);
    if (!chosen || !chosen.view || !chosen.view.webContents || (typeof chosen.view.webContents.isDestroyed === 'function' && chosen.view.webContents.isDestroyed())) {
      return null;
    }
    const mainFrame = chosen.view.webContents.mainFrame;
    if (!mainFrame) return null;

    // Ensure the tab view is added to the window's view hierarchy so the compositor produces video frames
    if (win && !win.isDestroyed?.() && win.contentView && typeof win.contentView.addChildView === 'function') {
      const children = win.contentView.children || [];
      if (!children.includes(chosen.view)) {
        win.contentView.addChildView(chosen.view, 0);
        if (viewport && typeof chosen.view.setBounds === 'function') {
          chosen.view.setBounds(viewport);
        }
      }
    }

    const streams = {
      video: mainFrame
    };
    if (request?.audioRequested && selection.audio !== false) {
      streams.audio = mainFrame;
      streams.enableLocalEcho = true;
    }
    return streams;
  }

  return null;
}

module.exports = { handleDisplayMediaSelection };
