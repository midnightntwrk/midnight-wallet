---
'@midnightntwrk/wallet-sdk-utilities': minor
---

feat(utilities): read the core state of whichever wallet variant produced a state

`@midnightntwrk/wallet-sdk-utilities/testing/variants` adds `eitherCoreStateOf`, for a test or tool that follows a wallet
across a protocol boundary: given a wallet state and the V2 and V1 variants' `coreStateOf`, it returns the core state of
whichever variant produced the state, and fails for a state neither produced. It has a subpath of its own so that a unit
test can use it without loading the container tooling `/testing` carries.
