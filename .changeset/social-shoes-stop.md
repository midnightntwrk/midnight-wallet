---
'@midnight-ntwrk/wallet-sdk-shielded': minor
'@midnight-ntwrk/wallet-sdk-prover-client': minor
---

Expose proving provider for custom prover integration

- Added `asProvingProvider()` method to `HttpProverClient` and `WasmProver` to expose underlying proving providers
- Added `create()` factory functions to `HttpProverClient` and `WasmProver` for direct instantiation without Effect layers
- Added `fromProvingProvider()` and `fromProvingProviderEffect()` helper functions to `Proving` module for creating proving services from custom providers
- Refactored `makeServerProvingService()` and `makeWasmProvingService()` to use the new provider-based approach
- Added comprehensive test coverage for custom prover workflows in both HTTP and WASM configurations
