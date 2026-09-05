---
'@midnightntwrk/wallet-sdk-abstractions': minor
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-testkit': major
'@midnightntwrk/wallet-sdk': major
---

feat(sdk)!: state the fork schedule as a map keyed by ledger version

The wallet, facade and block-data-fetcher configurations take `forks: { v9 }` — the protocol version from which
ledger-v9 reads the chain — in place of the single `forkVersion`. The value and its meaning are unchanged; only the shape
is. A single number could name one boundary and no more, so the next hard fork would have changed the shape of every
application's configuration. A map keyed by ledger version adds a key (`v10`) instead, which is why the change is made
now, while 2.0 is still in beta. The type is `ProtocolVersion.ForkSchedule` in the abstractions package; ledger-v8 begins
at `MinSupportedVersion` and has no entry, and every entry stays required in the wallet packages, for the same reason as
before: where a chain forks is a fact about the chain, not the SDK. The facade presets `DefaultForkSchedule` when `forks`
is left out — see its own changeset.

BREAKING CHANGE — replace the field in every configuration you build:

```ts
// before
{ forkVersion: ProtocolVersion.V9NativeForkVersion, ... }
// after
{ forks: { v9: ProtocolVersion.V9NativeForkVersion }, ... }
```

Factories that take a single boundary directly (`defaultLedgerParametersCodecs(forkVersion)`, `ProtocolVersion.epochOf`)
are unchanged; the facade passes `configuration.forks.v9` to them. Proving takes the whole schedule, since its backends
are keyed the same way — see the proving changeset.
