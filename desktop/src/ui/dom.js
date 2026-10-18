// Tiny DOM toolkit: element builder, icons, tooltips, toasts, menus, modals and form controls
// (all keyboard accessible, with ARIA roles).
import ICONS from './icons.gen.js';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'tip') tip(el, v);
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function mount(el, ...kids) { clear(el); append(el, kids); return el; }

export function icon(name, cls = '') {
  const s = document.createElement('span');
  s.className = 'icon ' + cls; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || ICONS['circle'] || '';
  return s;
}

// ---------------------------------------------------------------------------------- tooltips
let tipEl = null, tipTimer = 0;
export function tip(el, text) {
  if (!text) return;
  const [label, key] = Array.isArray(text) ? text : [text, null];
  if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', label + (key ? ` (${key})` : ''));
  el.addEventListener('pointerenter', () => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      hideTip();
      if (!el.isConnected) return;
      tipEl = h('div', { class: 'tip', role: 'tooltip' }, label, key ? h('kbd', null, key) : null);
      document.body.appendChild(tipEl);
      const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
      let x = r.left + r.width / 2 - t.width / 2, y = r.bottom + 8;
      if (y + t.height > innerHeight - 4) y = r.top - t.height - 8;
      x = Math.max(6, Math.min(innerWidth - t.width - 6, x));
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    }, 450);
  });
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('pointerdown', hideTip);
}
export function hideTip() { clearTimeout(tipTimer); if (tipEl) { tipEl.remove(); tipEl = null; } }

// ---------------------------------------------------------------------------------- toast
let toastHost = null;
export function toast(text, ms = 2200) {
  if (!toastHost) { toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
  const t = h('div', { class: 'toast' }, text);
  toastHost.appendChild(t);
  while (toastHost.children.length > 3) toastHost.firstChild.remove();
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
}

// ---------------------------------------------------------------------------------- buttons
export function btn(label, onClick, cls = '', ic = null, tipText = null) {
  return h('button', { class: 'btn ' + cls, onclick: onClick, tip: tipText }, ic ? icon(ic) : null, label);
}
export function ibtn(ic, tipText, onClick, cls = '') {
  return h('button', { class: 'ibtn ' + cls, onclick: onClick, tip: tipText }, icon(ic));
}
export function tool(ic, label, onClick, active = false, tipText = null) {
  return h('button', { class: 'tool' + (active ? ' active' : ''), onclick: onClick, 'aria-pressed': String(!!active), tip: tipText || label }, icon(ic), h('span', null, label));
}

// ---------------------------------------------------------------------------------- menus
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
/** items: {label, icon, key, onClick, danger, disabled} | 'sep' | {header} */
export function menu(items, x, y, anchor = null) {
  closeMenu();
  const bd = h('div', { class: 'backdrop clear', onpointerdown: (e) => { if (e.target === bd) closeMenu(); }, oncontextmenu: (e) => { e.preventDefault(); closeMenu(); } });
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { m.appendChild(h('div', { class: 'sep', role: 'separator' })); continue; }
    if (it.header) { m.appendChild(h('div', { class: 'hdr' }, it.header)); continue; }
    m.appendChild(h('div', {
      class: 'item' + (it.danger ? ' danger' : ''), role: 'menuitem', tabindex: '-1', 'aria-disabled': it.disabled ? 'true' : null,
      style: it.disabled ? { opacity: 0.4, pointerEvents: 'none' } : null,
      onclick: () => { closeMenu(); it.onClick?.(); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeMenu(); it.onClick?.(); } },
    }, it.icon ? icon(it.icon) : h('span', { class: 'icon' }), it.label, it.key ? h('span', { class: 'k' }, it.key) : null));
  }
  bd.appendChild(m);
  document.body.appendChild(bd);
  openMenu = bd;
  if (anchor) { const r = anchor.getBoundingClientRect(); x = r.left; y = r.bottom + 6; }
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(6, Math.min(innerWidth - r.width - 6, x)) + 'px';
  m.style.top = Math.max(6, (y + r.height > innerHeight - 6 ? y - r.height - (anchor ? anchor.getBoundingClientRect().height + 12 : 0) : y)) + 'px';
  const focusables = [...m.querySelectorAll('.item')];
  focusables[0]?.focus();
  m.addEventListener('keydown', (e) => {
    const i = focusables.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusables[(i + 1) % focusables.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); focusables[(i - 1 + focusables.length) % focusables.length]?.focus(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor?.focus(); }
  });
  return bd;
}

// ---------------------------------------------------------------------------------- modals
const modalStack = [];
export function modal({ title, body, footer, wide = false, onClose, closable = true, icon: ic }) {
  const prevFocus = document.activeElement;
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const close = () => {
    if (!bd.isConnected) return;
    bd.remove(); modalStack.splice(modalStack.indexOf(api), 1); onClose?.();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  };
  const bd = h('div', { class: 'backdrop', onpointerdown: (e) => { if (e.target === bd && closable) close(); } }, box);
  box.appendChild(h('header', null, ic ? icon(ic) : null, h('h2', null, title), closable ? ibtn('x', ['Close', 'Esc'], close) : null));
  const bodyEl = h('div', { class: 'body' }); box.appendChild(bodyEl);
  if (body) append(bodyEl, [body]);
  let footEl = null;
  if (footer) { footEl = h('footer'); append(footEl, [footer]); box.appendChild(footEl); }
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && closable) { e.stopPropagation(); close(); }
    if (e.key === 'Tab') { // focus trap
      const f = [...box.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  document.body.appendChild(bd);
  const api = { el: box, body: bodyEl, footer: footEl, close, closable, setBody: (b) => mount(bodyEl, b) };
  modalStack.push(api);
  setTimeout(() => (box.querySelector('[autofocus]') || box.querySelector('input, .btn.primary, button'))?.focus(), 30);
  return api;
}
export const anyModalOpen = () => modalStack.length > 0 || !!openMenu;
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (openMenu) { e.preventDefault(); closeMenu(); return; }
  const top = modalStack[modalStack.length - 1];
  if (top && top.closable !== false && !top.el.contains(document.activeElement)) { e.preventDefault(); top.close(); }
}, true);

export function confirmDialog(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let done = false;
    const m = modal({
      title, body: h('p', { class: 'muted', style: { fontSize: '13.5px', margin: '4px 0 6px' } }, text),
      footer: [btn('Cancel', () => m.close(), 'ghost'), btn(okLabel, () => { done = true; m.close(); res(true); }, danger ? 'danger' : 'primary')],
      onClose: () => { if (!done) res(false); },
    });
  });
}
export function promptDialog(title, value = '', okLabel = 'Save') {
  return new Promise((res) => {
    let done = false;
    const inp = h('input', { class: 'field', value, autofocus: true, 'aria-label': title, onkeydown: (e) => { if (e.key === 'Enter') ok(); } });
    const ok = () => { done = true; m.close(); res(inp.value.trim() || null); };
    const m = modal({ title, body: inp, footer: [btn('Cancel', () => m.close(), 'ghost'), btn(okLabel, ok, 'primary')], onClose: () => { if (!done) res(null); } });
    setTimeout(() => inp.select(), 40);
  });
}

// ---------------------------------------------------------------------------------- controls
export const fmt = (v, step) => {
  if (Math.abs(v) >= 100 || step >= 1) return String(Math.round(v));
  const d = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return v.toFixed(d);
};
/** Labelled slider. onInput(v) live, onCommit(v) once at the end of a drag/keyboard change. */
export function slider({ label, min, max, step = 0.01, value, onInput, onCommit, unit = '', format, int = false }) {
  if (int) step = 1;
  const f = format || ((v) => fmt(v, step) + unit);
  const val = h('span', { class: 'value', tabindex: '-1', title: 'Click to type a value' }, f(value));
  const inp = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  const paint = () => inp.style.setProperty('--p', ((inp.value - min) / (max - min)) * 100 + '%');
  paint();
  let started = false;
  inp.addEventListener('input', () => { started = true; const v = +inp.value; val.textContent = f(v); paint(); onInput?.(v); });
  inp.addEventListener('change', () => { if (started || true) { started = false; onCommit?.(+inp.value); } });
  val.addEventListener('click', () => {
    const e = h('input', { class: 'field', value: fmt(+inp.value, step), style: { width: '70px', height: '24px', fontSize: '12px', padding: '0 6px' } });
    val.replaceWith(e); e.focus(); e.select();
    const done = (apply) => {
      if (!e.isConnected) return;
      if (apply) { const v = parseFloat(e.value); if (Number.isFinite(v)) { inp.value = String(v); const vv = Math.max(min, Math.min(max * 100, v)); val.textContent = f(vv); paint(); onInput?.(vv); onCommit?.(vv); } }
      e.replaceWith(val);
    };
    e.addEventListener('keydown', (k) => { if (k.key === 'Enter') done(true); if (k.key === 'Escape') { k.stopPropagation(); done(false); } });
    e.addEventListener('blur', () => done(true));
  });
  const el = h('div', { class: 'slider' }, h('span', { class: 'name' }, label), val, inp);
  el.set = (v) => { inp.value = v; val.textContent = f(v); paint(); };
  return el;
}
export function toggle(label, value, onChange, sub = null) {
  const sw = h('button', { class: 'switch', role: 'switch', 'aria-checked': String(!!value), 'aria-label': label });
  sw.addEventListener('click', () => { const v = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', String(v)); onChange(v); });
  return h('div', { class: 'toggle' }, h('div', { class: 't' }, h('span', null, label), sub ? h('span', { class: 'sub' }, sub) : null), sw);
}
/** Segmented control. options: [[value, label, icon?], ...] */
export function seg(options, value, onChange, cls = '', ariaLabel = '') {
  const el = h('div', { class: 'seg ' + cls, role: 'radiogroup', 'aria-label': ariaLabel });
  const buttons = options.map(([v, label, ic, tipText]) => {
    const b = h('button', { role: 'radio', 'aria-checked': String(v === value), tip: tipText, onclick: () => { buttons.forEach((x) => x.setAttribute('aria-checked', 'false')); b.setAttribute('aria-checked', 'true'); onChange(v); } }, ic ? icon(ic) : null, label);
    return b;
  });
  buttons.forEach((b) => el.appendChild(b));
  return el;
}
export function select(options, value, onChange, ariaLabel = '') {
  const s = h('select', { class: 'field', 'aria-label': ariaLabel, onchange: () => onChange(s.value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  return s;
}
export function colorSwatch(hex, onInput, onCommit, label = 'Color') {
  const inp = h('input', { type: 'color', value: hex, 'aria-label': label });
  const sw = h('div', { class: 'swatch', style: { background: hex } }, inp);
  inp.addEventListener('input', () => { sw.style.background = inp.value; onInput?.(inp.value); });
  inp.addEventListener('change', () => onCommit?.(inp.value));
  return sw;
}
/** Three numeric fields with drag-to-scrub labels (X/Y/Z). */
export function vec3Field(values, onInput, onCommit, step = 0.01, labels = ['X', 'Y', 'Z']) {
  const colors = ['var(--x)', 'var(--y)', 'var(--z)'];
  const cur = [...values];
  const inputs = [];
  const el = h('div', { class: 'num3' }, values.map((v, i) => {
    const inp = h('input', { value: fmt(v, step), 'aria-label': labels[i], inputmode: 'decimal' });
    inputs.push(inp);
    const commit = () => { const n = parseFloat(inp.value); if (Number.isFinite(n)) { cur[i] = n; onInput?.([...cur]); onCommit?.([...cur]); } inp.value = fmt(cur[i], step); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); cur[i] += (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1); inp.value = fmt(cur[i], step); onInput?.([...cur]); onCommit?.([...cur]); } });
    inp.addEventListener('blur', commit);
    const grab = h('label', { title: 'Drag to change' });
    grab.addEventListener('pointerdown', (e) => {
      e.preventDefault(); grab.setPointerCapture(e.pointerId);
      const x0 = e.clientX, v0 = cur[i];
      const mv = (ev) => { cur[i] = v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 0.1 : 1); inp.value = fmt(cur[i], step); onInput?.([...cur]); };
      const up = () => { grab.removeEventListener('pointermove', mv); grab.removeEventListener('pointerup', up); onCommit?.([...cur]); };
      grab.addEventListener('pointermove', mv); grab.addEventListener('pointerup', up);
    });
    return h('div', { class: 'num', style: { '--c': colors[i] } }, inp, grab);
  }));
  el.set = (vals) => vals.forEach((v, i) => { cur[i] = v; if (document.activeElement !== inputs[i]) inputs[i].value = fmt(v, step); });
  return el;
}
export const section = (t) => h('div', { class: 'section', role: 'heading', 'aria-level': '3' }, t);
export const hexOf = (c) => '#' + c.getHexString();
export function busy(text = 'Working…') {
  const el = h('div', { class: 'loading', role: 'alert', 'aria-busy': 'true' }, h('div', { class: 'progress-card' }, h('div', { class: 'spinner' }), h('span', null, text)));
  document.body.appendChild(el);
  return { set: (t) => { el.querySelector('span').textContent = t; }, close: () => el.remove() };
}
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
