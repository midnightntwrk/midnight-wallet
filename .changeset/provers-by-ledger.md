---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk': major
---

feat(proving)!: name a proving backend per ledger version, with the ranges taken from the fork schedule

`provers` is a map keyed by ledger version, the way `forks` is, in place of a list of backends each carrying the protocol
version it starts serving. The boundary between two backends is the chain's fork schedule, and it is now read from
`forks` alone. A `provers` entry could restate it, and a `sinceVersion` that drifted from `forks.v9` framed the versions
in between with one ledger and sent them to a server built for the other, which nothing caught at configuration time.

```ts
// before
{
  forks: { v9 },
  provers: [
    { sinceVersion: ProtocolVersion.MinSupportedVersion, backend: { kind: 'server', url: v8ProofServer } },
    { sinceVersion: v9, backend: { kind: 'wasm' } },
  ],
}
// after
{ forks: { v9 }, provers: { v8: { kind: 'server', url: v8ProofServer }, v9: { kind: 'wasm' } } }
```

`v9` is required, because every new transaction is proved with it. `v8` may be left out on a chain whose pre-fork history
the wallet never authors for; a transaction stamped there then fails with `UnsupportedProvingVersionError`. The next hard
fork adds a key (`v10`) rather than changing the shape. `provingServerUrl` remains the shorthand for one proof server under
every key; `provingServers` is gone, since it carried the same `sinceVersion`.

BREAKING CHANGE (`@midnightntwrk/wallet-sdk-capabilities`) — `ProvingBackends` replaces `ProverActivation` and
`ProvingServerActivation`; `resolveProvingServers` is removed and `resolveProvingBackends(configuration)` returns the
`ProvingBackends` map rather than a registry; `makeDefaultProvingServices`, `makeDefaultVersionedProvingServiceEffect`
and `makeDefaultVersionedProvingService` take the `ProtocolVersion.ForkSchedule` as their second argument in place of a
single fork version. The facade passes `configuration.forks` for you.
