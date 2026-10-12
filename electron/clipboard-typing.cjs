'use strict';

// Native insertion preserves selections, Unicode, and Chromium input events.
class ClipboardTyping {
  constructor({ readText, canType, notify, random = Math.random, getSpeed = () => 1 }) {
    Object.assign(this, { readText, canType, notify, random, getSpeed });
    this.run = null;
    this.segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }

  stop() {
    if (!this.run) return false;
    clearTimeout(this.run.timer);
    this.run = null;
    return true;
  }

  delay(character) {
    let ms = 45 + this.random() * 100;
    if (/[\n.!?]/u.test(character)) ms += 180 + this.random() * 280;
    else if (/[,;:\s]/u.test(character)) ms += 35 + this.random() * 100;
    if (this.random() < 0.035) ms += 160 + this.random() * 220;
    return Math.round(ms / this.getSpeed());
  }

  async toggle(wc) {
    if (this.stop()) { this.notify('Clipboard typing stopped.'); return; }
    const run = { wc, timer: null };
    this.run = run;
    let text;
    try { text = (await this.readText()).replace(/\r\n?/g, '\n'); }
    catch {
      if (this.run === run) { this.stop(); this.notify('Could not read clipboard text.'); }
      return;
    }
    if (this.run !== run) return;
    if (!text) { this.stop(); this.notify('Your clipboard has no text to type.'); return; }
    if (!this.canType(wc)) { this.stop(); return; }
    run.characters = this.segmenter.segment(text)[Symbol.iterator]();
    run.next = run.characters.next();
    this.notify('Typing clipboard text… Press Escape or the shortcut again to stop.');
    const step = async () => {
      if (this.run !== run) return;
      if (!this.canType(wc)) { this.stop(); return; }
      const next = run.next;
      if (next.done) { this.stop(); return; }
      try {
        // Line breaks are text, never Enter, so typing cannot submit a form.
        await wc.insertText(next.value.segment);
        if (this.run === run) {
          run.next = run.characters.next();
          if (run.next.done) this.stop();
          else run.timer = setTimeout(step, this.delay(next.value.segment));
        }
      } catch {
        if (this.run === run) { this.stop(); this.notify('Clipboard typing stopped because the field is unavailable.'); }
      }
    };
    run.timer = setTimeout(step, 200 + this.random() * 150);
  }

  attach(wc) {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const shortcut = (process.platform === 'darwin' ? input.meta : input.control)
        && !input.alt && !input.shift && (input.key === '9' || input.code === 'Digit9');
      if (shortcut) {
        event.preventDefault();
        if (!input.isAutoRepeat) void this.toggle(wc);
      } else if (!['Control', 'Meta', 'Shift', 'Alt'].includes(input.key) && this.run) {
        this.stop();
        if (input.key === 'Escape') event.preventDefault();
      }
    });
    const cancel = () => { if (this.run?.wc === wc) this.stop(); };
    wc.on('before-mouse-event', (_event, input) => { if (input.type === 'mouseDown') this.stop(); });
    wc.on('did-start-navigation', cancel);
    wc.on('blur', cancel);
    wc.on('destroyed', cancel);
    wc.on('render-process-gone', cancel);
  }
}

module.exports = { ClipboardTyping };
