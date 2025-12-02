# Kiến Trúc Hệ Thống

## Tổng Quan Kiến Trúc

Midnight Wallet SDK triển khai mô hình **Variant-Runtime** cho phép các phiên bản ví khác nhau coexist và chuyển đổi seamless giữa các hard-fork.

### Sơ Đồ Kiến Trúc Cấp Cao

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Application Layer                       │
│                    (Any App, Web, Mobile)                        │
└────────────────────────────────────┬────────────────────────────┘
                                     │
┌────────────────────────────────────▼────────────────────────────┐
│                      Wallet Facade (API Layer)                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ WalletFacade                                             │   │
│  │  - Unified API across wallet types                       │   │
│  │  - Variant selection & switching                         │   │
│  │  - State observable streams                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────┘
                                     │
       ┌─────────────┬───────────────┼────────────┬──────────────┐
       │             │               │            │              │
       ▼             ▼               ▼            ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Shielded     │ │ Unshielded   │ │ Dust Wallet  │ │ Future V2+   │
│ Wallet V1    │ │ Wallet       │ │ (Testing)    │ │ Variants     │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
       │             │               │            │              │
└───────────────┬─────────────────────────────────┴──────────────┘
                │
    ┌───────────▼──────────────┐
    │  Wallet Runtime Layer    │
    │  ┌────────────────────┐  │
    │  │ WalletRuntime      │  │
    │  │  - Variant mgmt    │  │
    │  │  - State dispatch  │  │
    │  │  - State migration │  │
    │  └────────────────────┘  │
    └────────────┬─────────────┘
                 │
    ┌────────────▼────────────────────────────────────┐
    │  Shared Infrastructure Layer                    │
    │  ┌──────────────┬─────────────────────────┐   │
    │  │ Capabilities │ Services & Clients      │   │
    │  ├──────────────┼─────────────────────────┤   │
    │  │ Coin Select  │ Indexer Client (Sync)  │   │
    │  │ Balancing    │ Node Client (Submit)    │   │
    │  │ Fee Calc     │ Prover Client (Prove)  │   │
    │  │ Validation   │ HD Wallet (Keys)       │   │
    │  │              │ Address Format         │   │
    │  └──────────────┴─────────────────────────┘   │
    └────────────┬────────────────────────────────┘
                 │
    ┌────────────▼────────────────────────────┐
    │  External Services (Docker Compose)    │
    │  ┌─────────┬────────────┬──────────┐   │
    │  │ Midnight│ Midnight   │ Proof    │   │
    │  │ Node    │ Indexer    │ Server   │   │
    │  │(RPC)    │(GraphQL)   │(HTTP)    │   │
    │  └─────────┴────────────┴──────────┘   │
    └─────────────────────────────────────────┘
                    │
    ┌───────────────▼────────────────┐
    │  Midnight Blockchain Network   │
    │  - MainNet / TestNet / DevNet  │
    │  - QaNet / Preview / PreProd   │
    └────────────────────────────────┘
```

## Thành Phần Chính

### 1. Wallet Facade (Layer API)

**Mục đích:** Cung cấp API thống nhất cho tất cả loại ví

```typescript
interface WalletFacade {
  // State access
  readonly state: Stream<WalletState>;
  readonly shielded: ShieldedWalletAPI;
  readonly unshielded: UnshieldedWalletAPI;
  readonly dust: DustWalletAPI;

  // Variant operations
  switchVariant(protocolVersion: ProtocolVersion): Effect<void>;
  getCurrentVariant(): ProtocolVersion;

  // Common operations
  getAddresses(): Effect<Address[]>;
  buildTransaction(request: TransactionRequest): Effect<TransactionRecipe>;
  proveTransaction(recipe: TransactionRecipe): Effect<ProvenTransaction>;
  submitTransaction(tx: ProvenTransaction): Effect<TransactionId>;
  getBalance(): Stream<Balance>;
}
```

**Responsibilities:**
- Aggregates multiple wallet types
- Variant selection logic
- State synchronization
- Error handling & recovery

---

### 2. Wallet Variant Layer

Mỗi variant (shielded, unshielded, dust) triển khai chuẩn `RuntimeVariant`:

```typescript
interface RuntimeVariant {
  readonly tag: string;  // "v1", "v2", etc.
  startSync(): Stream<StateChange>;
  migrateFromPrevious(prevState: unknown): Effect<VariantState>;
}

class ShieldedVariant implements RuntimeVariant {
  readonly tag = "v1";

  constructor(
    private ref: SubscriptionRef<ShieldedState>,
    private services: { sync: SyncService, prover: ProverService },
    private capabilities: { coin: CoinCapability, tx: TxCapability }
  ) {}

  startSync(): Stream<StateChange> {
    // Subscribe to indexer for state updates
  }

  migrateFromPrevious(prevState: unknown): Effect<ShieldedState> {
    // Transform previous version state to v1
  }
}
```

**Key Characteristics:**
- **Immutable State** - `VariantState` là Readonly type
- **Capability-based** - Operations qua pure functions
- **Service-driven** - Side effects từ services
- **Effect-based** - Composition qua Effect monad

---

### 3. Wallet Runtime (Orchestration)

Quản lý lifecycle & dispatch của variants:

```typescript
class WalletRuntime {
  constructor(
    private variants: Map<ProtocolVersion, RuntimeVariant>,
    private currentVersion: ProtocolVersion,
    private ref: SubscriptionRef<WalletRuntimeState>
  ) {}

  dispatch<T>(
    fn: (variant: RuntimeVariant) => T
  ): T {
    // Get active variant & call function
    const variant = this.variants.get(this.currentVersion);
    return fn(variant);
  }

  switchVariant(newVersion: ProtocolVersion): Effect<void> {
    // Get new & old variant
    // Migrate state from old to new
    // Update reference
    // Restart sync
  }
}
```

**Responsibilities:**
- Variant lifecycle management
- State migration orchestration
- Sync restart on hard-fork
- Type-safe dispatch pattern

---

## Data Flow Patterns

### Pattern 1: Synchronization (Từ Blockchain)

```
┌─────────────────────────────────────────────────────────────────┐
│                       Indexer Client                             │
│  (Maintains GraphQL subscription to Midnight Indexer)            │
└────────────┬────────────────────────────────────────────────────┘
             │ StateChange stream (realtime)
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SyncCapability.applyUpdate()                    │
│  (Pure function: old_state + update → new_state)                │
└────────────┬────────────────────────────────────────────────────┘
             │ Updated VariantState
             ▼
┌─────────────────────────────────────────────────────────────────┐
│              SubscriptionRef<VariantState>                       │
│  (Immutable state holder with atomic updates)                    │
└────────────┬────────────────────────────────────────────────────┘
             │ Stream<StateChange>
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    User subscriptions                            │
│  (App listens to state changes)                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Sequence:**
1. Indexer subscription → update stream
2. Validate update (SyncCapability.validate)
3. Apply to state (SyncCapability.applyUpdate)
4. Update ref (atomic)
5. Emit to subscribers

---

### Pattern 2: Transaction Building & Submission

```
User Action (buildTransaction)
         │
         ▼
┌──────────────────────────────────────────┐
│ CoinCapability.selectCoins()             │
│ - Get available coins/UTXOs              │
│ - Calculate balances                      │
│ - Check sufficient funds                  │
└──────────┬───────────────────────────────┘
           │ Selected coins + fees
           ▼
┌──────────────────────────────────────────┐
│ TransactionCapability.build()             │
│ - Create transaction with inputs/outputs │
│ - Reserve coins in state                  │
│ - Calculate size & fees                   │
│ → TransactionRecipe                      │
└──────────┬───────────────────────────────┘
           │ Recipe (unsigned tx)
           ▼
┌──────────────────────────────────────────┐
│ ProverService.prove() (Shielded only)    │
│ - HTTP request to Proof Server           │
│ - Get zero-knowledge proof               │
│ → ProvenTransaction                      │
└──────────┬───────────────────────────────┘
           │ Proven transaction
           ▼
┌──────────────────────────────────────────┐
│ NodeClient.submit()                      │
│ - WebSocket to Midnight Node             │
│ - Broadcast transaction                   │
│ → TransactionId                          │
└──────────┬───────────────────────────────┘
           │ Tx ID
           ▼
┌──────────────────────────────────────────┐
│ Indexer tracks tx status                  │
│ - Pending → In block → Finalized         │
│ → State update                           │
└──────────────────────────────────────────┘
```

---

### Pattern 3: State Migration (Hard-Fork)

```
Old Protocol Version (v1)
         │
         ├── Variant v1 with state_v1
         │
         └── User initiates protocol upgrade
                 │
                 ▼
         ┌──────────────────────────┐
         │ New ProtocolVersion v2   │
         │ available in builder     │
         └──────────┬───────────────┘
                    │
                    ▼
         ┌──────────────────────────────────┐
         │ WalletRuntime.switchVariant()    │
         │ 1. Stop old variant sync         │
         │ 2. Get old state_v1              │
         │ 3. Call variant_v2.migrate()     │
         │ 4. Transform state_v1 → state_v2 │
         │ 5. Create new subscription ref   │
         │ 6. Start v2 sync                 │
         └──────────┬──────────────────────┘
                    │
                    ▼
         ┌──────────────────────────┐
         │ New Protocol Version (v2) │
         │ with state_v2             │
         │ Sync continues            │
         └──────────────────────────┘
```

**Guarantees:**
- No transaction loss
- State completeness preserved
- Atomic transition
- Automatic indexer re-sync

---

## Component Interactions

### Shielded Wallet Detailed Architecture

```
┌────────────────────────────────────────────────────────────┐
│                     ShieldedVariant                         │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  State (Immutable): ShieldedState                          │
│    ├─ coins: ShieldedCoin[]                                │
│    ├─ commitments: Commitment[]                            │
│    ├─ nullifiers: Nullifier[]                              │
│    ├─ txHistory: Transaction[]                             │
│    └─ syncState: SyncState                                 │
│                                                             │
│  Capabilities (Pure):                                      │
│    ├─ CoinCapability                                       │
│    │   ├─ listCoins(state) → Coin[]                        │
│    │   ├─ getBalance(state) → Balance                      │
│    │   └─ getAvailableBalance(state) → Balance             │
│    │                                                        │
│    ├─ TransactionCapability                                │
│    │   ├─ build(state, request) → Recipe                   │
│    │   ├─ finalize(state, recipe) → Tx                     │
│    │   └─ estimateFee(state, tx) → Fee                     │
│    │                                                        │
│    └─ SyncCapability                                       │
│        ├─ applyUpdate(state, update) → State               │
│        └─ validate(state, update) → Either                 │
│                                                             │
│  Services (Effects/Streams):                               │
│    ├─ IndexerService                                       │
│    │   └─ startSync(state) → Stream<StateChange>           │
│    │       (GraphQL subscription)                           │
│    │                                                        │
│    ├─ ProverService                                        │
│    │   └─ prove(tx) → Effect<ProvenTx>                     │
│    │       (HTTP to Proof Server)                           │
│    │                                                        │
│    └─ NodeService                                          │
│        └─ submit(tx) → Effect<TxId>                        │
│            (WebSocket to Midnight Node)                     │
│                                                             │
│  State Management:                                         │
│    ├─ ref: SubscriptionRef<ShieldedState>                  │
│    │   └─ Atomic state updates                             │
│    │                                                        │
│    ├─ state: Stream<ShieldedState>                         │
│    │   └─ Observable for subscribers                        │
│    │                                                        │
│    └─ dispatch methods:                                    │
│        ├─ selectCoins(params) → Effect<Coins>              │
│        ├─ buildTx(request) → Effect<Recipe>                │
│        ├─ proveTx(recipe) → Effect<ProvenTx>               │
│        └─ submitTx(tx) → Effect<TxId>                      │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

---

## External Service Integration

### Indexer (Sync Service)

```typescript
interface IndexerClient {
  subscribe(state: State): Stream<StateChange>;
}

// GraphQL subscription pattern
async function* streamUpdates() {
  const subscription = client.subscribe(`
    subscription onStateChange($since: BlockHeight) {
      stateChanges(since: $since) {
        block { height, hash }
        coins { added, spent }
        commitments { added }
      }
    }
  `);

  for await (const change of subscription) {
    yield change;
  }
}
```

**Purpose:** Real-time state synchronization
**Frequency:** Continuous subscription
**Data:** UTXO changes, commitment updates, nullifier proofs

---

### Node Client (Submission)

```typescript
interface NodeClient {
  submit(tx: ProvenTransaction): Effect<TransactionId>;
  waitForInclusion(txId: TxId): Stream<TxStatus>;
}

// WebSocket connection to Midnight Node
async function submit(tx: ProvenTransaction): Promise<TxId> {
  const payload = encodeTransaction(tx);
  return rpc.call("author_submitExtrinsic", [payload]);
}
```

**Purpose:** Transaction broadcasting
**Method:** Polkadot RPC (author_submitExtrinsic)
**Response:** Transaction hash

---

### Prover Client (Proving)

```typescript
interface ProverClient {
  prove(tx: UnsignedTransaction): Effect<ProvenTransaction>;
}

// HTTP POST to Proof Server
async function prove(tx: UnsignedTransaction): Promise<ProvenTx> {
  const response = await fetch("http://proof-server:3000/prove", {
    method: "POST",
    body: JSON.stringify(encodeTransaction(tx))
  });
  return decodeProven(await response.json());
}
```

**Purpose:** Zero-knowledge proof generation
**Method:** HTTP REST
**Latency:** 1-5 seconds per transaction

---

## State Shape Overview

### Shielded Wallet State

```typescript
type ShieldedState = Readonly<{
  // UTXO Management
  coins: ReadonlyArray<Readonly<{
    nullifier: Nullifier;
    commitment: Commitment;
    value: Uint256;
    tokenId: TokenId;
    token: Token;
  }>>;

  // Proofs
  commitmentTree: MerkleTree;
  nullifiers: Set<Nullifier>;

  // Transaction History
  transactions: ReadonlyArray<Transaction>;

  // Sync State
  syncState: Readonly<{
    lastSyncedBlock: BlockHeight;
    isSyncing: boolean;
    lastSyncError?: Error;
  }>;
}>;
```

### Unshielded Wallet State

```typescript
type UnshieldedState = Readonly<{
  utxos: ReadonlyArray<UTXO>;
  reserved: Set<UTXO>;  // For pending txs
  nonce: number;
  transactions: ReadonlyArray<Transaction>;
  syncState: SyncState;
}>;
```

---

## Error Handling Strategy

### Layered Error Handling

```
User Code
    │
    ├─→ Facade API Error Boundary
    │       └─→ Transaction validation errors
    │       └─→ Network errors (retry)
    │       └─→ State errors
    │
    ├─→ Capability Error Handling
    │       └─→ Either<T, Error> return
    │       └─→ Specific error types
    │
    ├─→ Service Error Handling
    │       └─→ Effect<T, Error> return
    │       └─→ Timeout handling
    │       └─→ Retry logic
    │
    └─→ Network Layer Error Handling
            └─→ WebSocket reconnect
            └─→ Fallback mechanisms
            └─→ Graceful degradation
```

---

## Deployment Architecture

### Local Development

```
┌──────────────────────────────────────────────┐
│          Docker Compose Environment           │
├──────────────────────────────────────────────┤
│  ┌────────────────┐  ┌────────────────┐    │
│  │ Midnight Node  │  │ Midnight Index │    │
│  │ (RPC: 9944)    │  │ (GraphQL: 8080)│    │
│  └────────────────┘  └────────────────┘    │
│  ┌────────────────┐                         │
│  │ Proof Server   │                         │
│  │ (HTTP: 3000)   │                         │
│  └────────────────┘                         │
└──────────────────────────────────────────────┘
        │               │
        └───────┬───────┘
                │
    ┌───────────▼────────────┐
    │  SDK Integration Tests │
    │  (vitest + testcontainers)
    └────────────────────────┘
```

### Production

```
┌─────────────────────────────────────────────┐
│     Midnight Wallet Application (Client)    │
├─────────────────────────────────────────────┤
│  Embedded:                                  │
│  - Wallet SDK (packages)                    │
│  - Effect.js + RxJS                         │
│  - State management                         │
└────────────┬────────────────────────────────┘
             │
    ┌────────┴─────────────────────────┐
    │          Network                  │
    │                                   │
    ├──────────────┬────────────────────┤
    │              │                    │
    ▼              ▼                    ▼
Midnight Node   Indexer            Proof Server
(Mainnet)       (Cloud)             (Cloud/Local)
```

---

## Performance Characteristics

### Key Metrics

| Operation | Latency | Notes |
|-----------|---------|-------|
| **Build Transaction** | < 100ms | Pure function |
| **Select Coins** | < 50ms | State lookup |
| **Generate Proof** | 1-5s | HTTP + crypto |
| **Submit Transaction** | < 500ms | Network IO |
| **Sync Update** | < 1s | GraphQL + state |
| **State Migration** | < 100ms | Transformation |

### Optimization Points

1. **Batching** - Group sync updates
2. **Caching** - Merkle tree snapshots
3. **Memoization** - Selectors for balance
4. **Lazy Loading** - Load commitments on demand

---

## Security Architecture

### Key Security Principles

1. **Keys Management**
   - Never stored on server
   - Generated locally via HD-Wallet
   - Private keys never leave client

2. **Transaction Privacy (Shielded)**
   - Zero-knowledge proofs verify without revealing amounts
   - Commitments & nullifiers ensure double-spend prevention
   - Encrypted notes for receiver

3. **State Integrity**
   - Immutable state prevents races
   - Cryptographic commitments verify blockchain state
   - Transaction signature verification

4. **Network Security**
   - WebSocket + TLS for Node connection
   - HTTPS for Prover & Indexer APIs
   - Certificate pinning (recommended)

---

## Extensibility Points

### Add New Wallet Variant

```typescript
// 1. Create variant package
packages/new-wallet/

// 2. Implement RuntimeVariant
class NewVariant implements RuntimeVariant {
  readonly tag = "v2";
  startSync() { /* ... */ }
  migrateFromPrevious() { /* ... */ }
}

// 3. Register in builder
const wallet = new WalletBuilder()
  .addVariant(ProtocolVersion.v1, shieldedVariant)
  .addVariant(ProtocolVersion.v2, newVariant)  // New!
  .build();
```

### Add Custom Capability

```typescript
interface CustomCapability<TState> {
  customOperation(state: TState): Result<TState>;
}

class CustomCapabilityImpl<TState> implements CustomCapability<TState> {
  customOperation(state: TState): Result<TState> {
    // Pure function on state
  }
}

// Inject into variant
const variant = new MyVariant(
  ref,
  { sync, prover },
  { coin, tx, custom: new CustomCapabilityImpl() }
);
```

---

## References

- Design Details: `./docs/Design.md`
- Architecture Decisions: `./docs/decisions/`
- IcePanel Diagram: https://app.icepanel.io/landscapes/yERCUolKk91aYF1pzsql/
- Specification: https://github.com/midnightntwrk/midnight-architecture
