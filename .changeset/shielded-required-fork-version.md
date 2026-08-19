---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-testkit': major
---

**`DefaultShieldedConfiguration` gains a required `forkVersion`. Every site that builds a shielded — or facade —
configuration must add it.**

`forkVersion` is the protocol version at which a chain hands over from the pre-fork ledger version to the post-fork one.
The shielded wallet is being made able to register a variant either side of that boundary, and the boundary itself is a
property of the chain an application points at, not of the SDK — so the SDK cannot supply it. It is required rather than
defaulted on purpose: a wrong value does not degrade gracefully, it decides which ledger version reads the chain.

```ts
import { ShieldedWallet, V9_NATIVE_FORK_VERSION } from '@midnightntwrk/wallet-sdk-shielded';

const wallet = ShieldedWallet({
  networkId,
  indexerClientConnection,
  txHistoryStorage,
  forkVersion: V9_NATIVE_FORK_VERSION,
});
```

**`V9_NATIVE_FORK_VERSION` (`2000000`) is the value for a ledger-v9-native chain**, and it is measured rather than
assumed: a `midnight-node` 2.x reports protocol version `2000000` on its ledger events — the runtime version scaled, not
a small ordinal and not the ledger major. A chain on the previous node line reports a 1.x-encoded value, which is below
it, so a wallet configured with this constant stays on the pre-fork variant on a genuinely pre-fork chain and reaches
the post-fork variant on any v9-native one. Prefer it over a hand-written number for exactly that reason.

It is **not** a default — `forkVersion` stays required at every construction site. **The final mainnet fork constant is
still open**; when it is fixed, a `ProtocolVersion.Forks.*` value will join this one and this field will keep working
unchanged.

Reaching further than the shielded package:

- **facade** — `DefaultConfiguration` is an intersection that includes `DefaultShieldedConfiguration`, so every facade
  configuration literal needs `forkVersion` too. This is the reason for the major.
- **testkit** — `WalletConfiguration` is now built on `DefaultShieldedConfiguration` rather than on the post-fork
  variant's configuration, and therefore carries `forkVersion`. `TestEnvironment.getWalletConfig()` supplies it, so
  suites driving the testkit through that factory need no change; anything assembling a `WalletConfiguration` by hand
  does.

`DefaultV1Configuration` and `DefaultV2Configuration` are unchanged and deliberately do **not** gain the field: neither
variant knows there is another one, and `forkVersion` is the wallet layer's alone.

Registration is still single-variant in this release, so nothing changes behaviourally: this is the configuration
contract landing ahead of the two-variant wallet that consumes it.
