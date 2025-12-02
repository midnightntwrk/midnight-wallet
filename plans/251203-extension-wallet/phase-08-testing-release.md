# Phase 08: Testing & Release

**Status:** Pending | **Priority:** High | **Date:** 2025-12-03

## Context

- Depends on: [Phase 07](./phase-07-settings-polish.md)
- Final phase before production release
- Comprehensive testing + Chrome Web Store submission

## Overview

Implement unit tests (Vitest), E2E tests, security audit checklist verification, Chrome Web Store preparation, and release process documentation.

## Key Insights

- Vitest for unit tests (matches monorepo pattern)
- Puppeteer for E2E (can control extension)
- Security audit covers OWASP + crypto best practices
- Chrome Web Store requires privacy policy + screenshots

## Requirements

**Functional:**
- Unit test coverage >80%
- E2E tests for critical flows
- All security checklist items pass
- Chrome Web Store assets ready

**Non-Functional:**
- Tests run in CI (<5 min)
- No critical security vulnerabilities
- Extension passes Chrome review

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Testing & Release Pipeline                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  Unit Tests (Vitest)                                                │   │
│  │  ├── src/background/*.test.ts                                       │   │
│  │  │   ├── crypto-service.test.ts (encrypt/decrypt)                  │   │
│  │  │   ├── storage-service.test.ts (IndexedDB mock)                  │   │
│  │  │   ├── session-manager.test.ts (lock/unlock)                     │   │
│  │  │   └── wallet-service.test.ts (create/import)                    │   │
│  │  ├── src/lib/*.test.ts                                              │   │
│  │  │   ├── format.test.ts (amounts, addresses)                       │   │
│  │  │   └── utils.test.ts (helpers)                                   │   │
│  │  └── src/components/*.test.tsx                                      │   │
│  │      ├── balance-card.test.tsx                                      │   │
│  │      └── seed-phrase-input.test.tsx                                │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  E2E Tests (Puppeteer + Extension)                                  │   │
│  │  ├── e2e/create-wallet.test.ts                                      │   │
│  │  ├── e2e/import-wallet.test.ts                                      │   │
│  │  ├── e2e/send-receive.test.ts                                       │   │
│  │  ├── e2e/dapp-connect.test.ts                                       │   │
│  │  └── e2e/settings.test.ts                                           │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  Security Audit                                                      │   │
│  │  ├── Key storage encryption                                         │   │
│  │  ├── Session management                                             │   │
│  │  ├── Input validation                                               │   │
│  │  ├── Origin verification                                            │   │
│  │  └── CSP compliance                                                 │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │  Release Artifacts                                                   │   │
│  │  ├── extension.zip (Chrome Web Store)                               │   │
│  │  ├── Screenshots (1280x800)                                         │   │
│  │  ├── Privacy policy                                                 │   │
│  │  └── Store description                                              │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Related Files

**Create:**
- `src/background/__tests__/crypto-service.test.ts`
- `src/background/__tests__/storage-service.test.ts`
- `src/background/__tests__/session-manager.test.ts`
- `src/background/__tests__/wallet-service.test.ts`
- `src/lib/__tests__/format.test.ts`
- `src/components/__tests__/balance-card.test.tsx`
- `e2e/create-wallet.test.ts`
- `e2e/import-wallet.test.ts`
- `e2e/send-receive.test.ts`
- `e2e/dapp-connect.test.ts`
- `vitest.config.ts`
- `SECURITY_AUDIT.md`
- `PRIVACY_POLICY.md`
- `STORE_DESCRIPTION.md`

**Modify:**
- `package.json` - Add test scripts
- `.github/workflows/ci.yml` - Add extension tests

## Implementation Steps

### 1. Configure Vitest
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'test/'],
    },
  },
});
```

### 2. Write crypto service tests
```typescript
// background/__tests__/crypto-service.test.ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKey } from '../crypto-service';

describe('CryptoService', () => {
  it('encrypts and decrypts data correctly', async () => {
    const password = 'test-password';
    const data = 'secret-seed-phrase';
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const key = await deriveKey(password, salt);
    const encrypted = await encrypt(data, key);
    const decrypted = await decrypt(encrypted, key);

    expect(decrypted).toBe(data);
  });

  it('fails with wrong password', async () => {
    const data = 'secret';
    const salt = crypto.getRandomValues(new Uint8Array(16));

    const key1 = await deriveKey('password1', salt);
    const key2 = await deriveKey('password2', salt);
    const encrypted = await encrypt(data, key1);

    await expect(decrypt(encrypted, key2)).rejects.toThrow();
  });
});
```

### 3. Write component tests
```typescript
// components/__tests__/balance-card.test.tsx
import { render, screen } from '@testing-library/react';
import { BalanceCard } from '../balance-card';

describe('BalanceCard', () => {
  it('displays formatted balance', () => {
    render(<BalanceCard balance={{ shielded: 1000000n, unshielded: 500000n }} />);
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.getByText('Shielded')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<BalanceCard balance={null} loading />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
```

### 4. Setup E2E with Puppeteer
```typescript
// e2e/create-wallet.test.ts
import puppeteer from 'puppeteer';

describe('Create Wallet Flow', () => {
  let browser, page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  });

  it('creates new wallet with seed phrase', async () => {
    // Open extension popup
    const extensionId = await getExtensionId(browser);
    page = await browser.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/index.html`);

    // Click "Create Wallet"
    await page.click('[data-testid="create-wallet"]');

    // Verify seed phrase displayed
    const words = await page.$$('[data-testid="seed-word"]');
    expect(words.length).toBe(24);

    // Complete flow
    await page.click('[data-testid="continue"]');
    await page.type('[data-testid="password"]', 'TestPassword123!');
    await page.click('[data-testid="create"]');

    // Verify on home page
    expect(await page.url()).toContain('/home');
  });
});
```

### 5. Create security audit checklist
```markdown
# Security Audit Checklist

## Key Storage
- [ ] Seeds encrypted with AES-256-GCM
- [ ] Encryption key derived via PBKDF2 (100k iterations)
- [ ] Salt unique per wallet (16 bytes random)
- [ ] Keys never written to disk in plaintext
- [ ] CryptoKey uses extractable: false

## Session Management
- [ ] Session tokens expire (configurable)
- [ ] Tokens regenerated on unlock
- [ ] Lock clears all in-memory secrets
- [ ] Auto-lock on popup close

## Input Validation
- [ ] Seed phrase checksum validated
- [ ] Address format validated (bech32m)
- [ ] Amount bounds checked
- [ ] Integer overflow prevented (bigint)

## dApp Security
- [ ] Origin validated for all requests
- [ ] User approves all connections
- [ ] User approves all transactions
- [ ] Request rate limiting
- [ ] No auto-approve

## CSP Compliance
- [ ] No eval() or inline scripts
- [ ] Manifest V3 compliant
- [ ] No remote code loading
```

### 6. Prepare Chrome Web Store assets
```
store-assets/
├── icon-128.png
├── screenshot-1-home.png (1280x800)
├── screenshot-2-send.png
├── screenshot-3-receive.png
├── screenshot-4-dapp.png
└── promotional-440x280.png
```

### 7. Create release workflow
```yaml
# .github/workflows/release.yml
name: Release Extension

on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: yarn install
      - run: turbo dist --filter=extension
      - run: cd packages/extension && zip -r extension.zip dist/
      - uses: actions/upload-artifact@v4
        with:
          name: extension
          path: packages/extension/extension.zip
```

## Todo List

- [ ] Configure Vitest for extension package
- [ ] Write crypto-service.test.ts
- [ ] Write storage-service.test.ts
- [ ] Write session-manager.test.ts
- [ ] Write wallet-service.test.ts
- [ ] Write format.test.ts
- [ ] Write balance-card.test.tsx
- [ ] Write seed-phrase-input.test.tsx
- [ ] Setup Puppeteer E2E
- [ ] Write create-wallet.test.ts
- [ ] Write import-wallet.test.ts
- [ ] Write send-receive.test.ts
- [ ] Write dapp-connect.test.ts
- [ ] Complete security audit checklist
- [ ] Create store screenshots
- [ ] Write privacy policy
- [ ] Write store description
- [ ] Create release workflow
- [ ] Test CI pipeline

## Success Criteria

- [ ] Unit test coverage >80%
- [ ] All E2E tests pass
- [ ] Security audit checklist complete
- [ ] Extension builds without errors
- [ ] Bundle size <150KB gzipped
- [ ] All store assets ready
- [ ] Privacy policy published

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK mocking complexity | Medium | Use integration tests where possible |
| E2E flakiness | Medium | Add retries, increase timeouts |
| Chrome review rejection | High | Pre-review with checklist |

## Security Considerations

- Review all dependencies for vulnerabilities
- Run `npm audit` before release
- Verify no secrets in bundle
- Test CSP violations

## Release Checklist

1. [ ] All tests pass
2. [ ] Security audit complete
3. [ ] Version bumped in manifest.json
4. [ ] Changelog updated
5. [ ] Build extension.zip
6. [ ] Test on fresh Chrome profile
7. [ ] Upload to Chrome Web Store
8. [ ] Submit for review
9. [ ] Monitor review status

## Post-Release

- Monitor crash reports
- Respond to user reviews
- Plan hotfix process
- Document known issues
