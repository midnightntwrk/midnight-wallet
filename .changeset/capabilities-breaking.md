---
'@midnightntwrk/wallet-sdk-capabilities': major
---

Breaking changes since 3.x

In 3.x this package served ledger-v8 alone. It now serves `@midnightntwrk/ledger-v8` and `@midnightntwrk/ledger-v9`
side by side, and its proving, simulation and submission names say which ledger version they serve.

- **Proving.** `ProvingService<TProven, TUnproven>` and `ProvingServiceEffect<TProven, TUnproven>` name the unproven
  transaction they accept as well as the one they return, with no defaults, and fail with `ProvingFailure`. The 3.x
  factories, all of them ledger-v8, are renamed:

  | 3.x                                   | Now                                     |
  | ------------------------------------- | --------------------------------------- |
  | `fromProvingProvider(Effect)`         | `fromV8ProvingProvider(Effect)`         |
  | `makeServerProvingServiceEffect`      | `makeV8ServerProvingServiceEffect`      |
  | `makeWasmProvingServiceEffect`        | `makeV8WasmProvingServiceEffect`        |
  | `makeSimulatorProvingService(Effect)` | `makeV8SimulatorProvingService(Effect)` |
  | `UnboundTransaction`                  | `V8UnboundTransaction`                  |

  `makeDefaultProvingService(Effect)`, `makeServerProvingService` and `makeWasmProvingService` are removed: use
  `makeDefaultVersionedProvingService(configuration, forks)`, which routes each transaction to its ledger version's
  backend, or a ledger-v9 factory such as `makeV9ServerProvingService`. `DefaultProvingConfiguration` is
  `{ provingServerUrl?, provers? }`.

- **Pending transactions become transaction lifecycle records.** `./pendingTransactions` is replaced by
  `./transactionLifecycle`, and `PendingTransactionsService`, `PendingTransactionsServiceImpl`,
  `PendingTransactionsServiceEffect` and `PendingTransactionsServiceEffectImpl` by `TransactionLifecycleService`,
  `TransactionLifecycleServiceImpl`, `TransactionLifecycleServiceEffect` and `TransactionLifecycleServiceEffectImpl`,
  which keep one record per transaction (see the additions). `addPendingTransaction(tx)` becomes `submitted(facts)` and
  `clear(tx)` becomes `reverted(identifiers)`; `state()` returns `{ records }`. `init` and `restore` take `txTraits`, a
  trait per ledger version (wrap a single trait with `TransactionTraits.singleTrait`), and an optional clock. A custom
  service implements the whole interface, `serializeState()` included. `PendingTransactions` and its state functions are
  replaced by the `Lifecycle`, `TransactionTraits` and `LifecycleFormat` namespaces, and `InitParams` and
  `DefaultPendingTransactionsServiceConfiguration` by `TransactionLifecycleServiceInitParams` and
  `DefaultTransactionLifecycleServiceConfiguration`.
- **Transaction traits.** A `TransactionTrait` provides `intentHashes`, `inputs` and `ttl`, and no longer
  `hasTTLExpired` or `isOneIncludedInOther`. It may add `formOf`, and `deserialize` takes an optional form.
- **Stored format.** The service saves format `v2`. A `v1` store saved by 3.x is read and upgraded; 3.x cannot read
  `v2`.
- **Simulation.** The simulators are exported per ledger version: 3.x's `Simulator` and its helpers are now under `V8`,
  ledger-v9's under `V9`, and no single-ledger simulator is exported unqualified. The deprecated `getBlockEventsSince`
  is removed (use `getBlockEventsFrom`). `makeSimulatorSubmissionService` and `SimulatorSubmissionConfiguration` are now
  `makeV9SimulatorSubmissionService` and `V9SimulatorSubmissionConfiguration`, over the ledger-v9 simulator.
- **Submission.** `makeDefaultSubmissionService(Effect)` submits either ledger version's finalized transaction
  (`AnyVersionFinalizedTransaction`) when no transaction type is named.
- **Dependencies.** Depends on `@midnightntwrk/ledger-v9` `^1.0.0` beside `@midnightntwrk/ledger-v8`, and on
  `@midnightntwrk/zkir-v2` `^2.2.0`.
