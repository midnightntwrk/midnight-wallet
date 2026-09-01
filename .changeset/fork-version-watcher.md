---
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

**Every wallet now notices a protocol-version change even when no traffic of its own reaches it.** On all three wallets
— shielded, unshielded and dust — both variants' indexer-backed sync source observes the chain's protocol version
without waiting to be served something that carries it, and feeds what it observes into the same state-recording path
the timeline uses. Recording a version past the boundary hands the wallet over exactly as an event or a transaction
carrying that version would.

Until now a wallet observed the chain's version only from what the indexer served it, and what it is served can be
silent indefinitely. The zswap and dust event subscriptions have no progress arm at all — they say nothing when there is
nothing to say — and the unshielded subscription's progress arm reported only how far this address's timeline goes. So
on a chain that crossed a protocol boundary and then produced no shielded traffic, no dust traffic, or nothing addressed
to this wallet, the wallet was told nothing and stayed on the pre-fork variant indefinitely, with everything the facade
built through it routed to the pre-fork ledger. It crossed only once somebody made a transaction it happened to see.

**Unshielded reads the version off the frames it is already sent.** The indexer now states the protocol version at the
chain's tip on every `UnshieldedTransactionsProgress` frame, and those arrive on an address the chain has never
mentioned exactly as they do on a busy one. The source selects that field and splits it off into a version signal
emitted alongside the progress bookkeeping, so a wallet nobody pays crosses on the next idle frame, with no polling and
no extra request. Zero is not read as a version: it is the indexer reporting that it has indexed no block yet.

This sets a floor. `@midnightntwrk/wallet-sdk-unshielded-wallet` requires an indexer at **4.4.0-rc.2 (commit
`25da0487`)** or newer; against an older one the subscription fails GraphQL validation on the unknown field. The fork
release ships the SDK and the indexer together, so there is no half-deployed configuration to support, and a
feature-detected fallback would mean carrying two mechanisms forever for a transition nobody performs piecemeal.

**Shielded and dust ask on a timer**, because their event subscriptions have nothing equivalent to read: they carry
versions on the items they deliver and say nothing at all when there are none. Each source therefore re-asks the chain
which version its tip is on, on an interval, for as long as sync runs.

Both routes are gated so they can never outrun unread history. Handing over parks the sync cursor where it stands and
the next variant resumes from there, so anything still unread below the source's tip would arrive at a variant that
cannot read it — or, on the unshielded side, would be applied by a variant that never saw the history leading to it. The
version is therefore recorded only when the wallet is level with the far end of the relevant timeline. On shielded and
dust that means reading the chain's tip first and the timeline's far end second, in that order, because that is what
makes two separately-answered questions sound; a check that cannot be completed is skipped in silence, and sync is never
failed by one. On unshielded the two arrive in the same frame, indexed at the same instant, so the ordering problem does
not exist.

Each wallet's second question is the one its own source can answer:

- **Shielded** asks the zswap event timeline for its `maxId`, and short-circuits on a chain whose commitment tree has
  never grown — such a chain provably holds no zswap event.
- **Dust** asks the dust event timeline for its `maxId`. It has no equivalent short-circuit, and deliberately does not
  invent one: a `ParamChange` is a dust ledger event and moves neither the commitment tree nor the generation tree, so
  the block's two end indices at zero prove nothing about the timeline being empty. A chain holding literally no dust
  event therefore crosses on its first dust event rather than on the watcher.
- **Unshielded** reads `highestTransactionId` off the same progress frame that carries the version, and adopts the
  version only once it has applied everything up to it. An address the chain has never mentioned reports zero, which is
  how a wallet that has never been paid still crosses.

The shielded and dust `DefaultSyncConfiguration` takes an optional `versionWatch: { intervalMs }`, defaulting to 30
seconds; zero or less turns the check off, which is what a source driving a wallet from something other than a live
chain wants. The unshielded configuration gains nothing: there is no interval to tune when the answer rides frames that
were arriving anyway.

The shielded and dust `WalletSyncUpdate` types gain a `VersionSignal` arm and become tagged unions on both variants —
code matching on them exhaustively, or reading `.updates` off them without narrowing, has to narrow on `_tag` now. The
unshielded `WalletSyncUpdate` likewise gains a `VersionSignal` member, narrowed on `type`; the schema-decoded shape it
had is still exported, now as `IndexerSyncUpdate`, and its progress arm carries a `protocolVersion` alongside
`highestTransactionId`. The simulator-backed sources are unchanged and need no version check of their own: their blocks
carry their version, so a quiet chain cannot strand a wallet there. Dust's projections-based fast sync
(`makeEventLessSyncService`) is also unchanged — it keeps no event cursor for the gate to compare against, so its
existing no-hand-over limitation stands, now noted as such.

`indexer-client` pins the indexer GraphQL schema at `25da0487`, which adds `protocolVersion` to the progress types, and
selects it on the `UnshieldedTransactionsProgress` arm of the `UnshieldedTransactions` subscription. It also gains two
subscriptions that ask an existing field a different question and carry their own injection tags: `ZswapEventTip` and
`DustLedgerEventTip`, selecting `id` and `maxId` only, never the event bytes.
