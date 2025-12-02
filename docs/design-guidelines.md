# Midnight Wallet - Design Guidelines

**Version:** 1.0.0 | **Date:** 2025-12-03 | **Status:** Active

---

## Design Philosophy

**Clean. Secure. Trustworthy.**

Midnight Wallet follows a minimalist approach inspired by Trust Wallet's simplicity. Every pixel serves a purpose. The interface prioritizes clarity, reduces cognitive load, and builds confidence for crypto transactions.

**Core Principles:**
- **Clarity First** - Essential information upfront, progressive disclosure for details
- **Security Visible** - Visual cues that reinforce security without being intrusive
- **Speed** - Sub-second interactions, minimal steps to complete actions
- **Accessibility** - WCAG 2.1 AA compliant, works for all users

---

## Viewport & Layout

```
Popup: 360px x 600px (fixed)
Safe Area: 16px padding (328px usable width)
```

---

## Color Palette

### Light Theme (Primary)
```css
--bg-primary: #FFFFFF;        /* Main background */
--bg-secondary: #F8FAFC;      /* Cards, surfaces */
--bg-tertiary: #F1F5F9;       /* Hover states, dividers */

--text-primary: #0F172A;      /* Headings, primary text */
--text-secondary: #475569;    /* Body text, labels */
--text-tertiary: #94A3B8;     /* Placeholders, hints */

--midnight-purple: #6366F1;   /* Brand primary - actions */
--midnight-dark: #1A1A2E;     /* Brand accent - emphasis */

--success: #22C55E;           /* Confirmed, received */
--error: #EF4444;             /* Failed, warnings */
--warning: #F59E0B;           /* Pending, caution */
--info: #3B82F6;              /* Informational */
```

### Dark Theme
```css
--bg-primary: #0F0F1A;
--bg-secondary: #1A1A2E;
--bg-tertiary: #252542;

--text-primary: #F8FAFC;
--text-secondary: #94A3B8;
--text-tertiary: #64748B;
```

---

## Typography

**Font:** Inter (Google Fonts) - clean, highly readable

```css
/* Type Scale */
--text-xs: 12px / 16px;    /* Captions, timestamps */
--text-sm: 14px / 20px;    /* Body text, labels */
--text-base: 16px / 24px;  /* Default, inputs */
--text-lg: 18px / 28px;    /* Section headers */
--text-xl: 20px / 28px;    /* Card titles */
--text-2xl: 24px / 32px;   /* Page headers */
--text-3xl: 30px / 36px;   /* Balance display */

/* Weights */
font-normal: 400;  /* Body */
font-medium: 500;  /* Labels, emphasis */
font-semibold: 600; /* Headings */
font-bold: 700;    /* Balance amounts */
```

**Tailwind Classes:**
```
Headings: text-2xl font-semibold text-slate-900
Body: text-sm text-slate-600
Balance: text-3xl font-bold text-slate-900
Caption: text-xs text-slate-400
```

---

## Spacing System

**Base Unit:** 4px

```
space-1: 4px   | space-6: 24px
space-2: 8px   | space-8: 32px
space-3: 12px  | space-10: 40px
space-4: 16px  | space-12: 48px
```

**Standard Spacing:**
- Container padding: `p-4` (16px)
- Card padding: `p-3` (12px)
- Section gap: `gap-4` (16px)
- Element gap: `gap-2` (8px)

---

## Components

### Header
```
┌─────────────────────────────────────┐
│ [Logo]  Network ▼       [Settings] │
└─────────────────────────────────────┘
Height: 56px | px-4 py-3
```
```tsx
// Tailwind: flex items-center justify-between px-4 py-3 border-b border-slate-100
```

### Balance Card
```
┌─────────────────────────────────────┐
│         Total Balance               │
│         $12,345.67                  │
│         +2.34% ↑                    │
│  ┌─────┐  ┌─────┐  ┌─────┐        │
│  │Send │  │Recv │  │Swap │        │
│  └─────┘  └─────┘  └─────┘        │
└─────────────────────────────────────┘
```
```tsx
// Card: bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-4 text-white
// Balance: text-3xl font-bold
// Actions: flex justify-center gap-6 mt-4
```

### Action Button (Icon + Label)
```tsx
// Container: flex flex-col items-center gap-1
// Icon bg: w-12 h-12 rounded-full bg-white/20 flex items-center justify-center
// Label: text-xs font-medium
```

### Primary Button
```tsx
// Full: w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl
// Disabled: opacity-50 cursor-not-allowed
```

### Secondary Button
```tsx
// border border-slate-200 bg-white hover:bg-slate-50 text-slate-700
```

### Ghost Button
```tsx
// bg-transparent hover:bg-slate-100 text-slate-600
```

### Token List Item
```
┌─────────────────────────────────────┐
│ [Icon] Token Name          $100.00 │
│        0.05 TOKEN          +1.2%   │
└─────────────────────────────────────┘
```
```tsx
// flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl cursor-pointer
```

### Transaction Item
```
┌─────────────────────────────────────┐
│ ↑ Sent to 0x1234...        -0.5 ETH│
│   Dec 3, 2025 14:30        -$25.00 │
└─────────────────────────────────────┘
```
```tsx
// Status icons: ↑ Sent (text-red-500), ↓ Received (text-green-500), ⏳ Pending (text-amber-500)
```

### Input Field
```tsx
// Container: relative
// Input: w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent
// Label: text-sm font-medium text-slate-700 mb-1.5
// Error: border-red-500 focus:ring-red-500
```

### Address Display
```tsx
// Container: flex items-center gap-2 p-3 bg-slate-50 rounded-xl
// Address: font-mono text-sm text-slate-600 truncate
// Copy btn: p-2 hover:bg-slate-200 rounded-lg
```

### Bottom Navigation
```
┌───────┬───────┬───────┬───────┐
│ Home  │Tokens │ DApps │Setting│
└───────┴───────┴───────┴───────┘
Height: 64px
```
```tsx
// fixed bottom-0 left-0 right-0 flex border-t border-slate-100 bg-white
// Tab: flex-1 flex flex-col items-center py-2 text-slate-400
// Active: text-indigo-600
```

---

## Screen Layouts

### Home/Dashboard
```
┌─────────────────────────────────────┐
│ Header                              │
├─────────────────────────────────────┤
│ Balance Card                        │
│ [Send] [Receive] [Swap]             │
├─────────────────────────────────────┤
│ Tokens                      See all │
│ ┌─────────────────────────────────┐ │
│ │ Token 1                         │ │
│ │ Token 2                         │ │
│ │ Token 3                         │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Recent Activity             See all │
│ ┌─────────────────────────────────┐ │
│ │ Tx 1                            │ │
│ │ Tx 2                            │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Bottom Nav                          │
└─────────────────────────────────────┘
```

### Send Flow
```
Screen 1: Select Token → Screen 2: Enter Amount → Screen 3: Recipient → Screen 4: Confirm
```

### Receive Screen
```
┌─────────────────────────────────────┐
│ ← Receive                           │
├─────────────────────────────────────┤
│                                     │
│         ┌───────────────┐           │
│         │   QR Code     │           │
│         │   200x200     │           │
│         └───────────────┘           │
│                                     │
│    midnight1abc...xyz [Copy]        │
│                                     │
│  [ Share Address ]                  │
│                                     │
└─────────────────────────────────────┘
```

### dApp Connect Modal
```
┌─────────────────────────────────────┐
│          Connect to dApp            │
├─────────────────────────────────────┤
│         [dApp Logo]                 │
│         example.com                 │
│                                     │
│  This app wants to:                 │
│  • View your wallet address         │
│  • Request transaction signatures   │
│                                     │
│  ┌───────────┐  ┌───────────┐      │
│  │  Cancel   │  │  Connect  │      │
│  └───────────┘  └───────────┘      │
└─────────────────────────────────────┘
```

---

## Accessibility

- **Contrast:** 4.5:1 minimum for text, 3:1 for UI elements
- **Touch targets:** 44x44px minimum
- **Focus states:** Visible ring (ring-2 ring-indigo-500 ring-offset-2)
- **Motion:** Respect `prefers-reduced-motion`
- **Screen readers:** Semantic HTML, aria-labels for icons

---

## Animation Guidelines

**Duration Scale:**
- Fast: 150ms (hover, focus)
- Normal: 200ms (transitions)
- Slow: 300ms (modals, page transitions)

**Easing:** `ease-out` for enters, `ease-in` for exits

```tsx
// Default transition: transition-all duration-200 ease-out
// Modal enter: animate-in fade-in slide-in-from-bottom-4 duration-300
// Modal exit: animate-out fade-out slide-out-to-bottom-4 duration-200
```

**Micro-interactions:**
- Button press: `active:scale-95`
- Loading: Pulse animation on balance skeleton
- Success: Brief scale + checkmark

---

## Icons

Use **Lucide React** (included with shadcn/ui)

Common icons:
- Send: `ArrowUpRight`
- Receive: `ArrowDownLeft`
- Swap: `ArrowLeftRight`
- Copy: `Copy`
- Settings: `Settings`
- Back: `ChevronLeft`
- Success: `CheckCircle`
- Error: `XCircle`
- Pending: `Clock`

Size: 20px default, 24px for primary actions

---

## Shadows & Borders

```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
--border-radius-lg: 12px;
--border-radius-xl: 16px;
--border-radius-2xl: 20px;
```

---

## Loading States

- **Skeleton:** `bg-slate-200 animate-pulse rounded`
- **Spinner:** 20px indigo-600, centered
- **Button loading:** Spinner replaces text, maintain width

---

## Error States

- **Inline errors:** `text-sm text-red-500 mt-1`
- **Toast errors:** Bottom slide-up, auto-dismiss 5s
- **Empty states:** Centered illustration + message + action

---

## File Structure Reference

```
popup/
├── components/
│   ├── ui/           # shadcn components
│   ├── layout/       # Header, BottomNav
│   ├── wallet/       # BalanceCard, TokenList
│   └── common/       # AddressDisplay, etc.
├── pages/
│   ├── home.tsx
│   ├── send.tsx
│   ├── receive.tsx
│   └── settings.tsx
└── styles/
    └── globals.css   # Tailwind + custom vars
```

---

## Quick Reference

| Element | Tailwind Classes |
|---------|-----------------|
| Page bg | `bg-white min-h-screen` |
| Card | `bg-slate-50 rounded-2xl p-4` |
| Primary btn | `bg-indigo-600 text-white rounded-xl py-3 font-medium` |
| Input | `border border-slate-200 rounded-xl px-4 py-3` |
| Section title | `text-lg font-semibold text-slate-900` |
| Caption | `text-xs text-slate-400` |

---

*Design inspired by Trust Wallet's clean approach. Tailored for Midnight Network's privacy-focused experience.*
