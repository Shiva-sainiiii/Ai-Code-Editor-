/**
 * NEXUS AI - FIREBASE ENGINE v2.0
 * Handles Authentication, Cloud Storage, and Real-time Synchronization
 * SECURITY: Never expose apiKey in production - use environment variables
 */

// ============================================
// 1. FIREBASE INITIALIZATION
// ============================================

// Get config from environment or use default (ensure sensitive keys are in .env)
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBeiIUdVEv5kvJ6GFSzWZwFav8Nx3Mxhkg",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "code-editor-ai.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "code-editor-ai",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "code-editor-ai.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "145185559673",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:145185559673:web:5646addc66bb365209b0a8",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-CYWKWQJGP0"
};

try {
    firebase.initializeApp(firebaseConfig);
} catch (error) {
    console.error('❌ Firebase initialization failed:', error);
}

const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

// Configure Google sign-in options
provider.setCustomParameters({
    'prompt': 'consent',
    'display': 'popup'
});

// ============================================
// 2. AUTHENTICATION MODULE
// ============================================
class AuthService {
    /**
     * Sign in with Google
     */
    static async signInWithGoogle() {
        try {
            const result = await auth.signInWithPopup(provider);
            console.log("✅ User signed in:", result.user.displayName);
            this.updateUIState(result.user);
            await this.loadUserFiles();
            this.showNotification(`Welcome, ${result.user.displayName}!`);
            return result.user;
        } catch (error) {
            console.error("❌ Auth Error:", error.message);
            this.showNotification(`Sign-in failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Sign out
     */
    static async signOut() {
        try {
            await auth.signOut();
            this.updateUIState(null);
            this.showNotification('Signed out successfully');
            setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            console.error("❌ Sign-out Error:", error);
            this.showNotification('Sign-out failed', 'error');
        }
    }

    /**
     * Sign in with Email/Password (optional)
     */
    static async signInWithEmail(email, password) {
        try {
            const result = await auth.signInWithEmailAndPassword(email, password);
            this.updateUIState(result.user);
            await this.loadUserFiles();
            return result.user;
        } catch (error) {
            console.error("❌ Email Sign-in Error:", error);
            this.showNotification(`Sign-in failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Create account with Email/Password
     */
    static async createAccountWithEmail(email, password) {
        try {
            const result = await auth.createUserWithEmailAndPassword(email, password);
            await result.user.updateProfile({
                displayName: email.split('@')[0]
            });
            this.updateUIState(result.user);
            return result.user;
        } catch (error) {
            console.error("❌ Account Creation Error:", error);
            this.showNotification(`Account creation failed: ${error.message}`, 'error');
            throw error;
        }
    }

    /**
     * Update UI based on auth state
     */
    static updateUIState(user) {
        const loginBtn = document.getElementById('login-btn');
        if (!loginBtn) return;

        if (user) {
            const avatar = user.photoURL || this.generateAvatarPlaceholder(user.displayName);
            loginBtn.innerHTML = `<img src="${avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;" alt="Avatar">`;
            loginBtn.title = `${user.displayName} (${user.email})`;
            loginBtn.onclick = (e) => {
                e.preventDefault();
                this.showUserMenu(user);
            };
        } else {
            loginBtn.innerHTML = `<i class="far fa-user-circle"></i>`;
            loginBtn.title = 'Sign in';
            loginBtn.onclick = () => AuthService.signInWithGoogle();
        }
    }

    /**
     * Show user menu
     */
    static showUserMenu(user) {
        const menu = document.createElement('div');
        menu.style.cssText = `
            position: absolute;
            top: 60px;
            right: 20px;
            background: var(--glass-bg);
            backdrop-filter: blur(10px);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            min-width: 200px;
            z-index: 10000;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        `;
        menu.innerHTML = `
            <div style="padding: 15px; border-bottom: 1px solid var(--border-color);">
                <strong>${user.displayName}</strong><br>
                <small style="color: var(--text-muted);">${user.email}</small>
            </div>
            <button onclick="AuthService.signOut()" style="width: 100%; padding: 10px; text-align: left; background: none; border: none; color: var(--text-main); cursor: pointer;">
                Sign Out
            </button>
        `;
        document.body.appendChild(menu);
        setTimeout(() => menu.remove(), 5000);
    }

    /**
     * Generate placeholder avatar
     */
    static generateAvatarPlaceholder(name) {
        const initials = (name || 'U').split(' ').map(w => w[0]).join('');
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 24, 24);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, 12, 12);
        return canvas.toDataURL();
    }

    static showNotification(msg, type = 'success') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 20px;
            background: ${type === 'error' ? '#ef4444' : '#10b981'};
            color: white;
            border-radius: 6px;
            z-index: 9999;
            animation: slideDown 0.3s ease;
        `;
        notification.textContent = msg;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
}

// ============================================
// 3. CLOUD STORAGE & FILE MANAGEMENT
// ============================================
class FileService {
    /**
     * Save project to Firestore
     */
    static async saveProjectToCloud(fileName, code, language) {
        const user = auth.currentUser;
        if (!user) {
            AuthService.showNotification('Please sign in to save projects', 'error');
            return false;
        }

        if (!fileName || !code) {
            AuthService.showNotification('File name and code are required', 'error');
            return false;
        }

        try {
            const projectRef = db.collection("users")
                .doc(user.uid)
                .collection("projects")
                .doc(fileName.replace(/\./g, '_'));

            await projectRef.set({
                name: fileName,
                content: code,
                language: language || 'javascript',
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                size: code.length,
                hash: this.generateHash(code)
            }, { merge: true });

            console.log("✅ Project saved:", fileName);
            AuthService.showNotification(`✅ Saved: ${fileName}`);
            await this.loadUserFiles();
            return true;

        } catch (error) {
            console.error("❌ Save Error:", error);
            AuthService.showNotification(`Save failed: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Load all user files
     */
    static async loadUserFiles() {
        const user = auth.currentUser;
        if (!user) return [];

        const fileListContainer = document.getElementById('file-tree');
        if (!fileListContainer) return [];

        try {
            const snapshot = await db.collection("users")
                .doc(user.uid)
                .collection("projects")
                .orderBy("updatedAt", "desc")
                .get();

            fileListContainer.innerHTML = '';
            const files = [];

            if (snapshot.empty) {
                fileListContainer.innerHTML = '<div style="padding: 20px; color: var(--text-muted); text-align: center;">No files yet. Create one!</div>';
                return [];
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                files.push(data);
                
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.innerHTML = `
                    <i class="far fa-file-code"></i>
                    <span>${data.name}</span>
                    <div style="margin-left: auto; display: none; gap: 5px;" class="file-actions">
                        <button class="file-btn delete-btn" title="Delete" onclick="FileService.deleteFile('${data.name}')">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                `;
                
                fileItem.addEventListener('click', () => this.openFile(data));
                fileItem.addEventListener('mouseenter', () => {
                    fileItem.querySelector('.file-actions').style.display = 'flex';
                });
                fileItem.addEventListener('mouseleave', () => {
                    fileItem.querySelector('.file-actions').style.display = 'none';
                });

                fileListContainer.appendChild(fileItem);
            });

            console.log(`✅ Loaded ${files.length} files`);
            return files;

        } catch (error) {
            console.error("❌ Load Error:", error);
            AuthService.showNotification(`Failed to load files: ${error.message}`, 'error');
            return [];
        }
    }

    /**
     * Open file in editor
     */
    static openFile(fileData) {
        if (!window.editor || !window.isEditorReady) {
            AuthService.showNotification('Editor not ready', 'error');
            return;
        }

        window.editor.setValue(fileData.content);
        const selector = document.getElementById('language-selector');
        selector.value = fileData.language || 'javascript';
        monaco.editor.setModelLanguage(window.editor.getModel(), fileData.language);
        
        AuthService.showNotification(`📂 Opened: ${fileData.name}`);
    }

    /**
     * Delete file
     */
    static async deleteFile(fileName) {
        const user = auth.currentUser;
        if (!user) return;

        if (!confirm(`Delete "${fileName}"? This cannot be undone.`)) return;

        try {
            await db.collection("users")
                .doc(user.uid)
                .collection("projects")
                .doc(fileName.replace(/\./g, '_'))
                .delete();

            AuthService.showNotification(`🗑️ Deleted: ${fileName}`);
            await this.loadUserFiles();
        } catch (error) {
            console.error("❌ Delete Error:", error);
            AuthService.showNotification(`Delete failed: ${error.message}`, 'error');
        }
    }

    /**
     * Generate hash of code (for duplicate detection)
     */
    static generateHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Export file as JSON backup
     */
    static async exportAsBackup(fileName) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const doc = await db.collection("users")
                .doc(user.uid)
                .collection("projects")
                .doc(fileName.replace(/\./g, '_'))
                .get();

            if (!doc.exists) {
                AuthService.showNotification('File not found', 'error');
                return;
            }

            const backup = JSON.stringify(doc.data(), null, 2);
            const blob = new Blob([backup], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.backup.json`;
            link.click();
            URL.revokeObjectURL(url);
            
            AuthService.showNotification('📥 Backup downloaded');
        } catch (error) {
            console.error("❌ Export Error:", error);
            AuthService.showNotification('Export failed', 'error');
        }
    }
}

// ============================================
// 4. REAL-TIME COLLABORATION (OPTIONAL)
// ============================================
class CollaborationService {
    /**
     * Set up real-time listening to a file
     */
    static watchFile(fileName, callback) {
        const user = auth.currentUser;
        if (!user) return null;

        return db.collection("users")
            .doc(user.uid)
            .collection("projects")
            .doc(fileName.replace(/\./g, '_'))
            .onSnapshot((doc) => {
                if (doc.exists) {
                    callback(doc.data());
                }
            }, (error) => {
                console.error('❌ Watch Error:', error);
            });
    }

    /**
     * Create shareable link
     */
    static async createShareableLink(fileName) {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            const projectRef = db.collection("users")
                .doc(user.uid)
                .collection("projects")
                .doc(fileName.replace(/\./g, '_'));

            await projectRef.update({
                shared: true,
                sharedAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            const shareUrl = `${window.location.origin}?shared=${user.uid}/${fileName}`;
            AuthService.showNotification('🔗 Share link created');
            return shareUrl;
        } catch (error) {
            console.error("❌ Share Error:", error);
            AuthService.showNotification('Failed to create share link', 'error');
        }
    }
}

// ============================================
// 5. UI INTEGRATION & EVENT LISTENERS
// ============================================

// Monitor auth state changes
auth.onAuthStateChanged((user) => {
    AuthService.updateUIState(user);
    if (user) {
        FileService.loadUserFiles();
    }
});

// Save button integration
const saveBtn = document.getElementById('save-btn');
if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const fileName = prompt("Enter file name (e.g., main.js):", "index.js");
        if (fileName && window.editor) {
            const code = window.editor.getValue();
            const lang = document.getElementById('language-selector')?.value || 'javascript';
            await FileService.saveProjectToCloud(fileName, code, lang);
        }
    });
}

// Refresh files button
const refreshBtn = document.getElementById('refresh-files');
if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
        await FileService.loadUserFiles();
        AuthService.showNotification('Refreshed');
    });
}

// Auto-save to cloud every 5 minutes (if signed in)
setInterval(async () => {
    if (auth.currentUser && window.editor) {
        const code = window.editor.getValue();
        if (code && code.length > 0) {
            await FileService.saveProjectToCloud(
                'auto-backup.js',
                code,
                document.getElementById('language-selector')?.value || 'javascript'
            );
        }
    }
}, 5 * 60 * 1000); // 5 minutes

// ============================================
// 6. EXPOSE TO GLOBAL SCOPE
// ============================================
window.AuthService = AuthService;
window.FileService = FileService;
window.CollaborationService = CollaborationService;

console.log('✅ Nexus AI Firebase Engine v2.0 loaded');