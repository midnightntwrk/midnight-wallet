# Midnight Extension Wallet - Implementation Plan

**Created:** 2025-12-03 | **Status:** Planning | **Type:** Chrome Extension

## Overview

Browser extension wallet for Midnight Network enabling secure key management, balance viewing, transactions, and dApp integration. Built with React + TypeScript + Vite + Zustand + shadcn/ui.

## Tech Stack

- **Build:** Vite + Manifest V3
- **UI:** React 18 + TypeScript + Tailwind + shadcn/ui
- **State:** Zustand (persist to chrome.storage)
- **Routing:** React Router (MemoryRouter)
- **Security:** AES-GCM encryption + IndexedDB
- **SDK:** @midnight-ntwrk/wallet-sdk-* packages

## Phases

| # | Phase | Priority | Status | Est. Days |
|---|-------|----------|--------|-----------|
| 1 | [Project Setup](./phase-01-project-setup.md) | Critical | Pending | 2 |
| 2 | [Background Service](./phase-02-background-service.md) | Critical | Pending | 3 |
| 3 | [Popup UI Core](./phase-03-popup-ui-core.md) | High | Pending | 2 |
| 4 | [Wallet Management](./phase-04-wallet-management.md) | Critical | Pending | 3 |
| 5 | [Balance & Transactions](./phase-05-balance-transactions.md) | High | Pending | 4 |
| 6 | [dApp Integration](./phase-06-dapp-integration.md) | High | Pending | 3 |
| 7 | [Settings & Polish](./phase-07-settings-polish.md) | Medium | Pending | 2 |
| 8 | [Testing & Release](./phase-08-testing-release.md) | High | Pending | 3 |

**Total Estimated:** 22 days

## Success Criteria

- [ ] Extension loads in Chrome without errors
- [ ] Create/restore wallet from seed phrase
- [ ] Display shielded/unshielded/dust balances
- [ ] Send transactions with confirmation
- [ ] Receive via address + QR code
- [ ] dApp connection/approval flow works
- [ ] Auto-lock after inactivity
- [ ] <150KB bundle (gzipped)
- [ ] <500ms popup load time

## Research References

- [Architecture Research](./research-wallet-architecture.md)
- [UI Patterns Research](./research-react-ui-patterns.md)

## SDK Packages

```
@midnight-ntwrk/wallet-sdk-hd          - HD wallet derivation
@midnight-ntwrk/wallet-sdk-runtime     - Wallet runtime
@midnight-ntwrk/wallet-sdk-shielded    - Shielded wallet
@midnight-ntwrk/wallet-sdk-dust-wallet - Dust wallet
@midnight-ntwrk/wallet-sdk-indexer-client - Indexer sync
@midnight-ntwrk/wallet-sdk-address-format - Bech32m formatting
```

## Risk Summary

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK browser compatibility | High | Test WASM/WebCrypto early |
| Bundle size | Medium | Tree-shake, lazy load SDK |
| Manifest V3 limitations | Medium | Use service worker patterns |
