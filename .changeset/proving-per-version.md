---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-prover-client': minor
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk': minor
---

Prove on either side of a protocol boundary. Routing a transaction to a prover by the version stamped on it already
worked; every backend, however, was bound to ledger-v9 — it drove `Transaction.prove` with ledger-v9's cost
model, framed its proof-server requests with ledger-v9's payload helpers, and resolved key material at a fixed circuit
line. A pre-fork entry in `provingServers` was therefore accepted by configuration and could not be honoured: handing a
ledger-v8 transaction ledger-v9's cost model fails at the wasm-bindgen boundary with `expected instance of
CostModel`. There is now a backend per ledger version, and the registration that says which serves which range of
protocol versions.

Proving backends are configured with `provers`, which — unlike `provingServers` — can also name the in-process prover:

```ts
const configuration = {
  forkVersion,
  provers: [
    { sinceVersion: ProtocolVersion.MinSupportedVersion, backend: { kind: 'server', url: v8ProofServer } },
    { sinceVersion: forkVersion, backend: { kind: 'wasm' } },
  ],
};
```

`provingServers` and `provingServerUrl` are unchanged and still supported; precedence is `provers` > `provingServers` >
`provingServerUrl`, and naming none is still a `ProvingConfigurationError`. A backend whose range spans `forkVersion` —
which `provingServerUrl` always does — is split at the boundary and driven by each ledger version in turn, so the same
description frames correctly on both sides. Whether one proof server can in fact prove both is an operational fact
about that server, not something the SDK can enforce: no published image serves both today, so a chain with history
below the boundary wants an entry per side. The in-process prover works on bytes and does serve both, with the same
published circuits.

Each registered backend refuses the other ledger version's transaction with a new `ProvingEpochMismatchError` naming
the epoch it serves, rather than passing a foreign object to a ledger that cannot read it.

BREAKING CHANGE (`@midnightntwrk/wallet-sdk-capabilities`) — `makeDefaultVersionedProvingService` and
`makeDefaultVersionedProvingServiceEffect` take the chain's fork version as a second argument, and a new
`makeDefaultProvingServices(configuration, forkVersion)` exposes the registry they build. The facade passes
`configuration.forkVersion` for you; only a direct caller of these factories is affected. `ProvingServiceEffect`'s error
channel widens from `ProvingError` to `ProvingFailure` (`ProvingError | ProvingEpochMismatchError`) — existing
implementations stay assignable. The facade's `InitParams.provingService` widens to
`VersionedProvingService<AnyVersionUnboundTransaction, AnyVersionUnprovenTransaction>`, which existing ledger-v9
implementations also satisfy.

`@midnightntwrk/wallet-sdk-prover-client` gains `@midnight-ntwrk/ledger-v8` as a runtime dependency, so
`HttpProverClient` can frame a ledger-v8 request as ledger-v8 would: `asV8ProvingProvider()` alongside the
unchanged `asProvingProvider()`, which `asV9ProvingProvider()` now also names. Both ledgers are WASM modules, so a consumer bundling this package directly now ships
both; users of `@midnightntwrk/wallet-sdk` or `-capabilities` already did.
`WasmProver.makeDefaultKeyMaterialProvider` now takes an optional `{ circuits: 8 | 9 }` naming the circuit line to read,
defaulting to what both ledger versions accept.
