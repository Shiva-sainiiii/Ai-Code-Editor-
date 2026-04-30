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
        padding: { top: 20 },
        roundedSelection: true,
        scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            useShadows: false,
            verticalHasArrows: false,
            horizontalHasArrows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10
        }
    });

    // Sync language selector with editor
    document.getElementById('language-selector').addEventListener('change', (e) => {
        const lang = e.target.value;
        monaco.editor.setModelLanguage(editor.getModel(), lang);
        currentLanguage = lang;
    });

    // Initial Layout check
    window.addEventListener('resize', () => editor.layout());
});

// 2. AI Assistant Logic (Generation & Analysis)
const aiPrompt = document.getElementById('ai-prompt');
const sendAiBtn = document.getElementById('send-ai-btn');
const chatHistory = document.getElementById('ai-chat-history');

async function askAI(customPrompt = null) {
    const promptValue = customPrompt || aiPrompt.value.trim();
    if (!promptValue) return;

    // UI Feedback
    const userMsg = document.createElement('div');
    userMsg.className = 'ai-message user';
    userMsg.textContent = promptValue;
    chatHistory.appendChild(userMsg);
    aiPrompt.value = '';
    chatHistory.scrollTop = chatHistory.scrollHeight;

    const botMsg = document.createElement('div');
    botMsg.className = 'ai-message bot';
    botMsg.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Nexus is thinking...';
    chatHistory.appendChild(botMsg);

    try {
        const response = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptValue,
                code: editor.getValue(),
                language: currentLanguage
            })
        });

        const data = await response.json();

        if (data.code) {
            // Use executeEdits for a cleaner "undoable" code insertion
            const lineCount = editor.getModel().getLineCount();
            const range = new monaco.Range(1, 1, lineCount, editor.getModel().getLineMaxColumn(lineCount));
            
            editor.executeEdits("nexus-ai", [{
                range: range,
                text: data.code,
                forceMoveMarkers: true
            }]);
            
            botMsg.innerHTML = `<strong>Analysis:</strong><br>${data.explanation}`;
        } else {
            botMsg.textContent = data.explanation || "I processed your request, but no code changes were needed.";
        }
    } catch (error) {
        botMsg.textContent = "Error connecting to Nexus AI. Please check your API configuration.";
        console.error(error);
    }
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Event Listeners for AI
sendAiBtn.addEventListener('click', () => askAI());
aiPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        askAI();
    }
});

// Quick AI Tools (Fix, Explain, Optimize)
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        let prompt = "";
        if (action === 'fix') prompt = "Find and fix any bugs in this code.";
        if (action === 'explain') prompt = "Explain how this code works in simple terms.";
        if (action === 'optimize') prompt = "Optimize this code for better performance.";
        askAI(prompt);
    });
});

// 3. Productivity Functions
function copyCode() {
    const code = editor.getValue();
    navigator.clipboard.writeText(code).then(() => {
        alert("Code copied to clipboard!");
    });
}

function newFile() {
    if (confirm("Create a new file? Unsaved changes will be lost.")) {
        editor.setValue("");
    }
}

// 4. Live Preview Execution
document.getElementById('run-btn').addEventListener('click', () => {
    const code = editor.getValue();
    const outputFrame = document.getElementById('output-frame');
    const lang = document.getElementById('language-selector').value;

    if (lang === 'html') {
        outputFrame.srcdoc = code;
    } else if (lang === 'javascript') {
        outputFrame.srcdoc = `
            <style>body { font-family: sans-serif; color: #333; }</style>
            <script>
                try {
                    ${code}
                } catch (err) {
                    document.body.innerHTML = '<pre style="color:red">' + err + '</pre>';
                }
            </script>
        `;
    } else {
        alert("Live preview is currently supported for HTML and JS only.");
    }
    
    // Switch to preview tab automatically on mobile
    if (window.innerWidth <= 768) {
        switchMobileTab('bottom-panel');
    }
});

// 5. Mobile Navigation Controller
const mobileBtns = document.querySelectorAll('.m-nav-btn');
const mobileSections = {
    'explorer-drawer': document.getElementById('explorer-drawer'),
    'monaco-container': document.getElementById('monaco-container'),
    'ai-sidebar': document.getElementById('ai-sidebar'),
    'bottom-panel': document.getElementById('bottom-panel')
};

function switchMobileTab(target) {
    // Remove active class from all buttons and sections
    mobileBtns.forEach(b => b.classList.remove('active'));
    Object.values(mobileSections).forEach(sec => {
        if (sec) sec.classList.remove('mobile-active');
    });

    // Add active to clicked button and target section
    const activeBtn = document.querySelector(`[data-tab="${target}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    
    if (mobileSections[target]) {
        mobileSections[target].classList.add('mobile-active');
        
        // Handle overlay for Explorer
        if (target === 'explorer-drawer') {
            mobileSections[target].style.display = 'flex';
        } else {
            document.getElementById('explorer-drawer').style.display = 'none';
        }

        // Force Monaco to recalculate layout
        if (target === 'monaco-container' && editor) {
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

// 6. Tabs & Drawer UI Logic
document.getElementById('toggle-ai').addEventListener('click', () => {
    const aiSidebar = document.getElementById('ai-sidebar');
    if (aiSidebar.style.display === 'none') {
        aiSidebar.style.display = 'flex';
    } else {
        aiSidebar.style.display = 'none';
    }
    editor.layout();
});

// Tab switching logic for Bottom Panel (Preview vs Console)
document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-target');
        
        // Update tab buttons
        document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update views
        document.querySelectorAll('.panel-view').forEach(v => v.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    });
});

// Default mobile view initialization
if (window.innerWidth <= 768) {
    switchMobileTab('monaco-container');
}

// Expose editor to window for the inline Mobile Ribbon buttons (insertCode)
window.editor = editor;
    
