/**
 * NEXUS AI - FIREBASE ENGINE v3.0
 * Enhanced authentication, cloud storage, file sync, and collaboration
 * SECURITY: Store API keys in .env files, never commit them
 */

// ============================================
// 1. FIREBASE INITIALIZATION
// ============================================

const firebaseConfig = {
    apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || "AIzaSyBeiIUdVEv5kvJ6GFSzWZwFav8Nx3Mxhkg",
    authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || "code-editor-ai.firebaseapp.com",
    projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || "code-editor-ai",
    storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || "code-editor-ai.firebasestorage.app",
    messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || "145185559673",
    appId: import.meta.env?.VITE_FIREBASE_APP_ID || "1:145185559673:web:5646addc66bb365209b0a8",
    measurementId: import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID || "G-CYWKWQJGP0"
};

try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    console.log('✅ Firebase initialized');
} catch (error) {
    console.error('❌ Firebase init error:', error);
}

const db = firebase.firestore();
const auth = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

provider.setCustomParameters({
    'prompt': 'consent',
    'display': 'popup'
});

// ============================================
// 2. AUTHENTICATION SERVICE
// ============================================
class AuthService {
    /**
     * Sign in with Google
     */
    static async signInWithGoogle() {
        try {
            const result = await auth.signInWithPopup(provider);
            const user = result.user;
            console.log("✅ User signed in:", user.displayName);
            
            this.updateUIState(user);
            await FileService.loadUserFiles();
            this.showNotification(`Welcome, ${user.displayName}!`, 'success');
            
            return user;
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
            this.showNotification('Signed out successfully', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            console.error("❌ Sign-out Error:", error);
            this.showNotification('Sign-out failed', 'error');
        }
    }

    /**
     * Sign in with Email/Password
     */
    static async signInWithEmail(email, password) {
        try {
            const result = await auth.signInWithEmailAndPassword(email, password);
            this.updateUIState(result.user);
            await FileService.loadUserFiles();
            this.showNotification(`Welcome back, ${result.user.displayName || email}!`, 'success');
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
            const user = result.user;
            
            await user.updateProfile({
                displayName: email.split('@')[0]
            });
            
            this.updateUIState(user);
            this.showNotification('Account created successfully!', 'success');
            return user;
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
            loginBtn.innerHTML = `<img src="${avatar}" style="width:24px; height:24px; border-radius:50%; object-fit:cover;" alt="Avatar" title="${user.displayName}">`;
            loginBtn.title = `${user.displayName} • Click for menu`;
            loginBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showUserMenu(user);
            };
        } else {
            loginBtn.innerHTML = `<i class="far fa-user-circle"></i>`;
            loginBtn.title = 'Sign in with Google';
            loginBtn.onclick = () => AuthService.signInWithGoogle();
        }
    }

    /**
     * Generate placeholder avatar
     */
    static generateAvatarPlaceholder(name) {
        const initials = (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase();
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7B731', '#5F27CD'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 32, 32);
        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, 16, 16);
        
        return canvas.toDataURL();
    }

    /**
     * Show user profile menu
     */
    static showUserMenu(user) {
        // Remove existing menu
        const existingMenu = document.querySelector('.user-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.className = 'user-menu glass-panel';
        menu.style.cssText = `
            position: fixed;
            top: 70px;
            right: 20px;
            min-width: 240px;
            z-index: 10000;
            border-radius: 12px;
            animation: slideDown 0.2s ease;
        `;
        menu.innerHTML = `
            <div style="padding: 16px; border-bottom: 1px solid var(--border);">
                <strong style="color: var(--text-bright);">${user.displayName || user.email}</strong><br>
                <small style="color: var(--text-muted); font-size: 11px;">${user.email}</small>
                <div style="margin-top: 8px; font-size: 11px; color: var(--text-dim);">
                    <i class="fas fa-clock"></i> Joined ${new Date(user.metadata.creationTime).toLocaleDateString()}
                </div>
            </div>
            <button onclick="FileService.loadUserFiles()" style="width: 100%; padding: 10px; text-align: left; background: none; border: none; border-bottom: 1px solid var(--border); color: var(--text); cursor: pointer; font-family: var(--font-ui); transition: var(--t-fast);" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='none'">
                <i class="fas fa-cloud-download-alt"></i> Sync Files
            </button>
            <button onclick="AuthService.signOut()" style="width: 100%; padding: 10px; text-align: left; background: none; border: none; color: var(--danger); cursor: pointer; font-family: var(--font-ui); transition: var(--t-fast);" onmouseover="this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.background='none'">
                <i class="fas fa-sign-out-alt"></i> Sign Out
            </button>
        `;
        
        document.body.appendChild(menu);
        
        setTimeout(() => {
            document.addEventListener('click', () => {
                if (menu && menu.parentElement) menu.remove();
            }, { once: true });
        }, 100);
    }

    static showNotification(msg, type = 'success') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 20px;
            background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981'};
            color: white;
            border-radius: 8px;
            z-index: 9999;
            font-family: var(--font-ui);
            font-size: 13px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideDown 0.3s ease;
        `;
        notification.textContent = msg;
        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.animation = 'slideUp 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// ============================================
// 3. CLOUD FILE SERVICE
// ============================================
class FileService {
    /**
     * Save file to Firestore
     */
    static async saveToCloud(fileName, code, language = 'javascript') {
        const user = auth.currentUser;
        if (!user) {
            AuthService.showNotification('Please sign in to save to cloud', 'error');
            return false;
        }

        if (!fileName || !code) {
            AuthService.showNotification('File name and code are required', 'error');
            return false;
        }

        try {
            const docId = fileName.replace(/\./g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
            
            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .set({
                    name: fileName,
                    content: code,
                    language: language,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    size: code.length,
                    hash: this.generateHash(code),
                    tags: [],
                    shared: false
                }, { merge: true });

            console.log("✅ File saved to cloud:", fileName);
            AuthService.showNotification(`☁️ Saved to cloud: ${fileName}`, 'success');
            await this.loadUserFiles();
            return true;

        } catch (error) {
            console.error("❌ Cloud save error:", error);
            AuthService.showNotification(`Save failed: ${error.message}`, 'error');
            return false;
        }
    }

    /**
     * Load all user files from Firestore
     */
    static async loadUserFiles() {
        const user = auth.currentUser;
        if (!user) return [];

        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return [];

        try {
            const snapshot = await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .orderBy('updatedAt', 'desc')
                .get();

            fileTree.innerHTML = '';
            const files = [];

            if (snapshot.empty) {
                fileTree.innerHTML = '<div style="padding: 20px; color: var(--text-dim); text-align: center; font-size: 12px;">☁️ No cloud files. Save your first file!</div>';
                return [];
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                files.push(data);
                
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.style.display = 'flex';
                fileItem.style.alignItems = 'center';
                fileItem.style.gap = '8px';
                
                const icon = this.getLanguageIcon(data.language);
                fileItem.innerHTML = `
                    <i class="fas fa-file-code icon-${icon}" style="flex-shrink: 0;"></i>
                    <span class="file-name">${data.name}</span>
                    <div class="file-opts" style="margin-left: auto;">
                        <button class="file-opt-btn" onclick="event.stopPropagation(); FileService.openFile('${doc.id}')" title="Open">
                            <i class="fas fa-folder-open"></i>
                        </button>
                        <button class="file-opt-btn" onclick="event.stopPropagation(); FileService.deleteFile('${doc.id}', '${data.name}')" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
                
                fileItem.addEventListener('click', () => this.openFile(doc.id));
                fileTree.appendChild(fileItem);
            });

            console.log(`✅ Loaded ${files.length} cloud files`);
            return files;

        } catch (error) {
            console.error("❌ Load files error:", error);
            AuthService.showNotification(`Failed to load files: ${error.message}`, 'error');
            return [];
        }
    }

    /**
     * Open file from Firestore
     */
    static async openFile(docId) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const doc = await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .get();

            if (!doc.exists) {
                AuthService.showNotification('File not found', 'error');
                return;
            }

            const data = doc.data();
            if (window.FileManager && window.editor) {
                window.FileManager.openFile(data.name, data.content, data.language);
            }

        } catch (error) {
            console.error("❌ Open file error:", error);
            AuthService.showNotification(`Failed to open file: ${error.message}`, 'error');
        }
    }

    /**
     * Delete file from Firestore
     */
    static async deleteFile(docId, fileName) {
        const user = auth.currentUser;
        if (!user) return;

        if (!confirm(`Delete "${fileName}" from cloud? This cannot be undone.`)) return;

        try {
            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .delete();

            AuthService.showNotification(`🗑️ Deleted: ${fileName}`, 'success');
            await this.loadUserFiles();
        } catch (error) {
            console.error("❌ Delete error:", error);
            AuthService.showNotification(`Delete failed: ${error.message}`, 'error');
        }
    }

    /**
     * Generate simple hash for code
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
     * Export file as backup
     */
    static async exportAsBackup(docId, fileName) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const doc = await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
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
            
            AuthService.showNotification('📥 Backup downloaded', 'success');
        } catch (error) {
            console.error("❌ Export error:", error);
            AuthService.showNotification('Export failed', 'error');
        }
    }

    static getLanguageIcon(lang) {
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
}

// ============================================
// 4. COLLABORATION SERVICE (OPTIONAL)
// ============================================
class CollaborationService {
    /**
     * Watch file for real-time updates
     */
    static watchFile(userId, docId, callback) {
        return db.collection('users')
            .doc(userId)
            .collection('projects')
            .doc(docId)
            .onSnapshot((doc) => {
                if (doc.exists) {
                    callback(doc.data());
                }
            }, (error) => {
                console.error('❌ Watch error:', error);
            });
    }

    /**
     * Create shareable link
     */
    static async createShareableLink(docId, fileName) {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .update({
                    shared: true,
                    sharedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

            const shareUrl = `${window.location.origin}?project=${user.uid}/${docId}`;
            AuthService.showNotification(`🔗 Share link: ${shareUrl}`, 'success');
            return shareUrl;
        } catch (error) {
            console.error("❌ Share error:", error);
            AuthService.showNotification('Failed to create share link', 'error');
        }
    }
}

// ============================================
// 5. INITIALIZATION & EVENT LISTENERS
// ============================================

// Monitor auth state
auth.onAuthStateChanged((user) => {
    AuthService.updateUIState(user);
    if (user) {
        FileService.loadUserFiles();
        console.log('✅ User signed in:', user.displayName);
    }
});

// Save to cloud button integration
document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        const originalListener = saveBtn.onclick;
        saveBtn.addEventListener('click', async (e) => {
            if (auth.currentUser && window.editor) {
                const fileName = prompt("Save to cloud? Enter file name:", window.currentFileName || "untitled.js");
                if (fileName) {
                    const code = window.editor.getValue();
                    const lang = document.getElementById('language-selector')?.value || 'javascript';
                    await FileService.saveToCloud(fileName, code, lang);
                }
            }
        });
    }
});

// Refresh cloud files button
document.addEventListener('DOMContentLoaded', () => {
    const refreshBtn = document.getElementById('refresh-files');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            const user = auth.currentUser;
            if (user) {
                await FileService.loadUserFiles();
                AuthService.showNotification('Files refreshed', 'success');
            } else {
                AuthService.showNotification('Sign in to sync cloud files', 'warning');
            }
        });
    }
});

// Auto-save to cloud (every 5 minutes if signed in)
setInterval(async () => {
    if (auth.currentUser && window.editor && window.unsavedChanges) {
        const code = window.editor.getValue();
        if (code && code.length > 0) {
            await FileService.saveToCloud(
                window.currentFileName || 'auto-backup.js',
                code,
                document.getElementById('language-selector')?.value || 'javascript'
            );
        }
    }
}, 5 * 60 * 1000);

// ============================================
// 6. EXPOSE TO GLOBAL SCOPE
// ============================================
window.AuthService = AuthService;
window.FileService = FileService;
window.CollaborationService = CollaborationService;

console.log('✅ Nexus AI Firebase Engine v3.0 loaded');