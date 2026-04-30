// ==========================================
// NEXUS AI — PRODUCTION SCRIPT v3.0
// Architecture: Modular + Scalable
// ==========================================

// ================= GLOBAL STATE =================
const state = {
    editor: null,
    currentFile: "index.js",
    files: {
        "index.js": {
            content: "// Welcome to Nexus AI 🚀\nconsole.log('Start coding...');",
            language: "javascript"
        }
    }
};

// ================= MONACO INIT =================
require.config({
    paths: { vs: "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs" }
});

require(["vs/editor/editor.main"], function () {
    state.editor = monaco.editor.create(document.getElementById("monaco-container"), {
        value: state.files[state.currentFile].content,
        language: "javascript",
        theme: "vs-dark",
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: true }
    });

    bindEditorEvents();
});

// ================= EDITOR EVENTS =================
function bindEditorEvents() {
    state.editor.onDidChangeModelContent(() => {
        const file = state.files[state.currentFile];
        file.content = state.editor.getValue();
    });
}

// ================= FILE SYSTEM =================
function createFile(name, language = "javascript") {
    if (state.files[name]) return;

    state.files[name] = {
        content: "",
        language
    };

    renderFileTree();
    openFile(name);
}

function openFile(name) {
    state.currentFile = name;

    const file = state.files[name];

    state.editor.setValue(file.content);
    monaco.editor.setModelLanguage(state.editor.getModel(), file.language);

    document.getElementById("language-selector").value = file.language;
    updateTabs();
}

function renderFileTree() {
    const container = document.getElementById("file-tree");
    container.innerHTML = "";

    Object.keys(state.files).forEach(name => {
        const div = document.createElement("div");
        div.className = "file-item";
        div.innerHTML = `<i class="far fa-file-code"></i> ${name}`;

        div.onclick = () => openFile(name);
        container.appendChild(div);
    });
}

// ================= TABS SYSTEM =================
function updateTabs() {
    const tabContainer = document.querySelector(".tab-container");
    tabContainer.innerHTML = "";

    Object.keys(state.files).forEach(name => {
        const tab = document.createElement("div");
        tab.className = "tab " + (name === state.currentFile ? "active" : "");
        tab.innerHTML = `
            <span>${name}</span>
            <i class="fas fa-times close-tab"></i>
        `;

        tab.onclick = () => openFile(name);

        tab.querySelector(".close-tab").onclick = (e) => {
            e.stopPropagation();
            delete state.files[name];
            state.currentFile = Object.keys(state.files)[0];
            renderFileTree();
            openFile(state.currentFile);
        };

        tabContainer.appendChild(tab);
    });
}

// ================= LANGUAGE SWITCH =================
document.getElementById("language-selector").addEventListener("change", (e) => {
    const lang = e.target.value;

    state.files[state.currentFile].language = lang;
    monaco.editor.setModelLanguage(state.editor.getModel(), lang);
});

// ================= RUN ENGINE =================
document.getElementById("run-btn").addEventListener("click", runCode);

function runCode() {
    const code = state.editor.getValue();
    const iframe = document.getElementById("output-frame");

    const html = `
        <html>
        <body>
        <script>
        console.log = function(msg){
            parent.postMessage({type:'log', data:msg}, '*');
        }
        try {
            ${code}
        } catch(e) {
            document.body.innerHTML = '<pre style="color:red;">'+e+'</pre>';
        }
        <\/script>
        </body>
        </html>
    `;

    iframe.srcdoc = html;
    logToTerminal("▶ Running code...");
}

// ================= TERMINAL =================
window.addEventListener("message", (e) => {
    if (e.data.type === "log") {
        logToTerminal(e.data.data);
    }
});

function logToTerminal(text) {
    const terminal = document.getElementById("terminal");
    const div = document.createElement("div");
    div.className = "term-line";
    div.textContent = text;
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

// ================= AI SYSTEM =================
const sendBtn = document.getElementById("send-ai-btn");
const promptInput = document.getElementById("ai-prompt");
const chatBox = document.getElementById("ai-chat-history");

sendBtn.addEventListener("click", handleAI);

async function handleAI() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    addMessage(prompt, "user");
    promptInput.value = "";

    const typing = addTyping();

    try {
        const res = await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                prompt,
                code: state.editor.getValue(),
                language: state.files[state.currentFile].language
            })
        });

        const data = await res.json();
        typing.remove();

        if (data.code) {
            state.editor.setValue(data.code);
            addMessage("✅ Code updated", "bot");
        } else {
            addMessage(data.explanation || "No response", "bot");
        }

        if (typeof saveChatToFirebase === "function") {
            saveChatToFirebase(prompt, data);
        }

    } catch (err) {
        typing.remove();
        addMessage("❌ AI Error", "bot");
        console.error(err);
    }
}

// ================= CHAT UI =================
function addMessage(text, sender) {
    const div = document.createElement("div");
    div.className = `ai-message ${sender}`;
    div.innerHTML = `<div class="msg-bubble">${text}</div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addTyping() {
    const div = document.createElement("div");
    div.className = "ai-message bot";
    div.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
    chatBox.appendChild(div);
    return div;
}

// ================= SAVE BUTTON =================
document.getElementById("save-btn").addEventListener("click", () => {
    const file = state.files[state.currentFile];

    if (typeof saveProjectToCloud === "function") {
        saveProjectToCloud(
            state.currentFile,
            file.content,
            file.language
        );
    }
});

// ================= MOBILE NAV FIX =================
const mobileBtns = document.querySelectorAll(".m-nav-btn");

mobileBtns.forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".m-nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        const target = btn.getAttribute("data-tab");

        document.querySelectorAll(
            "#explorer-drawer, #monaco-container, #ai-sidebar, #bottom-panel"
        ).forEach(el => el.classList.remove("mobile-active"));

        document.getElementById(target).classList.add("mobile-active");
    });
});

// ================= INIT =================
function init() {
    renderFileTree();
    updateTabs();
}

init();
