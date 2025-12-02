# Phase 07: Settings & Polish

**Status:** Pending | **Priority:** Medium | **Date:** 2025-12-03

## Context

- Depends on: [Phase 06](./phase-06-dapp-integration.md)
- Final feature work before testing
- User preferences + UX refinements

## Overview

Implement settings page (network, auto-lock, security), add UI polish (animations, loading states, error handling), and ensure consistent UX across all flows.

## Key Insights

- Settings persist to chrome.storage.sync (syncs across devices)
- Network selector for testnet/mainnet switching
- Auto-lock configurable (5-60 minutes)
- Error boundaries prevent full app crashes

## Requirements

**Functional:**
- Network selector (testnet/mainnet)
- Auto-lock timeout configuration
- Connected dApps management
- Lock wallet button
- About/version info
- Export seed phrase (with re-auth)

**Non-Functional:**
- Smooth transitions (200-300ms)
- Loading states for async operations
- Clear error messages
- Consistent spacing/typography

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                    Settings Page Structure                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  General Section                                          │  │
│  │  ├── Network Selector (dropdown)                          │  │
│  │  │   ├── Mainnet                                          │  │
│  │  │   └── Testnet                                          │  │
│  │  ├── Auto-lock Timeout (select)                           │  │
│  │  │   ├── 5 minutes                                        │  │
│  │  │   ├── 15 minutes (default)                             │  │
│  │  │   ├── 30 minutes                                       │  │
│  │  │   └── 60 minutes                                       │  │
│  │  └── Currency Display (select)                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Security Section                                         │  │
│  │  ├── Export Seed Phrase (button → re-auth modal)         │  │
│  │  ├── Change Password (button → modal)                    │  │
│  │  └── Connected dApps (list → revoke button)             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Actions Section                                          │  │
│  │  ├── Lock Wallet (button)                                │  │
│  │  └── Remove Wallet (button → confirm modal)              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  About Section                                            │  │
│  │  ├── Version: 0.1.0                                       │  │
│  │  ├── Support link                                         │  │
│  │  └── Privacy policy link                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Related Files

**Create:**
- `src/popup/pages/settings.tsx` - Main settings page
- `src/popup/pages/settings/connected-dapps.tsx` - dApp list
- `src/popup/pages/settings/export-seed.tsx` - Seed export
- `src/popup/pages/settings/change-password.tsx` - Password change
- `src/popup/components/settings-section.tsx` - Section wrapper
- `src/popup/components/network-selector.tsx` - Network dropdown
- `src/popup/components/loading-spinner.tsx` - Loading indicator
- `src/popup/components/error-boundary.tsx` - Error handling
- `src/popup/components/toast.tsx` - Notifications
- `src/store/settings-store.ts` - Settings state

**Modify:**
- `src/background/message-router.ts` - Settings handlers
- `src/popup/layouts/main-layout.tsx` - Add toast provider
- `src/popup/router.tsx` - Add settings routes

## Implementation Steps

### 1. Create settings store
```typescript
// store/settings-store.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  network: 'mainnet' | 'testnet';
  autoLockMinutes: number;
  currency: 'USD' | 'EUR';
  setNetwork: (network: 'mainnet' | 'testnet') => void;
  setAutoLock: (minutes: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      network: 'mainnet',
      autoLockMinutes: 15,
      currency: 'USD',
      setNetwork: (network) => set({ network }),
      setAutoLock: (autoLockMinutes) => set({ autoLockMinutes }),
    }),
    { name: 'midnight-settings' }
  )
);
```

### 2. Create settings page
```typescript
// pages/settings.tsx
export function SettingsPage() {
  const { network, autoLockMinutes, setNetwork, setAutoLock } = useSettingsStore();

  return (
    <div className="space-y-6">
      <SettingsSection title="General">
        <NetworkSelector value={network} onChange={setNetwork} />
        <AutoLockSelect value={autoLockMinutes} onChange={setAutoLock} />
      </SettingsSection>

      <SettingsSection title="Security">
        <Button variant="outline" onClick={() => navigate('/settings/export-seed')}>
          Export Seed Phrase
        </Button>
        <Button variant="outline" onClick={() => navigate('/settings/connected-dapps')}>
          Connected dApps
        </Button>
      </SettingsSection>

      <SettingsSection title="Actions">
        <Button variant="destructive" onClick={lockWallet}>Lock Wallet</Button>
      </SettingsSection>
    </div>
  );
}
```

### 3. Create network selector
```typescript
// components/network-selector.tsx
const networks = [
  { id: 'mainnet', name: 'Mainnet', url: 'https://indexer.midnight.network' },
  { id: 'testnet', name: 'Testnet', url: 'https://testnet.midnight.network' },
];

export function NetworkSelector({ value, onChange }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">{networks.find(n => n.id === value)?.name}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {networks.map(n => (
          <DropdownMenuItem key={n.id} onClick={() => onChange(n.id)}>
            {n.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### 4. Create error boundary
```typescript
// components/error-boundary.tsx
export class ErrorBoundary extends React.Component<Props, State> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center">
          <h2>Something went wrong</h2>
          <Button onClick={() => this.setState({ hasError: false })}>Try Again</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 5. Create loading spinner
```typescript
// components/loading-spinner.tsx
export function LoadingSpinner({ size = 'md' }) {
  const sizes = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' };
  return (
    <div className={cn('animate-spin rounded-full border-2 border-primary border-t-transparent', sizes[size])} />
  );
}
```

### 6. Add page transitions
```css
/* globals.css */
.page-enter {
  opacity: 0;
  transform: translateX(10px);
}
.page-enter-active {
  opacity: 1;
  transform: translateX(0);
  transition: opacity 200ms, transform 200ms;
}
```

### 7. Create connected dApps page
```typescript
// pages/settings/connected-dapps.tsx
export function ConnectedDappsPage() {
  const [dapps, setDapps] = useState([]);

  useEffect(() => {
    sendMessage('GET_CONNECTED_DAPPS').then(setDapps);
  }, []);

  async function revoke(origin: string) {
    await sendMessage('REVOKE_DAPP', { origin });
    setDapps(dapps.filter(d => d.origin !== origin));
  }

  return (
    <div>
      {dapps.map(dapp => (
        <div key={dapp.origin} className="flex justify-between items-center">
          <span>{new URL(dapp.origin).hostname}</span>
          <Button size="sm" variant="ghost" onClick={() => revoke(dapp.origin)}>
            Revoke
          </Button>
        </div>
      ))}
    </div>
  );
}
```

## Todo List

- [ ] Create settings-store.ts (Zustand persist)
- [ ] Create settings.tsx main page
- [ ] Create network-selector.tsx
- [ ] Create settings-section.tsx wrapper
- [ ] Create loading-spinner.tsx
- [ ] Create error-boundary.tsx
- [ ] Create toast notifications (shadcn toast)
- [ ] Create connected-dapps.tsx page
- [ ] Create export-seed.tsx page
- [ ] Create change-password.tsx page
- [ ] Add page transition animations
- [ ] Add loading states to async buttons
- [ ] Add error handling to all API calls
- [ ] Polish responsive typography
- [ ] Test settings persistence

## Success Criteria

- [ ] Network switch changes indexer URL
- [ ] Auto-lock timer respects setting
- [ ] Connected dApps can be revoked
- [ ] Seed export requires password
- [ ] Loading spinners show during async ops
- [ ] Errors display user-friendly messages
- [ ] Settings persist across sessions

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Settings sync quota exceeded | Low | Use chrome.storage.local fallback |
| Network switch mid-transaction | Medium | Complete pending ops before switch |
| Password change corrupts seed | High | Re-encrypt with new password atomically |

## Security Considerations

- Seed export requires recent unlock
- Confirm before dangerous actions (remove wallet)
- Don't store password in settings
- Revoke dApp removes all permissions

## Next Steps

After completion, proceed to [Phase 08: Testing & Release](./phase-08-testing-release.md).
