/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          NEXUS AI — CORE ENGINE v4.0                        ║
 * ║  Fixed: DOM race conditions · callAIAPI class scope         ║
 * ║         stale tab cache · mobile init timing                ║
 * ║         delete/inline-AI wiring · localStorage loop        ║
 * ║         XSS sanitization · history both sides              ║
 * ║         AbortController timeout · char counter             ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

// ============================================================
// GLOBAL STATE  (no DOM touches here — just primitives)
// ============================================================
let editor          = null;
let currentLanguage = 'javascript';
let currentFileName = 'untitled.js';
let isEditorReady   = false;
let unsavedChanges  = false;
let openTabs        = [];   // [{ name, code, language }]
let aiAssistant     = null; // Assigned inside DOMContentLoaded

// ============================================================
// 1. BOOT — everything starts here after DOM is ready
// ============================================================
window.addEventListener('DOMContentLoaded', () => {

    // ── Splash screen ──────────────────────────────────────
    setTimeout(() => {
        document.getElementById('splash-screen')?.classList.add('hidden');
        document.getElementById('app-container')?.classList.add('loaded');
    }, 2800);

    // ── Core systems ───────────────────────────────────────
    initializeEditor();
    initializeEventListeners();    // includes setupModals + setupInlineAI
    initializeFileManager();
    loadLocalFiles();
    updateStorageInfo();

    // ── AIAssistant — MUST be after DOM is ready ───────────
    // (constructor queries DOM elements internally)
    aiAssistant = new AIAssistant();

    // ── Mobile default view ────────────────────────────────
    // (also MUST be after DOM is ready)
    if (window.innerWidth <= 768) {
        switchMobileTab('editor-wrapper');
    }
});

// ============================================================
// 2. MONACO EDITOR INITIALIZATION
// ============================================================
function initializeEditor() {
    require.config({
        paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }
    });

    require(['vs/editor/editor.main'], () => {
        const savedCode = localStorage.getItem('nexus_last_code') || [
            '// ✨ Welcome to Nexus AI v4.0',
            '// Start coding or use the AI panel for help.',
            '',
            'function greet(name = "World") {',
            '    return `Hello, ${name}! 🚀`;',
            '}',
            '',
            'console.log(greet());'
        ].join('\n');

        editor = monaco.editor.create(document.getElementById('monaco-container'), {
            value:                   savedCode,
            language:                'javascript',
            theme:                   'vs-dark',
            automaticLayout:         true,
            fontSize:                14,
            fontFamily:              "'JetBrains Mono', 'Fira Code', monospace",
            fontLigatures:           true,
            minimap:                 { enabled: true, scale: 1 },
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling:         true,
            padding:                 { top: 20, bottom: 20 },
            roundedSelection:        true,
            wordWrap:                'on',
            formatOnPaste:           true,
            formatOnType:            false,    // avoid jumpy cursor behaviour
            scrollbar: {
                vertical:              'visible',
                horizontal:            'visible',
                useShadows:            false,
                verticalScrollbarSize: 8,
                horizontalScrollbarSize: 8,
            },
            lineNumbers:             'on',
            renderWhitespace:        'selection',
            bracketPairColorization: { enabled: true },
            quickSuggestions:        true,
            suggest:                 { showKeywords: true },
        });

        isEditorReady = true;
        updateEditorStatus();
        setupEditorListeners();
        console.log('✅ Monaco Editor v4.0 ready');
    });
}

function setupEditorListeners() {
    // Track changes + keep active-tab cache in sync
    editor.onDidChangeModelContent(() => {
        unsavedChanges = true;
        updateEditorStatus();
        updateStorageInfo();
        localStorage.setItem('nexus_last_code', editor.getValue());
        updateSaveButton();

        // FIX: Keep tab's cached code live so switching back shows current work
        const tab = openTabs.find(t => t.name === currentFileName);
        if (tab) tab.code = editor.getValue();
    });

    // Cursor position
    editor.onDidChangeCursorPosition(({ position }) => {
        const el = document.getElementById('status-pos');
        if (el) el.textContent = `Ln ${position.lineNumber}, Col ${position.column}`;
    });

    // Language selector
    document.getElementById('language-selector')?.addEventListener('change', (e) => {
        currentLanguage = e.target.value;
        monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
        updateEditorStatus();
        // Sync language in tab cache
        const tab = openTabs.find(t => t.name === currentFileName);
        if (tab) tab.language = currentLanguage;
    });

    // Re-layout on window resize
    window.addEventListener('resize', () => {
        if (editor && isEditorReady) editor.layout();
    });
}

function updateEditorStatus() {
    if (!isEditorReady) return;

    const langEl  = document.getElementById('status-lang');
    const savedEl = document.getElementById('status-saved');
    const langName = currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);

    if (langEl) {
        langEl.innerHTML =
            `<i class="fas fa-circle" style="color:var(--accent);font-size:8px"></i> ${langName}`;
    }
    if (savedEl) {
        savedEl.innerHTML = unsavedChanges
            ? '<i class="fas fa-circle" style="color:var(--warning);font-size:8px"></i> Unsaved'
            : '<i class="fas fa-check" style="color:var(--success)"></i> Saved';
    }
}

function updateSaveButton() {
    const btn = document.getElementById('save-btn');
    if (!btn) return;
    btn.style.opacity    = unsavedChanges ? '1' : '0.7';
    btn.style.boxShadow  = unsavedChanges ? '0 0 10px rgba(0,122,255,0.35)' : 'none';
}

// ============================================================
// 3. FILE MANAGER & MULTI-TAB SYSTEM
// ============================================================
class FileManager {

    /**
     * Open a file: set editor content, language, add/activate tab.
     */
    static openFile(fileName, code = '', language = null) {
        currentFileName = fileName;
        currentLanguage = language || detectLanguage(fileName);

        if (isEditorReady) {
            editor.setValue(code);
            monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
        }

        const langSelector = document.getElementById('language-selector');
        if (langSelector) langSelector.value = currentLanguage;

        unsavedChanges = false;
        updateEditorStatus();
        updateSaveButton();
        this._addTab(fileName, code, currentLanguage);

        // Highlight file in explorer
        document.querySelectorAll('.file-item').forEach(f => f.classList.remove('active'));
        document.querySelector(`.file-item[data-file="${CSS.escape(fileName)}"]`)
            ?.classList.add('active');

        showNotification(`📂 Opened: ${fileName}`, 'success');
    }

    /** Add or activate a tab for the given file */
    static _addTab(fileName, code, language) {
        const container = document.getElementById('tab-container');
        if (!container) return;

        // Already open — just activate
        const existing = container.querySelector(`[data-file="${CSS.escape(fileName)}"]`);
        if (existing) {
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            existing.classList.add('active');
            return;
        }

        // Deactivate others
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

        const tab = document.createElement('button');
        tab.className = 'tab active';
        tab.dataset.file = fileName;

        const icon = getLanguageIcon(language || detectLanguage(fileName));
        tab.innerHTML = `
            <i class="fas fa-file-code icon-${icon}" style="font-size:11px;flex-shrink:0"></i>
            <span class="tab-name"></span>
            <button class="close-tab" title="Close tab">
                <i class="fas fa-times"></i>
            </button>`;

        // Safely set filename (no XSS)
        tab.querySelector('.tab-name').textContent = fileName;

        // Close
        tab.querySelector('.close-tab').addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTab(fileName);
        });

        // Switch to tab — restore from cache
        tab.addEventListener('click', () => {
            container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const cached = openTabs.find(f => f.name === fileName);
            if (cached && isEditorReady) {
                currentFileName = cached.name;
                currentLanguage = cached.language;
                editor.setValue(cached.code);   // uses live-synced code (no staleness)
                monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
                const ls = document.getElementById('language-selector');
                if (ls) ls.value = currentLanguage;
                unsavedChanges = false;
                updateEditorStatus();
                updateSaveButton();
            }
        });

        container.appendChild(tab);

        // Register in openTabs (deduplicated)
        if (!openTabs.find(f => f.name === fileName)) {
            openTabs.push({ name: fileName, code, language: currentLanguage });
        }
    }

    static closeTab(fileName) {
        document.querySelector(`[data-file="${CSS.escape(fileName)}"]`)?.remove();
        openTabs = openTabs.filter(f => f.name !== fileName);

        const remaining = document.querySelectorAll('.tab');
        if (remaining.length > 0) {
            remaining[remaining.length - 1].click();
        } else {
            currentFileName = 'untitled.js';
            currentLanguage = 'javascript';
            if (isEditorReady) editor.setValue('');
            updateEditorStatus();
        }
    }

    static createNewFile() {
        document.getElementById('new-file-modal')?.classList.add('open');
    }

    static saveFile() {
        if (!isEditorReady) return;
        const code = editor.getValue();
        const record = {
            name:      currentFileName,
            code,
            language:  currentLanguage,
            timestamp: new Date().toISOString(),
        };
        // Use 'nexus_file_' prefix — separates from other localStorage keys
        localStorage.setItem(`nexus_file_${currentFileName}`, JSON.stringify(record));
        unsavedChanges = false;
        updateEditorStatus();
        updateSaveButton();
        updateStorageInfo();
        loadLocalFiles();
        showNotification(`✅ Saved: ${currentFileName}`, 'success');
    }

    /** Delete a local (localStorage) file */
    static deleteLocalFile(fileName) {
        localStorage.removeItem(`nexus_file_${fileName}`);
        this.closeTab(fileName);
        loadLocalFiles();
        updateStorageInfo();
        showNotification(`🗑️ Deleted: ${fileName}`, 'success');
    }
}

// ============================================================
// 4. MODAL MANAGEMENT
// ============================================================
function setupModals() {
    const newFileModal = document.getElementById('new-file-modal');
    const deleteModal  = document.getElementById('delete-modal');

    // ── New-file modal helpers ─────────────────────────────
    const openNewModal = () => newFileModal?.classList.add('open');
    const closeNewModal = () => {
        newFileModal?.classList.remove('open');
        const inp = document.getElementById('new-file-name');
        if (inp) inp.value = '';
    };

    document.getElementById('close-modal')?.addEventListener('click',  closeNewModal);
    document.getElementById('cancel-modal')?.addEventListener('click', closeNewModal);
    newFileModal?.addEventListener('click', (e) => { if (e.target === newFileModal) closeNewModal(); });

    // Confirm create
    document.getElementById('confirm-new-file')?.addEventListener('click', () => {
        const nameEl     = document.getElementById('new-file-name');
        const rawName    = nameEl?.value.trim();
        const activeChip = document.querySelector('.lang-chip.active');

        if (!rawName) { showNotification('⚠️ Enter a file name', 'warning'); return; }

        const lang     = activeChip?.dataset.lang || 'javascript';
        const ext      = activeChip?.dataset.ext  || 'js';
        const fullName = rawName.includes('.') ? rawName : `${rawName}.${ext}`;

        FileManager.openFile(fullName, '', lang);
        closeNewModal();
    });

    // Language chip selection in modal
    document.querySelectorAll('.lang-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.lang-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    // ── Delete-file modal ──────────────────────────────────
    let pendingDeleteName = null;

    // Global opener — called by file list items
    window.openDeleteModal = (fileName) => {
        pendingDeleteName = fileName;
        const nameEl = document.getElementById('delete-file-name');
        if (nameEl) nameEl.textContent = fileName;   // textContent = safe
        deleteModal?.classList.add('open');
    };

    const closeDeleteModal = () => {
        deleteModal?.classList.remove('open');
        pendingDeleteName = null;
    };

    document.getElementById('close-delete-modal')?.addEventListener('click', closeDeleteModal);
    document.getElementById('cancel-delete')?.addEventListener('click',       closeDeleteModal);
    deleteModal?.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteModal(); });

    // FIX: confirm-delete was never wired — now it is
    document.getElementById('confirm-delete')?.addEventListener('click', () => {
        if (pendingDeleteName) {
            FileManager.deleteLocalFile(pendingDeleteName);
        }
        closeDeleteModal();
    });
}

// ============================================================
// 5. INLINE AI BAR  (Ctrl+K)
// ============================================================
function setupInlineAI() {
    const bar      = document.getElementById('inline-ai-bar');
    const input    = document.getElementById('inline-ai-input');
    const sendBtn  = document.getElementById('inline-ai-send');
    const closeBtn = document.getElementById('inline-ai-close');

    if (!bar || !input) return;

    const closeBar = () => {
        bar.classList.remove('open');
        input.value = '';
    };

    const sendInline = () => {
        const val = input.value.trim();
        if (!val) return;
        closeBar();
        // Delegate to AIAssistant
        aiAssistant?.ask(val);
        // On mobile, switch to AI panel so user sees the response
        if (window.innerWidth <= 768) switchMobileTab('ai-sidebar');
    };

    // FIX: these buttons had no listeners in v3.0
    sendBtn?.addEventListener('click', sendInline);
    closeBtn?.addEventListener('click', closeBar);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); sendInline(); }
        if (e.key === 'Escape') closeBar();
    });
}

// ============================================================
// 6. AI ASSISTANT ENGINE
// ============================================================
class AIAssistant {

    constructor() {
        this.isProcessing    = false;
        this.abortController = null;

        // FIX: DOM references captured here — constructor is called inside DOMContentLoaded
        this._promptEl    = document.getElementById('ai-prompt');
        this._chatHistory = document.getElementById('ai-chat-history');

        // FIX: restore BOTH sides of conversation (user + bot)
        this._history = JSON.parse(localStorage.getItem('nexus_ai_history') || '[]');

        this._wireCharCounter();
        this._restoreHistory();
    }

    /** Live character counter under the prompt textarea */
    _wireCharCounter() {
        const counter = document.getElementById('char-count');
        this._promptEl?.addEventListener('input', () => {
            const len = this._promptEl.value.length;
            if (counter) {
                counter.textContent  = `${len} / 2000`;
                counter.style.color  = len > 1800 ? 'var(--warning)' : 'var(--text-dim)';
            }
        });
    }

    /** Send a prompt — accepts optional override (used by tool buttons & inline bar) */
    async ask(customPrompt = null) {
        if (this.isProcessing || !isEditorReady) return;

        const promptText = customPrompt ?? this._promptEl?.value.trim();
        if (!promptText) {
            showNotification('⚠️ Enter a prompt first', 'warning');
            return;
        }
        if (promptText.length > 2000) {
            showNotification('⚠️ Prompt exceeds 2 000 chars', 'warning');
            return;
        }

        this.isProcessing = true;
        this._setStatus(true);

        // Show user message, clear input
        this._appendMessage('user', promptText);
        if (this._promptEl) {
            this._promptEl.value = '';
            document.getElementById('char-count') &&
                (document.getElementById('char-count').textContent = '0 / 2000');
        }

        // Show typing indicator
        const botEl = this._appendTypingIndicator();

        try {
            const response = await this._callAPI({
                prompt:   promptText,
                code:     editor.getValue(),
                language: currentLanguage,
            });

            this._handleResponse(response, botEl);

            // FIX: persist BOTH sides so chat restores correctly after reload
            this._history.push(
                { type: 'user', content: promptText },
                { type: 'bot',  content: response.explanation || '' }
            );
            // Cap at 40 entries (20 Q&A pairs)
            if (this._history.length > 40) this._history.splice(0, 2);
            localStorage.setItem('nexus_ai_history', JSON.stringify(this._history));

        } catch (err) {
            const bubble = botEl?.querySelector('.msg-bubble');
            if (bubble) {
                bubble.textContent = err.name === 'AbortError'
                    ? '⏱️ Request cancelled.'
                    : `⚠️ ${err.message}`;
            }
            if (err.name !== 'AbortError') {
                console.error('❌ AI Error:', err);
                showNotification('AI service unavailable', 'error');
            }
        } finally {
            this.isProcessing    = false;
            this.abortController = null;
            this._setStatus(false);
        }
    }

    /** Cancel an in-flight request */
    cancel() {
        this.abortController?.abort();
    }

    /** HTTP call with AbortController timeout — FIX: replaces useless `timeout` fetch option */
    async _callAPI({ prompt, code, language }) {
        this.abortController = new AbortController();
        const timer = setTimeout(() => this.abortController.abort(), 30_000);

        try {
            const res = await fetch('/api/ask', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                signal:  this.abortController.signal,
                body:    JSON.stringify({ prompt, code, language }),
            });

            const result = await res.json();

            if (!res.ok || !result.success) {
                throw new Error(result.detail || result.message || 'AI request failed');
            }

            return {
                code:        result.data.code,
                explanation: result.data.explanation,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    /** Apply AI response to the editor and render chat bubble */
    _handleResponse(response, botEl) {
        const bubble = botEl?.querySelector('.msg-bubble');
        if (!bubble) return;

        if (response.code?.trim()) {
            // Push into editor with full undo support
            const model     = editor.getModel();
            const lineCount = model.getLineCount();
            const range     = new monaco.Range(1, 1, lineCount, model.getLineMaxColumn(lineCount));

            editor.executeEdits('nexus-ai', [{ range, text: response.code, forceMoveMarkers: true }]);
            editor.pushUndoStop();

            // FIX: use sanitizeText — never put raw AI output into innerHTML directly
            const safeExplanation = sanitizeText(response.explanation || 'Code updated by AI.');

            bubble.innerHTML = `
                <strong style="color:var(--accent)">✨ Code Updated</strong>
                <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--text)">
                    ${safeExplanation}
                </p>
                <div style="display:flex;gap:8px;margin-top:10px">
                    <button class="btn btn-primary"
                        style="font-size:11px;padding:4px 12px"
                        onclick="window.aiAssistant?.acceptChanges()">
                        ✓ Accept
                    </button>
                    <button class="btn btn-ghost"
                        style="font-size:11px;padding:4px 12px"
                        onclick="window.aiAssistant?.rejectChanges()">
                        ✗ Undo
                    </button>
                </div>`;

            unsavedChanges = true;
            updateSaveButton();

        } else {
            const safeExplanation = sanitizeText(response.explanation || 'No changes needed.');
            bubble.innerHTML = `
                <strong style="color:var(--accent-3)">ℹ️ Analysis</strong>
                <p style="margin:6px 0 0;font-size:12px;line-height:1.6;color:var(--text)">
                    ${safeExplanation}
                </p>`;
        }

        this._scrollChat();
    }

    acceptChanges() {
        unsavedChanges = true;
        showNotification('✅ Changes accepted', 'success');
    }

    rejectChanges() {
        editor.trigger('nexus-ai', 'undo', null);
        unsavedChanges = false;
        updateSaveButton();
        showNotification('↩️ Changes reverted', 'success');
    }

    /** Append a user or bot message bubble to the chat panel */
    _appendMessage(type, content) {
        if (!this._chatHistory) return null;

        const isUser = (type === 'user');
        const wrap   = document.createElement('div');
        wrap.className = `ai-message ${isUser ? 'user' : 'bot'}`;

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.innerHTML = isUser ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';

        const msgContent = document.createElement('div');
        msgContent.className = 'msg-content';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.textContent = content;    // FIX: textContent prevents XSS in user/plain messages

        const time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        msgContent.append(bubble, time);
        wrap.append(avatar, msgContent);
        this._chatHistory.appendChild(wrap);
        this._scrollChat();
        return wrap;
    }

    /** Temporary typing indicator — replaced by real response */
    _appendTypingIndicator() {
        if (!this._chatHistory) return null;
        const wrap = document.createElement('div');
        wrap.className = 'ai-message bot';
        wrap.innerHTML = `
            <div class="msg-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-content">
                <div class="msg-bubble">
                    <div class="typing-dots">
                        <span></span><span></span><span></span>
                    </div>
                </div>
            </div>`;
        this._chatHistory.appendChild(wrap);
        this._scrollChat();
        return wrap;
    }

    /** Restore message history from localStorage on page load */
    _restoreHistory() {
        if (!this._chatHistory || this._history.length === 0) return;
        this._history.forEach(msg => {
            if (msg.type === 'user' || msg.type === 'bot') {
                this._appendMessage(msg.type, msg.content);
            }
        });
    }

    clearHistory() {
        if (!this._chatHistory) return;
        this._chatHistory.innerHTML = '';
        // Re-add the welcome bubble
        const wrap = document.createElement('div');
        wrap.className = 'ai-message bot';
        wrap.innerHTML = `
            <div class="msg-avatar"><i class="fas fa-robot"></i></div>
            <div class="msg-content">
                <div class="msg-bubble">Chat cleared. How can I help you?</div>
                <div class="msg-time">
                    ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>`;
        this._chatHistory.appendChild(wrap);
        this._history = [];
        localStorage.removeItem('nexus_ai_history');
    }

    _setStatus(processing) {
        const el = document.getElementById('ai-status');
        if (!el) return;
        el.innerHTML = processing
            ? '<i class="fas fa-circle-notch fa-spin"></i> Processing…'
            : '<i class="fas fa-sparkles"></i> AI Ready';
    }

    _scrollChat() {
        this._chatHistory?.scrollTo({ top: this._chatHistory.scrollHeight, behavior: 'smooth' });
    }
}

// ============================================================
// 7. CODE EXECUTOR & LIVE PREVIEW
// ============================================================
class CodeExecutor {

    static execute() {
        if (!isEditorReady) return;

        const code = editor.getValue().trim();
        if (!code) { showNotification('⚠️ Nothing to run', 'warning'); return; }

        const lang = currentLanguage;

        if      (lang === 'html')       this._runHTML(code);
        else if (lang === 'javascript') this._runJS(code);
        else if (lang === 'css')        this._runCSS(code);
        else {
            showNotification(`Preview not supported for ${lang}`, 'warning');
            return;
        }

        this._activateBottomTab('preview-content');
        if (window.innerWidth <= 768) switchMobileTab('bottom-panel');
        showNotification('▶ Running…', 'success');
    }

    static _runHTML(code) {
        const f = document.getElementById('output-frame');
        if (f) f.srcdoc = code;
    }

    static _runJS(code) {
        const f = document.getElementById('output-frame');
        if (!f) return;

        // srcdoc isolates user code in its own browsing context (no cross-site risk)
        f.srcdoc = `<!DOCTYPE html>
<html>
<head>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'JetBrains Mono', monospace;
    background: #0e0e18; color: #d4d4e8;
    padding: 16px; margin: 0; font-size: 13px; line-height: 1.6;
  }
  .out  { background: rgba(255,255,255,0.04); border-left: 3px solid #007aff;
          padding: 8px 12px; border-radius: 6px; margin: 6px 0; word-break: break-all; }
  .err  { background: rgba(239,68,68,0.08);  border-left: 3px solid #ef4444;
          color: #f87171; padding: 8px 12px; border-radius: 6px; margin: 6px 0; }
  .muted{ color: #6b7280; padding: 8px 0; }
</style>
</head>
<body>
<div id="__out__"></div>
<script>
(function() {
  const outputs = [];
  const _log = console.log.bind(console);
  const _err = console.error.bind(console);
  console.log = (...a) => {
    outputs.push({ t:'out', v: a.map(x => typeof x === 'object' ? JSON.stringify(x, null, 2) : String(x)).join(' ') });
    _log(...a);
  };
  console.error = (...a) => {
    outputs.push({ t:'err', v: a.map(String).join(' ') });
    _err(...a);
  };
  try {
    ${code}
  } catch(e) {
    outputs.push({ t:'err', v: '❌ ' + e.name + ': ' + e.message });
  }
  const el = document.getElementById('__out__');
  if (!outputs.length) {
    el.innerHTML = '<div class="muted">No output.</div>';
  } else {
    el.innerHTML = outputs.map(o =>
      '<div class="' + o.t + '">' + o.v.replace(/</g,'&lt;') + '</div>'
    ).join('');
  }
})();
<\/script>
</body>
</html>`;
    }

    static _runCSS(code) {
        const f = document.getElementById('output-frame');
        if (!f) return;
        f.srcdoc = `<!DOCTYPE html>
<html>
<head>
<style>
  body { padding: 24px; font-family: sans-serif; background: #fff; }
  ${code}
</style>
</head>
<body>
  <h1>Heading 1</h1>
  <h2>Heading 2</h2>
  <p>A paragraph with <strong>bold</strong> and <em>italic</em> text.</p>
  <button>Button</button>
  <input type="text" placeholder="Input field">
  <div class="container" style="margin-top:16px;padding:16px;border:1px solid #eee;border-radius:6px">
    Sample container
  </div>
  <ul style="margin-top:12px"><li>List item 1</li><li>List item 2</li></ul>
</body>
</html>`;
    }

    static _activateBottomTab(tabId) {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-target="${tabId}"]`)?.classList.add('active');
        document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
        document.getElementById(tabId)?.classList.add('active');
    }
}

// ============================================================
// 8. GLOBAL UI EVENT WIRING
// ============================================================
function initializeEventListeners() {
    // ── Toolbar buttons ────────────────────────────────────
    document.getElementById('new-file-btn')?.addEventListener('click', () => FileManager.createNewFile());
    document.getElementById('save-btn')?.addEventListener('click',     () => FileManager.saveFile());
    document.getElementById('run-btn')?.addEventListener('click',      () => CodeExecutor.execute());

    // ── AI prompt send ─────────────────────────────────────
    // (aiAssistant is not yet created here, so use the global reference via window)
    document.getElementById('send-ai-btn')?.addEventListener('click', () => aiAssistant?.ask());
    document.getElementById('ai-prompt')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiAssistant?.ask(); }
    });

    // ── Quick AI action chips ──────────────────────────────
    const quickPrompts = {
        fix:      '🐛 Find and fix all bugs in this code.',
        explain:  '📖 Explain how this code works, step by step.',
        optimize: '⚡ Optimize this code for better performance.',
        comment:  '📝 Add clear, professional comments and JSDoc where needed.',
        refactor: '✨ Refactor this code to be cleaner and more maintainable.',
        test:     '🧪 Write comprehensive unit tests for this code.',
    };
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            const prompt = quickPrompts[action];
            if (prompt) aiAssistant?.ask(prompt);
        });
    });

    // ── AI panel controls ──────────────────────────────────
    document.getElementById('clear-chat')?.addEventListener('click',  () => aiAssistant?.clearHistory());
    document.getElementById('toggle-ai')?.addEventListener('click',   () => {
        document.getElementById('ai-sidebar')?.classList.toggle('collapsed');
        if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
    });

    // ── Bottom panel tabs ──────────────────────────────────
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
            document.getElementById(tab.getAttribute('data-target'))?.classList.add('active');
        });
    });

    // ── Panel collapse / clear ─────────────────────────────
    document.getElementById('toggle-panel')?.addEventListener('click', () => {
        document.getElementById('bottom-panel')?.classList.toggle('collapsed');
    });

    document.getElementById('clear-console')?.addEventListener('click', () => {
        const term = document.getElementById('terminal');
        if (term) term.innerHTML = `
            <div class="term-line">
                <span class="term-prompt">nexus@ai:~$</span> Console cleared.
            </div>
            <div class="term-line">
                <span class="term-prompt">nexus@ai:~$</span>
                <span class="term-cursor">█</span>
            </div>`;
    });

    // ── Explorer / drawer toggle ───────────────────────────
    document.getElementById('toggle-explorer')?.addEventListener('click', () => {
        document.getElementById('explorer-drawer')?.classList.toggle('collapsed');
        if (editor && isEditorReady) setTimeout(() => editor.layout(), 300);
    });

    // ── Mobile nav ─────────────────────────────────────────
    document.querySelectorAll('.m-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMobileTab(btn.getAttribute('data-tab')));
    });

    // ── Modals + inline AI bar ─────────────────────────────
    setupModals();
    setupInlineAI();
}

// ============================================================
// 9. LOCAL FILE SYSTEM
// ============================================================
function loadLocalFiles() {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;

    // FIX: O(1) key iteration using Object.keys — avoids localStorage.key(i) O(n²)
    //      Also uses 'nexus_file_' prefix to avoid collisions with other entries
    const files = Object.keys(localStorage)
        .filter(k => k.startsWith('nexus_file_'))
        .map(k => {
            try   { return JSON.parse(localStorage.getItem(k)); }
            catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    if (files.length === 0) {
        fileTree.innerHTML = `
            <div style="padding:24px 16px;text-align:center;
                        color:var(--text-muted);font-size:12px;line-height:1.8">
                <i class="fas fa-folder-open"
                   style="font-size:28px;display:block;margin-bottom:10px;opacity:0.3"></i>
                No files yet.<br>Create one to get started!
            </div>`;
        return;
    }

    fileTree.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.dataset.file = file.name;

        const icon = getLanguageIcon(file.language);

        // ── Build via DOM methods — no innerHTML with user data ────
        const iconEl = document.createElement('i');
        iconEl.className = `fas fa-file-code icon-${icon}`;

        const nameEl = document.createElement('span');
        nameEl.className = 'file-name';
        nameEl.textContent = file.name;    // textContent = XSS-safe

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'file-opts';
        deleteBtn.title = 'Delete file';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.openDeleteModal(file.name);
        });

        item.append(iconEl, nameEl, deleteBtn);

        item.addEventListener('click', () => {
            document.querySelectorAll('.file-item').forEach(f => f.classList.remove('active'));
            item.classList.add('active');
            FileManager.openFile(file.name, file.code, file.language);
        });

        fileTree.appendChild(item);
    });
}

function initializeFileManager() {
    // Additional file-manager event wiring (refresh button is wired via initializeEventListeners)
    document.getElementById('refresh-files')?.addEventListener('click', loadLocalFiles);
}

// ============================================================
// 10. UTILITIES
// ============================================================

/**
 * Escape user/AI text for safe HTML injection.
 * Use this before any innerHTML assignment that includes external data.
 */
function sanitizeText(str) {
    const el = document.createElement('div');
    el.textContent = String(str ?? '');
    return el.innerHTML;
}

/** Map language ID → icon CSS suffix */
function getLanguageIcon(lang) {
    const map = {
        javascript: 'js',  typescript: 'ts',  html:     'html',
        css:        'css',  python:     'py',  cpp:      'cpp',
        java:       'java', json:       'json', markdown: 'md',
    };
    return map[lang] || 'file';
}

/** Detect Monaco language from file extension */
function detectLanguage(fileName = '') {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const map = {
        js: 'javascript', ts:   'typescript', html: 'html',
        css:'css',         py:   'python',      cpp: 'cpp',
        java:'java',       json: 'json',        md:  'markdown',
    };
    return map[ext] || 'javascript';
}

/** Update the storage usage indicator in the sidebar */
function updateStorageInfo() {
    // Use Blob for accurate byte-size calculation (not .length which counts chars)
    const allData = Object.values(localStorage).join('');
    const usedBytes = new Blob([allData]).size;
    const maxBytes  = 5 * 1024 * 1024;   // 5 MB standard limit
    const pct       = Math.min((usedBytes / maxBytes) * 100, 100).toFixed(1);

    const fill = document.getElementById('storage-fill');
    const size = document.getElementById('storage-size');
    if (fill) fill.style.width = pct + '%';
    if (size) size.textContent = `${(usedBytes / 1024).toFixed(1)} KB used`;
}

/** Show a toast notification */
function showNotification(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { success: 'check-circle', error: 'exclamation-circle',
                    warning: 'exclamation-triangle', info: 'info-circle' };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Icon is from a safe enum — message is sanitized
    toast.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i>
                       <span>${sanitizeText(msg)}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 350);
    }, 3500);
}

// ============================================================
// 11. MOBILE NAVIGATION
// ============================================================
function switchMobileTab(target) {
    const SECTIONS = ['explorer-drawer', 'editor-wrapper', 'ai-sidebar', 'bottom-panel'];

    document.querySelectorAll('.m-nav-btn').forEach(b => b.classList.remove('active'));
    SECTIONS.forEach(id => document.getElementById(id)?.classList.remove('mobile-active'));

    document.querySelector(`[data-tab="${target}"]`)?.classList.add('active');

    const el = document.getElementById(target);
    if (el) {
        el.classList.add('mobile-active');
        // Re-layout Monaco after the CSS transition completes
        if (target === 'editor-wrapper' && editor && isEditorReady) {
            setTimeout(() => editor.layout(), 120);
        }
    }
}

// ============================================================
// 12. KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    // Ctrl/Cmd + S → Save
    if (mod && e.key === 's') {
        e.preventDefault();
        FileManager.saveFile();
    }

    // Ctrl/Cmd + Enter → Run
    if (mod && e.key === 'Enter') {
        e.preventDefault();
        CodeExecutor.execute();
    }

    // Ctrl/Cmd + K → Toggle inline AI bar
    if (mod && e.key === 'k') {
        e.preventDefault();
        const bar = document.getElementById('inline-ai-bar');
        if (bar) {
            const opening = !bar.classList.contains('open');
            bar.classList.toggle('open', opening);
            if (opening) document.getElementById('inline-ai-input')?.focus();
        }
    }

    // Escape → close modals / inline bar
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        document.getElementById('inline-ai-bar')?.classList.remove('open');
    }
});

// Warn before leaving with unsaved work
window.addEventListener('beforeunload', (e) => {
    if (unsavedChanges) { e.preventDefault(); e.returnValue = ''; }
});

// ============================================================
// 13. GLOBAL EXPORTS
// ============================================================
window.FileManager     = FileManager;
window.CodeExecutor    = CodeExecutor;
window.switchMobileTab = switchMobileTab;
window.showNotification = showNotification;
window.loadLocalFiles  = loadLocalFiles;

// Expose aiAssistant via getter so it works even before DOMContentLoaded completes
Object.defineProperty(window, 'aiAssistant', {
    get: () => aiAssistant,
    configurable: true,
});

console.log('✅ Nexus AI Engine v4.0 loaded');
