/**
 * NEXUS AI — Utilities v5.0
 * Single source of truth for shared helpers.
 * No DOM access here — pure functions only.
 */
'use strict';

// ─── Device / capability detection ───────────────────────────────────────────

/** True on any touch-primary device (phones + tablets) */
export const isMobile = () =>
  window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768;

/** True when the user prefers reduced motion */
export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True on low-end devices (hardware concurrency ≤ 4 or device memory ≤ 4 GB) */
export const isLowEnd = () => {
  const cores  = navigator.hardwareConcurrency ?? 4;
  const memory = navigator.deviceMemory ?? 4;   // GB, Chrome only
  return cores <= 4 || memory <= 4;
};

// ─── Function utilities ───────────────────────────────────────────────────────

/**
 * Debounce — delays execution until `ms` ms after last call.
 * Returns a cancel() method.
 */
export function debounce(fn, ms = 150) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/**
 * Throttle — fires at most once per `ms` ms.
 */
export function throttle(fn, ms = 100) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

// ─── Security ─────────────────────────────────────────────────────────────────

/**
 * Escape user/AI text for safe HTML injection.
 * Use before ANY innerHTML that includes external data.
 */
export function sanitizeHTML(str) {
  const el = document.createElement('div');
  el.textContent = String(str ?? '');
  return el.innerHTML;
}

// ─── Language helpers ─────────────────────────────────────────────────────────

const LANG_MAP = {
  js:   'javascript', ts:   'typescript', html: 'html',
  css:  'css',        py:   'python',     cpp:  'cpp',
  c:    'c',          java: 'java',       json: 'json',
  md:   'markdown',   jsx:  'javascript', tsx:  'typescript',
  sh:   'shell',      sql:  'sql',        rs:   'rust',
  go:   'go',         php:  'php',        rb:   'ruby',
};

const ICON_MAP = {
  javascript: 'js',  typescript: 'ts',  html: 'html',
  css:        'css',  python:    'py',   cpp:  'cpp',
  java:       'java', json:      'json', markdown: 'md',
  rust:       'rs',  go:        'go',   shell:    'sh',
};

/** Detect Monaco language from file extension */
export function detectLanguage(fileName = '') {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return LANG_MAP[ext] || 'plaintext';
}

/** Map language ID → icon CSS suffix */
export function getLanguageIcon(lang) {
  return ICON_MAP[lang] || 'file';
}

// ─── DOM utilities ─────────────────────────────────────────────────────────────

/** Create a DOM element with optional attributes and children */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class')   node.className = v;
    else if (k === 'on') Object.entries(v).forEach(([e, h]) => node.addEventListener(e, h));
    else                 node.setAttribute(k, v);
  }
  children.forEach(c => {
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else if (c instanceof Node) node.appendChild(c);
  });
  return node;
}

/** Safely query a selector, returning null without throwing */
export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

// ─── Timing helpers ───────────────────────────────────────────────────────────

/** Promisified setTimeout */
export const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** requestAnimationFrame wrapper */
export const raf = (fn) => requestAnimationFrame(fn);

// ─── Storage size ─────────────────────────────────────────────────────────────

/** Accurate localStorage size using Blob */
export function localStorageUsedBytes() {
  try {
    const allData = Object.values(localStorage).join('');
    return new Blob([allData]).size;
  } catch { return 0; }
}

// ─── String utilities ─────────────────────────────────────────────────────────

/** Format bytes to human-readable string */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Generate a short unique ID */
export const uid = () => Math.random().toString(36).slice(2, 9);

/** Clamp a value between min and max */
export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
