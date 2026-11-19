// Discreet on-screen palette chooser for a passive display. One small swatch per
// theme, bottom corner; the choice persists per device (localStorage) and can be
// forced with ?theme=<id>. Idle-fades so it does not intrude on the ambient view.

import { THEMES } from './themes.js';

const KEY = 'keyscape_theme';
const valid = (id) => THEMES.some((t) => t.id === id);

export function saveTheme(id) { try { localStorage.setItem(KEY, id); } catch { /* storage blocked */ } }

// Resolve the theme id to start with: ?theme= > saved > default.
export function initialThemeId(defaultId) {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (valid(fromUrl)) return fromUrl;
  try { const s = localStorage.getItem(KEY); if (valid(s)) return s; } catch { /* storage blocked */ }
  return valid(defaultId) ? defaultId : THEMES[0].id;
}

// Returns a controller { setActive(id) } so the auto-cycle can reflect the
// current theme on the swatches. A manual click persists the choice.
export function buildThemeSwitcher(currentId, onSelect) {
  const wrap = document.createElement('div');
  wrap.id = 'theme-switcher';
  const buttons = new Map();
  for (const t of THEMES) {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (t.id === currentId ? ' active' : '');
    btn.title = t.name + (t.dark ? ' - dark' : ' - light');
    btn.style.background = t.background;
    btn.style.borderColor = t.status['used-empty'];
    const dot = document.createElement('span');
    dot.style.background = t.status['used-empty'];
    btn.appendChild(dot);
    btn.addEventListener('click', () => { setActive(t.id); saveTheme(t.id); onSelect(t); });
    buttons.set(t.id, btn);
    wrap.appendChild(btn);
  }
  document.body.appendChild(wrap);

  function setActive(id) { for (const [tid, b] of buttons) b.classList.toggle('active', tid === id); }

  // Idle-fade: show on pointer activity, fade after a few seconds of stillness.
  let timer;
  const wake = () => {
    wrap.classList.remove('idle');
    clearTimeout(timer);
    timer = setTimeout(() => wrap.classList.add('idle'), 4000);
  };
  for (const ev of ['pointermove', 'pointerdown', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
  wake();
  return { el: wrap, setActive };
}
