# Midnight Extension Wallet - Tech Stack

**Date:** 2025-12-03
**Status:** Approved

---

## Summary

| Layer | Technology | Size (gzipped) |
|-------|------------|----------------|
| **Platform** | Chrome Extension Manifest V3 | - |
| **Build** | Vite 5.x | - |
| **Framework** | React 18 + TypeScript 5.x | 45KB |
| **Routing** | React Router 6 (MemoryRouter) | 12KB |
| **State** | Zustand 4.x | 1KB |
| **UI Components** | shadcn/ui (Radix primitives) | 15-20KB |
| **Styling** | Tailwind CSS 4.0 | 8-20KB |
| **Animation** | CSS transitions + Tailwind | 0KB |
| **SDK** | @midnight-ntwrk/wallet-sdk | TBD |
| **Total (est.)** | - | ~105KB + SDK |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│           Chrome Extension (Manifest V3)             │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  Background Service Worker                     │ │
│  │  - Encrypted key storage (IndexedDB + AES-GCM)│ │
│  │  - Session management                          │ │
│  │  - Transaction signing                         │ │
│  │  - Message routing                             │ │
│  └────────────────────────────────────────────────┘ │
│              ↑               ↑                       │
│       [runtime.sendMessage]  [storage.onChanged]    │
│              ↑               ↑                       │
│  ┌────────────────────────────────────────────────┐ │
│  │  Popup UI (React + TypeScript)                 │ │
│  │  - 360x600px viewport                          │ │
│  │  - Zustand state management                    │ │
│  │  - shadcn/ui components                        │ │
│  │  - Tailwind CSS styling                        │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  Content Script (dApp injection)               │ │
│  │  - Injects window.midnight provider            │ │
│  │  - Bridges dApp ↔ Background Worker            │ │
│  │  - Origin validation                           │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
└─────────────────────────────────────────────────────┘
```

---

## Key Decisions

### 1. Build: Vite (not Webpack)
- 3-5x faster builds
- Zero-config extension bundling
- Native ES modules support

### 2. Routing: MemoryRouter (not HashRouter)
- Clean in-memory routing
- No URL hash pollution
- Works perfectly with popup

### 3. State: Zustand (not Redux/Context)
- 1KB bundle (vs 6KB Redux)
- Fine-grained reactivity
- No Provider boilerplate
- Built-in persist middleware

### 4. UI: shadcn/ui (not MUI/Chakra)
- 15-20KB (vs 80-120KB)
- Full code ownership
- Tree-shakeable
- Clean minimalist style

### 5. Security: AES-GCM + IndexedDB
- Never store plaintext keys
- Scrypt KDF for password
- In-memory only after unlock
- Sign-only operations

---

## Directory Structure

```
packages/extension/
├── src/
│   ├── background/           # Service worker
│   │   ├── index.ts
│   │   ├── keyring.ts        # Key encryption/storage
│   │   ├── session.ts        # Lock/unlock logic
│   │   └── message-handler.ts
│   ├── content/              # Content script
│   │   ├── index.ts
│   │   ├── provider.ts       # window.midnight
│   │   └── bridge.ts
│   ├── popup/                # React UI
│   │   ├── components/
│   │   ├── pages/
│   │   ├── store/
│   │   ├── lib/
│   │   └── app.tsx
│   └── shared/               # Shared types/utils
│       ├── types.ts
│       └── messages.ts
├── public/
│   ├── manifest.json
│   └── icons/
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| JS bundle | < 150KB gzipped |
| CSS | < 25KB |
| Popup load | < 500ms |
| Memory | < 50MB |

---

## Dependencies

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "zustand": "^4.4.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-dropdown-menu": "^1.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "@types/react": "^18.2.0",
    "@types/chrome": "^0.0.250",
    "tailwindcss": "^4.0.0",
    "autoprefixer": "^10.4.0"
  }
}
```

---

## References

- Research: `plans/251203-extension-wallet/research-*.md`
- SDK Docs: `docs/system-architecture.md`
- Design: `docs/design-guidelines.md` (TBD)
