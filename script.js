/**
 * NEXUS AI - CORE ENGINE
 * Manages Monaco Editor, AI interactions, and UI state.
 */

let editor;
let currentLanguage = 'javascript';

// 1. Initialize Monaco Editor
require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
    editor = monaco.editor.create(document.getElementById('monaco-container'), {
        value: [
            '// Welcome to Nexus AI',
            'function greet() {',
            '    console.log("Hello, world!");',
            '}',
            '',
            'greet();'
        ].join('\n'),
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono',
        minimap: { enabled: true },
        cursorSmoothCaretAnimation: "on",
        smoothScrolling: true,
        padding: { top: 20 }
    });

    // Sync language selector with editor
    document.getElementById('language-selector').addEventListener('change', (e) => {
        const lang = e.target.value;
        monaco.editor.setModelLanguage(editor.getModel(), lang);
        currentLanguage = lang;
    });
});

// 2. AI Assistant Logic
const aiPrompt = document.getElementById('ai-prompt');
const sendAiBtn = document.getElementById('send-ai-btn');
const chatHistory = document.getElementById('ai-chat-history');

async function askAI(customPrompt = null) {
    const prompt = customPrompt || aiPrompt.value;
    if (!prompt.trim()) return;

    // Add User Message to UI
    appendMessage('user', prompt);
    aiPrompt.value = '';

    const codeContext = editor.getValue();
    
    // Loading State
    const loadingId = appendMessage('bot', '<i class="fas fa-spinner fa-spin"></i> Thinking...');

    try {
        const response = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                code: codeContext,
                language: currentLanguage
            })
        });

        const data = await response.json();
        
        // Remove loading and show response
        document.getElementById(loadingId).remove();
        
        if (data.code) {
            appendMessage('bot', data.explanation || "I've updated your code:");
            // Option to apply code: for simplicity, we just update the editor or show it
            if (confirm("AI generated new code. Apply to editor?")) {
                editor.setValue(data.code);
            }
        } else {
            appendMessage('bot', data.message || "I'm sorry, I couldn't process that request.");
        }

    } catch (error) {
        document.getElementById(loadingId).innerHTML = "Error connecting to AI. Check your API configuration.";
        console.error("AI Error:", error);
    }
}

function appendMessage(role, text) {
    const id = 'msg-' + Date.now();
    const msgDiv = document.createElement('div');
    msgDiv.className = `ai-message ${role}`;
    msgDiv.id = id;
    msgDiv.innerHTML = text;
    chatHistory.appendChild(msgDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return id;
}

// 3. AI Tool Actions (Fix, Explain, Optimize)
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        const selection = editor.getModel().getValueInRange(editor.getSelection());
        const context = selection || "the entire file";

        let prompt = "";
        if (action === 'fix') prompt = `Fix bugs in this code: ${context}`;
        if (action === 'explain') prompt = `Explain how this code works: ${context}`;
        if (action === 'optimize') prompt = `Optimize this code for better performance: ${context}`;

        askAI(prompt);
    });
});

// 4. Live Preview Logic
document.getElementById('run-btn').addEventListener('click', () => {
    const code = editor.getValue();
    const iframe = document.getElementById('output-frame');
    
    if (currentLanguage === 'html' || currentLanguage === 'javascript' || currentLanguage === 'css') {
        // Simple HTML Preview Logic
        const previewHtml = currentLanguage === 'html' ? code : `
            <html>
                <style>body { font-family: sans-serif; color: #333; }</style>
                <body>
                    <div id="app"></div>
                    <script>${code}<\/script>
                </body>
            </html>
        `;
        
        const blob = new Blob([previewHtml], { type: 'text/html' });
        iframe.src = URL.createObjectURL(blob);
        
        // Switch to preview tab
        document.querySelector('[data-target="preview-content"]').click();
    } else {
        // Simulation for other languages
        const terminal = document.getElementById('terminal');
        terminal.innerHTML += `<br>[Nexus] Running ${currentLanguage} simulation...<br>Output: Success (Exit Code 0)`;
        document.querySelector('[data-target="terminal-content"]').click();
    }
});

// 5. UI Utilities
// Toggle Sidebars
document.getElementById('toggle-ai').addEventListener('click', () => {
    const aiPanel = document.getElementById('ai-sidebar');
    aiPanel.style.width = aiPanel.style.width === '0px' ? '350px' : '0px';
});

// Tab Switching (Preview vs Console)
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
        
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
    });
});

// Event Listeners
sendAiBtn.addEventListener('click', () => askAI());
aiPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askAI();
    }
});

// File Save Simulation
document.getElementById('save-btn').addEventListener('click', () => {
    const code = editor.getValue();
    // Integrated with Firebase later
    localStorage.setItem('nexus_autosave', code);
    alert('Project saved locally!');
});
          
