import { showToast } from './toast.js';
// Thin bridge to the Tauri desktop shell. Uses the injected `window.__TAURI__`
// global (enabled by withGlobalTauri in tauri.conf.json) rather than importing
// an @tauri-apps/* package — so the website build pulls in ZERO desktop deps
// and these helpers simply no-op / throw outside the desktop app.

export function isDesktop() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

function bridge() {
  const t = typeof window !== 'undefined' ? window.__TAURI__ : null;
  if (!t) throw new Error('Not running in the PokeKit desktop app.');
  return t;
}

export async function invoke(cmd, args) {
  return bridge().core.invoke(cmd, args);
}

// Subscribe to a Tauri event; returns an unlisten function (no-op off-desktop).
export async function listen(event, handler) {
  if (!isDesktop()) return () => {};
  return bridge().event.listen(event, handler);
}

/* ── Capture/OCR commands (implemented in src-tauri) ─────────────────────── */

// List capturable top-level windows: [{ hwnd:number, title:string }].
export async function listWindows() {
  return invoke('list_windows');
}

// Capture a window (optionally a sub-rect) and OCR it. Returns the parse
// payload: { text, width, height, words:[{text,x,y,w,h,green}], pngBase64 }.
// `rect` is a normalized { x, y, w, h } in 0..1 of the window, or null for the
// whole window.
export async function captureAndOcr({ hwnd, rect = null } = {}) {
  return invoke('capture_and_ocr', { hwnd, rect });
}

// Event name the global capture hotkey fires.
export const CAPTURE_HOTKEY_EVENT = 'capture-hotkey';

// Flash the always-on-top overlay toast (no-op off-desktop).
export async function flashToast(text, ok) {
  if (!isDesktop()) return;
  try {
    await invoke('flash_toast', { text, ok });
  } catch {
    /* ignore */
  }
}

/* ── Audio cue ───────────────────────────────────────────────────────────── */
// A short tone played from the (hidden) main window — audible over a fullscreen
// game. High tone = clean read, low tone = check it. The AudioContext unlocks on
// the first user gesture in the app and then plays even on the hotkey path.

let _audioCtx = null;

export function primeAudio() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
  } catch {
    /* ignore */
  }
}

export function beep(ok) {
  try {
    primeAudio();
    if (!_audioCtx) return;
    const o = _audioCtx.createOscillator();
    const g = _audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = ok ? 880 : 330;
    o.connect(g);
    g.connect(_audioCtx.destination);
    const t = _audioCtx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.start(t);
    o.stop(t + 0.22);
  } catch {
    /* ignore */
  }
}

// Export a text file. On the web this is a normal <a download>; the desktop
// WebView ignores those, so there we write to Downloads via the save_text
// command and also copy the text to the clipboard (handy for pasting a team).
export async function downloadText(text, filename, type = 'text/plain') {
  if (isDesktop()) {
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch { /* ignore */ }
    try {
      const path = await invoke('save_text', { filename, text });
      showToast(`Saved to ${path}${copied ? ' · also copied to clipboard' : ''}`);
    } catch (e) {
      showToast(copied ? 'Copied to clipboard (file save failed)' : `Export failed: ${e}`);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
