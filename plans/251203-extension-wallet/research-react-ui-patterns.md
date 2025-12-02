# React Extension UI Patterns Research
**Date:** 2025-12-03 | **Status:** Completed

## Executive Summary

For a Chrome extension wallet with React + TypeScript (360x600px popup, Trust Wallet style), adopt **Vite + React Router (MemoryRouter) + Zustand + shadcn/ui + Tailwind** stack. Rationale: minimal bundle (~85-120KB gzipped), clean minimalist design, zero provider boilerplate, fine-grained reactivity without performance penalties.

---

## 1. Build Tool: Vite vs Webpack

### Verdict: **Vite** ✅

**Why Vite:**
- Near-instant HMR (hot module replacement)
- Zero-config extension bundling with `base: './'`
- 3-5x faster builds than Webpack
- Native ES modules support
- Simpler configuration for extensions

**Why NOT Webpack:**
- Extension-specific path resolution complexity
- Steeper configuration learning curve
- Build optimization overhead

**Setup Pattern:**
```javascript
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'ES2020',
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: { entryFileNames: '[name].js' }
    }
  }
});
```

**Boilerplate References:**
- [vite-web-extension](https://github.com/JohnBra/vite-web-extension) - Minimal, production-ready
- [chrome-extension-boilerplate-react-vite](https://github.com/Jonghakseo/chrome-extension-boilerplate-react-vite) - Feature-rich with Turborepo

---

## 2. Routing: React Router MemoryRouter vs Custom

### Verdict: **React Router (MemoryRouter)** for 360x600px popup ✅

**Why MemoryRouter:**
- BrowserRouter breaks extensions (expects server-side routing)
- HashRouter works but adds `#/route` complexity
- MemoryRouter = clean in-memory routing, no hash pollution
- Works perfectly with 360x600px single-page layout

**Why NOT Custom:**
- Reinventing state machine = unnecessary DRY violation
- React Router ecosystem mature & battle-tested in extensions

**Implementation Pattern:**
```typescript
// src/router.tsx
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

const router = createMemoryRouter([
  { path: '/', element: <Home /> },
  { path: '/send', element: <Send /> },
  { path: '/receive', element: <Receive /> },
  { path: '/settings', element: <Settings /> }
]);

export function App() {
  return <RouterProvider router={router} />;
}
```

**Lightweight Alternative (if needed):**
- `react-chrome-extension-router` - Stack-based, 2KB gzipped (overkill for 4-screen wallet)

---

## 3. State Management: Zustand >> Context >> Redux

### Verdict: **Zustand** for extension ✅

| Feature | Zustand | Redux | Context |
|---------|---------|-------|---------|
| Bundle | ~1KB | ~6KB (RTK) | 0KB (built-in) |
| Re-render granularity | Fine-grained | Requires reselect | All consumers |
| Boilerplate | Minimal | Medium (RTK helps) | None |
| Performance | Fast | Good | Poor with frequent updates |
| Extension fit | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ |

**Why Zustand:**
- No Provider wrapper needed (single hook injection)
- Only re-renders components using subscribed state slices
- Persist plugin for chrome.storage integration
- Perfect wallet balance/transaction patterns

**Pattern:**
```typescript
// src/store/wallet.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useWallet = create(
  persist(
    (set) => ({
      balance: 0,
      transactions: [],
      addTx: (tx) => set((s) => ({
        transactions: [...s.transactions, tx]
      })),
    }),
    { name: 'wallet-storage' }
  )
);

// In component: const { balance } = useWallet();
```

---

## 4. Component Library: shadcn/ui + Radix Primitives

### Verdict: **shadcn/ui for Trust Wallet minimalism** ✅

| Library | Bundle | Control | Styling | Extension fit |
|---------|--------|---------|---------|---------------|
| shadcn/ui | ~15-20KB | Full | Tailwind | ⭐⭐⭐⭐⭐ |
| Radix UI | ~40-60KB | Headless | Custom | ⭐⭐⭐ |
| Material UI | ~120KB+ | Limited | MUI system | ⭐ |
| Chakra | ~80KB+ | Medium | CSS-in-JS | ⭐⭐ |

**Why shadcn/ui:**
- Copy-paste components = no hidden dependencies
- Tree-shakeable individually
- Radix accessibility + Tailwind utility flexibility
- Perfect for Trust Wallet-style minimalism
- Only includes components you use

**Radix Maintenance Note:**
⚠️ Radix UI maintenance status unclear (2025). shadcn/ui copied components are stable & owned by you.

**Essential Components for Wallet:**
```
- Button (with variants: primary, outline, ghost)
- Card (balance display, transaction items)
- Input (address, amount inputs)
- Dialog (confirm transfers)
- Dropdown Menu (network selection)
- Tabs (Swap, Send, Receive)
- Toast (notifications)
```

---

## 5. Styling: Tailwind CSS + PurgeCSS

### Verdict: **Tailwind CSS 4.0** ✅

**Why Tailwind for Extensions:**
- Native purging (5x faster v3→v4): ~30KB → ~8KB CSS
- Tree-shaking works perfectly with shadcn/ui
- No runtime overhead (pure CSS generation)
- Minimal bundle impact in extension context

**Tailwind 4.0 Bundle Impact:**
```
Base Tailwind: ~8KB (with aggressive purging)
  + shadcn/ui (10 components): ~12KB
  + Custom fonts: ~0KB (system fonts for wallet)
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total CSS: ~20KB (already in manifest.json injection)
```

**Configuration:**
```javascript
// tailwind.config.ts
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#000', // Trust Wallet dark
        surface: '#fff'
      }
    }
  }
};
```

**Critical for Extensions:**
- Use CSS injection via manifest (not inline)
- Avoid @import chains (serial load blocking)
- Prefer CSS variable theming over Tailwind plugins

---

## 6. Animations: useAnimate Mini + CSS Transitions

### Verdict: **No heavy animation library needed** ✅

**Bundle Size Comparison:**
```
useAnimate (mini):    2.3KB  ✅
Framer Motion (m):    4.6KB  ✅
Framer Motion (full): 34KB   ❌
React Spring:         8KB    ⚠️
GSAP:                 69KB   ❌
AutoAnimate:          7KB    ✅
```

**Recommended: CSS Transitions + Tailwind**
```typescript
// For fade/slide: use Tailwind + CSS transitions
<motion className="transition-opacity duration-200">

// For hardware-accelerated: optional useAnimate mini
import { useAnimate } from 'framer-motion/mini';
const [scope, animate] = useAnimate();
animate(scope.current, { x: 100 }, { duration: 0.3 });
```

**Why NO Framer Motion full:**
- 34KB base is 28% of entire extension budget
- CSS transitions sufficient for wallet UX
- Wallet needs 3 animation types max (fade, slide, pulse)

---

## 7. Recommended Stack Summary

### Core Dependencies (Bundle: ~85-120KB gzipped)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0",
    "zustand": "^4.4.0",
    "radix-ui/react-*": "^1.0.0",
    "clsx": "^2.0.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^4.0.0",
    "autoprefixer": "^10.4.0"
  }
}
```

### Bundle Breakdown (Gzipped):
```
React + ReactDOM:      45KB  (largest)
React Router:          12KB
Radix UI (5 components): 15KB
Zustand:                1KB
Tailwind + purged CSS: ~20KB
App code:             ~12KB
━━━━━━━━━━━━━━━━━━━━━━━━━
Total:               ~105KB
```

---

## 8. Code Organization (< 200 lines per file)

```
src/
├── components/
│   ├── wallet-card.tsx         (balance display)
│   ├── transaction-list.tsx    (scrollable list)
│   ├── address-input.tsx       (address + copy)
│   └── network-selector.tsx    (dropdown)
├── pages/
│   ├── home.tsx               (dashboard)
│   ├── send.tsx               (transfer form)
│   ├── receive.tsx            (QR + address)
│   └── settings.tsx           (preferences)
├── store/
│   ├── wallet.ts              (Zustand: balance, txs)
│   ├── ui.ts                  (Zustand: modal state)
│   └── hooks.ts               (useWallet, useUI)
├── lib/
│   ├── midnight.ts            (SDK integration)
│   ├── format.ts              (address formatting)
│   └── theme.ts               (Tailwind extend)
└── app.tsx                    (Router entry)
```

---

## 9. Performance Checklist

- [ ] Bundle analysis: `npm run build && npm run analyze`
- [ ] Tree-shaking: Verify unused code removed (Vite inspector)
- [ ] CSS purging: shadcn/ui components only (no global bloat)
- [ ] React DevTools Profiler: No >50ms renders
- [ ] Chrome DevTools Network: JS < 120KB gzipped
- [ ] Popup load: < 500ms (including Midnight SDK)
- [ ] Memory: < 50MB resident popup context

---

## 10. Testing & Validation

```bash
# Build & analyze
vite build --mode analyze

# Extension load time
chrome://extensions → Inspect popup → Network/Performance

# Bundle visualization
npm run build && npx vite-plugin-visualizer

# Performance budget
npm run build && du -h dist/popup.js
```

---

## Key Decisions Rationale

| Decision | Why | Alternatives Considered |
|----------|-----|------------------------|
| Vite | 3-5x faster, zero config | Webpack (complex), esbuild (no HMR) |
| MemoryRouter | Clean in-memory, no hash | HashRouter (ugly), custom (DRY violation) |
| Zustand | 1KB + no boilerplate | Redux (6KB + ceremony), Context (re-render hell) |
| shadcn/ui | Tree-shakeable + owned code | Radix (40KB), Chakra (80KB), MUI (120KB) |
| Tailwind 4.0 | Native purging + shadcn match | CSS Modules (no utility), Styled Components (runtime) |
| CSS animations | Sufficient for wallet | Framer Motion (28% of bundle) |

---

## Unresolved Questions

1. **Midnight SDK size:** How much does midnight SDK add gzipped? (impacts total budget)
2. **Chrome storage limits:** Need to verify chrome.storage.sync size limits for transaction history
3. **Network switching:** Will Zustand persist handle multi-chain state cleanly?
4. **Service Worker:** Does manifest v3 service worker communication affect state sync?

---

## References

- [Vite Web Extension Boilerplate](https://github.com/JohnBra/vite-web-extension)
- [React Router v6 MemoryRouter](https://reactrouter.com/en/main/routers/memory-router)
- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [shadcn/ui Component Library](https://ui.shadcn.com/)
- [Tailwind CSS 4.0 Optimization](https://tailwindcss.com/docs/optimizing-for-production)
- [Framer Motion Bundle Reduction](https://motion.dev/docs/react-reduce-bundle-size)
- [Chrome Extension Development Guide 2025](https://www.diego-rodriguez.work/blog/chrome-extension-development-guide)
