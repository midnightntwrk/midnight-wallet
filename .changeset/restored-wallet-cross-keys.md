---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

**A wallet restored from a snapshot written below the fork boundary can now be started, and crosses the fork.** The
shielded and dust wallets gain two instance starts, `startWithSeed(seed)` and `startWithKeys({ v8, v9 })`, which mirror
the class-level ones onto a wallet that already exists. They are what a restored wallet needs, and until now nothing was:
snapshots deliberately carry no key material, so a restored wallet synchronizes nothing until it is started again — and
the only instance start, `start(secretKeys)`, takes the post-fork ledger version's key alone. On a snapshot written below
the boundary the variant that restores is the pre-fork one, whose synchronization that key cannot serve, so the start
failed with `MissingStartAuxError` and the two remedies its message named existed only as statics, which build a _fresh_
wallet and discard the state the caller restored. There was no working start path at all for such a wallet.

Started with either of the new methods, a restored pre-fork wallet reads the stretch of chain its snapshot never saw,
hands over at the boundary, and arrives on the far side with everything it held — the shielded wallet carrying its
commitment tree, the dust wallet re-discovering its dust from the indexer's replay.

`start(secretKeys)` is unchanged and still the right call for a wallet restored at or past the boundary, where the key an
application holds is the key the running variant needs. It goes on refusing a pre-fork-restored wallet rather than
accepting a key that cannot serve the variant that is running — accepting it would leave the wallet silently
unsynchronized, which is the foot-gun the keys-by-epoch product exists to prevent — but its message now names the two
instance starts that would have worked instead of the statics that would not.

The new methods are on the forking wallet types only. `ShieldedWalletAPI` and `DustWalletAPI` are unchanged, so
single-variant wallets built through `CustomShieldedWallet` / `CustomDustWallet` are unaffected: they speak one ledger
version, and the key material `start` takes is always the right one.
