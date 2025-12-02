# Tóm Tắt Codebase

## Tổng Quan Cấu Trúc

Midnight Wallet SDK là monorepo TypeScript với 18 packages được tổ chức bằng Yarn Workspaces và Turborepo. Các packages phụ thuộc lẫn nhau theo kiến trúc phân lớp rõ ràng.

### Lớp Kiến Trúc (Bottom-Up)

```
Layer 4 (Facade)
    └── Facade (unified API)
        ├── Layer 3: Wallet Variants
        │   ├── Shielded Wallet
        │   ├── Unshielded Wallet
        │   └── Dust Wallet
        │
        └── Layer 2: Clients & Utilities
            ├── Indexer Client (sync)
            ├── Node Client (submit tx)
            ├── Prover Client (prove tx)
            ├── HD Wallet (key derivation)
            ├── Address Format (encoding)
            ├── Capabilities (coin selection)
            └── Utilities (common ops)

        Layer 1: Abstractions & Runtime
            ├── Abstractions (type contracts)
            ├── Runtime (variant orchestration)
            └── State Mgmt (unshielded-state)
```

## Packages Chi Tiết

### Layer 1: Nền Tảng

#### `abstractions` (v1.0.0-beta.9)
**Mục đích:** Định nghĩa các loại và interface hợp đồng
- **Files chính:**
  - `types.ts` - WalletSeed, ProtocolVersion, NetworkId
  - `wallet.ts` - Wallet interface contracts
  - `state.ts` - State shape definitions
- **Exports:** Type definitions dành cho các package khác
- **Phụ thuộc:** `effect`
- **Không phụ thuộc:** Không phụ thuộc vào package khác
- **Mục đích:** Cung cấp hợp đồng kiểu cho các variant khác nhau

#### `runtime` (v1.0.0-beta.8)
**Mục đích:** Orchestration cho các biến thể ví giữa hard-fork
- **Files chính:**
  - `WalletRuntime.ts` - Dispatch logic
  - `WalletBuilder.ts` - Builder pattern
  - `RuntimeVariant.ts` - Interface cho variant
  - `StateTransition.ts` - State migration
- **Key Classes:**
  - `WalletBuilder` - Đăng ký variant theo phiên bản giao thức
  - `WalletRuntime` - Generic variant dispatcher
- **Phụ thuộc:** `abstractions`, `utilities`, `effect`, `rxjs`
- **Sử dụng:** `facade`, tất cả wallet packages

#### `unshielded-state` (v1.0.0-beta.11)
**Mục đích:** Quản lý UTXO state cho ví unshielded
- **Files chính:**
  - `state.ts` - UTXO state type & operations
  - `selector.ts` - Coin selection algorithm
  - `merge.ts` - Consolidation logic
- **Phụ thuộc:** `abstractions`, `effect`

---

### Layer 2: Clients & Utilities

#### `indexer-client` (v1.0.0-beta.12)
**Mục đích:** GraphQL client để đồng bộ trạng thái
- **Chức năng:**
  - GraphQL query building
  - Subscription handling
  - State merge logic
- **Phụ thuộc:** `abstractions`, gql library
- **Tương tác:** Indexer service (external)

#### `node-client` (v1.0.0-beta.10)
**Mục đích:** Wrapper cho Polkadot API để gửi giao dịch
- **Chức năng:**
  - RPC connection management
  - Transaction submission
  - Event monitoring
- **Phụ thuộc:** `@polkadot/api`
- **Tương tác:** Midnight Node service (external)

#### `prover-client` (v1.0.0-beta.10)
**Mục đích:** HTTP client cho proof generation service
- **Chức năng:**
  - Proof request formatting
  - HTTP communication
  - Result parsing
- **Phụ thuộc:** `node-fetch` hoặc `node:https`
- **Tương tác:** Proof Server service (external)

#### `address-format` (v3.0.0-beta.9)
**Mục đích:** Mã hóa/giải mã địa chỉ Bech32m
- **Files chính:**
  - `bech32m.ts` - Encoding logic
  - `validation.ts` - Address validation
- **Phụ thuộc:** `bech32` library
- **Sử dụng:** `shielded-wallet`, `unshielded-wallet`, `facade`

#### `hd` (v3.0.0-beta.7)
**Mục đích:** HD-Wallet theo BIP32/BIP39
- **Chức năng:**
  - Mnemonic generation (BIP39)
  - Key derivation (BIP32)
  - Path validation
- **Files chính:**
  - `mnemonic.ts` - BIP39 operations
  - `derivation.ts` - BIP32 paths
  - `keyPair.ts` - Key generation
- **Phụ thuộc:** `@noble/hashes`, `@noble/secp256k1`
- **Sử dụng:** `facade` (key initialization)

#### `capabilities` (v3.0.0-beta.9)
**Mục đích:** Shared capability implementations
- **Chức năng:**
  - Coin selection (balancing)
  - UTXO consolidation
  - Fee calculation
  - Balance computation
- **Files chính:**
  - `balancing.ts` - Balance calculation
  - `coinSelection.ts` - Coin selection algorithm
  - `fees.ts` - Fee estimation
- **Phụ thuộc:** `abstractions`, `unshielded-state`
- **Sử dụng:** `shielded-wallet`, `unshielded-wallet`

#### `utilities` (v1.0.0-beta.7)
**Mục đích:** Các tiện ích chung
- **Chức năng:**
  - Conversion utilities
  - Serialization helpers
  - Common validators
- **Phụ thuộc:** `effect`

---

### Layer 3: Wallet Variants

#### `shielded-wallet` (v1.0.0-beta.11)
**Mục đích:** Triển khai ví shielded variant v1
- **Kiến Trúc:**
  - `state.ts` - ShieldedState type
  - `capabilities/` - Coin, transaction, proof capabilities
  - `services/` - Sync, indexing services
  - `variant.ts` - ShieldedVariant implementation
  - `builder.ts` - ShieldedVariantBuilder
- **Key Capabilities:**
  - `CoinCapability` - List coins, balances
  - `TransactionCapability` - Build shielded tx
  - `ProofCapability` - Prepare tx for proving
  - `SyncCapability` - Apply state updates
- **Phụ thuộc:**
  - `abstractions`, `runtime`
  - `indexer-client`, `node-client`, `prover-client`
  - `capabilities`, `unshielded-state`
  - `effect`, `rxjs`
- **Ledger:** `@midnight-ntwrk/ledger-v6` (mật mã)

#### `unshielded-wallet` (v1.0.0-beta.13)
**Mục đích:** Triển khai ví unshielded (UTXO công khai)
- **Kiến Trúc:**
  - `state.ts` - UnshieldedState type
  - `capabilities/` - Coin, transaction capabilities
  - `services/` - Sync service
  - `variant.ts` - UnshieldedVariant
  - `builder.ts` - UnshieldedVariantBuilder
- **Key Capabilities:**
  - `CoinCapability` - List coins, balances
  - `TransactionCapability` - Build unshielded tx
  - `SyncCapability` - Apply state updates
- **Phụ thuộc:** `abstractions`, `runtime`, `capabilities`

#### `dust-wallet` (v1.0.0-beta.10)
**Mục đích:** Ví dust cho thanh toán phí (chỉ testing)
- **Mục đích:** Quản lý Dust tokens (token phí riêng)
- **Tương tự:** `unshielded-wallet` nhưng cho Dust

---

### Layer 4: Facade & APIs

#### `facade` (v1.0.0-beta.11)
**Mục đích:** API thống nhất cho tất cả wallet types
- **Kiến Trúc:**
  - `WalletFacade.ts` - Main entry point
  - `variants/` - Variant registration
  - `adapters/` - Facade API adapters
- **Cung cấp:**
  - Unified API across shielded/unshielded/dust
  - Variant switching
  - State access
- **Phụ thuộc:** Tất cả wallet packages + clients
- **Xuất:** `WalletFacade`, `WalletBuilder`, variant types

---

### Testing & Documentation

#### `e2e-tests`
**Mục đích:** End-to-end tests với cơ sở hạ tầng thực
- **Cấu hình:** Docker Compose với Node, Indexer, Proof Server
- **Tests:** Full transaction lifecycle
- **Phụ thuộc:** `testcontainers`, `facade`

#### `wallet-integration-tests`
**Mục đích:** Integration tests cho public APIs
- **Phạm vi:** API contracts, variant behavior
- **Phụ thuộc:** Tất cả wallet packages

#### `docs-snippets`
**Mục đích:** Documentation code examples
- **Sử dụng:** Trong hướng dẫn & API docs

---

## Sơ Đồ Phụ Thuộc

```
facades
  ├─→ shielded-wallet
  ├─→ unshielded-wallet
  ├─→ dust-wallet
  ├─→ address-format
  └─→ hd

shielded-wallet (& unshielded, dust)
  ├─→ abstractions
  ├─→ runtime
  ├─→ capabilities
  ├─→ unshielded-state
  ├─→ indexer-client
  ├─→ node-client
  └─→ prover-client

runtime
  ├─→ abstractions
  └─→ utilities

indexer-client / node-client / prover-client
  └─→ abstractions

address-format / hd
  └─→ abstractions

capabilities
  ├─→ abstractions
  └─→ unshielded-state
```

## State Management Pattern

Tất cả wallet variant tuân theo cấu trúc tương tự:

```typescript
// State type: Immutable domain state
type VariantState = Readonly<{
  coins: Coin[];
  transactions: Transaction[];
  syncState: SyncState;
}>;

// Capability: Pure functions on state
interface MyCap<TState> {
  operation(state: TState, params: Params): Result<TState>;
}

// Service: Side effects (sync, proving, etc)
interface MyService<TState> {
  stream(state: TState): Stream<StateUpdate>;
}

// Variant: Manages state + services + capabilities
class MyVariant implements RuntimeVariant {
  startSync(): Stream<StateChange>;
  migrateFromPrevious(prevState: unknown): Effect<VariantState>;
}
```

## Transaction Flow

```
1. HD Wallet → Derive keys từ mnemonic
   ↓
2. Address Format → Mã hóa địa chỉ Bech32m
   ↓
3. Capabilities (Coin Selection) → Chọn UTXO cho tx
   ↓
4. Shielded/Unshielded Wallet → Xây dựng tx
   ↓
5. Prover Client → Tạo chứng minh Zk (shielded)
   ↓
6. Node Client → Gửi tx đến blockchain
   ↓
7. Indexer Client → Theo dõi trạng thái (subscription)
   ↓
8. Wallet → Cập nhật state từ indexer
```

## Build & Release Flow

```
Development
  ↓
turbo test       (Vitest - all packages)
turbo lint       (ESLint - all packages)
turbo typecheck  (TypeScript - all packages)
turbo dist       (Build - all packages)
  ↓
yarn changeset   (Changesets for versioning)
  ↓
yarn changeset:publish
  ↓
GitHub Releases  (Automated)
```

## Mạng Network Support

Mỗi client được cấu hình cho mạng:
- **MainNet** - Production Midnight Network
- **TestNet** - Public testing
- **DevNet** - Development network
- **QaNet** - QA testing
- **Preview** - New feature preview
- **PreProd** - Pre-production
- **Undeployed** - Local testing

## Key Technologies

| Công Nghệ | Phiên Bản | Mục Đích |
|-----------|----------|---------|
| TypeScript | 5.9.3+ | Type safety |
| Effect.js | ^3.17.3 | Functional effects & composition |
| RxJS | ^7.5 | Reactive streams |
| Vitest | ^3.2.4 | Unit testing |
| ESLint | ^9.32.0 | Code linting |
| Prettier | ^3.6.2 | Code formatting |
| Turborepo | ^2.5.5 | Build orchestration |
| Yarn | 4.10.3 | Package management |
| Node | v20+ | Runtime |

## Files Quan Trọng

### Configuration
- `tsconfig.base.json` - Base TS config
- `eslint.config.mjs` - Linting rules
- `.yarnrc.yml` - Yarn configuration
- `turbo.json` - Turborepo tasks (nếu có)
- `docker-compose.yml` - Local infrastructure

### Documentation
- `./docs/Design.md` - Detailed design patterns
- `./docs/decisions/` - ADRs (Architecture Decision Records)
- `./README.md` - Getting started
- `./CLAUDE.md` - Development guidance

## Summary
Codebase được thiết kế để:
1. **Modularity** - Mỗi package là independent
2. **Composability** - Dễ kết hợp variant & capabilities
3. **Type Safety** - Strict TypeScript + branded types
4. **Testability** - Unit tests + E2E tests
5. **Maintainability** - Clear layering & patterns

Sử dụng `repomix` để tạo snapshot toàn bộ codebase:
```bash
repomix --output ./repomix-output.xml
```
