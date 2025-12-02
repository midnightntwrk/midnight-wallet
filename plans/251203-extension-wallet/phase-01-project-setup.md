# Phase 01: Project Setup

**Status:** Pending | **Priority:** Critical | **Date:** 2025-12-03

## Context

- First phase - no dependencies
- Creates foundation for all subsequent phases
- Integrates with existing monorepo (Yarn workspaces + Turborepo)

## Overview

Scaffold Chrome extension package in monorepo with Vite + React + TypeScript. Configure Manifest V3, Tailwind, shadcn/ui, and build scripts.

## Key Insights

- Use Vite for fast HMR and ES module support
- Manifest V3 required for modern Chrome (service workers, no eval)
- shadcn/ui components copy-pasted (no hidden deps)
- Must work with existing Turborepo tasks

## Requirements

**Functional:**
- Extension loads in Chrome developer mode
- Hot reload during development
- Build produces valid extension bundle

**Non-Functional:**
- <120KB initial bundle (gzipped)
- <2s build time (incremental)

## Architecture

```
packages/extension/
├── src/
│   ├── popup/           # React popup app
│   │   ├── main.tsx
│   │   ├── app.tsx
│   │   └── index.html
│   ├── background/      # Service worker
│   │   └── index.ts
│   ├── content/         # Content script
│   │   └── index.ts
│   ├── components/      # Shared UI components
│   │   └── ui/          # shadcn/ui components
│   ├── lib/             # Utilities
│   └── styles/
│       └── globals.css
├── public/
│   ├── manifest.json
│   └── icons/
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.build.json
└── package.json
```

## Related Files

**Create:**
- `packages/extension/package.json`
- `packages/extension/vite.config.ts`
- `packages/extension/tailwind.config.ts`
- `packages/extension/tsconfig.json`
- `packages/extension/tsconfig.build.json`
- `packages/extension/public/manifest.json`
- `packages/extension/src/popup/main.tsx`
- `packages/extension/src/popup/app.tsx`
- `packages/extension/src/popup/index.html`
- `packages/extension/src/background/index.ts`
- `packages/extension/src/content/index.ts`
- `packages/extension/src/styles/globals.css`
- `packages/extension/components.json` (shadcn config)

**Modify:**
- Root `turbo.json` (add extension tasks)

## Implementation Steps

### 1. Create package structure
```bash
mkdir -p packages/extension/src/{popup,background,content,components/ui,lib,styles}
mkdir -p packages/extension/public/icons
```

### 2. Create package.json
```json
{
  "name": "@midnight-ntwrk/wallet-extension",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "dist": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "zustand": "^4.4.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "@midnight-ntwrk/wallet-sdk-hd": "workspace:*",
    "@midnight-ntwrk/wallet-sdk-address-format": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/chrome": "^0.0.260",
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.0.0",
    "typescript": "^5.9.3",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### 3. Create Manifest V3
```json
{
  "manifest_version": 3,
  "name": "Midnight Wallet",
  "version": "0.1.0",
  "description": "Secure wallet for Midnight Network",
  "permissions": ["storage", "activeTab"],
  "action": {
    "default_popup": "popup/index.html",
    "default_icon": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
  },
  "background": {
    "service_worker": "background/index.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content/index.js"],
    "run_at": "document_start"
  }],
  "icons": { "16": "icons/16.png", "48": "icons/48.png", "128": "icons/128.png" }
}
```

### 4. Configure Vite for multi-entry
Build popup, background, content as separate entries.

### 5. Setup Tailwind + shadcn/ui
Initialize with dark theme, install Button, Card, Input, Dialog.

### 6. Create minimal popup app
Hello World React app that renders in 360x600 popup.

### 7. Integrate with Turborepo
Add `dist` task for extension in turbo.json.

## Todo List

- [ ] Create directory structure
- [ ] Create package.json with dependencies
- [ ] Create Vite config (multi-entry)
- [ ] Create manifest.json (V3)
- [ ] Setup TypeScript configs
- [ ] Configure Tailwind CSS
- [ ] Initialize shadcn/ui
- [ ] Create popup entry point
- [ ] Create background stub
- [ ] Create content script stub
- [ ] Add Turborepo integration
- [ ] Test extension loads in Chrome

## Success Criteria

- [ ] `yarn install` succeeds
- [ ] `turbo dist --filter=extension` builds
- [ ] Extension loads in chrome://extensions
- [ ] Popup renders "Midnight Wallet"
- [ ] No console errors

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Vite multi-entry complexity | Medium | Use proven boilerplate patterns |
| SDK workspace linking | Low | Test imports early |
| Chrome API types | Low | @types/chrome covers most |

## Security Considerations

- Manifest V3 enforces strict CSP (no eval)
- Service worker has limited APIs
- Content scripts isolated by default

## Next Steps

After completion, proceed to [Phase 02: Background Service](./phase-02-background-service.md).
