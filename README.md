# ⚡ Nexus AI — Pro Code Editor v5.0

AI-powered browser IDE. Upgraded from v4 with full mobile support, IndexedDB storage,
Command Palette, PWA, modular architecture, and production-grade performance.

---

## 🗂 Project Structure

```
nexus-ai/
├── index.html          ← App shell (semantic HTML5, ARIA, PWA meta)
├── style.css           ← Mobile-first stylesheet (100dvh, pointer:coarse)
├── firebase.js         ← Auth + Firestore (listener cleanup, avatar cache)
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (offline, cache-first)
├── api/
│   └── ask.js          ← Vercel serverless function (rate limiting, fallback)
└── js/
    ├── main.js         ← Boot sequence, wiring, keyboard shortcuts
    ├── editor.js       ← Monaco init, mobile config, ResizeObserver, auto-save
    ├── files.js        ← File manager, tab system, drag & drop, diff rendering
    ├── ai.js           ← AI assistant, voice input, context attach, history
    ├── ui.js           ← Command Palette, toasts, theme, panel resize, mobile nav
    ├── storage.js      ← IndexedDB layer (localStorage fallback)
    └── utils.js        ← Debounce, throttle, sanitizeHTML, device detection
```

---

## 🚀 What Changed (v4 → v5)

### Architecture
| Before | After |
|--------|-------|
| Single `script.js` (1100+ lines) | 7 focused ES modules |
| `localStorage` for all storage | **IndexedDB** (Storage API) with localStorage fallback |
| Global variables everywhere | Module-scoped state, explicit exports |
| Duplicate helpers in firebase.js + script.js | Single source of truth in `utils.js` |
| `innerHTML` with user data | `textContent` / `sanitizeHTML()` everywhere |

### Performance
| Issue | Fix |
|-------|-----|
| Monaco `automaticLayout:true` polls every 100ms | **ResizeObserver** — fires only on actual size changes |
| `editor.setValue()` on tab switch destroys undo | **Per-file ITextModel** cache — undo history preserved |
| Status bar updated on every keystroke | Batched via single `requestAnimationFrame` |
| Particles running on mobile | Removed on `(pointer:coarse)` and reduced-motion |
| backdrop-filter on every panel on mobile | Stripped on `@media (max-width:768px)` |
| Resize handler fires on every mousemove | **Pointer capture** + rAF throttle |

### Mobile Responsiveness
| Issue | Fix |
|-------|-----|
| `height:100vh` blank space on mobile | `height:100dvh` (dynamic viewport) |
| Keyboard pushes Monaco off-screen | **VisualViewport API** adjusts padding |
| `display:none` loses Monaco container | `visibility:hidden` + `opacity:0` keeps layout |
| No touch targets (< 36px) | All interactive elements ≥ 40px on `pointer:coarse` |
| Particles JS on mobile | Auto-disabled |
| Blur effects on mobile | Stripped with `backdrop-filter:none` in media query |
| `switchMobileTab` with display:none | CSS opacity/visibility (GPU composited) |

### New Features
- ✅ **Command Palette** (`Ctrl+Shift+P`) — fuzzy search, keyboard navigation
- ✅ **IndexedDB storage** — no more 5 MB localStorage cap
- ✅ **PWA** — installable, offline-capable via Service Worker
- ✅ **Auto-save** — 2 s debounce after last keystroke
- ✅ **Per-file Monaco models** — tab switching retains undo history
- ✅ **Drag & drop file import** — drop files from OS onto editor
- ✅ **Voice input** — Web Speech API for AI prompts
- ✅ **File size display** in explorer
- ✅ **Context attach** — attach current file or selection to AI prompt
- ✅ **Resizable bottom panel** — pointer-capture drag handle
- ✅ **Model fallback chain** — Claude → GPT-4o-mini → Mistral
- ✅ **Rate limiting** in serverless function
- ✅ **Service Worker** — cache-first for assets, network-first for API
- ✅ **Explorer search** — live filter by filename or content
- ✅ **Middle-click tab close**
- ✅ **ARIA labels** throughout for accessibility

---

## 🛠 Setup

### 1. Environment variables (Vercel)
```
OPENROUTER_API_KEY=your_key_here
APP_ORIGIN=https://your-domain.vercel.app
```

### 2. Deploy
```bash
vercel deploy
```

### 3. Firebase
Replace the `firebaseConfig` object in `firebase.js` with your own project credentials.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save file |
| `Ctrl+N` | New file |
| `Ctrl+Enter` | Run code |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+K` | Inline AI |
| `Escape` | Close modals/palette |

---

## 📱 Mobile UX

- Bottom navigation bar: Files · Code · AI · Run
- All panels are full-screen overlays (only active panel visible)
- Monaco minimap disabled on mobile
- Font ligatures disabled on mobile
- Smooth scrolling + momentum scroll on AI chat
- Touch targets ≥ 40px
- Keyboard-aware layout via VisualViewport API
- Safe-area padding for notch/gesture-bar devices
