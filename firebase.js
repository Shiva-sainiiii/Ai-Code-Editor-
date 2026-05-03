/**
 * NEXUS AI — Firebase Engine v5.0
 *
 * Changes from v4:
 * - escapeHTML removed (canonical version is in utils.js)
 * - getLanguageIcon removed (canonical version is in utils.js)
 * - Listener cleanup via _unsubListeners array
 * - loadUserFiles merged into renderFileTree via Storage adapter
 * - Auth UI uses DOM methods, not innerHTML, for XSS safety
 * - Avatar URL cached in sessionStorage to avoid re-fetching
 */
'use strict';

// ─── Firebase Init ────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyBeiIUdVEv5kvJ6GFSzWZwFav8Nx3Mxhkg',
  authDomain:        'code-editor-ai.firebaseapp.com',
  projectId:         'code-editor-ai',
  storageBucket:     'code-editor-ai.firebasestorage.app',
  messagingSenderId: '145185559673',
  appId:             '1:145185559673:web:5646addc66bb365209b0a8',
};

try {
  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
} catch (err) {
  console.error('❌ Firebase init error:', err);
}

const db       = firebase.firestore();
const auth     = firebase.auth();
const provider = new firebase.auth.GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

// ─── Listener registry (prevents memory leaks) ────────────────────────────────
const _unsubListeners = [];

function _trackListener(unsub) {
  if (typeof unsub === 'function') _unsubListeners.push(unsub);
}

/** Call this on sign-out to clean up all Firestore listeners */
function _cleanupListeners() {
  _unsubListeners.forEach(fn => { try { fn(); } catch { /* noop */ } });
  _unsubListeners.length = 0;
}

// ─── Auth State ───────────────────────────────────────────────────────────────
auth.onAuthStateChanged(async (user) => {
  if (user) {
    console.info('🔄 Session restored:', user.displayName || user.email);
    AuthService.updateUIState(user);
    await FileService.loadUserFiles();
  } else {
    AuthService.updateUIState(null);
    _cleanupListeners();
    // Fall back to local file listing
    if (typeof window.loadLocalFiles === 'function') {
      window.loadLocalFiles();
    }
  }
});

// ─── Auth Service ─────────────────────────────────────────────────────────────
class AuthService {

  static async signInWithGoogle() {
    try {
      const { user } = await auth.signInWithPopup(provider);
      console.info('✅ Signed in:', user.displayName);
      return user;
    } catch (err) {
      if (err.code === 'auth/popup-blocked') {
        window.showNotification?.('⚠️ Allow popups to sign in', 'warning');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        console.error('❌ Sign-in error:', err);
        window.showNotification?.('Sign-in failed: ' + err.message, 'error');
      }
      return null;
    }
  }

  static async signOut() {
    try {
      _cleanupListeners();
      await auth.signOut();
      window.showNotification?.('👋 Signed out', 'info');
    } catch (err) {
      console.error('❌ Sign-out error:', err);
    }
  }

  static getCurrentUser() {
    return auth.currentUser;
  }

  /** Update the login button to show the user's avatar / name */
  static updateUIState(user) {
    const btn = document.getElementById('login-btn');
    if (!btn) return;

    if (user) {
      // Cache avatar URL so we don't re-fetch on every state change
      const cachedAvatar = sessionStorage.getItem('nexus_avatar');
      const avatarUrl    = cachedAvatar || user.photoURL || '';
      if (user.photoURL && !cachedAvatar) {
        sessionStorage.setItem('nexus_avatar', user.photoURL);
      }

      btn.innerHTML = '';   // clear

      if (avatarUrl) {
        const img = document.createElement('img');
        img.src    = avatarUrl;
        img.alt    = user.displayName || 'User';
        img.title  = user.displayName || user.email;
        img.style.cssText = 'width:28px;height:28px;border-radius:50%;object-fit:cover';
        img.onerror = () => { img.replaceWith(_defaultAvatar(user)); };
        btn.appendChild(img);
      } else {
        btn.appendChild(_defaultAvatar(user));
      }

      btn.title = user.displayName || user.email;
      btn.onclick = () => AuthService.signOut();

    } else {
      sessionStorage.removeItem('nexus_avatar');
      btn.innerHTML = '<i class="far fa-user-circle" aria-hidden="true"></i>';
      btn.title     = 'Sign in with Google';
      btn.onclick   = () => AuthService.signInWithGoogle();
    }
  }
}

function _defaultAvatar(user) {
  const span = document.createElement('span');
  span.textContent  = (user.displayName || user.email || '?')[0].toUpperCase();
  span.style.cssText = `
    width:28px;height:28px;border-radius:50%;
    background:var(--accent-grad);color:white;
    font-size:13px;font-weight:600;
    display:flex;align-items:center;justify-content:center;`;
  return span;
}

// ─── File Service (Firestore) ──────────────────────────────────────────────────
class FileService {

  /** Load cloud files for the current user into the explorer */
  static async loadUserFiles() {
    const user = auth.currentUser;
    if (!user) return;

    try {
      const snapshot = await db
        .collection('users').doc(user.uid)
        .collection('files')
        .orderBy('updatedAt', 'desc')
        .get();

      const cloudFiles = snapshot.docs.map(doc => ({
        name:      doc.id,
        code:      doc.data().code    || '',
        language:  doc.data().language || 'plaintext',
        timestamp: doc.data().updatedAt?.toMillis() || Date.now(),
        cloud:     true,
      }));

      // Merge into IndexedDB storage so the rest of the app sees them uniformly
      const Storage = await _getStorage();
      for (const file of cloudFiles) {
        await Storage.saveFile(file);
      }

      // Refresh the file tree
      window.loadLocalFiles?.();
      console.info(`☁️ Loaded ${cloudFiles.length} cloud files`);

    } catch (err) {
      console.error('❌ Failed to load cloud files:', err);
      window.showNotification?.('Failed to load cloud files', 'error');
    }
  }

  /** Save a file to Firestore */
  static async saveFile(name, code, language) {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await db
        .collection('users').doc(user.uid)
        .collection('files').doc(name)
        .set({
          code,
          language,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

      console.info(`☁️ Cloud saved: ${name}`);
    } catch (err) {
      console.error('❌ Cloud save failed:', err);
      window.showNotification?.('Cloud save failed', 'error');
    }
  }

  /** Delete a file from Firestore */
  static async deleteFile(name) {
    const user = auth.currentUser;
    if (!user) return;

    try {
      await db
        .collection('users').doc(user.uid)
        .collection('files').doc(name)
        .delete();
    } catch (err) {
      console.error('❌ Cloud delete failed:', err);
    }
  }

  /** Subscribe to real-time file updates (auto-syncs on another device) */
  static subscribeToFiles(onChange) {
    const user = auth.currentUser;
    if (!user) return;

    const unsub = db
      .collection('users').doc(user.uid)
      .collection('files')
      .onSnapshot((snap) => {
        snap.docChanges().forEach(change => {
          onChange(change.type, change.doc.id, change.doc.data());
        });
      }, err => console.error('❌ File subscription error:', err));

    _trackListener(unsub);
    return unsub;
  }
}

// ─── Dynamic import of Storage (avoids circular dep at parse time) ─────────────
async function _getStorage() {
  try {
    const mod = await import('./js/storage.js');
    return mod.default;
  } catch {
    // Fallback if ES modules aren't available
    return window._Storage || { saveFile: () => {} };
  }
}

// ─── Global exports ────────────────────────────────────────────────────────────
window.AuthService = AuthService;
window.FileService = FileService;
