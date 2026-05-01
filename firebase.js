/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         NEXUS AI — FIREBASE ENGINE v4.0                     ║
 * ║  Fixed: truncated file · onAuthStateChanged session restore ║
 * ║         invalid OAuth param · page-reload on sign-out       ║
 * ║         XSS in file list · undefined CSS class             ║
 * ║         no listener cleanup · duplicate getLanguageIcon     ║
 * ║         avatar caching · DOM-safe user menu                ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

// ============================================================
// 1. FIREBASE INITIALIZATION
// ============================================================
const firebaseConfig = {
    apiKey:            'AIzaSyBeiIUdVEv5kvJ6GFSzWZwFav8Nx3Mxhkg',
    authDomain:        'code-editor-ai.firebaseapp.com',
    projectId:         'code-editor-ai',
    storageBucket:     'code-editor-ai.firebasestorage.app',
    messagingSenderId: '145185559673',
    appId:             '1:145185559673:web:5646addc66bb365209b0a8',
    measurementId:     'G-CYWKWQJGP0',
};

try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    console.log('✅ Firebase initialized');
} catch (err) {
    console.error('❌ Firebase init error:', err);
}

const db       = firebase.firestore();
const auth     = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();

// FIX: removed invalid 'display' parameter — only valid OAuth hint here
provider.setCustomParameters({ prompt: 'select_account' });

// ============================================================
// 2. SESSION RESTORATION  (FIX: was completely missing in v3)
// ============================================================
/**
 * Firebase restores the signed-in user automatically on page reload.
 * Without this listener the app always appeared logged-out after refresh.
 */
auth.onAuthStateChanged(async (user) => {
    if (user) {
        console.log('🔄 Session restored:', user.displayName || user.email);
        AuthService.updateUIState(user);
        // Load their cloud files into the explorer
        await FileService.loadUserFiles();
    } else {
        AuthService.updateUIState(null);
        // Fall back to local file listing when signed out
        if (typeof window.loadLocalFiles === 'function') {
            window.loadLocalFiles();
        }
    }
});

// ============================================================
// 3. SHARED UTILITIES
// ============================================================

/** Escape a string for safe innerHTML injection — prevents XSS */
function escapeHTML(str) {
    const el = document.createElement('div');
    el.textContent = String(str ?? '');
    return el.innerHTML;
}

/**
 * Map a language identifier to the icon-suffix used in CSS classes.
 * NOTE: kept here (and removed from script.js) — single source of truth.
 * script.js's getLanguageIcon is a local duplicate; keep this one canonical.
 */
function getLanguageIcon(lang) {
    const map = {
        javascript: 'js',  typescript: 'ts',  html:     'html',
        css:        'css',  python:     'py',  cpp:      'cpp',
        java:       'java', json:       'json', markdown: 'md',
    };
    return map[lang] || 'file';
}

// ============================================================
// 4. AUTHENTICATION SERVICE
// ============================================================
class AuthService {

    // ── Sign-in ─────────────────────────────────────────────
    static async signInWithGoogle() {
        try {
            const result = await auth.signInWithPopup(provider);
            console.log('✅ Signed in:', result.user.displayName);
            // onAuthStateChanged handles UI update + file load automatically
            return result.user;
        } catch (err) {
            console.error('❌ Auth Error:', err.message);
            this.notify(`Sign-in failed: ${err.message}`, 'error');
            throw err;
        }
    }

    static async signInWithEmail(email, password) {
        try {
            const result = await auth.signInWithEmailAndPassword(email, password);
            return result.user;
        } catch (err) {
            console.error('❌ Email sign-in error:', err);
            this.notify(`Sign-in failed: ${err.message}`, 'error');
            throw err;
        }
    }

    static async createAccount(email, password) {
        try {
            const result = await auth.createUserWithEmailAndPassword(email, password);
            await result.user.updateProfile({ displayName: email.split('@')[0] });
            this.notify('Account created successfully!', 'success');
            return result.user;
        } catch (err) {
            console.error('❌ Account creation error:', err);
            this.notify(`Account creation failed: ${err.message}`, 'error');
            throw err;
        }
    }

    // ── Sign-out ────────────────────────────────────────────
    static async signOut() {
        try {
            await auth.signOut();
            // FIX: update UI in place — no location.reload() that destroys editor state
            // onAuthStateChanged fires and calls updateUIState(null) + loadLocalFiles()
            this.notify('Signed out successfully', 'success');
        } catch (err) {
            console.error('❌ Sign-out error:', err);
            this.notify('Sign-out failed', 'error');
        }
    }

    // ── UI state ────────────────────────────────────────────
    static updateUIState(user) {
        const btn = document.getElementById('login-btn');
        if (!btn) return;

        if (user) {
            const avatarSrc = user.photoURL || this._avatarDataURL(user.displayName || user.email);
            // Build element via DOM — not innerHTML with user data
            const img = document.createElement('img');
            img.src   = avatarSrc;
            img.alt   = user.displayName || 'User';
            img.style.cssText = 'width:24px;height:24px;border-radius:50%;object-fit:cover;';
            btn.innerHTML = '';
            btn.appendChild(img);
            btn.title   = `${user.displayName || user.email} — click for options`;
            btn.onclick = (e) => { e.stopPropagation(); this._showUserMenu(user); };
        } else {
            btn.innerHTML = '<i class="far fa-user-circle"></i>';
            btn.title     = 'Sign in with Google';
            btn.onclick   = () => AuthService.signInWithGoogle();
        }
    }

    // ── Avatar generation (cached) ──────────────────────────
    static _avatarCache = {};

    static _avatarDataURL(name) {
        if (this._avatarCache[name]) return this._avatarCache[name];

        const initials = (name || 'U')
            .split(' ')
            .map(w => w[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();

        // Deterministic colour from first char code — consistent per user
        const palette = ['#007aff', '#9333ea', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
        const color   = palette[(name?.charCodeAt(0) ?? 0) % palette.length];

        const canvas   = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
        const ctx      = canvas.getContext('2d');
        ctx.fillStyle  = color;
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle  = '#ffffff';
        ctx.font       = 'bold 26px Arial';
        ctx.textAlign  = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, 32, 32);

        const url = canvas.toDataURL();
        this._avatarCache[name] = url;   // FIX: cache after first render
        return url;
    }

    // ── User menu popup ─────────────────────────────────────
    static _showUserMenu(user) {
        document.querySelector('.user-menu')?.remove();

        const menu = document.createElement('div');
        menu.className = 'user-menu glass-panel';
        // Styles belong in CSS, but kept minimal here for self-contained popup
        Object.assign(menu.style, {
            position: 'fixed', top: '60px', right: '16px',
            minWidth: '220px', zIndex: '10000',
            borderRadius: '14px', overflow: 'hidden',
            animation: 'fadeIn 0.2s ease',
        });

        // ── Header (safe DOM construction) ──────────────────
        const header = document.createElement('div');
        header.style.cssText = 'padding:14px 16px;border-bottom:1px solid var(--border)';

        const nameEl = Object.assign(document.createElement('strong'), {
            style: 'display:block;color:var(--text-bright);font-size:13px',
        });
        nameEl.textContent = user.displayName || user.email;

        const emailEl = Object.assign(document.createElement('small'), {
            style: 'color:var(--text-muted);font-size:11px',
        });
        emailEl.textContent = user.email;

        const joinedEl = document.createElement('div');
        joinedEl.style.cssText = 'margin-top:6px;font-size:10px;color:var(--text-dim)';
        joinedEl.textContent = user.metadata?.creationTime
            ? `Joined ${new Date(user.metadata.creationTime).toLocaleDateString()}`
            : '';

        header.append(nameEl, emailEl, joinedEl);
        menu.appendChild(header);

        // ── Menu items ──────────────────────────────────────
        const items = [
            { icon: 'cloud-download-alt', label: 'Sync Cloud Files', action: () => FileService.loadUserFiles() },
            { icon: 'file-export',        label: 'Export All Files',  action: () => FileService.exportAllBackup() },
            { icon: 'sign-out-alt',       label: 'Sign Out',          action: () => AuthService.signOut(), danger: true },
        ];

        items.forEach(({ icon, label, action, danger }) => {
            const btn = document.createElement('button');
            btn.style.cssText = [
                'width:100%;padding:10px 16px;text-align:left;',
                'background:none;border:none;',
                `border-bottom:1px solid var(--border);`,
                `color:${danger ? 'var(--danger)' : 'var(--text)'};`,
                'cursor:pointer;font-family:var(--font-ui);font-size:13px;',
                'display:flex;align-items:center;gap:10px;transition:var(--t-fast);',
            ].join('');

            const ico = document.createElement('i');
            ico.className = `fas fa-${icon}`;
            const lbl = document.createElement('span');
            lbl.textContent = label;

            btn.append(ico, lbl);
            btn.addEventListener('mouseenter', () => {
                btn.style.background = danger ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)';
            });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'none'; });
            btn.addEventListener('click', () => { menu.remove(); action(); });
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);

        // Close on outside click
        setTimeout(() => {
            const dismiss = (e) => {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', dismiss);
                }
            };
            document.addEventListener('click', dismiss);
        }, 50);
    }

    /** Delegate to global showNotification (script.js) or console fallback */
    static notify(msg, type = 'success') {
        if (typeof window.showNotification === 'function') {
            window.showNotification(msg, type);
        } else {
            console.log(`[Firebase ${type}] ${msg}`);
        }
    }
}

// ============================================================
// 5. CLOUD FILE SERVICE
// ============================================================
class FileService {

    static async saveToCloud(fileName, code, language = 'javascript') {
        const user = auth.currentUser;
        if (!user) {
            AuthService.notify('Please sign in to save to cloud', 'error');
            return false;
        }
        if (!fileName || code === undefined) {
            AuthService.notify('File name and code are required', 'error');
            return false;
        }

        try {
            // Derive a safe Firestore document ID
            const docId = this._toDocId(fileName);

            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .set({
                    name:      fileName,
                    content:   code,
                    language,
                    size:      code.length,
                    hash:      this._hash(code),
                    shared:    false,
                    tags:      [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                }, { merge: true });

            console.log('✅ Cloud save:', fileName);
            AuthService.notify(`☁️ Saved to cloud: ${fileName}`, 'success');
            await this.loadUserFiles();
            return true;

        } catch (err) {
            console.error('❌ Cloud save error:', err);
            AuthService.notify(`Save failed: ${err.message}`, 'error');
            return false;
        }
    }

    static async loadUserFiles() {
        const user = auth.currentUser;
        if (!user) return [];

        const fileTree = document.getElementById('file-tree');
        if (!fileTree) return [];

        // Show loading state
        fileTree.innerHTML = `
            <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:12px">
                <i class="fas fa-circle-notch fa-spin"
                   style="display:block;margin-bottom:8px;font-size:20px;opacity:0.6"></i>
                Loading cloud files…
            </div>`;

        try {
            const snapshot = await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .orderBy('updatedAt', 'desc')
                .get();

            if (snapshot.empty) {
                fileTree.innerHTML = `
                    <div style="padding:24px 16px;text-align:center;
                                color:var(--text-muted);font-size:12px;line-height:1.8">
                        <i class="fas fa-cloud"
                           style="font-size:28px;display:block;margin-bottom:10px;opacity:0.3"></i>
                        No cloud files yet.<br>Save your first file!
                    </div>`;
                return [];
            }

            fileTree.innerHTML = '';
            const files = [];

            snapshot.forEach(doc => {
                const data = doc.data();
                files.push(data);

                const item = document.createElement('div');
                item.className = 'file-item';

                // ── Safe DOM construction — no innerHTML with Firestore data ──
                const iconEl = document.createElement('i');
                iconEl.className = `fas fa-file-code icon-${getLanguageIcon(data.language)}`;

                const nameEl = document.createElement('span');
                nameEl.className = 'file-name';
                nameEl.textContent = data.name;   // FIX: textContent, not innerHTML

                // Action buttons wrapper
                const optsEl = document.createElement('div');
                optsEl.className = 'file-opts';

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'file-opt-btn';
                deleteBtn.title = 'Delete from cloud';
                deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._confirmDelete(doc.id, data.name);
                });

                optsEl.appendChild(deleteBtn);
                item.append(iconEl, nameEl, optsEl);

                item.addEventListener('click', () => {
                    document.querySelectorAll('.file-item').forEach(f => f.classList.remove('active'));
                    item.classList.add('active');
                    this.openFile(doc.id);
                });

                fileTree.appendChild(item);
            });

            console.log(`✅ Loaded ${files.length} cloud file(s)`);
            return files;

        } catch (err) {
            console.error('❌ Load files error:', err);
            fileTree.innerHTML = `
                <div style="padding:20px;text-align:center;color:var(--danger);font-size:12px">
                    <i class="fas fa-exclamation-circle"
                       style="display:block;margin-bottom:8px;font-size:20px"></i>
                    Failed to load files.
                </div>`;
            AuthService.notify(`Load failed: ${err.message}`, 'error');
            return [];
        }
    }

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
                AuthService.notify('File not found', 'error');
                return;
            }

            const data = doc.data();
            // Delegate to FileManager in script.js
            if (typeof window.FileManager !== 'undefined') {
                window.FileManager.openFile(data.name, data.content, data.language);
            }
        } catch (err) {
            console.error('❌ Open file error:', err);
            AuthService.notify(`Failed to open: ${err.message}`, 'error');
        }
    }

    /** Use the app's delete modal if available, otherwise fallback to confirm() */
    static _confirmDelete(docId, fileName) {
        if (typeof window.openDeleteModal === 'function') {
            // Store pending args for the confirm-delete handler
            window._cloudDeletePending = { docId, fileName };
            window.openDeleteModal(fileName);

            const confirmBtn = document.getElementById('confirm-delete');
            if (confirmBtn) {
                const handler = () => {
                    const pending = window._cloudDeletePending;
                    if (pending) this.deleteFile(pending.docId, pending.fileName);
                    window._cloudDeletePending = null;
                    confirmBtn.removeEventListener('click', handler);
                };
                confirmBtn.addEventListener('click', handler, { once: true });
            }
        } else {
            if (confirm(`Delete "${fileName}" from cloud?\nThis cannot be undone.`)) {
                this.deleteFile(docId, fileName);
            }
        }
    }

    static async deleteFile(docId, fileName) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .delete();

            AuthService.notify(`🗑️ Deleted: ${fileName}`, 'success');
            await this.loadUserFiles();
        } catch (err) {
            console.error('❌ Delete error:', err);
            AuthService.notify(`Delete failed: ${err.message}`, 'error');
        }
    }

    /** Download all cloud files as a JSON backup */
    static async exportAllBackup() {
        const user = auth.currentUser;
        if (!user) { AuthService.notify('Sign in to export', 'error'); return; }

        try {
            const snapshot = await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .get();

            const files = snapshot.docs.map(d => d.data());
            const json  = JSON.stringify(files, null, 2);
            const blob  = new Blob([json], { type: 'application/json' });
            const url   = URL.createObjectURL(blob);
            const a     = Object.assign(document.createElement('a'), {
                href:     url,
                download: `nexus-backup-${Date.now()}.json`,
            });
            a.click();
            URL.revokeObjectURL(url);
            AuthService.notify('📥 Backup downloaded', 'success');
        } catch (err) {
            console.error('❌ Export error:', err);
            AuthService.notify('Export failed', 'error');
        }
    }

    /** Export a single file as JSON */
    static async exportFile(docId, fileName) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const doc = await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .get();

            if (!doc.exists) { AuthService.notify('File not found', 'error'); return; }

            const json = JSON.stringify(doc.data(), null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = Object.assign(document.createElement('a'), {
                href: url, download: `${fileName}.backup.json`,
            });
            a.click();
            URL.revokeObjectURL(url);
            AuthService.notify('📥 File exported', 'success');
        } catch (err) {
            console.error('❌ Export error:', err);
            AuthService.notify('Export failed', 'error');
        }
    }

    /** Create a Firestore-safe document ID from a file name */
    static _toDocId(fileName) {
        return fileName
            .replace(/\.[^.]+$/, '')           // strip extension
            .replace(/[^a-zA-Z0-9_-]/g, '_')  // replace unsafe chars
            .substring(0, 100)                 // cap length
            || 'untitled';
    }

    /** Fast 32-bit hash for change detection */
    static _hash(str) {
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = Math.imul(31, h) + str.charCodeAt(i) | 0;
        }
        return Math.abs(h).toString(16);
    }
}

// ============================================================
// 6. COLLABORATION SERVICE
// ============================================================
class CollaborationService {

    /** Active Firestore listeners — stored so we can unsubscribe cleanly */
    static _listeners = {};

    /**
     * Watch a file document for real-time updates.
     * Returns the unsubscribe function.
     * FIX: stores unsubscribe and de-dupes per docId.
     */
    static watchFile(userId, docId, callback) {
        this.unwatchFile(docId);   // clean up existing listener first

        const unsubscribe = db.collection('users')
            .doc(userId)
            .collection('projects')
            .doc(docId)
            .onSnapshot(
                (doc) => { if (doc.exists) callback(doc.data()); },
                (err)  => { console.error('❌ Real-time watch error:', err); }
            );

        this._listeners[docId] = unsubscribe;
        return unsubscribe;
    }

    /** Stop watching a single document */
    static unwatchFile(docId) {
        if (this._listeners[docId]) {
            this._listeners[docId]();          // call unsubscribe
            delete this._listeners[docId];
        }
    }

    /** Stop all active listeners (call on sign-out or component unmount) */
    static unwatchAll() {
        Object.values(this._listeners).forEach(fn => fn());
        this._listeners = {};
        console.log('🔇 All Firestore listeners removed');
    }

    /**
     * Mark a file as shared and copy the shareable URL to clipboard.
     * FIX: was truncated mid-statement in v3.0.
     */
    static async createShareableLink(docId, fileName) {
        const user = auth.currentUser;
        if (!user) { AuthService.notify('Sign in to share', 'error'); return null; }

        try {
            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .update({
                    shared:    true,
                    sharedAt:  firebase.firestore.FieldValue.serverTimestamp(),
                    sharedBy:  user.uid,
                    sharedName: fileName,
                });

            const link = `${window.location.origin}/share/${user.uid}/${docId}`;

            // Copy to clipboard if supported
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(link);
                AuthService.notify('🔗 Share link copied to clipboard!', 'success');
            } else {
                // Graceful fallback
                window.prompt('Copy this share link:', link);
            }

            return link;

        } catch (err) {
            console.error('❌ Share error:', err);
            AuthService.notify('Failed to create share link', 'error');
            return null;
        }
    }

    /**
     * Retrieve a shared file (for a public /share/:uid/:docId route).
     * Throws if the file doesn't exist or isn't marked shared.
     */
    static async getSharedFile(ownerUid, docId) {
        try {
            const doc = await db.collection('users')
                .doc(ownerUid)
                .collection('projects')
                .doc(docId)
                .get();

            if (!doc.exists || !doc.data().shared) {
                throw new Error('File not found or not shared');
            }
            return doc.data();
        } catch (err) {
            console.error('❌ getSharedFile error:', err);
            throw err;
        }
    }

    /** Revoke sharing for a file */
    static async revokeShare(docId) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            await db.collection('users')
                .doc(user.uid)
                .collection('projects')
                .doc(docId)
                .update({ shared: false });

            AuthService.notify('🔒 Share link revoked', 'success');
        } catch (err) {
            console.error('❌ Revoke share error:', err);
            AuthService.notify('Failed to revoke share', 'error');
        }
    }
}

// ============================================================
// 7. FIRESTORE OFFLINE SUPPORT
// ============================================================
/**
 * Enable persistence so the app works offline and syncs when reconnected.
 * Must be called before any Firestore reads/writes.
 */
(async () => {
    try {
        await db.enablePersistence({ synchronizeTabs: true });
        console.log('✅ Firestore offline persistence enabled');
    } catch (err) {
        if (err.code === 'failed-precondition') {
            // Multiple tabs open — persistence only works in one tab at a time
            console.warn('⚠️ Firestore persistence unavailable (multiple tabs)');
        } else if (err.code === 'unimplemented') {
            // Browser doesn't support it
            console.warn('⚠️ Firestore persistence not supported in this browser');
        }
    }
})();

// ============================================================
// 8. GLOBAL EXPORTS
// ============================================================
window.AuthService          = AuthService;
window.FileService          = FileService;
window.CollaborationService = CollaborationService;

console.log('✅ Nexus Firebase Engine v4.0 loaded');
