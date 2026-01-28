# @midnight-ntwrk/wallet-sdk-utilities

Domain-agnostic utilities for the Midnight Wallet SDK.

## Installation

```bash
npm install @midnight-ntwrk/wallet-sdk-utilities
```

## Overview

This package provides common utility functions and types used throughout the Midnight Wallet SDK. It includes:

- Array operations
- Blob/binary data operations
- Date utilities
- Either/Result type operations
- Fluent API helpers
- Heterogeneous list types
- Ledger operations
- Observable utilities
- Polymorphic functions
- Record operations

## Exports

### Default Export

```typescript
import {
  ArrayOps, // Array manipulation utilities
  BlobOps, // Binary data operations
  DateOps, // Date handling utilities
  EitherOps, // Either/Result type helpers
  Fluent, // Fluent API patterns
  HList, // Heterogeneous list types
  LedgerOps, // Ledger-specific operations
  ObservableOps, // RxJS Observable utilities
  Poly, // Polymorphic function helpers
  RecordOps, // Object/Record utilities
} from '@midnight-ntwrk/wallet-sdk-utilities';
```

### Networking Submodule (`/networking`)

Network-related utilities:

```typescript
import { ... } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
```

### Types Submodule (`/types`)

Common type definitions:

```typescript
import { ... } from '@midnight-ntwrk/wallet-sdk-utilities/types';
```

### Testing Submodule (`/testing`)

Testing utilities and helpers:

```typescript
import { ... } from '@midnight-ntwrk/wallet-sdk-utilities/testing';
```

## Usage Examples

### Observable Operations

```typescript
import { ObservableOps } from '@midnight-ntwrk/wallet-sdk-utilities';

// Convert Effect streams to RxJS Observables
const observable = ObservableOps.fromStream(effectStream);
```

### Array Operations

```typescript
import { ArrayOps } from '@midnight-ntwrk/wallet-sdk-utilities';

// Various array manipulation utilities
```

## License

Apache-2.0
