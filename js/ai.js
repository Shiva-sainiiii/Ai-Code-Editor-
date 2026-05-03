/**
 * NEXUS AI — AI Assistant v5.0
 *
 * Improvements over v4:
 * 1. Bounded history (IndexedDB, not localStorage)
 * 2. AbortController with proper cleanup
 * 3. Voice input via Web Speech API
 * 4. Context attach (line range selection)
 * 5. DOM references resolved once in constructor (no repeated querySelector)
 * 6. Markdown-safe rendering (no raw innerHTML from AI)
 * 7. Scroll-to-bottom only when user is near bottom (no forced scrolljacking)
 */
'use strict';

import { sanitizeHTML, debounce, qs } from './utils.js';
import Storage from './storage.js';
import { editor, isEditorReady, currentLanguage, currentFileName, unsavedChanges } from './editor.js';
import { showNotification, updateStatusBar } from './ui.js';

const MAX_HISTORY    = 40;   // messages (20 Q&A pairs)
const MAX_PROMPT_LEN = 2000;
const REQUEST_TIMEOUT = 30_000;

export class AIAssistant {
  constructor() {
    this.isProcessing    = false;
    this.abortController = null;

    // Capture DOM refs once — avoids repeated querySelector
    this._promptEl    = qs('#ai-prompt');
    this._chatHistory = qs('#ai-chat-history');
    this._counter     = qs('#char-count');
    this._statusEl    = qs('#ai-status');
    this._contextBar  = qs('#ai-context-bar');
    this._contextFile = qs('#ai-context-file');
    this._contextLines= qs('#ai-context-lines');

    // History: loaded async in init()
    this._history = [];

    this._wireCharCounter();
    this._wireAttachCode();
    this._wireVoiceInput();
  }

  async init() {
    this._history = await Storage.getMeta('ai_history', []);
    this._restoreHistory();
    this._updateContextBar();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async ask(customPrompt = null) {
    if (this.isProcessing) {
      showNotification('⏳ Processing — please wait', 'warning');
      return;
    }
    if (!isEditorReady) {
      showNotification('⚠️ Editor not ready', 'warning');
      return;
    }

    const promptText = customPrompt ?? this._promptEl?.value.trim();
    if (!promptText) {
      showNotification('⚠️ Enter a prompt first', 'warning');
      return;
    }
    if (promptText.length > MAX_PROMPT_LEN) {
      showNotification(`⚠️ Prompt too long (max ${MAX_PROMPT_LEN} chars)`, 'warning');
      return;
    }

    this.isProcessing = true;
    this._setStatus(true);

    this._appendMessage('user', promptText);
    this._clearInput();

    const typingEl = this._appendTypingIndicator();

    try {
      const response = await this._callAPI({
        prompt:   promptText,
        code:     editor.getValue(),
        language: currentLanguage,
        fileName: currentFileName,
      });

      this._handleResponse(response, typingEl);
      await this._persistHistory(promptText, response.explanation || '');

    } catch (err) {
      const bubble = typingEl?.querySelector('.msg-bubble');
      if (bubble) {
        bubble.innerHTML = err.name === 'AbortError'
          ? '<i class="fas fa-clock"></i> Request cancelled.'
          : `<i class="fas fa-exclamation-triangle"></i> ${sanitizeHTML(err.message)}`;
        bubble.classList.add('error-bubble');
      }
      if (err.name !== 'AbortError') {
        console.error('❌ AI Error:', err);
        showNotification('AI service error — check console', 'error');
      }
    } finally {
      this.isProcessing    = false;
      this.abortController = null;
      this._setStatus(false);
    }
  }

  cancel() {
    this.abortController?.abort();
  }

  acceptChanges() {
    showNotification('✅ Changes accepted', 'success');
    updateStatusBar();
  }

  rejectChanges() {
    editor?.trigger('nexus-ai', 'undo', null);
    showNotification('↩️ Changes reverted', 'info');
    updateStatusBar();
  }

  async clearHistory() {
    if (!this._chatHistory) return;

    // Remove all messages except the welcome bubble
    const msgs = this._chatHistory.querySelectorAll('.ai-message:not(.welcome)');
    msgs.forEach(m => m.remove());

    this._history = [];
    await Storage.deleteMeta('ai_history');
    showNotification('🗑️ Chat cleared', 'info');
  }

  // ─── API call ────────────────────────────────────────────────────────────────

  async _callAPI({ prompt, code, language, fileName }) {
    this.abortController = new AbortController();
    const timer = setTimeout(() => this.abortController.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch('/api/ask', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  this.abortController.signal,
        body:    JSON.stringify({ prompt, code, language, fileName }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.message || `HTTP ${res.status}`);
      }

      const result = await res.json();
      if (!result.success) throw new Error(result.detail || 'AI returned error');

      return { code: result.data.code, explanation: result.data.explanation };

    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Response rendering ───────────────────────────────────────────────────────

  _handleResponse(response, typingEl) {
    const bubble = typingEl?.querySelector('.msg-bubble');
    if (!bubble) return;

    if (response.code?.trim()) {
      // Apply code to editor with undo support
      const model     = editor.getModel();
      const lineCount = model.getLineCount();
      const range     = new monaco.Range(1, 1, lineCount, model.getLineMaxColumn(lineCount));

      editor.executeEdits('nexus-ai', [{ range, text: response.code, forceMoveMarkers: true }]);
      editor.pushUndoStop();

      const safeExp = sanitizeHTML(response.explanation || 'Code updated.');

      bubble.innerHTML = `
        <div class="ai-response-header">
          <i class="fas fa-sparkles" style="color:var(--accent)"></i>
          <strong>Code Updated</strong>
        </div>
        <p class="ai-response-text">${safeExp}</p>
        <div class="ai-response-actions">
          <button class="btn btn-sm btn-primary" id="accept-ai">
            <i class="fas fa-check"></i> Accept
          </button>
          <button class="btn btn-sm btn-ghost" id="reject-ai">
            <i class="fas fa-undo"></i> Undo
          </button>
        </div>`;

      bubble.querySelector('#accept-ai')?.addEventListener('click', () => this.acceptChanges());
      bubble.querySelector('#reject-ai')?.addEventListener('click', () => this.rejectChanges());

    } else {
      const safeExp = sanitizeHTML(response.explanation || 'No changes needed.');
      bubble.innerHTML = `
        <div class="ai-response-header">
          <i class="fas fa-robot" style="color:var(--accent-3)"></i>
          <strong>Analysis</strong>
        </div>
        <p class="ai-response-text">${safeExp}</p>`;
    }

    this._scrollChat();
  }

  // ─── Chat DOM helpers ─────────────────────────────────────────────────────────

  _appendMessage(type, content) {
    if (!this._chatHistory) return null;

    const isUser = type === 'user';
    const wrap   = document.createElement('div');
    wrap.className = `ai-message ${isUser ? 'user' : 'bot'}`;

    wrap.innerHTML = `
      <div class="msg-avatar" aria-hidden="true">
        <i class="fas fa-${isUser ? 'user' : 'robot'}"></i>
      </div>
      <div class="msg-content">
        <div class="msg-bubble"></div>
        <div class="msg-time">${_formatTime()}</div>
      </div>`;

    // Safe content set AFTER innerHTML to prevent XSS
    wrap.querySelector('.msg-bubble').textContent = content;

    this._chatHistory.appendChild(wrap);
    this._scrollChat();
    return wrap;
  }

  _appendTypingIndicator() {
    if (!this._chatHistory) return null;

    const wrap = document.createElement('div');
    wrap.className = 'ai-message bot typing';
    wrap.innerHTML = `
      <div class="msg-avatar" aria-hidden="true"><i class="fas fa-robot"></i></div>
      <div class="msg-content">
        <div class="msg-bubble">
          <div class="typing-dots" aria-label="AI is thinking">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>`;

    this._chatHistory.appendChild(wrap);
    this._scrollChat();
    return wrap;
  }

  _restoreHistory() {
    if (!this._chatHistory || !this._history.length) return;
    this._history.forEach(msg => {
      if (msg.type === 'user' || msg.type === 'bot') {
        this._appendMessage(msg.type, msg.content);
      }
    });
  }

  async _persistHistory(userMsg, botMsg) {
    this._history.push(
      { type: 'user', content: userMsg },
      { type: 'bot',  content: botMsg  }
    );
    // Cap at MAX_HISTORY
    if (this._history.length > MAX_HISTORY) {
      this._history.splice(0, this._history.length - MAX_HISTORY);
    }
    await Storage.setMeta('ai_history', this._history);
  }

  // ─── Scroll ──────────────────────────────────────────────────────────────────
  /**
   * Only scroll if user is near the bottom (within 100px).
   * This prevents interrupting the user if they've scrolled up to read history.
   */
  _scrollChat() {
    const el = this._chatHistory;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }

  // ─── Status ──────────────────────────────────────────────────────────────────

  _setStatus(processing) {
    if (!this._statusEl) return;
    this._statusEl.innerHTML = processing
      ? '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Processing…'
      : '<i class="fas fa-sparkles" aria-hidden="true"></i> AI Ready';
    this._statusEl.setAttribute('aria-live', processing ? 'assertive' : 'polite');
  }

  // ─── Character counter ────────────────────────────────────────────────────────

  _wireCharCounter() {
    if (!this._promptEl || !this._counter) return;
    this._promptEl.addEventListener('input', () => {
      const len = this._promptEl.value.length;
      this._counter.textContent = `${len} / ${MAX_PROMPT_LEN}`;
      this._counter.style.color = len > MAX_PROMPT_LEN * 0.9
        ? 'var(--warning)' : 'var(--text-dim)';
    });
  }

  _clearInput() {
    if (this._promptEl) this._promptEl.value = '';
    if (this._counter)  this._counter.textContent = `0 / ${MAX_PROMPT_LEN}`;
  }

  // ─── Context bar ─────────────────────────────────────────────────────────────

  _updateContextBar() {
    if (!this._contextFile || !this._contextLines || !isEditorReady) return;
    this._contextFile.textContent  = currentFileName;
    const lc = editor?.getModel()?.getLineCount() ?? 0;
    this._contextLines.textContent = `— ${lc} lines`;
  }

  _wireAttachCode() {
    qs('#attach-code-btn')?.addEventListener('click', () => {
      if (!isEditorReady) return;
      const selection = editor.getSelection();
      const hasSelection = !selection.isEmpty();
      const text = hasSelection
        ? editor.getModel().getValueInRange(selection)
        : editor.getValue();

      const snippet = text.substring(0, 500);
      if (this._promptEl) {
        this._promptEl.value += `\n\`\`\`${currentLanguage}\n${snippet}\n\`\`\`\n`;
        this._promptEl.focus();
        // Update char counter
        this._promptEl.dispatchEvent(new Event('input'));
      }
      showNotification(hasSelection ? '📌 Selection attached' : '📌 File attached', 'success');
    });
  }

  // ─── Voice input ─────────────────────────────────────────────────────────────

  _wireVoiceInput() {
    const btn = qs('#voice-btn');
    if (!btn || !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      btn?.style.setProperty('display', 'none');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous    = false;
    recognition.interimResults = true;
    recognition.lang           = 'en-US';

    let listening = false;

    btn.addEventListener('click', () => {
      if (listening) {
        recognition.stop();
      } else {
        recognition.start();
        btn.classList.add('listening');
        listening = true;
        showNotification('🎤 Listening…', 'info', 2000);
      }
    });

    recognition.onresult = (e) => {
      const transcript = [...e.results].map(r => r[0].transcript).join('');
      if (this._promptEl) this._promptEl.value = transcript;
    };

    recognition.onend = () => {
      listening = false;
      btn.classList.remove('listening');
    };

    recognition.onerror = (e) => {
      listening = false;
      btn.classList.remove('listening');
      showNotification(`🎤 Voice error: ${e.error}`, 'warning');
    };
  }
}

function _formatTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default AIAssistant;
