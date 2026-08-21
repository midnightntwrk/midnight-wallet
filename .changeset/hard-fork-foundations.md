---
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-runtime': minor
---

Groundwork for hard-fork support: the runtime hooks and the test infrastructure the dual-ledger wallets are built on.

- The runtime derives each registered variant's protocol-version range and hands it to the variant as
  `VariantContext.activationRange`, and `Runtime.onVariantActivation` notifies a watcher when a migration activates a
  variant — the hook a wallet uses to restart background synchronization. `Variant.migrateState` may now fail with
  `WalletRuntimeError`; existing implementations remain valid. Breaking only for code that constructs a `VariantContext`
  and calls `Variant.start` directly, which is not part of the normal wallet lifecycle.
- The `simulation` entry point provides a simulator per ledger version (`V8` and `V9`; the v9 names stay exported
  unqualified, so existing code is unaffected) and a `ForkSimulator` that drives one chain across a protocol boundary.
  Simulators carry a protocol-version timeline (`SimulatorConfig.protocolVersion`, `setProtocolVersion`,
  `scheduleFork`, `produceEmptyBlock`), and `ForkSimulatorConfig.translator` states how the pre-fork ledger state
  crosses the boundary, in serialized bytes.
- A new private package, `@midnightntwrk/wallet-sdk-state-translation`, wraps the ledger's v8-to-v9 state translation
  as WebAssembly, so a simulated fork carries the pre-fork chain's real state instead of approximating it. It is a
  development dependency only; published bundles are unaffected. Running the integration tests that use it requires a
  Rust toolchain; building, type-checking, linting and unit tests do not.
- `@midnight-ntwrk/ledger-v8` becomes a runtime dependency of the capabilities package: consumers install two ledger
  WASM modules, which matters for browser bundle size.
