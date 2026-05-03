/**
 * NEXUS AI — Storage Engine v5.0
 * IndexedDB-backed file storage with localStorage fallback.
 *
 * WHY IndexedDB:
 *   localStorage is synchronous, limited to ~5 MB, and blocks the main thread.
 *   IndexedDB is async, supports up to hundreds of MB, and is safe for large code files.
 */
'use strict';

import { sanitizeHTML } from './utils.js';

const DB_NAME    = 'nexus-ai-db';
const DB_VERSION = 1;
const STORE_FILES = 'files';
const STORE_META  = 'meta';

// ─── Database singleton ────────────────────────────────────────────────────────

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // Files store: keyed by file name
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        const store = db.createObjectStore(STORE_FILES, { keyPath: 'name' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('language',  'language',  { unique: false });
      }

      // Meta store: arbitrary key-value pairs (settings, AI history, etc.)
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Low-level helper for a single IDB transaction */
function idbTx(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req   = fn(store);
    tx.oncomplete = () => resolve(req?.result ?? undefined);
    tx.onerror    = () => reject(tx.error);
    if (req) req.onerror = () => reject(req.error);
  }));
}

// ─── Public File API ───────────────────────────────────────────────────────────

export const Storage = {

  /** Save or update a file record */
  async saveFile({ name, code, language, folder = '' }) {
    if (!name) throw new Error('File name is required');

    const record = {
      name,
      code:      code ?? '',
      language:  language ?? 'plaintext',
      folder,
      size:      new Blob([code]).size,
      timestamp: Date.now(),
    };

    try {
      await idbTx(STORE_FILES, 'readwrite', s => s.put(record));
    } catch (err) {
      // Fallback: localStorage
      console.warn('IDB unavailable, using localStorage:', err);
      localStorage.setItem(
        `nexus_file_${name}`,
        JSON.stringify({ ...record, timestamp: new Date(record.timestamp).toISOString() })
      );
    }

    return record;
  },

  /** Load a single file by name */
  async getFile(name) {
    try {
      return await idbTx(STORE_FILES, 'readonly', s => s.get(name));
    } catch {
      // Fallback
      const raw = localStorage.getItem(`nexus_file_${name}`);
      return raw ? JSON.parse(raw) : null;
    }
  },

  /** Load all files, sorted newest first */
  async getAllFiles() {
    try {
      const files = await idbTx(STORE_FILES, 'readonly', s => s.getAll());
      return (files ?? []).sort((a, b) => b.timestamp - a.timestamp);
    } catch {
      // Fallback: localStorage
      return Object.keys(localStorage)
        .filter(k => k.startsWith('nexus_file_'))
        .map(k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
  },

  /** Delete a file by name */
  async deleteFile(name) {
    try {
      await idbTx(STORE_FILES, 'readwrite', s => s.delete(name));
    } catch {
      localStorage.removeItem(`nexus_file_${name}`);
    }
  },

  /** Rename a file (copy + delete) */
  async renameFile(oldName, newName) {
    const file = await this.getFile(oldName);
    if (!file) throw new Error(`File "${oldName}" not found`);
    await this.saveFile({ ...file, name: newName });
    await this.deleteFile(oldName);
  },

  /** Duplicate a file */
  async duplicateFile(name, newName) {
    const file = await this.getFile(name);
    if (!file) throw new Error(`File "${name}" not found`);
    return this.saveFile({ ...file, name: newName, timestamp: Date.now() });
  },

  // ─── Meta store (settings, AI history) ─────────────────────────────────────

  async getMeta(key, defaultVal = null) {
    try {
      const record = await idbTx(STORE_META, 'readonly', s => s.get(key));
      return record ? record.value : defaultVal;
    } catch {
      const raw = localStorage.getItem(`nexus_meta_${key}`);
      return raw !== null ? JSON.parse(raw) : defaultVal;
    }
  },

  async setMeta(key, value) {
    try {
      await idbTx(STORE_META, 'readwrite', s => s.put({ key, value }));
    } catch {
      localStorage.setItem(`nexus_meta_${key}`, JSON.stringify(value));
    }
  },

  async deleteMeta(key) {
    try {
      await idbTx(STORE_META, 'readwrite', s => s.delete(key));
    } catch {
      localStorage.removeItem(`nexus_meta_${key}`);
    }
  },

  // ─── Storage stats ──────────────────────────────────────────────────────────

  async getStats() {
    try {
      // Use StorageManager API if available
      if ('storage' in navigator && 'estimate' in navigator.storage) {
        const { usage, quota } = await navigator.storage.estimate();
        return { used: usage ?? 0, quota: quota ?? 0 };
      }
    } catch { /* noop */ }

    // Fallback: count localStorage
    const allData = Object.values(localStorage).join('');
    return { used: new Blob([allData]).size, quota: 5 * 1024 * 1024 };
  },
};

export default Storage;
