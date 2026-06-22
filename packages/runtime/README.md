# @midnightntwrk/wallet-sdk-runtime

Runtime infrastructure for Midnight wallet variants.

## Installation

```bash
npm install @midnightntwrk/wallet-sdk-runtime
```

## Overview

This package provides the shared runtime functionality used across different wallet implementations in the Midnight
Wallet SDK. It includes:

- Wallet builder patterns for constructing wallet instances
- Runtime abstractions for wallet lifecycle management
- Common runtime utilities shared by wallet variants

## Exports

### Default Export

- `WalletBuilder` - Builder pattern for constructing wallet instances
- `Runtime` - Runtime utilities namespace

### Abstractions Submodule (`/abstractions`)

Runtime abstractions for extending wallet functionality:

```typescript
import { ... } from '@midnightntwrk/wallet-sdk-runtime/abstractions';
```

## License

Apache-2.0
