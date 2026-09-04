---
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-capabilities': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-facade': minor
'@midnightntwrk/wallet-sdk': minor
'@midnightntwrk/wallet-sdk-testkit': minor
'@midnightntwrk/wallet-sdk-prover-client': minor
'@midnightntwrk/wallet-sdk-node-client': minor
'@midnightntwrk/wallet-sdk-address-format': minor
---

**What a real hard fork taught the wallets.** Running the SDK through an actual ledger 8 → 9 fork on live node and
indexer builds — a chain with pre-fork history, a governance runtime upgrade, and the indexer's real behaviour at the
boundary — found five things the fork simulation could not, and this release fixes all of them. It also moves the wallet
onto the ledger-v9 `1.0.0-rc.4` line, which the post-fork chain runs.

**The shielded wallet carries its local state across the fork as bytes.** Both ledger versions serialize a shielded
wallet's local state under the same codec (the transaction codec moved at the fork; this one did not), so the migration
hands the pre-fork state's serialization straight to the post-fork ledger's deserializer. The commitment tree arrives
whole, coins at the Merkle indices the chain gave them, together with the outputs the wallet was still expecting from
its own transactions — which no chain announces a second time. The previous design waited for the indexer to replay
pre-fork history as new-version events; it does not, and a wallet that waited lost its coins. A characterization test
pins the shared codec against both ledger modules; if a future major moves it the migration fails loudly rather than
misreading bytes. Coin commitments and nullifiers need secret keys a migration is not given, so a migrated wallet
declares them pending and the first synchronization update computes them; a snapshot written in that window restores
unchanged. `PreviousLedgerWallet` now also requires the previous wallet's serializable local state; wallets built
through the SDK satisfy this as they are.

**A wallet with no snapshot starts on the version the chain's timeline starts under, not the version its tip is on.**
The default chain-version probe asks for the protocol version of the chain's first block, and the exported effect is
named for that question: `currentChainVersion` becomes `timelineStartChainVersion` and `LatestBlockAnswer` becomes
`BlockVersionAnswer`. Routing on the tip put a fresh wallet on the post-fork variant, which then read pre-fork history
it could not deserialize and ended up holding nothing. A chain post-fork since its own genesis still starts a fresh
wallet directly on the post-fork variant. Applications supplying their own `chainVersionProbe` should answer the same
question.

**Every wallet notices a protocol-version change even when no traffic of its own reaches it.** Until now a wallet
learned the chain's version only from what it was served, and on a chain that forked and then went quiet — or never
mentioned this address — it stayed on the pre-fork variant indefinitely. Unshielded now reads the version off the
`UnshieldedTransactionsProgress` frames it already receives: the indexer states the tip's protocol version on every
frame alongside `highestTransactionId`, and the wallet adopts it once it has applied everything up to that id. Zero is
the indexer reporting no block indexed yet, not a version. Shielded and dust have no progress frames to read, so their
sync sources re-ask the chain's tip version on a timer (`DefaultSyncConfiguration.versionWatch: { intervalMs }`,
default 30 seconds, zero or less turns it off), gated so a hand-over can never outrun unread history: the version is
recorded only when the wallet is level with the far end of its own event timeline. The shielded and dust
`WalletSyncUpdate` types gain a `VersionSignal` arm and become tagged unions narrowed on `_tag`; the unshielded one
gains a `VersionSignal` member narrowed on `type`, and its schema-decoded shape is exported as `IndexerSyncUpdate`.
`indexer-client` pins the indexer schema at `4.4.0-rc.2` (commit `25da0487`) — the floor the unshielded wallet now
requires — and gains the `ZswapEventTip` and `DustLedgerEventTip` subscriptions, which select ids only, never event
bytes. Dust's projections-based fast sync is unchanged and keeps its documented no-hand-over limitation.

**Crossing the fork returns unshielded UTxOs booked by still-pending transactions to the available balance.** A
pre-fork transaction can never be included in a post-fork block — the transaction codec moved — so a booking's reason
expires at the boundary, and carried over it would have been permanent: nothing post-fork can identify the coins to
un-book them. The release is exact: the hand-over fires only once the complete pre-fork timeline is applied, so any
transaction that did land has already confirmed and cleared its own bookings. At the boundary an application sees the
pending balance drop to zero and the available balance rise by the same amount; the total is unchanged. The shielded
wallet has the same shape of problem and cannot yet be fixed the same way, because its pending spends live inside the
ledger's local state and the ledger call for clearing them is currently a no-op.

**A wallet restored from a snapshot written below the fork boundary can be started, and crosses.** The shielded and
dust forking wallets gain `startWithSeed(seed)` and `startWithKeys({ v8, v9 })` as instance methods. Snapshots carry no
key material, and the only instance start, `start(secretKeys)`, took the post-fork key alone — which the pre-fork variant
that restores such a snapshot cannot use — so there was no working start path at all. `start(secretKeys)` is unchanged
and still right for a wallet restored at or past the boundary; its refusal message now names the two starts that work.
`ShieldedWalletAPI` and `DustWalletAPI` are unchanged.

**The wallet builds against `@midnightntwrk/ledger-v9` `1.0.0-rc.4`** and its test infrastructure runs node
`2.1.0-beta.1`, indexer `4.4.0-rc.2-25da0487` and proof-server `9.0.0-rc.7`. rc.4's type declarations are byte-identical
to rc.3's, so nothing in the TypeScript surface moves; the change is inside the WASM. The two lines are not
proof-compatible for dust: rc.4 changed the dust `spend` circuit (the spend now binds the spent UTXO's nonce and its
generation info to a shared initial nonce), so every rc.4 verifier rejects an rc.3-circuit proof with
`Malformed(InvalidDustSpendProof)`. The SDK's HTTP prover sends only the proof preimage and the proof server resolves the
dust circuit from keys compiled into its binary, so the proof server's build decides the circuit — and proof-server image
tags do not track ledger tags: `9.0.0-rc.4` predates the circuit change by five weeks, while the rc.4 ledger declares
proof-server `9.0.0-rc.7`. Deployments moving to rc.4 must move the proof server with it. `@midnight-ntwrk/ledger-v8`,
the pre-fork side of the twins, is untouched.
