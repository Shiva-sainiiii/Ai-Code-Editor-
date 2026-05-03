/**
 * NEXUS AI — UI Engine v5.0
 *
 * Responsibilities:
 *   - Command Palette (Ctrl+Shift+P)
 *   - Toast notifications (batched, auto-dismissed)
 *   - Theme management (dark/light, persisted)
 *   - Mobile navigation
 *   - Panel resize (drag handles)
 *   - Drawer toggle
 *   - Sidebar nav view switching
 *   - Status bar updates (batched via rAF)
 */
'use strict';

import { debounce, sanitizeHTML, qs, qsa, isMobile, prefersReducedMotion } from './utils.js';
import { editor, isEditorReady, currentLanguage, currentFileName, unsavedChanges } from './editor.js';

// ─── Toast Notification System ─────────────────────────────────────────────────
/**
 * PROBLEM: Old system created a DOM node per notification with setTimeout chains
 * and no queue management — spamming could flood the UI.
 *
 * FIX: Queue-based system with a max of 4 visible toasts at once.
 * Pauses animation on reduced-motion preference.
 */

const TOAST_QUEUE = [];
let   _toastCount = 0;
const MAX_TOASTS  = 4;
const ICONS = {
  success: 'circle-check',
  error:   'circle-exclamation',
  warning: 'triangle-exclamation',
  info:    'circle-info',
};

export function showNotification(msg, type = 'info', duration = 3500) {
  const container = qs('#toast-container');
  if (!container) return;

  if (_toastCount >= MAX_TOASTS) {
    // Remove oldest
    container.firstChild?.remove();
    _toastCount--;
  }

  const icon  = ICONS[type] || ICONS.info;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  toast.innerHTML = `
    <i class="fas fa-${icon}" aria-hidden="true"></i>
    <span>${sanitizeHTML(msg)}</span>
    <button class="toast-close" aria-label="Dismiss"><i class="fas fa-times"></i></button>`;

  toast.querySelector('.toast-close').addEventListener('click', () => _dismissToast(toast));

  container.appendChild(toast);
  _toastCount++;

  // Animate in (next frame to trigger CSS transition)
  requestAnimationFrame(() => toast.classList.add('show'));

  const timer = setTimeout(() => _dismissToast(toast), duration);
  toast._timer = timer;
}

function _dismissToast(toast) {
  clearTimeout(toast._timer);
  toast.classList.remove('show');
  toast.classList.add('out');
  const delay = prefersReducedMotion() ? 0 : 300;
  setTimeout(() => { toast.remove(); _toastCount--; }, delay);
}

// ─── Command Palette ───────────────────────────────────────────────────────────
/**
 * NEW FEATURE: Ctrl+Shift+P opens a fuzzy-search command palette similar to
 * VS Code. Commands are registered by modules at runtime.
 */

const _commands = [];

export function registerCommand(id, label, icon, fn, shortcut = '') {
  _commands.push({ id, label, icon, fn, shortcut });
}

export function initCommandPalette() {
  const overlay = qs('#command-palette');
  const input   = qs('#cp-input');
  const list    = qs('#cp-list');
  if (!overlay || !input || !list) return;

  const open = () => {
    overlay.classList.add('open');
    input.value = '';
    _renderCommandList('', list);
    requestAnimationFrame(() => input.focus());
  };

  const close = () => {
    overlay.classList.remove('open');
  };

  // Fuzzy filter
  input.addEventListener('input', debounce(() => {
    _renderCommandList(input.value.trim().toLowerCase(), list);
  }, 80));

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    const items = qsa('.cp-item', list);
    const active = qs('.cp-item.focused', list);
    let idx = items.indexOf(active);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
      items[idx]?.classList.add('focused');
      active?.classList.remove('focused');
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
      items[idx]?.classList.add('focused');
      active?.classList.remove('focused');
      items[idx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const focusedCmd = active?.dataset.cmdId;
      const cmd = _commands.find(c => c.id === focusedCmd) || _commands[0];
      if (cmd) { close(); cmd.fn(); }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // Click to run
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.cp-item');
    if (!item) return;
    const cmd = _commands.find(c => c.id === item.dataset.cmdId);
    if (cmd) { close(); cmd.fn(); }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Expose open/close
  window._cmdPalette = { open, close };
}

function _renderCommandList(query, list) {
  const matches = query
    ? _commands.filter(c => c.label.toLowerCase().includes(query))
    : _commands;

  if (!matches.length) {
    list.innerHTML = `<div class="cp-empty">No commands found</div>`;
    return;
  }

  list.innerHTML = matches.map((c, i) => `
    <button class="cp-item${i === 0 ? ' focused' : ''}" data-cmd-id="${sanitizeHTML(c.id)}">
      <i class="fas fa-${sanitizeHTML(c.icon)}" aria-hidden="true"></i>
      <span class="cp-label">${sanitizeHTML(c.label)}</span>
      ${c.shortcut ? `<kbd class="cp-shortcut">${sanitizeHTML(c.shortcut)}</kbd>` : ''}
    </button>`).join('');
}

// ─── Theme management ──────────────────────────────────────────────────────────

const THEMES = ['dark-theme', 'light-theme', 'hc-theme'];

export async function initTheme() {
  const saved = await _getMeta('theme', 'dark-theme');
  _applyTheme(saved);

  qs('#theme-toggle')?.addEventListener('click', () => {
    const cur = THEMES.find(t => document.body.classList.contains(t)) || 'dark-theme';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    _applyTheme(next);
    _setMeta('theme', next);

    // Update Monaco theme
    const monacoTheme = next === 'light-theme' ? 'vs' : 'nexus-dark';
    monaco?.editor?.setTheme(monacoTheme);
  });
}

function _applyTheme(theme) {
  document.body.classList.remove(...THEMES);
  document.body.classList.add(theme);
  const dot = qs('#theme-toggle');
  if (dot) dot.title = theme === 'dark-theme' ? 'Switch to Light' : 'Switch to Dark';
}

// ─── Status bar ────────────────────────────────────────────────────────────────
/**
 * PROBLEM: Old code updated status bar on every keystroke — multiple DOM
 * reads/writes per second causing layout thrashing.
 *
 * FIX: Batch all status bar updates in a single rAF callback.
 */

let _statusPending = false;

export function updateStatusBar() {
  if (_statusPending) return;
  _statusPending = true;
  requestAnimationFrame(() => {
    _statusPending = false;
    _doUpdateStatusBar();
  });
}

function _doUpdateStatusBar() {
  const langEl  = qs('#status-lang');
  const savedEl = qs('#status-saved');
  const fileEl  = qs('#status-file');

  const langName = (currentLanguage || 'Plain').replace(/^\w/, c => c.toUpperCase());

  if (langEl)  langEl.innerHTML  = `<i class="fas fa-circle" style="color:var(--accent);font-size:8px"></i> ${sanitizeHTML(langName)}`;
  if (savedEl) savedEl.innerHTML = unsavedChanges
    ? '<i class="fas fa-circle" style="color:var(--warning);font-size:8px"></i> Unsaved'
    : '<i class="fas fa-check" style="color:var(--success)"></i> Saved';
  if (fileEl)  fileEl.textContent = currentFileName || '';
}

export function updateCursorStatus(position) {
  const el = qs('#status-pos');
  if (el) el.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
}

// ─── Mobile navigation ─────────────────────────────────────────────────────────
/**
 * PROBLEM: Old switchMobileTab used display:none/flex causing full re-layouts.
 *
 * FIX: Use CSS opacity + pointer-events + translate instead, which the browser
 * can optimize without layout recalculation. Also gate Monaco layout call.
 */

const MOBILE_SECTIONS = ['explorer-drawer', 'editor-wrapper', 'ai-sidebar', 'bottom-panel'];

export function switchMobileTab(target) {
  const wasEditor = MOBILE_SECTIONS
    .find(id => qs(`#${id}`)?.classList.contains('mobile-active'));

  qsa('.m-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === target));
  MOBILE_SECTIONS.forEach(id => qs(`#${id}`)?.classList.remove('mobile-active'));

  qs(`#${target}`)?.classList.add('mobile-active');

  // Re-layout Monaco only when switching TO the editor
  if (target === 'editor-wrapper' && editor && isEditorReady) {
    // Wait for CSS transition to finish before measuring
    setTimeout(() => editor.layout(), 120);
  }
}

export function initMobileNav() {
  qsa('.m-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      if (target) switchMobileTab(target);
    });
  });

  if (isMobile()) {
    switchMobileTab('editor-wrapper');
  }
}

// ─── Sidebar view switching ────────────────────────────────────────────────────

let _activeView = 'explorer';

export function initSidebarNav() {
  qsa('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      _switchView(view);
    });
  });
}

function _switchView(view) {
  if (_activeView === view) {
    // Toggle drawer
    qs('#explorer-drawer')?.classList.toggle('collapsed');
    if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
    return;
  }

  _activeView = view;
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  const drawer = qs('#explorer-drawer');
  if (!drawer) return;

  // Show the appropriate drawer content
  const views = {
    explorer: qs('#file-explorer-view'),
    search:   qs('#search-drawer'),
    ai:       null,   // AI has its own sidebar
    settings: qs('#settings-view'),
  };

  Object.entries(views).forEach(([k, el]) => {
    if (el) el.style.display = k === view ? '' : 'none';
  });

  if (view === 'ai') {
    // Toggle AI sidebar
    qs('#ai-sidebar')?.classList.toggle('collapsed');
    if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
  } else {
    drawer.classList.remove('collapsed');
    if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
  }
}

// ─── Bottom panel resize ───────────────────────────────────────────────────────
/**
 * PROBLEM: Old resize used mousemove on document with no cleanup, causing
 * memory leaks and jank from unnecessary event processing.
 *
 * FIX: Use pointer events + setPointerCapture for reliable cross-device
 * dragging. Throttle the handler to 60fps. Clean up on pointerup.
 */

export function initPanelResize() {
  const handle = qs('#resize-handle');
  const panel  = qs('#bottom-panel');
  if (!handle || !panel) return;

  let startY     = 0;
  let startH     = 0;
  let dragging   = false;

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dragging = true;
    startY   = e.clientY;
    startH   = panel.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta  = startY - e.clientY;
    const newH   = Math.max(60, Math.min(startH + delta, window.innerHeight * 0.6));
    panel.style.height = `${newH}px`;
    // Throttle Monaco layout to rAF
    requestAnimationFrame(() => { if (editor && isEditorReady) editor.layout(); });
  });

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    if (editor && isEditorReady) editor.layout();
  };

  handle.addEventListener('pointerup',     stopDrag);
  handle.addEventListener('pointercancel', stopDrag);

  // Double-click to reset
  handle.addEventListener('dblclick', () => {
    panel.style.height = '240px';
    if (editor && isEditorReady) editor.layout();
  });
}

// ─── Panel tab switching ───────────────────────────────────────────────────────

export function initPanelTabs() {
  qs('#bottom-panel')?.addEventListener('click', (e) => {
    const tab = e.target.closest('.panel-tab[data-target]');
    if (!tab) return;

    qsa('.panel-tab').forEach(t  => t.classList.remove('active'));
    qsa('.panel-view').forEach(v => v.classList.remove('active'));

    tab.classList.add('active');
    qs(`#${tab.dataset.target}`)?.classList.add('active');
  });

  qs('#toggle-panel')?.addEventListener('click', () => {
    qs('#bottom-panel')?.classList.toggle('collapsed');
    if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
  });
}

// ─── Explorer toggle ───────────────────────────────────────────────────────────

export function initExplorerToggle() {
  qs('#toggle-explorer')?.addEventListener('click', () => {
    qs('#explorer-drawer')?.classList.toggle('collapsed');
    if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
  });
}

// ─── Helpers (meta storage shims until Storage module loads) ──────────────────

async function _getMeta(key, def) {
  try {
    const raw = localStorage.getItem(`nexus_meta_${key}`);
    return raw !== null ? JSON.parse(raw) : def;
  } catch { return def; }
}

function _setMeta(key, value) {
  localStorage.setItem(`nexus_meta_${key}`, JSON.stringify(value));
}
