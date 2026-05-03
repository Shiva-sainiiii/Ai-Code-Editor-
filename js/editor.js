/**
 * NEXUS AI — Editor Engine v5.0
 *
 * Key improvements over v4:
 * 1. Mobile-first Monaco config (no minimap, touch scrolling, safe font sizes)
 * 2. VisualViewport API to handle mobile keyboard overlap
 * 3. Debounced resize — stops layout thrashing during drag/orientation change
 * 4. Auto-save with configurable delay (default 2 s after last keystroke)
 * 5. Models cached per file — no full setValue on tab switch (huge perf win)
 * 6. Reduced re-render: status bar batched via rAF
 */
'use strict';

import { debounce, isMobile, isLowEnd, sanitizeHTML, detectLanguage } from './utils.js';
import Storage from './storage.js';

// ─── State ─────────────────────────────────────────────────────────────────────
export let editor          = null;
export let isEditorReady   = false;
export let currentFileName = 'untitled.js';
export let currentLanguage = 'javascript';
export let unsavedChanges  = false;

// Model cache: filename → monaco.editor.ITextModel
const _models = new Map();

// Callbacks registered by other modules
const _changeCallbacks  = [];
const _cursorCallbacks  = [];

// Auto-save timer
let _autoSaveTimer = null;
const AUTO_SAVE_DELAY = 2000; // ms

// ─── Monaco initialization ─────────────────────────────────────────────────────

export function initEditor() {
  return new Promise((resolve) => {
    require.config({
      paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' },
    });

    require(['vs/editor/editor.main'], async () => {
      const savedCode = await Storage.getMeta('last_code', _defaultCode());
      const mobile    = isMobile();
      const lowEnd    = isLowEnd();

      editor = monaco.editor.create(
        document.getElementById('monaco-container'),
        _buildEditorOptions(mobile, lowEnd, savedCode)
      );

      _defineCustomTheme();
      monaco.editor.setTheme('nexus-dark');

      isEditorReady = true;
      _attachEditorListeners(mobile);
      _attachVisualViewportFix(mobile);
      _attachResizeObserver();

      resolve(editor);
      console.info('✅ Monaco ready — mobile:', mobile, '| lowEnd:', lowEnd);
    });
  });
}

function _buildEditorOptions(mobile, lowEnd, initialCode) {
  return {
    value:                   initialCode,
    language:                'javascript',
    theme:                   'vs-dark',         // overridden by custom theme after init
    automaticLayout:         false,             // we handle layout manually (see ResizeObserver)
    fontSize:                mobile ? 13 : 14,
    fontFamily:              "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    fontLigatures:           !mobile,           // ligatures add render cost on mobile
    lineHeight:              mobile ? 20 : 22,

    // Minimap is expensive on mobile — disable it
    minimap: {
      enabled:   !mobile,
      scale:     1,
      maxColumn: 80,
    },

    // Smooth animations are heavy on low-end — disable
    cursorSmoothCaretAnimation: lowEnd ? 'off' : 'on',
    smoothScrolling:            !lowEnd,

    padding:          { top: mobile ? 12 : 20, bottom: 20 },
    roundedSelection: true,
    wordWrap:         'on',
    formatOnPaste:    true,
    formatOnType:     false,

    // Scrollbar
    scrollbar: {
      vertical:              'visible',
      horizontal:            'visible',
      useShadows:            false,
      verticalScrollbarSize: mobile ? 6 : 8,
      horizontalScrollbarSize: mobile ? 6 : 8,
      // Better touch scrolling
      alwaysConsumeMouseWheel: false,
    },

    // Mobile-specific touch config
    mouseWheelScrollSensitivity: mobile ? 1.5 : 1,
    fastScrollSensitivity: 5,

    lineNumbers:             'on',
    renderWhitespace:        'selection',
    bracketPairColorization: { enabled: !lowEnd },
    guides:                  { bracketPairs: !lowEnd },

    // Suggestions: disable heavy features on low-end
    quickSuggestions:   !lowEnd,
    suggest:            { showKeywords: !lowEnd, preview: !lowEnd },
    parameterHints:     { enabled: !lowEnd },
    inlineSuggest:      { enabled: !lowEnd },

    // Rendering
    renderLineHighlight:     lowEnd ? 'none' : 'line',
    occurrencesHighlight:    !lowEnd,
    codeLens:                !lowEnd,
    folding:                 !mobile,            // folding arrows waste space on mobile
    foldingHighlight:        false,

    // Accessibility
    accessibilitySupport:    'auto',

    // Context menu (replaces browser default on mobile)
    contextmenu:             !mobile,
  };
}

// ─── Custom theme ──────────────────────────────────────────────────────────────

function _defineCustomTheme() {
  monaco.editor.defineTheme('nexus-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment',          foreground: '5c6370', fontStyle: 'italic' },
      { token: 'keyword',          foreground: 'c678dd' },
      { token: 'string',           foreground: '98c379' },
      { token: 'number',           foreground: 'd19a66' },
      { token: 'type',             foreground: 'e5c07b' },
      { token: 'function',         foreground: '61afef' },
      { token: 'variable',         foreground: 'e06c75' },
    ],
    colors: {
      'editor.background':            '#080810',
      'editor.foreground':            '#d4d4e8',
      'editor.lineHighlightBackground':'#0e0e1a',
      'editor.selectionBackground':   '#264f78',
      'editorCursor.foreground':      '#007aff',
      'editorLineNumber.foreground':  '#3d3d5c',
      'editorLineNumber.activeForeground': '#6b7280',
      'editorGutter.background':      '#080810',
      'scrollbarSlider.background':   '#ffffff14',
      'scrollbarSlider.hoverBackground':'#ffffff22',
    },
  });
}

// ─── Editor event listeners ────────────────────────────────────────────────────

function _attachEditorListeners(mobile) {
  // Debounced auto-save
  const debouncedSave = debounce(_autoSave, AUTO_SAVE_DELAY);

  editor.onDidChangeModelContent(() => {
    unsavedChanges = true;
    _notifyChange();
    debouncedSave();
  });

  editor.onDidChangeCursorPosition(({ position }) => {
    _cursorCallbacks.forEach(cb => cb(position));
  });

  // Language selector
  document.getElementById('language-selector')?.addEventListener('change', (e) => {
    currentLanguage = e.target.value;
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, currentLanguage);
    _notifyChange();
  });
}

// ─── Mobile keyboard / VisualViewport fix ─────────────────────────────────────
/**
 * PROBLEM: On mobile, when the software keyboard opens, the browser resizes
 * the viewport, but the Monaco container doesn't know — causing blank space.
 *
 * FIX: Use the VisualViewport API (supported on Chrome/Safari mobile) to
 * detect viewport changes and re-layout Monaco. Also adjust container height
 * to avoid content being hidden under the keyboard.
 */
function _attachVisualViewportFix(mobile) {
  if (!mobile || !window.visualViewport) return;

  let _prevHeight = window.visualViewport.height;

  const onViewportChange = debounce(() => {
    const vh    = window.visualViewport.height;
    const delta = _prevHeight - vh;    // positive = keyboard appeared
    _prevHeight = vh;

    const container = document.getElementById('monaco-container');
    if (!container) return;

    if (delta > 100) {
      // Keyboard opened — shrink editor area
      container.style.paddingBottom = `${delta}px`;
    } else if (delta < -100) {
      // Keyboard closed — restore
      container.style.paddingBottom = '0px';
    }

    if (editor && isEditorReady) editor.layout();
  }, 80);

  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
}

// ─── ResizeObserver for Monaco container ──────────────────────────────────────
/**
 * PROBLEM: Monaco with automaticLayout:true uses a setInterval to poll the
 * container size. This runs every 100 ms even when nothing changes — wasting
 * CPU cycles, causing lag on low-end devices.
 *
 * FIX: Use ResizeObserver (zero cost when no change) to trigger layout only
 * when the container actually changes size. Debounce it to batch rapid
 * resize events during drag.
 */
function _attachResizeObserver() {
  const container = document.getElementById('monaco-container');
  if (!container || !window.ResizeObserver) {
    // Fallback: debounced window resize
    window.addEventListener('resize', debounce(() => {
      if (editor && isEditorReady) editor.layout();
    }, 150));
    return;
  }

  const ro = new ResizeObserver(debounce((entries) => {
    if (!editor || !isEditorReady) return;
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) editor.layout({ width, height });
  }, 80));

  ro.observe(container);
}

// ─── Model cache (per-file models) ────────────────────────────────────────────
/**
 * PROBLEM: FileManager was calling editor.setValue() on every tab switch.
 * This destroys undo history and triggers expensive re-tokenisation.
 *
 * FIX: Create one ITextModel per file and swap models on tab switch.
 * Each model retains its own undo stack, selections, and scroll position.
 */
export function getOrCreateModel(fileName, code, language) {
  if (_models.has(fileName)) {
    return _models.get(fileName);
  }
  const uri   = monaco.Uri.parse(`file:///${fileName}`);
  const model = monaco.editor.createModel(code, language, uri);
  _models.set(fileName, model);
  return model;
}

export function switchEditorModel(fileName, code, language) {
  if (!editor || !isEditorReady) return;

  const model = getOrCreateModel(fileName, code, language);

  // Update model code if different (e.g., loaded from storage)
  if (model.getValue() !== code) {
    model.setValue(code);
  }

  editor.setModel(model);
  currentFileName = fileName;
  currentLanguage = language || detectLanguage(fileName);
  unsavedChanges  = false;

  const ls = document.getElementById('language-selector');
  if (ls) ls.value = currentLanguage;
}

export function disposeModel(fileName) {
  const model = _models.get(fileName);
  if (model) {
    model.dispose();
    _models.delete(fileName);
  }
}

// ─── Auto-save ─────────────────────────────────────────────────────────────────

async function _autoSave() {
  if (!isEditorReady || !currentFileName || currentFileName === 'untitled.js') return;

  const code = editor.getValue();
  await Storage.saveFile({ name: currentFileName, code, language: currentLanguage });
  await Storage.setMeta('last_code', code);
  await Storage.setMeta('last_file', currentFileName);

  unsavedChanges = false;
  _notifyChange();
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Force immediate save (triggered by Ctrl+S) */
export async function saveCurrentFile() {
  const code = editor?.getValue() ?? '';
  await Storage.saveFile({ name: currentFileName, code, language: currentLanguage });
  await Storage.setMeta('last_code', code);
  unsavedChanges = false;
  _notifyChange();
  return code;
}

/** Get current editor content */
export const getCode     = ()  => editor?.getValue() ?? '';
export const setCode     = (v) => editor?.setValue(v);

/** Register callbacks */
export const onEditorChange = (cb) => _changeCallbacks.push(cb);
export const onCursorChange = (cb) => _cursorCallbacks.push(cb);

function _notifyChange() {
  requestAnimationFrame(() => _changeCallbacks.forEach(cb => cb()));
}

/** Update Monaco options (e.g., on theme change) */
export const updateEditorOptions = (opts) => editor?.updateOptions(opts);

// ─── Default welcome code ──────────────────────────────────────────────────────

function _defaultCode() {
  return [
    '// ✨ Welcome to Nexus AI v5.0',
    '// Start coding — AI is watching and ready to help.',
    '',
    'function greet(name = "World") {',
    '  return `Hello, ${name}! 🚀`;',
    '}',
    '',
    'console.log(greet("Nexus"));',
  ].join('\n');
}
