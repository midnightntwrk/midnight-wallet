# Phase 03: Popup UI Core

**Status:** Pending | **Priority:** High | **Date:** 2025-12-03

## Context

- Depends on: [Phase 01](./phase-01-project-setup.md), [Phase 02](./phase-02-background-service.md)
- User-facing component - 360x600px popup window
- Trust Wallet-style minimalist design

## Overview

Build React popup application with Zustand state management, MemoryRouter navigation, and shadcn/ui components. Establish design system and page structure.

## Key Insights

- MemoryRouter (not BrowserRouter) - extensions have no server
- Zustand for state (1KB, no provider wrapper)
- shadcn/ui components are copy-pasted (owned code)
- 360x600px fixed dimensions

## Requirements

**Functional:**
- Popup renders at 360x600px
- Navigation between pages (home, send, receive, settings)
- Global state accessible across pages
- Background service communication

**Non-Functional:**
- <500ms initial render
- Smooth page transitions
- Consistent theming (dark mode)

## Architecture

```
┌────────────────────────────────────────┐
│           Popup (360x600)              │
├────────────────────────────────────────┤
│  ┌──────────────────────────────────┐  │
│  │          <App />                 │  │
│  │  ┌────────────────────────────┐  │  │
│  │  │    <RouterProvider />      │  │  │
│  │  │                            │  │  │
│  │  │  ┌──────────────────────┐  │  │  │
│  │  │  │      <Layout />      │  │  │  │
│  │  │  │   ┌──────────────┐   │  │  │  │
│  │  │  │   │   Header     │   │  │  │  │
│  │  │  │   ├──────────────┤   │  │  │  │
│  │  │  │   │   <Outlet/>  │   │  │  │  │
│  │  │  │   │   (pages)    │   │  │  │  │
│  │  │  │   ├──────────────┤   │  │  │  │
│  │  │  │   │   TabNav     │   │  │  │  │
│  │  │  │   └──────────────┘   │  │  │  │
│  │  │  └──────────────────────┘  │  │  │
│  │  └────────────────────────────┘  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [Zustand Store] ←→ [Background SW]    │
└────────────────────────────────────────┘
```

**Page Flow:**
```
/unlock → /home ←→ /send
              ↕
         /receive ←→ /settings
```

## Related Files

**Create:**
- `src/popup/app.tsx` - Root component
- `src/popup/router.tsx` - MemoryRouter config
- `src/popup/pages/unlock.tsx` - Password entry
- `src/popup/pages/home.tsx` - Dashboard
- `src/popup/pages/send.tsx` - Send form
- `src/popup/pages/receive.tsx` - Address + QR
- `src/popup/pages/settings.tsx` - Preferences
- `src/popup/layouts/main-layout.tsx` - Header + nav
- `src/store/wallet-store.ts` - Zustand wallet state
- `src/store/ui-store.ts` - Zustand UI state
- `src/lib/background.ts` - Background messaging
- `src/lib/utils.ts` - cn() helper

**Create shadcn components:**
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/dialog.tsx`
- `src/components/ui/tabs.tsx`

## Implementation Steps

### 1. Setup Zustand stores
```typescript
// store/wallet-store.ts
import { create } from 'zustand';

interface WalletState {
  isUnlocked: boolean;
  activeWallet: string | null;
  balance: { shielded: bigint; unshielded: bigint; dust: bigint } | null;
  unlock: (walletId: string) => void;
  lock: () => void;
  setBalance: (balance: WalletState['balance']) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  isUnlocked: false,
  activeWallet: null,
  balance: null,
  unlock: (walletId) => set({ isUnlocked: true, activeWallet: walletId }),
  lock: () => set({ isUnlocked: false, activeWallet: null, balance: null }),
  setBalance: (balance) => set({ balance }),
}));
```

### 2. Create background messaging helper
```typescript
// lib/background.ts
export function sendMessage<T>(type: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response.data);
      }
    });
  });
}
```

### 3. Configure MemoryRouter
```typescript
// router.tsx
import { createMemoryRouter } from 'react-router-dom';

export const router = createMemoryRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/unlock" replace /> },
      { path: 'unlock', element: <UnlockPage /> },
      { path: 'home', element: <HomePage /> },
      { path: 'send', element: <SendPage /> },
      { path: 'receive', element: <ReceivePage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
```

### 4. Create main layout
```typescript
// layouts/main-layout.tsx
export function MainLayout() {
  const { isUnlocked } = useWalletStore();
  return (
    <div className="w-[360px] h-[600px] bg-background">
      <Header />
      <main className="flex-1 overflow-auto p-4">
        <Outlet />
      </main>
      {isUnlocked && <TabNav />}
    </div>
  );
}
```

### 5. Install shadcn/ui components
```bash
npx shadcn@latest init
npx shadcn@latest add button card input dialog tabs
```

### 6. Create page stubs
Each page: functional component with basic layout.

### 7. Setup theming
```css
/* globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  /* ... dark theme vars */
}
```

## Todo List

- [ ] Create wallet-store.ts (Zustand)
- [ ] Create ui-store.ts (Zustand)
- [ ] Create background.ts (messaging helper)
- [ ] Create router.tsx (MemoryRouter)
- [ ] Create main-layout.tsx
- [ ] Install shadcn/ui components (button, card, input, dialog, tabs)
- [ ] Create unlock page stub
- [ ] Create home page stub
- [ ] Create send page stub
- [ ] Create receive page stub
- [ ] Create settings page stub
- [ ] Setup dark theme CSS variables
- [ ] Wire up app.tsx entry

## Success Criteria

- [ ] Popup renders at 360x600px
- [ ] Navigation works between pages
- [ ] Zustand state persists across navigation
- [ ] Background messages send/receive
- [ ] shadcn/ui components render correctly
- [ ] Dark theme applied

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Router state loss on popup close | Medium | Persist last route to storage |
| Zustand persist conflicts | Low | Use unique storage keys |
| shadcn/ui version mismatch | Low | Pin component versions |

## Security Considerations

- Never store sensitive data in UI state
- Validate all data from background
- Clear state on lock

## Next Steps

After completion, proceed to [Phase 04: Wallet Management](./phase-04-wallet-management.md).
