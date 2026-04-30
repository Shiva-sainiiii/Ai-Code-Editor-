/**
 * NEXUS AI - CORE ENGINE v2.0
 * Manages Monaco Editor, AI interactions, UI state, and local persistence
 */

let editor;
let currentLanguage = 'javascript';
let isEditorReady = false;
let unsavedChanges = false;

// ============================================
// 1. MONACO EDITOR INITIALIZATION
// ============================================
require.config({ 
    paths: { 
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' 
    } 
});

require(['vs/editor/editor.main'], function () {
    const defaultCode = localStorage.getItem('lastCode') || [
        '// Welcome to Nexus AI',
        'function greet() {',
        '    console.log("Hello, world!");',
        '}',
        '',
        'greet();'
    ].join('\n');

    editor = monaco.editor.create(document.getElementById('monaco-container'), {
        value: defaultCode,
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono',
        minimap: { enabled: true, scale: 1 },
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        padding: { top: 20 },
        roundedSelection: true,
        wordWrap: 'on',
        formatOnPaste: true,
        formatOnType: true,
        scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        },
        minimap: { enabled: true }
    });

    isEditorReady = true;

    // Track unsaved changes
    editor.onDidChangeModelContent(() => {
        unsavedChanges = true;
        localStorage.setItem('lastCode', editor.getValue());
    });

    // Language selector sync
    document.getElementById('language-selector').addEventListener('change', (e) => {
        const lang = e.target.value;
        monaco.editor.setModelLanguage(editor.getModel(), lang);
        currentLanguage = lang;
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        if (editor && isEditorReady) {
            editor.layout();
        }
    });

    console.log('✅ Monaco Editor initialized successfully');
});

// ============================================
// 2. AI ASSISTANT ENGINE
// ============================================
const aiPrompt = document.getElementById('ai-prompt');
const sendAiBtn = document.getElementById('send-ai-btn');
const chatHistory = document.getElementById('ai-chat-history');

class AIAssistant {
    constructor() {
        this.isProcessing = false;
        this.messageHistory = JSON.parse(localStorage.getItem('aiHistory')) || [];
        this.restoreMessageHistory();
    }

    /**
     * Main AI query handler
     */
    async ask(customPrompt = null) {
        if (this.isProcessing || !isEditorReady) return;

        const promptValue = customPrompt || aiPrompt.value.trim();
        if (!promptValue) {
            this.showNotification('Please enter a prompt', 'warning');
            return;
        }

        this.isProcessing = true;
        this.addMessage('user', promptValue);
        aiPrompt.value = '';

        const botMsg = this.addMessage('bot', '<i class="fas fa-spinner fa-spin"></i> Analyzing...');

        try {
            const response = await this.callAIAPI({
                prompt: promptValue,
                code: editor.getValue(),
                language: currentLanguage,
                action: this.detectAction(promptValue)
            });

            this.handleAIResponse(response, botMsg);
            this.messageHistory.push({ type: 'bot', content: response.explanation });
            localStorage.setItem('aiHistory', JSON.stringify(this.messageHistory));

        } catch (error) {
            console.error('❌ AI Error:', error);
            botMsg.innerHTML = `<span style="color: #ef4444;">⚠️ Error: ${error.message}</span>`;
            this.showNotification('AI service unavailable', 'error');
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Call AI API (supports multiple backends)
     */
    async callAIAPI(data) {
        // Primary: Your backend API
        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('aiToken')}`
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) throw new Error(`API Error: ${response.status}`);
            return await response.json();

        } catch (error) {
            console.warn('Backend API failed, trying fallback...');
            
            // Fallback: OpenAI API (requires API key in .env)
            return await this.callOpenAIAPI(data);
        }
    }

    /**
     * OpenAI API fallback
     */
    async callOpenAIAPI(data) {
        const apiKey = localStorage.getItem('openaiKey');
        if (!apiKey) {
            throw new Error('No AI API key configured');
        }

        const systemPrompt = `You are Nexus AI, a code assistant. 
        Current language: ${data.language}
        Be concise. If providing code, wrap it in a code block.`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `${data.action}\n\nCode:\n${data.code}` }
                ],
                max_tokens: 1000,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'OpenAI API error');
        }

        const result = await response.json();
        const content = result.choices[0].message.content;

        // Parse response for code blocks
        const codeMatch = content.match(/```[\w]*\n([\s\S]*?)```/);
        return {
            code: codeMatch ? codeMatch[1] : null,
            explanation: content.replace(/```[\w]*\n[\s\S]*?```/g, '').trim()
        };
    }

    /**
     * Detect user intent from prompt
     */
    detectAction(prompt) {
        const lower = prompt.toLowerCase();
        if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) 
            return 'fix';
        if (lower.includes('explain') || lower.includes('what') || lower.includes('how'))
            return 'explain';
        if (lower.includes('optimize') || lower.includes('improve') || lower.includes('performance'))
            return 'optimize';
        if (lower.includes('add') || lower.includes('create') || lower.includes('generate'))
            return 'generate';
        return 'general';
    }

    /**
     * Handle AI response and update editor
     */
    handleAIResponse(response, botMsg) {
        if (response.code) {
            const lineCount = editor.getModel().getLineCount();
            const range = new monaco.Range(
                1, 1,
                lineCount,
                editor.getModel().getLineMaxColumn(lineCount)
            );

            editor.executeEdits("nexus-ai", [{
                range: range,
                text: response.code,
                forceMoveMarkers: true
            }]);

            botMsg.innerHTML = `
                <strong>✨ Code Updated</strong><br>
                <small>${response.explanation || 'Code has been modified'}</small>
                <button onclick="document.dispatchEvent(new CustomEvent('acceptChanges'))" 
                    style="margin-top: 8px; padding: 4px 8px; background: #007aff; border: none; border-radius: 4px; color: white; cursor: pointer;">
                    Accept Changes
                </button>
            `;
        } else {
            botMsg.innerHTML = `
                <strong>ℹ️ Analysis</strong><br>
                ${response.explanation || 'No changes needed'}
            `;
        }

        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    /**
     * Add message to chat
     */
    addMessage(type, content) {
        const msg = document.createElement('div');
        msg.className = `ai-message ${type}`;
        msg.innerHTML = content;
        chatHistory.appendChild(msg);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return msg;
    }

    /**
     * Restore chat history from localStorage
     */
    restoreMessageHistory() {
        this.messageHistory.forEach(msg => {
            this.addMessage(msg.type, msg.content);
        });
    }

    /**
     * Clear chat history
     */
    clearHistory() {
        chatHistory.innerHTML = '';
        this.messageHistory = [];
        localStorage.removeItem('aiHistory');
        this.addMessage('bot', 'Chat cleared. How can I help?');
    }

    /**
     * Show notifications
     */
    showNotification(msg, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 16px;
            background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981'};
            color: white;
            border-radius: 6px;
            z-index: 9999;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = msg;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
}

const aiAssistant = new AIAssistant();

// AI Event Listeners
sendAiBtn.addEventListener('click', () => aiAssistant.ask());
aiPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        aiAssistant.ask();
    }
});

// Quick AI Tools
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        const prompts = {
            'fix': '🐛 Find and fix any bugs in this code.',
            'explain': '📖 Explain how this code works.',
            'optimize': '⚡ Optimize this code for better performance.'
        };
        aiAssistant.ask(prompts[action] || '');
    });
});

// ============================================
// 3. CODE MANAGEMENT & PRODUCTIVITY
// ============================================
class CodeManager {
    /**
     * Save code locally
     */
    static saveLocally() {
        const code = editor.getValue();
        const timestamp = new Date().toLocaleString();
        const backup = {
            code: code,
            language: currentLanguage,
            timestamp: timestamp
        };
        localStorage.setItem('lastCode', code);
        localStorage.setItem('lastBackup', JSON.stringify(backup));
        this.showNotification('✅ Saved locally');
    }

    /**
     * Export code as file
     */
    static exportCode() {
        const code = editor.getValue();
        const ext = this.getFileExtension(currentLanguage);
        const fileName = prompt('Enter file name:', `code.${ext}`);
        
        if (!fileName) return;

        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        this.showNotification(`📥 Downloaded ${fileName}`);
    }

    /**
     * Copy code to clipboard
     */
    static copyCode() {
        navigator.clipboard.writeText(editor.getValue()).then(() => {
            this.showNotification('📋 Copied to clipboard');
        }).catch(() => {
            this.showNotification('❌ Copy failed', 'error');
        });
    }

    /**
     * Clear editor
     */
    static newFile() {
        if (confirm("Create new file? Unsaved changes will be lost.")) {
            editor.setValue("");
            unsavedChanges = false;
        }
    }

    /**
     * Get file extension by language
     */
    static getFileExtension(lang) {
        const map = {
            'javascript': 'js',
            'html': 'html',
            'css': 'css',
            'python': 'py',
            'cpp': 'cpp',
            'java': 'java'
        };
        return map[lang] || 'txt';
    }

    static showNotification(msg, type = 'success') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 16px;
            background: ${type === 'error' ? '#ef4444' : '#10b981'};
            color: white;
            border-radius: 6px;
            z-index: 9999;
        `;
        notification.textContent = msg;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 2000);
    }
}

// Button Bindings
document.getElementById('save-btn').addEventListener('click', () => CodeManager.saveLocally());
document.getElementById('new-file').addEventListener('click', () => CodeManager.newFile());

// ============================================
// 4. LIVE PREVIEW & CODE EXECUTION
// ============================================
class CodeExecutor {
    static execute() {
        if (!isEditorReady) return;

        const code = editor.getValue();
        const lang = document.getElementById('language-selector').value;

        if (lang === 'html') {
            this.executeHTML(code);
        } else if (lang === 'javascript') {
            this.executeJavaScript(code);
        } else if (lang === 'css') {
            this.executeCSS(code);
        } else {
            aiAssistant.showNotification('Preview not supported for this language', 'warning');
        }

        if (window.innerWidth <= 768) {
            switchMobileTab('bottom-panel');
        }
    }

    static executeHTML(code) {
        document.getElementById('output-frame').srcdoc = code;
    }

    static executeJavaScript(code) {
        const outputFrame = document.getElementById('output-frame');
        const wrappedCode = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { 
                        font-family: 'JetBrains Mono', monospace; 
                        color: #333; 
                        padding: 20px;
                        background: #f5f5f5;
                    }
                    .output { 
                        background: white; 
                        padding: 10px; 
                        border-radius: 6px;
                        margin: 5px 0;
                    }
                    .error { 
                        color: #ef4444; 
                        background: #fee; 
                        padding: 10px; 
                        border-radius: 6px;
                    }
                </style>
            </head>
            <body>
                <div id="output"></div>
                <script>
                    const originalLog = console.log;
                    const outputs = [];
                    
                    console.log = function(...args) {
                        outputs.push(args.map(arg => 
                            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
                        ).join(' '));
                        originalLog.apply(console, args);
                    };

                    try {
                        ${code}
                    } catch (err) {
                        outputs.push('<div class="error">Error: ' + err.message + '</div>');
                    }

                    document.getElementById('output').innerHTML = outputs
                        .map(o => '<div class="output">' + o + '</div>')
                        .join('');
                </script>
            </body>
            </html>
        `;
        outputFrame.srcdoc = wrappedCode;
    }

    static executeCSS(code) {
        const outputFrame = document.getElementById('output-frame');
        outputFrame.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>${code}</style>
            </head>
            <body>
                <div style="padding: 20px;">
                    <h1>CSS Preview</h1>
                    <p>Your CSS has been applied to this page.</p>
                    <button>Sample Button</button>
                    <div style="margin-top: 20px; padding: 10px; border: 1px solid #ddd;">
                        Sample Container
                    </div>
                </div>
            </body>
            </html>
        `;
    }
}

document.getElementById('run-btn').addEventListener('click', () => CodeExecutor.execute());

// ============================================
// 5. MOBILE NAVIGATION & RESPONSIVE UI
// ============================================
const mobileBtns = document.querySelectorAll('.m-nav-btn');
const mobileSections = {
    'explorer-drawer': document.getElementById('explorer-drawer'),
    'monaco-container': document.getElementById('monaco-container'),
    'ai-sidebar': document.getElementById('ai-sidebar'),
    'bottom-panel': document.getElementById('bottom-panel')
};

function switchMobileTab(target) {
    mobileBtns.forEach(b => b.classList.remove('active'));
    Object.values(mobileSections).forEach(sec => {
        if (sec) sec.classList.remove('mobile-active');
    });

    const activeBtn = document.querySelector(`[data-tab="${target}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (mobileSections[target]) {
        mobileSections[target].classList.add('mobile-active');

        if (target === 'monaco-container' && editor && isEditorReady) {
            setTimeout(() => editor.layout(), 100);
        }
    }
}

mobileBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-tab');
        switchMobileTab(target);
    });
});

// Initialize mobile view
if (window.innerWidth <= 768) {
    switchMobileTab('monaco-container');
}

// ============================================
// 6. PANEL CONTROLS & UI STATE MANAGEMENT
// ============================================

// AI Sidebar Toggle
document.getElementById('toggle-ai').addEventListener('click', () => {
    const aiSidebar = document.getElementById('ai-sidebar');
    aiSidebar.style.display = aiSidebar.style.display === 'none' ? 'flex' : 'none';
    if (editor && isEditorReady) editor.layout();
});

// Bottom Panel Tabs
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-target');

        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    });
});

// ============================================
// 7. KEYBOARD SHORTCUTS & ACCESSIBILITY
// ============================================
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 's') {
            e.preventDefault();
            CodeManager.saveLocally();
        }
        if (e.key === 'e') {
            e.preventDefault();
            CodeManager.exportCode();
        }
        if (e.key === '1') {
            e.preventDefault();
            switchMobileTab('explorer-drawer');
        }
    }
});

// Warn on unsaved changes
window.addEventListener('beforeunload', (e) => {
    if (unsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// ============================================
// 8. EXPOSE TO GLOBAL SCOPE
// ============================================
window.editor = editor;
window.insertCode = function(text) {
    if (editor && isEditorReady) {
        const selection = editor.getSelection();
        const range = new monaco.Range(
            selection.startLineNumber, selection.startColumn,
            selection.endLineNumber, selection.endColumn
        );
        editor.executeEdits("my-source", [{ range: range, text: text }]);
        editor.focus();
    }
};

console.log('✅ Nexus AI Editor loaded successfully v2.0');