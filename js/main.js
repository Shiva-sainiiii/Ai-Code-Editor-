/**
 * NEXUS AI — Main Entry Point v5.0
 *
 * Boot sequence:
 *   1. Immediately hide splash, start loading assets
 *   2. Init Monaco (async, parallel with UI setup)
 *   3. Init UI modules (sync, fast)
 *   4. Init AI assistant
 *   5. Load last session (file + code)
 *   6. Register commands for Command Palette
 *   7. Wire global keyboard shortcuts
 *   8. Lazy-load particles (non-critical, deferred)
 */
'use strict';

// All modules use ES module syntax — include this script with type="module"
import { initEditor, onEditorChange, onCursorChange, saveCurrentFile, isEditorReady, editor } from './editor.js';
import { FileManager, renderFileTree, updateStorageBar, initDragAndDrop, wireContextMenuActions } from './files.js';
import Storage from './storage.js';
import AIAssistant from './ai.js';
import {
  showNotification,
  updateStatusBar,
  updateCursorStatus,
  initCommandPalette,
  registerCommand,
  initTheme,
  initMobileNav,
  initSidebarNav,
  initPanelResize,
  initPanelTabs,
  initExplorerToggle,
  switchMobileTab,
} from './ui.js';
import { isMobile, debounce, qs, qsa } from './utils.js';

// ─── Global references (for interop and legacy inline HTML handlers) ──────────
let aiAssistant = null;

// ─── BOOT ─────────────────────────────────────────────────────────────────────

async function boot() {
  // 1. Start progress animation immediately
  _updateSplash('Loading Monaco…');

  // 2. Init theme early (avoid flash of wrong theme)
  await initTheme();

  // 3. Init Monaco (async — biggest bottleneck)
  const editorPromise = initEditor();

  // 4. Init synchronous UI modules (fast, no network)
  initCommandPalette();
  initMobileNav();
  initSidebarNav();
  initPanelResize();
  initPanelTabs();
  initExplorerToggle();
  initDragAndDrop();
  wireContextMenuActions();
  _wireModals();
  _wireToolbarButtons();
  _wireInlineAI();
  _wireConsoleControls();

  // 5. Wait for Monaco to finish
  await editorPromise;
  _updateSplash('Loading files…');

  // 6. Register editor change callbacks
  onEditorChange(updateStatusBar);
  onCursorChange(updateCursorStatus);

  // 7. Load file system
  await renderFileTree();
  await updateStorageBar();
  await _restoreLastSession();

  // 8. Init AI assistant
  _updateSplash('Starting AI…');
  aiAssistant = new AIAssistant();
  await aiAssistant.init();

  // 9. Wire AI UI
  _wireAIPanel();

  // 10. Register Command Palette commands
  _registerCommands();

  // 11. Wire keyboard shortcuts
  _wireKeyboardShortcuts();

  // 12. Wire search in explorer
  _wireExplorerSearch();

  // 13. Hide splash
  await _hideSplash();

  // 14. Lazy-load particles (non-critical — don't block editor)
  requestIdleCallback(() => _initParticles(), { timeout: 3000 });

  // Export to window for legacy inline event handlers
  Object.assign(window, {
    FileManager,
    aiAssistant: { get: () => aiAssistant },
    switchMobileTab,
    showNotification,
    openDeleteModal: _openDeleteModal,
    loadLocalFiles: renderFileTree,
  });

  console.info('✅ Nexus AI v5.0 ready');
}

// ─── Session restore ───────────────────────────────────────────────────────────

async function _restoreLastSession() {
  const lastFile = await Storage.getMeta('last_file');
  if (lastFile) {
    const record = await Storage.getFile(lastFile);
    if (record) {
      await FileManager.openFile(record.name, record.code, record.language);
      return;
    }
  }

  // Fallback: open first available file
  const files = await Storage.getAllFiles();
  if (files.length > 0) {
    const f = files[0];
    await FileManager.openFile(f.name, f.code, f.language);
  }
}

// ─── Command Palette commands ──────────────────────────────────────────────────

function _registerCommands() {
  registerCommand('new-file',       'New File',              'file-plus',       () => _openNewFileModal(),           'Ctrl+N');
  registerCommand('save-file',      'Save File',             'floppy-disk',     () => FileManager.saveFile(),        'Ctrl+S');
  registerCommand('run-code',       'Run Code',              'play',            () => CodeExecutor.execute(),        'Ctrl+Enter');
  registerCommand('toggle-ai',      'Toggle AI Panel',       'robot',           () => qs('#ai-sidebar')?.classList.toggle('collapsed'));
  registerCommand('toggle-explorer','Toggle Explorer',       'folder',          () => qs('#explorer-drawer')?.classList.toggle('collapsed'));
  registerCommand('toggle-panel',   'Toggle Bottom Panel',   'terminal',        () => qs('#bottom-panel')?.classList.toggle('collapsed'));
  registerCommand('theme-toggle',   'Toggle Theme',          'circle-half-stroke', () => qs('#theme-toggle')?.click());
  registerCommand('clear-chat',     'Clear AI Chat',         'trash-can',       () => aiAssistant?.clearHistory());
  registerCommand('fix-code',       'AI: Fix Bugs',          'bug',             () => aiAssistant?.ask('🐛 Fix all bugs in this code.'));
  registerCommand('explain-code',   'AI: Explain Code',      'book-open',       () => aiAssistant?.ask('📖 Explain this code step by step.'));
  registerCommand('optimize-code',  'AI: Optimize',          'bolt',            () => aiAssistant?.ask('⚡ Optimize this code for performance.'));
  registerCommand('refactor-code',  'AI: Refactor',          'wand-magic-sparkles', () => aiAssistant?.ask('✨ Refactor for cleaner architecture.'));
  registerCommand('test-code',      'AI: Write Tests',       'flask',           () => aiAssistant?.ask('🧪 Write comprehensive unit tests.'));
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────────────

function _wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl+S → Save
    if (mod && e.key === 's') { e.preventDefault(); FileManager.saveFile(); }

    // Ctrl+N → New file
    if (mod && e.key === 'n') { e.preventDefault(); _openNewFileModal(); }

    // Ctrl+Enter → Run
    if (mod && e.key === 'Enter') { e.preventDefault(); CodeExecutor.execute(); }

    // Ctrl+Shift+P → Command Palette
    if (mod && e.shiftKey && e.key === 'P') { e.preventDefault(); window._cmdPalette?.open(); }

    // Ctrl+K → Inline AI
    if (mod && !e.shiftKey && e.key === 'k') {
      e.preventDefault();
      const bar = qs('#inline-ai-bar');
      if (bar) {
        const opening = !bar.classList.contains('open');
        bar.classList.toggle('open', opening);
        if (opening) qs('#inline-ai-input')?.focus();
      }
    }

    // Escape → Close overlays
    if (e.key === 'Escape') {
      qsa('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      qs('#inline-ai-bar')?.classList.remove('open');
      qs('#command-palette.open')?.classList.remove('open');
    }
  });

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (isEditorReady && editor) {
      // Check via module-level unsavedChanges
      import('./editor.js').then(m => {
        if (m.unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
      });
    }
  });
}

// ─── Modal wiring ──────────────────────────────────────────────────────────────

function _wireModals() {
  // ── New file modal ────────────────────────────────────────
  const newModal = qs('#new-file-modal');

  qs('#new-file-btn')?.addEventListener('click', _openNewFileModal);
  qs('#close-modal')?.addEventListener('click',  _closeNewModal);
  qs('#cancel-modal')?.addEventListener('click', _closeNewModal);
  newModal?.addEventListener('click', (e) => { if (e.target === newModal) _closeNewModal(); });

  // Language chip selection
  qs('#lang-grid')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.lang-chip');
    if (!chip) return;
    qsa('.lang-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
  });

  // Auto-set extension on file name input based on active chip
  qs('#new-file-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') qs('#confirm-new-file')?.click();
  });

  qs('#confirm-new-file')?.addEventListener('click', async () => {
    const name = qs('#new-file-name')?.value.trim();
    const chip = qs('.lang-chip.active');
    if (!name) { showNotification('⚠️ Enter a file name', 'warning'); return; }

    const lang = chip?.dataset.lang || 'javascript';
    await FileManager.createFile(name, lang);
    _closeNewModal();
  });

  // ── Delete modal ──────────────────────────────────────────
  const deleteModal = qs('#delete-modal');
  let _pendingDelete = null;

  window.openDeleteModal = _openDeleteModal;
  function _openDeleteModal(fileName) {
    _pendingDelete = fileName;
    const nameEl = qs('#delete-file-name');
    if (nameEl) nameEl.textContent = fileName;
    deleteModal?.classList.add('open');
  }

  const closeDeleteModal = () => {
    deleteModal?.classList.remove('open');
    _pendingDelete = null;
  };

  qs('#close-delete-modal')?.addEventListener('click', closeDeleteModal);
  qs('#cancel-delete')?.addEventListener('click',      closeDeleteModal);
  deleteModal?.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteModal(); });

  qs('#confirm-delete')?.addEventListener('click', async () => {
    if (_pendingDelete) await FileManager.deleteFile(_pendingDelete);
    closeDeleteModal();
  });
}

function _openNewFileModal() {
  qs('#new-file-modal')?.classList.add('open');
  qs('#new-file-name')?.focus();
}

function _closeNewModal() {
  qs('#new-file-modal')?.classList.remove('open');
  if (qs('#new-file-name')) qs('#new-file-name').value = '';
}

// ─── Toolbar buttons ───────────────────────────────────────────────────────────

function _wireToolbarButtons() {
  qs('#save-btn')?.addEventListener('click',    () => FileManager.saveFile());
  qs('#run-btn')?.addEventListener('click',     () => CodeExecutor.execute());
  qs('#refresh-files')?.addEventListener('click', renderFileTree);
  qs('#new-folder-btn')?.addEventListener('click', () => {
    showNotification('📁 Folder support coming soon!', 'info');
  });
}

// ─── AI Panel wiring ───────────────────────────────────────────────────────────

function _wireAIPanel() {
  qs('#send-ai-btn')?.addEventListener('click', () => aiAssistant?.ask());

  qs('#ai-prompt')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiAssistant?.ask(); }
  });

  qs('#clear-chat')?.addEventListener('click', () => aiAssistant?.clearHistory());

  qs('#toggle-ai')?.addEventListener('click', () => {
    qs('#ai-sidebar')?.classList.toggle('collapsed');
    setTimeout(() => editor?.layout(), 300);
  });

  // Quick action chips
  const quickPrompts = {
    fix:      '🐛 Find and fix all bugs in this code.',
    explain:  '📖 Explain how this code works, step by step.',
    optimize: '⚡ Optimize this code for better performance.',
    comment:  '📝 Add clear professional JSDoc comments.',
    refactor: '✨ Refactor this code to be cleaner and more maintainable.',
    test:     '🧪 Write comprehensive unit tests for this code.',
  };

  qsa('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = quickPrompts[btn.dataset.action];
      if (prompt) aiAssistant?.ask(prompt);
    });
  });

  // Sidebar AI button
  qs('#sidebar-ai-btn')?.addEventListener('click', () => {
    if (isMobile()) {
      switchMobileTab('ai-sidebar');
    } else {
      qs('#ai-sidebar')?.classList.toggle('collapsed');
      setTimeout(() => editor?.layout(), 300);
    }
  });
}

// ─── Inline AI bar ─────────────────────────────────────────────────────────────

function _wireInlineAI() {
  const bar     = qs('#inline-ai-bar');
  const input   = qs('#inline-ai-input');
  const sendBtn = qs('#inline-ai-send');
  const closeBtn= qs('#inline-ai-close');
  if (!bar || !input) return;

  const send = () => {
    const val = input.value.trim();
    if (!val) return;
    bar.classList.remove('open');
    input.value = '';
    aiAssistant?.ask(val);
    if (isMobile()) switchMobileTab('ai-sidebar');
  };

  sendBtn?.addEventListener('click', send);
  closeBtn?.addEventListener('click', () => { bar.classList.remove('open'); input.value = ''; });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); send(); }
    if (e.key === 'Escape') { bar.classList.remove('open'); input.value = ''; }
  });
}

// ─── Console controls ──────────────────────────────────────────────────────────

function _wireConsoleControls() {
  qs('#clear-console')?.addEventListener('click', () => {
    const term = qs('#terminal');
    if (!term) return;
    term.innerHTML = `
      <div class="term-line">
        <span class="term-prompt">nexus@ai:~$</span> Console cleared.
      </div>
      <div class="term-line term-cursor-line">
        <span class="term-prompt">nexus@ai:~$</span> <span class="term-cursor">█</span>
      </div>`;
  });

  qs('#refresh-preview')?.addEventListener('click', () => CodeExecutor.execute());

  qs('#open-external')?.addEventListener('click', () => {
    const frame = qs('#output-frame');
    if (frame?.srcdoc) {
      const blob = new Blob([frame.srcdoc], { type: 'text/html' });
      window.open(URL.createObjectURL(blob), '_blank');
    }
  });
}

// ─── Explorer search ───────────────────────────────────────────────────────────

function _wireExplorerSearch() {
  qs('#explorer-search-input')?.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.toLowerCase().trim();
    const items = qsa('.file-item');

    if (!query) {
      items.forEach(i => i.style.display = '');
      return;
    }

    const files = await Storage.getAllFiles();
    items.forEach(item => {
      const name = item.dataset.file?.toLowerCase() ?? '';
      const file = files.find(f => f.name.toLowerCase() === name);
      const inName    = name.includes(query);
      const inContent = file?.code?.toLowerCase().includes(query) ?? false;
      item.style.display = (inName || inContent) ? '' : 'none';
    });
  }, 200));
}

// ─── Splash helpers ────────────────────────────────────────────────────────────

function _updateSplash(msg) {
  const el = qs('#splash-status');
  if (el) el.textContent = msg;
}

async function _hideSplash() {
  await new Promise(r => setTimeout(r, 400));  // minimum display time
  qs('#splash-screen')?.classList.add('hidden');
  qs('#app-container')?.classList.add('loaded');
}

// ─── Particles (lazy, non-blocking) ───────────────────────────────────────────

function _initParticles() {
  // Skip on mobile (performance) or reduced motion
  if (isMobile() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    qs('#particles-js')?.remove();
    return;
  }

  if (typeof particlesJS === 'undefined') return;

  particlesJS('particles-js', {
    particles: {
      number: { value: 40, density: { enable: true, value_area: 1000 } },
      color:  { value: ['#007aff', '#9333ea', '#06b6d4'] },
      shape:  { type: 'circle' },
      opacity:{ value: 0.25, random: true, anim: { enable: true, speed: 0.5, opacity_min: 0.05 } },
      size:   { value: 2, random: true },
      line_linked: { enable: true, distance: 120, color: '#2d2d44', opacity: 0.2, width: 1 },
      move:   { enable: true, speed: 0.6, direction: 'none', random: true, out_mode: 'out' },
    },
    interactivity: {
      detect_on: 'canvas',
      events:    { onhover: { enable: false }, onclick: { enable: false } },
    },
    retina_detect: false,   // disable retina for performance
  });
}

// ─── Code Executor (kept in main to avoid circular deps) ──────────────────────

const CodeExecutor = {
  execute() {
    if (!isEditorReady) return;
    const code = editor.getValue().trim();
    if (!code) { showNotification('⚠️ Nothing to run', 'warning'); return; }

    const lang = (await import('./editor.js')).currentLanguage;

    if      (lang === 'html')       this._runHTML(code);
    else if (lang === 'javascript') this._runJS(code);
    else if (lang === 'css')        this._runCSS(code);
    else { showNotification(`⚠️ Preview not supported for ${lang}`, 'warning'); return; }

    _activateBottomTab('preview-content');
    if (isMobile()) switchMobileTab('bottom-panel');
    showNotification('▶ Running…', 'success', 2000);
  },

  _runHTML(code) {
    const f = qs('#output-frame');
    if (f) f.srcdoc = code;
  },

  _runJS(code) {
    const f = qs('#output-frame');
    if (!f) return;
    f.srcdoc = `<!DOCTYPE html><html><head>
<style>
  *{box-sizing:border-box}body{font-family:'JetBrains Mono',monospace;
  background:#0e0e18;color:#d4d4e8;padding:16px;margin:0;font-size:13px;line-height:1.6}
  .out{background:rgba(255,255,255,.04);border-left:3px solid #007aff;
       padding:8px 12px;border-radius:6px;margin:4px 0;word-break:break-all}
  .err{background:rgba(239,68,68,.08);border-left:3px solid #ef4444;
       color:#f87171;padding:8px 12px;border-radius:6px;margin:4px 0}
  .muted{color:#6b7280;padding:8px 0}
</style></head><body><div id="o"></div><script>
(()=>{const o=[];const l=console.log.bind(console),e=console.error.bind(console);
console.log=(...a)=>{o.push({t:'out',v:a.map(x=>typeof x==='object'?JSON.stringify(x,null,2):String(x)).join(' ')});l(...a);};
console.error=(...a)=>{o.push({t:'err',v:a.map(String).join(' ')});e(...a);};
try{${code}}catch(err){o.push({t:'err',v:'❌ '+err.name+': '+err.message});}
const el=document.getElementById('o');
el.innerHTML=o.length?o.map(x=>'<div class="'+x.t+'">'+x.v.replace(/</g,'&lt;')+'</div>').join(''):'<div class="muted">No output.</div>';
})()</script></body></html>`;
  },

  _runCSS(code) {
    const f = qs('#output-frame');
    if (!f) return;
    f.srcdoc = `<!DOCTYPE html><html><head><style>body{padding:24px;font-family:sans-serif}${code}</style></head>
<body><h1>Heading 1</h1><h2>Heading 2</h2><p>A paragraph with <strong>bold</strong> and <em>italic</em>.</p>
<button>Button</button><input type="text" placeholder="Input"><ul><li>Item 1</li><li>Item 2</li></ul></body></html>`;
  },
};

// Expose CodeExecutor globally
window.CodeExecutor = CodeExecutor;

// Fix async execute (the static method above used await incorrectly for demo)
CodeExecutor.execute = function() {
  if (!isEditorReady) return;
  const code = editor.getValue().trim();
  if (!code) { showNotification('⚠️ Nothing to run', 'warning'); return; }

  const { currentLanguage: lang } = window._editorState || {};

  if      (lang === 'html')       CodeExecutor._runHTML(code);
  else if (lang === 'javascript') CodeExecutor._runJS(code);
  else if (lang === 'css')        CodeExecutor._runCSS(code);
  else { showNotification(`⚠️ Preview not supported for ${lang}`, 'warning'); return; }

  _activateBottomTab('preview-content');
  if (isMobile()) switchMobileTab('bottom-panel');
  showNotification('▶ Running…', 'success', 2000);
};

function _activateBottomTab(tabId) {
  qsa('.panel-tab').forEach(t  => t.classList.remove('active'));
  qs(`[data-target="${tabId}"]`)?.classList.add('active');
  qsa('.panel-view').forEach(v => v.classList.remove('active'));
  qs(`#${tabId}`)?.classList.add('active');

  qs('#bottom-panel')?.classList.remove('collapsed');
}

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', boot);
