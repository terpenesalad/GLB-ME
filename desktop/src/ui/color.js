// Accessible colour wheel: hue ring + saturation/brightness square, hex / RGB / HSV fields,
// palette, recent and saved swatches, optional eyedropper. Works with mouse, pen, touch and
// keyboard (arrow keys on the ring and square, Shift for bigger steps) and announces the colour.
import { h, icon, ibtn, announce } from './dom.js';

const RECENT_KEY = 'glbandme.recentColors', SAVED_KEY = 'glbandme.savedColors';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]').filter((x) => /^#[0-9a-f]{6}$/i.test(x)); } catch { return []; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
export const PALETTE_HEX = ['#ffffff', '#d9d9de', '#9aa0a6', '#5f6368', '#343a40', '#000000', '#ff6b6b', '#e03131', '#ffa94d', '#f76707', '#ffd43b', '#fab005', '#69db7c', '#2f9e44', '#38d9a9', '#0ca678', '#4dabf7', '#1971c2', '#748ffc', '#5f3dc4', '#da77f2', '#ae3ec9', '#f783ac', '#c2255c', '#8d6e63', '#5d4037', '#ffe8cc', '#c9a27e'];

// ------------------------------------------------------------------------------- conversions
export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
export function rgbToHex(r, g, b) { return '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join(''); }
export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(hh * 60 + 360) % 360, max ? d / max : 0, max];
}
export function hsvToRgb(hh, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** Plain-language colour name for screen readers ("dark blue", "light grey"). */
export function colorName(hex) {
  const [hh, s, v] = rgbToHsv(...hexToRgb(hex));
  if (v < 0.08) return 'black';
  if (s < 0.12) return v > 0.94 ? 'white' : v > 0.66 ? 'light grey' : v > 0.33 ? 'grey' : 'dark grey';
  const names = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [90, 'yellow-green'], [160, 'green'], [190, 'teal'], [215, 'sky blue'], [255, 'blue'], [285, 'purple'], [320, 'magenta'], [345, 'pink'], [361, 'red']];
  let n = names.find(([lim]) => hh < lim)[1];
  if (n === 'orange' && v < 0.6) n = 'brown';
  const tone = v < 0.4 ? 'dark ' : s < 0.45 && v > 0.8 ? 'pale ' : v > 0.9 && s < 0.7 ? 'light ' : '';
  return tone + n;
}
export function pushRecent(hex) { const r = [hex, ...load(RECENT_KEY).filter((x) => x.toLowerCase() !== hex.toLowerCase())].slice(0, 12); store(RECENT_KEY, r); }

/**
 * Builds an inline colour picker.
 * opts: value '#rrggbb', onInput(hex) while changing, onCommit(hex) when a change ends, onEyedrop() (optional), compact
 */
export function colorPicker({ value = '#ffffff', onInput, onCommit, onEyedrop, label = 'Colour', compact = false } = {}) {
  let [hue, sat, val] = rgbToHsv(...hexToRgb(value));
  let hex = value.toLowerCase();
  const size = compact ? 168 : 200, ring = Math.round(size * 0.11), sq = Math.floor((size / 2 - ring - 6) * Math.SQRT2);
  const wheel = h('canvas', { class: 'cw-wheel', width: size, height: size, 'aria-hidden': 'true' });
  const hueKnob = h('div', { class: 'cw-knob', role: 'slider', tabindex: '0', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '359' });
  const svBox = h('div', { class: 'cw-sv', role: 'slider', tabindex: '0', 'aria-label': 'Saturation and brightness', 'aria-roledescription': '2D slider', style: { width: sq + 'px', height: sq + 'px', left: (size - sq) / 2 + 'px', top: (size - sq) / 2 + 'px' } });
  const svKnob = h('div', { class: 'cw-sv-knob', 'aria-hidden': 'true' });
  svBox.appendChild(svKnob);
  const wrap = h('div', { class: 'cw-wrap', style: { width: size + 'px', height: size + 'px' } }, wheel, svBox, hueKnob);
  const preview = h('div', { class: 'cw-preview', 'aria-hidden': 'true' });
  const nameEl = h('span', { class: 'cw-name' });
  const hexIn = h('input', { class: 'field cw-hex', 'aria-label': label + ' hex code', spellcheck: 'false', maxlength: '7' });
  const num = (lbl, max) => h('input', { class: 'field cw-num', type: 'number', min: '0', max: String(max), 'aria-label': lbl });
  const rIn = num('Red (0 to 255)', 255), gIn = num('Green (0 to 255)', 255), bIn = num('Blue (0 to 255)', 255);
  const hIn = num('Hue (0 to 359 degrees)', 359), sIn = num('Saturation percent', 100), vIn = num('Brightness percent', 100);
  const recentRow = h('div', { class: 'cw-swatches', role: 'group', 'aria-label': 'Recent colours' });
  const savedRow = h('div', { class: 'cw-swatches', role: 'group', 'aria-label': 'Saved colours' });

  // paint the hue ring + sv square once per hue change
  const drawWheel = () => {
    const ctx = wheel.getContext('2d'), c = size / 2;
    ctx.clearRect(0, 0, size, size);
    for (let a = 0; a < 360; a += 1) {
      ctx.beginPath(); ctx.strokeStyle = `hsl(${a},100%,50%)`; ctx.lineWidth = ring;
      ctx.arc(c, c, c - ring / 2 - 1, ((a - 90 - 0.6) * Math.PI) / 180, ((a - 90 + 0.6) * Math.PI) / 180); ctx.stroke();
    }
    svBox.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hue},100%,50%))`;
  };
  const update = (src, fire = true) => {
    hex = rgbToHex(...hsvToRgb(hue, sat, val));
    const c = size / 2, rr = c - ring / 2 - 1, a = ((hue - 90) * Math.PI) / 180;
    Object.assign(hueKnob.style, { left: c + Math.cos(a) * rr + 'px', top: c + Math.sin(a) * rr + 'px', background: `hsl(${hue},100%,50%)` });
    Object.assign(svKnob.style, { left: sat * 100 + '%', top: (1 - val) * 100 + '%', background: hex });
    hueKnob.setAttribute('aria-valuenow', String(Math.round(hue))); hueKnob.setAttribute('aria-valuetext', `${Math.round(hue)} degrees, ${colorName(rgbToHex(...hsvToRgb(hue, 1, 1)))}`);
    svBox.setAttribute('aria-valuetext', `Saturation ${Math.round(sat * 100)}%, brightness ${Math.round(val * 100)}%, ${colorName(hex)}`);
    preview.style.background = hex; nameEl.textContent = colorName(hex);
    if (src !== 'hex') hexIn.value = hex;
    const [r, g, b] = hexToRgb(hex);
    if (src !== 'rgb') { rIn.value = r; gIn.value = g; bIn.value = b; }
    if (src !== 'hsv') { hIn.value = Math.round(hue); sIn.value = Math.round(sat * 100); vIn.value = Math.round(val * 100); }
    if (src === 'hue' || src === 'init' || src === 'set') drawWheel();
    if (fire) onInput?.(hex);
  };
  const commit = () => { pushRecent(hex); renderSwatches(); onCommit?.(hex); };
  const setHex = (x, fire = true, src = 'set') => { if (!/^#[0-9a-f]{6}$/i.test(x)) return false; [hue, sat, val] = rgbToHsv(...hexToRgb(x)); if (!sat) { /* keep hue for greys */ } update(src, fire); return true; };

  // pointer: ring or square
  const drag = (e, kind) => {
    const r = wrap.getBoundingClientRect();
    const move = (ev) => {
      if (kind === 'hue') { const x = ev.clientX - r.left - size / 2, y = ev.clientY - r.top - size / 2; hue = ((Math.atan2(y, x) * 180) / Math.PI + 90 + 360) % 360; update('hue'); }
      else { const b = svBox.getBoundingClientRect(); sat = Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)); val = Math.max(0, Math.min(1, 1 - (ev.clientY - b.top) / b.height)); update('sv'); }
    };
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); commit(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  wheel.addEventListener('pointerdown', (e) => { e.preventDefault(); const r = wrap.getBoundingClientRect(), d = Math.hypot(e.clientX - r.left - size / 2, e.clientY - r.top - size / 2); if (d > size / 2 - ring - 4) { hueKnob.focus(); drag(e, 'hue'); } });
  hueKnob.addEventListener('pointerdown', (e) => { e.preventDefault(); hueKnob.focus(); drag(e, 'hue'); });
  svBox.addEventListener('pointerdown', (e) => { e.preventDefault(); svBox.focus(); drag(e, 'sv'); });
  // keyboard
  const keyCommit = (e) => { if (e.key.startsWith('Arrow') || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Home' || e.key === 'End') commit(); };
  hueKnob.addEventListener('keydown', (e) => {
    const st = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') hue = (hue + st) % 360;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') hue = (hue - st + 360) % 360;
    else if (e.key === 'PageUp') hue = (hue + 30) % 360; else if (e.key === 'PageDown') hue = (hue + 330) % 360;
    else if (e.key === 'Home') hue = 0; else if (e.key === 'End') hue = 359;
    else return;
    e.preventDefault(); e.stopPropagation(); update('hue');
  });
  svBox.addEventListener('keydown', (e) => {
    const st = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowRight') sat = Math.min(1, sat + st); else if (e.key === 'ArrowLeft') sat = Math.max(0, sat - st);
    else if (e.key === 'ArrowUp') val = Math.min(1, val + st); else if (e.key === 'ArrowDown') val = Math.max(0, val - st);
    else return;
    e.preventDefault(); e.stopPropagation(); update('sv');
  });
  hueKnob.addEventListener('keyup', keyCommit); svBox.addEventListener('keyup', keyCommit);
  // text fields
  hexIn.addEventListener('input', () => { let x = hexIn.value.trim(); if (!x.startsWith('#')) x = '#' + x; if (/^#[0-9a-f]{3}$/i.test(x)) x = '#' + x.slice(1).split('').map((c) => c + c).join(''); setHex(x.toLowerCase(), true, 'hex'); });
  hexIn.addEventListener('change', commit);
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); });
  for (const f of [rIn, gIn, bIn]) { f.addEventListener('input', () => { const v = [rIn, gIn, bIn].map((x) => Math.max(0, Math.min(255, +x.value || 0))); [hue, sat, val] = rgbToHsv(...v); update('rgb'); }); f.addEventListener('change', commit); f.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); }); }
  for (const f of [hIn, sIn, vIn]) { f.addEventListener('input', () => { hue = Math.max(0, Math.min(359, +hIn.value || 0)); sat = Math.max(0, Math.min(100, +sIn.value || 0)) / 100; val = Math.max(0, Math.min(100, +vIn.value || 0)) / 100; update('hsv'); drawWheel(); }); f.addEventListener('change', commit); f.addEventListener('keydown', (e) => { if (e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation(); }); }

  const sw = (c, extra) => h('button', { class: 'swatch sm', style: { background: c }, 'aria-label': `${colorName(c)} ${c}`, title: c, onclick: () => { setHex(c); commit(); }, ...extra });
  function renderSwatches() {
    recentRow.replaceChildren(...load(RECENT_KEY).map((c) => sw(c)));
    const saved = load(SAVED_KEY);
    savedRow.replaceChildren(...saved.map((c) => sw(c, { oncontextmenu: (e) => { e.preventDefault(); store(SAVED_KEY, load(SAVED_KEY).filter((x) => x !== c)); renderSwatches(); announce('Removed ' + c); } })),
      h('button', { class: 'swatch sm add', 'aria-label': 'Save current colour', title: 'Save current colour (right-click a saved colour to remove it)', onclick: () => { const s = load(SAVED_KEY); if (!s.includes(hex)) { store(SAVED_KEY, [...s, hex].slice(-24)); renderSwatches(); announce('Saved ' + colorName(hex)); } } }, icon('plus')));
  }
  renderSwatches();
  const el = h('div', { class: 'cw' + (compact ? ' compact' : ''), role: 'group', 'aria-label': label },
    h('div', { class: 'cw-top' }, wrap,
      h('div', { class: 'cw-side' },
        h('div', { class: 'row' }, preview, h('div', { class: 'col', style: { gap: '2px', minWidth: 0 } }, hexIn, nameEl)),
        h('div', { class: 'cw-fields' }, h('label', null, 'R', rIn), h('label', null, 'G', gIn), h('label', null, 'B', bIn)),
        h('div', { class: 'cw-fields' }, h('label', null, 'H', hIn), h('label', null, 'S', sIn), h('label', null, 'V', vIn)),
        onEyedrop ? h('button', { class: 'btn ghost', onclick: () => onEyedrop() }, icon('pipette'), 'Pick from model') : null)),
    h('div', { class: 'cw-swatches', role: 'group', 'aria-label': 'Palette' }, PALETTE_HEX.map((c) => sw(c))),
    h('div', { class: 'cw-label' }, 'Recent'), recentRow,
    h('div', { class: 'cw-label' }, 'Saved'), savedRow);
  update('init', false);
  el.set = (x) => setHex(x, false);
  el.value = () => hex;
  return el;
}

// ------------------------------------------------------------------------------- popover
let openPop = null;
export const colorPopoverOpen = () => !!openPop;
export function closeColorPopover() { if (openPop) { const p = openPop; openPop = null; p.close(); } }
/** Opens the colour wheel next to an anchor element. Escape or clicking outside closes it. */
export function openColorPopover(anchor, opts) {
  closeColorPopover();
  const prevFocus = document.activeElement;
  let changed = false;
  const picker = colorPicker({ ...opts, compact: true, onInput: (x) => { changed = true; opts.onInput?.(x); }, onCommit: (x) => { opts.onCommit?.(x); changed = false; } });
  const box = h('div', { class: 'popover', role: 'dialog', 'aria-label': opts.label || 'Colour' }, picker);
  const bd = h('div', { class: 'backdrop clear', onpointerdown: (e) => { if (e.target === bd) close(); } }, box);
  const close = () => { if (!bd.isConnected) return; if (changed) opts.onCommit?.(picker.value()); bd.remove(); if (openPop?.bd === bd) openPop = null; opts.onClose?.(); if (prevFocus?.isConnected) prevFocus.focus(); };
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') { const f = [...box.querySelectorAll('button, input, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent); if (!f.length) return; if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } }
  });
  document.body.appendChild(bd);
  const r = anchor.getBoundingClientRect(), b = box.getBoundingClientRect();
  let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 8;
  if (y + b.height > innerHeight - 8) y = Math.max(8, r.top - b.height - 8);
  box.style.left = Math.max(8, Math.min(innerWidth - b.width - 8, x)) + 'px'; box.style.top = y + 'px';
  openPop = { bd, close };
  setTimeout(() => box.querySelector('.cw-sv')?.focus(), 20);
  return { close, picker };
}
export { ibtn };
