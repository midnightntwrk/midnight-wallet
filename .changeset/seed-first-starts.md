---
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
'@midnightntwrk/wallet-sdk-facade': major
'@midnightntwrk/wallet-sdk-testkit': major
---

**Wallets are started from seeds.** A seed is the only key material that crosses a protocol boundary — every ledger
version derives its own keys from the same seed and arrives at the same identity — so a wallet started from seeds can
follow the chain across a fork, and one started from key objects of a single ledger version cannot.

**BREAKING — deleted, with no shim:**

- `ShieldedWallet(...).startWithSecretKeys(secretKeys)`
- `DustWallet(...).startWithSecretKey(secretKey, dustParameters)`

Both took key objects of one ledger version, which is precisely the wallet that cannot read half the chain. The upgrade
is a compile error on purpose: an alias would have kept the foot-gun and hidden it.

**What replaces them:**

- `startWithSeed(seed)` — the primary path, unchanged in name.
- `startWithKeys({ v8, v9 })` — the escape hatch for a caller that will not part with a seed, with **both** sides
  required. A partial product would rebuild the very foot-gun the single-key start was. It costs the caller an import of
  both ledger packages and the same derivation performed twice; a seed costs neither.

**BREAKING — `facade.start`** takes `WalletSeeds` (or the both-epochs key product) and an options object, in place of
two positional key objects and a trailing boolean. `facade.doSync` takes the same material.

```diff
- await facade.start(shieldedSecretKeys, dustSecretKey, true);
+ await facade.start(seeds, { manualSync: true });
```

**`DustParameters` is now optional plain data** on every start path — three scalar rates, which both ledger versions'
classes remain structurally assignable to, so an existing `LedgerParameters.initialParameters().dust` argument still
compiles. Omitting it is what removes the last reason a wallet start had to import a ledger.

**Seed hygiene.** A seed-accepting start now derives *both* epochs' key objects eagerly and retains those; the seed
reference is dropped with the calling frame, so from that moment the wallet holds strictly less than it did before and
does the same work. Retained keys are still released by `stop()`, and a wallet that holds only one side says so by name
rather than handing over keys the other ledger runtime would misread. The unshielded wallet retains no key material at
all, as before — its identity is a public address.

As everywhere in this SDK, "cleared" means the SDK stops holding a reference. Neither JavaScript nor WebAssembly offers
a way to guarantee bytes are gone from memory, and no wallet on a general-purpose runtime can promise otherwise.
