---
'@midnight-ntwrk/wallet-sdk-dust-wallet': patch
'@midnight-ntwrk/wallet-sdk-shielded': patch
'@midnight-ntwrk/wallet-sdk-prover-client': minor
---

## Added

- Implemented WebAssembly (WASM) proving provider as an alternative to server-based proving
- Added `ProverClient.WasmConfig` interface for WASM prover configuration
- Introduced Web Worker-based proof generation with message-based communication
- Added comprehensive test coverage for both server and WASM proving services

## Changed

- Updated proving interface to support custom key material providers
- Migrated from Filecoin keys to Midnight-specific keys in Wasm prover

## Internal

- Refactored test utilities to support multiple proving backends
