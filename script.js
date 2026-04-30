/**
 * NEXUS AI - CORE ENGINE v3.0
 * Fully updated for enhanced UI with modals, inline AI, bottom panel, and file management
 * Manages Monaco Editor, AI interactions, file system, and UI state
 */

let editor;
let currentLanguage = 'javascript';
let currentFileName = 'untitled.js';
let isEditorReady = false;
let unsavedChanges = false;
let openTabs = [];
let activeTabFile = null;

// ============================================
// 1. INITIALIZATION & DOM READY
// ============================================
window.addEventListener('DOMContentLoaded', () => {
    // Hide splash screen and show app
    setTimeout(() => {
        const splash = document.getElementById('splash-screen');
        splash.classList.add('hidden');
        document.getElementById('app-container').classList.add('loaded');
    }, 2800);

    initializeEditor();
    initializeEventListeners();
    initializeFileManager();
    loadLocalFiles();
});

// ============================================
// 2. MONACO EDITOR INITIALIZATION
// ============================================
function initializeEditor() {
    require.config({ 
        paths: { 
            vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' 
        } 
    });

    require(['vs/editor/editor.main'], function () {
        const defaultCode = localStorage.getItem('lastCode') || [
            '// Welcome to Nexus AI',
            '// Start coding here...',
            '',
            'function greet() {',
            '    console.log("Hello, World!");',
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
            padding: { top: 20, bottom: 20 },
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
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            bracketPairColorization: true
        });

        isEditorReady = true;
        updateEditorStatus();
        setupEditorListeners();
        console.log('✅ Monaco Editor initialized v3.0');
    });
}

function setupEditorListeners() {
    // Track changes
    editor.onDidChangeModelContent(() => {
        unsavedChanges = true;
        updateEditorStatus();
        updateStorageInfo();
        localStorage.setItem('lastCode', editor.getValue());
        updateSaveButton();
    });

    // Update position display
    editor.onDidChangeCursorPosition((e) => {
        const line = e.position.lineNumber;
        const col = e.position.column;
        document.getElementById('status-pos').textContent = `Ln ${line}, Col ${col}`;
    });

    // Language selector sync
    document.getElementById('language-selector').addEventListener('change', (e) => {
        currentLanguage = e.target.value;
        monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
        updateEditorStatus();
    });

    // Window resize
    window.addEventListener('resize', () => {
        if (editor && isEditorReady) {
            editor.layout();
        }
    });
}

function updateEditorStatus() {
    if (!isEditorReady) return;
    
    const langDisplay = currentLanguage.charAt(0).toUpperCase() + currentLanguage.slice(1);
    document.getElementById('status-lang').innerHTML = 
        `<i class="fas fa-circle" style="color:#007aff;font-size:8px"></i> ${langDisplay}`;
    
    document.getElementById('status-saved').innerHTML = unsavedChanges 
        ? '<i class="fas fa-circle" style="color:#f59e0b;font-size:8px"></i> Unsaved' 
        : '<i class="fas fa-check"></i> Saved';
}

function updateSaveButton() {
    const saveBtn = document.getElementById('save-btn');
    if (unsavedChanges) {
        saveBtn.style.opacity = '1';
        saveBtn.style.transform = 'scale(1.05)';
    } else {
        saveBtn.style.opacity = '0.7';
    }
}

// ============================================
// 3. FILE MANAGEMENT & TABS
// ============================================
class FileManager {
    static openFile(fileName, code, language) {
        currentFileName = fileName;
        currentLanguage = language || 'javascript';
        
        editor.setValue(code);
        monaco.editor.setModelLanguage(editor.getModel(), currentLanguage);
        document.getElementById('language-selector').value = currentLanguage;
        unsavedChanges = false;
        updateEditorStatus();
        
        this.addTab(fileName, language);
        showNotification(`📂 Opened: ${fileName}`, 'success');
    }

    static addTab(fileName, language) {
        const container = document.getElementById('tab-container');
        
        // Check if tab already exists
        const existingTab = container.querySelector(`[data-file="${fileName}"]`);
        if (existingTab) {
            existingTab.classList.add('active');
            return;
        }

        const tab = document.createElement('button');
        tab.className = 'tab active';
        tab.setAttribute('data-file', fileName);
        tab.innerHTML = `
            <span class="tab-name">${fileName}</span>
            <button class="close-tab" onclick="event.stopPropagation(); FileManager.closeTab('${fileName}')">
                <i class="fas fa-times"></i>
            </button>
        `;

        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const file = openTabs.find(f => f.name === fileName);
            if (file) this.openFile(file.name, file.code, file.language);
        });

        container.appendChild(tab);
        openTabs.push({ name: fileName, code: editor.getValue(), language: currentLanguage });
    }

    static closeTab(fileName) {
        const tab = document.querySelector(`[data-file="${fileName}"]`);
        if (tab) tab.remove();
        
        openTabs = openTabs.filter(f => f.name !== fileName);
        
        const remainingTabs = document.querySelectorAll('.tab');
        if (remainingTabs.length > 0) {
            remainingTabs[remainingTabs.length - 1].click();
        }
    }

    static createNewFile() {
        const modal = document.getElementById('new-file-modal');
        modal.classList.add('open');
    }

    static saveFile() {
        const code = editor.getValue();
        const backup = {
            name: currentFileName,
            code: code,
            language: currentLanguage,
            timestamp: new Date().toISOString()
        };
        
        localStorage.setItem(`file_${currentFileName}`, JSON.stringify(backup));
        unsavedChanges = false;
        updateEditorStatus();
        showNotification(`✅ Saved: ${currentFileName}`, 'success');
    }
}

// ============================================
// 4. MODAL MANAGEMENT
// ============================================
function setupModals() {
    const newFileModal = document.getElementById('new-file-modal');
    const deleteModal = document.getElementById('delete-modal');
    
    // Close modals
    document.getElementById('close-modal').addEventListener('click', () => {
        newFileModal.classList.remove('open');
    });

    document.getElementById('cancel-modal').addEventListener('click', () => {
        newFileModal.classList.remove('open');
    });

    document.getElementById('close-delete-modal').addEventListener('click', () => {
        deleteModal.classList.remove('open');
    });

    document.getElementById('cancel-delete').addEventListener('click', () => {
        deleteModal.classList.remove('open');
    });

    // Create new file
    document.getElementById('confirm-new-file').addEventListener('click', () => {
        const fileName = document.getElementById('new-file-name').value.trim();
        const language = document.querySelector('.lang-chip.active').getAttribute('data-lang');
        
        if (!fileName) {
            showNotification('Please enter a file name', 'warning');
            return;
        }

        const ext = document.querySelector('.lang-chip.active').getAttribute('data-ext');
        const fullName = fileName.includes('.') ? fileName : `${fileName}.${ext}`;
        
        FileManager.openFile(fullName, '', language);
        newFileModal.classList.remove('open');
        document.getElementById('new-file-name').value = '';
    });

    // Language selection
    document.querySelectorAll('.lang-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.lang-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });
}

// ============================================
// 5. AI ASSISTANT ENGINE
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

    async ask(customPrompt = null) {
        if (this.isProcessing || !isEditorReady) return;

        const promptValue = customPrompt || aiPrompt.value.trim();
        if (!promptValue) {
            showNotification('Please enter a prompt', 'warning');
            return;
        }

        this.isProcessing = true;
        this.updateAIStatus(true);
        this.addMessage('user', promptValue);
        aiPrompt.value = '';

        const botMsg = this.addMessage('bot', '<div class="typing-dots"><span></span><span></span><span></span></div>');

        try {
            const response = await this.callAIAPI({
                prompt: promptValue,
                code: editor.getValue(),
                language: currentLanguage,
                fileName: currentFileName,
                action: this.detectAction(promptValue)
            });

            this.handleAIResponse(response, botMsg);
            this.messageHistory.push({ type: 'bot', content: response.explanation });
            localStorage.setItem('aiHistory', JSON.stringify(this.messageHistory));

        } catch (error) {
            console.error('❌ AI Error:', error);
            botMsg.innerHTML = `<span style="color: #ef4444;">⚠️ Error: ${error.message}</span>`;
            showNotification('AI service unavailable', 'error');
        } finally {
            this.isProcessing = false;
            this.updateAIStatus(false);
        }
    }

    async callAIAPI(data) {
        const apiKey = localStorage.getItem('openaiKey');
        if (!apiKey) {
            throw new Error('No OpenAI API key configured. Add it in settings.');
        }

        const systemPrompt = `You are Nexus AI, an expert code assistant.
        Current file: ${data.fileName}
        Language: ${data.language}
        Be concise and practical. If providing code, wrap it in \`\`\`${data.language}\n...\`\`\``;

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
                    { role: 'user', content: `${data.action}\n\nCode:\n${data.code}\n\nQuestion: ${data.prompt}` }
                ],
                max_tokens: 2000,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'OpenAI API error');
        }

        const result = await response.json();
        const content = result.choices[0].message.content;

        const codeMatch = content.match(/```[\w]*\n([\s\S]*?)```/);
        return {
            code: codeMatch ? codeMatch[1] : null,
            explanation: content.replace(/```[\w]*\n[\s\S]*?```/g, '').trim()
        };
    }

    detectAction(prompt) {
        const lower = prompt.toLowerCase();
        if (lower.includes('fix') || lower.includes('bug')) return 'Fix bugs';
        if (lower.includes('explain')) return 'Explain the logic';
        if (lower.includes('optimize')) return 'Optimize for performance';
        if (lower.includes('comment')) return 'Add detailed comments';
        if (lower.includes('test')) return 'Generate test cases';
        if (lower.includes('refactor')) return 'Refactor the code';
        return 'Analyze and suggest improvements';
    }

    handleAIResponse(response, botMsg) {
        if (response.code) {
            const lineCount = editor.getModel().getLineCount();
            const range = new monaco.Range(1, 1, lineCount, 
                editor.getModel().getLineMaxColumn(lineCount));

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
                    ✓ Accept Changes
                </button>
            `;
            unsavedChanges = true;
            updateSaveButton();
        } else {
            botMsg.innerHTML = `
                <strong>ℹ️ Analysis</strong><br>
                ${response.explanation || 'No changes needed'}
            `;
        }

        chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    addMessage(type, content) {
        const msg = document.createElement('div');
        msg.className = `ai-message ${type}`;
        
        const msgContent = document.createElement('div');
        msgContent.className = 'msg-content';
        
        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.innerHTML = type === 'bot' ? '<i class="fas fa-robot"></i>' : '<i class="fas fa-user"></i>';
        
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.innerHTML = content;
        
        const time = document.createElement('div');
        time.className = 'msg-time';
        time.textContent = new Date().toLocaleTimeString();
        
        msgContent.appendChild(bubble);
        msgContent.appendChild(time);
        msg.appendChild(avatar);
        msg.appendChild(msgContent);
        
        chatHistory.appendChild(msg);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return msg;
    }

    restoreMessageHistory() {
        this.messageHistory.forEach(msg => {
            this.addMessage(msg.type, msg.content);
        });
    }

    clearHistory() {
        chatHistory.innerHTML = '<div class="ai-message bot"><div class="msg-avatar"><i class="fas fa-robot"></i></div><div class="msg-content"><div class="msg-bubble">Chat cleared. How can I help?</div></div></div>';
        this.messageHistory = [];
        localStorage.removeItem('aiHistory');
    }

    updateAIStatus(processing) {
        const aiStatus = document.getElementById('ai-status');
        if (processing) {
            aiStatus.innerHTML = '<i class="fas fa-circle-notch fa-spin" id="ai-spin"></i> Processing...';
        } else {
            aiStatus.innerHTML = '<i class="fas fa-sparkles" id="ai-idle"></i> AI Ready';
        }
    }
}

const aiAssistant = new AIAssistant();

// ============================================
// 6. CODE EXECUTION & PREVIEW
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
            showNotification('Preview not supported for this language', 'warning');
            return;
        }

        this.switchTab('preview-content');
        if (window.innerWidth <= 768) switchMobileTab('bottom-panel');
    }

    static executeHTML(code) {
        const frame = document.getElementById('output-frame');
        frame.srcdoc = code;
    }

    static executeJavaScript(code) {
        const frame = document.getElementById('output-frame');
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
                        border-left: 3px solid #007aff;
                    }
                    .error { 
                        color: #ef4444; 
                        background: #fee; 
                        padding: 10px; 
                        border-radius: 6px;
                        border-left: 3px solid #ef4444;
                    }
                </style>
            </head>
            <body>
                <div id="output"></div>
                <script>
                    const outputs = [];
                    const originalLog = console.log;
                    
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
        frame.srcdoc = wrappedCode;
    }

    static executeCSS(code) {
        const frame = document.getElementById('output-frame');
        frame.srcdoc = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>${code}</style>
            </head>
            <body>
                <div style="padding: 20px;">
                    <h1>CSS Preview</h1>
                    <p>Your CSS styles are applied below:</p>
                    <button>Sample Button</button>
                    <div style="margin-top: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                        Sample Container
                    </div>
                </div>
            </body>
            </html>
        `;
    }

    static switchTab(tabId) {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-target="${tabId}"]`).classList.add('active');
        
        document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
        document.getElementById(tabId).classList.add('active');
    }
}

// ============================================
// 7. UI EVENT LISTENERS
// ============================================
function initializeEventListeners() {
    // File operations
    document.getElementById('new-file-btn')?.addEventListener('click', () => FileManager.createNewFile());
    document.getElementById('save-btn')?.addEventListener('click', () => FileManager.saveFile());
    document.getElementById('run-btn')?.addEventListener('click', () => CodeExecutor.execute());
    
    // AI panel
    sendAiBtn?.addEventListener('click', () => aiAssistant.ask());
    aiPrompt?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            aiAssistant.ask();
        }
    });

    // Quick AI tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.getAttribute('data-action');
            const prompts = {
                'fix': '🐛 Find and fix any bugs in this code.',
                'explain': '📖 Explain how this code works in detail.',
                'optimize': '⚡ Optimize this code for better performance.',
                'comment': '📝 Add detailed comments and documentation.',
                'refactor': '✨ Refactor this code to be cleaner and more maintainable.',
                'test': '🧪 Generate comprehensive test cases for this code.'
            };
            aiAssistant.ask(prompts[action] || action);
        });
    });

    // Clear chat
    document.getElementById('clear-chat')?.addEventListener('click', () => {
        aiAssistant.clearHistory();
    });

    // Toggle AI panel
    document.getElementById('toggle-ai')?.addEventListener('click', () => {
        const aiPanel = document.getElementById('ai-sidebar');
        aiPanel.classList.toggle('collapsed');
        if (editor && isEditorReady) editor.layout();
    });

    // Bottom panel tabs
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
            document.getElementById(tab.getAttribute('data-target')).classList.add('active');
        });
    });

    // Panel controls
    document.getElementById('toggle-panel')?.addEventListener('click', () => {
        document.getElementById('bottom-panel').classList.toggle('collapsed');
    });

    document.getElementById('clear-console')?.addEventListener('click', () => {
        document.getElementById('terminal').innerHTML = 
            '<div class="term-line"><span class="term-prompt">nexus@ai:~$</span> Console cleared</div>';
    });

    // Mobile navigation
    document.querySelectorAll('.m-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-tab');
            switchMobileTab(tab);
        });
    });

    // Setup modals
    setupModals();
}

// ============================================
// 8. LOCAL FILE MANAGEMENT
// ============================================
function loadLocalFiles() {
    const fileTree = document.getElementById('file-tree');
    const files = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('file_')) {
            try {
                const fileData = JSON.parse(localStorage.getItem(key));
                files.push(fileData);
            } catch (e) {
                console.error('Error parsing file:', e);
            }
        }
    }

    if (files.length === 0) {
        fileTree.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">No files. Create one to get started!</div>';
        return;
    }

    fileTree.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <i class="fas fa-file-code icon-${getLanguageIcon(file.language)}"></i>
            <span class="file-name">${file.name}</span>
        `;
        item.addEventListener('click', () => {
            FileManager.openFile(file.name, file.code, file.language);
        });
        fileTree.appendChild(item);
    });
}

function initializeFileManager() {
    document.getElementById('refresh-files')?.addEventListener('click', loadLocalFiles);
}

function getLanguageIcon(lang) {
    const iconMap = {
        'javascript': 'js',
        'html': 'html',
        'css': 'css',
        'python': 'py',
        'cpp': 'cpp',
        'java': 'java',
        'typescript': 'ts',
        'json': 'json'
    };
    return iconMap[lang] || 'file';
}

// ============================================
// 9. STORAGE & UTILITIES
// ============================================
function updateStorageInfo() {
    const used = JSON.stringify(localStorage).length;
    const percentage = Math.min((used / 5242880) * 100, 100);
    
    document.getElementById('storage-fill').style.width = percentage + '%';
    document.getElementById('storage-size').textContent = `${(used / 1024).toFixed(1)} KB used`;
}

function showNotification(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
        <span>${msg}</span>
    `;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// 10. MOBILE NAVIGATION
// ============================================
function switchMobileTab(target) {
    const mobileBtns = document.querySelectorAll('.m-nav-btn');
    const sections = ['explorer-drawer', 'editor-wrapper', 'ai-sidebar', 'bottom-panel'];
    
    mobileBtns.forEach(b => b.classList.remove('active'));
    sections.forEach(sec => {
        const el = document.getElementById(sec);
        if (el) el.classList.remove('mobile-active');
    });

    const activeBtn = document.querySelector(`[data-tab="${target}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    const activeSection = document.getElementById(target);
    if (activeSection) {
        activeSection.classList.add('mobile-active');
        if (target === 'editor-wrapper' && editor && isEditorReady) {
            setTimeout(() => editor.layout(), 100);
        }
    }
}

// Initialize mobile on load
if (window.innerWidth <= 768) {
    switchMobileTab('editor-wrapper');
}

// ============================================
// 11. KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        FileManager.saveFile();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        CodeExecutor.execute();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('inline-ai-input').focus();
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
// 12. EXPOSE GLOBAL FUNCTIONS
// ============================================
window.FileManager = FileManager;
window.CodeExecutor = CodeExecutor;
window.AIAssistant = AIAssistant;
window.switchMobileTab = switchMobileTab;
window.showNotification = showNotification;

console.log('✅ Nexus AI Editor v3.0 loaded successfully');