---
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-unshielded-wallet': minor
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-dust-wallet': minor
---

**Every wallet now notices a protocol-version change even when no traffic of its own reaches it.** On all three wallets
— shielded, unshielded and dust — both variants' indexer-backed sync source re-asks the chain which version its tip is
on, on a timer, and feeds the answer into the same state-recording path the timeline uses. Recording a version past the
boundary hands the wallet over exactly as an event or a transaction carrying that version would.

Until now a wallet observed the chain's version only from what the indexer served it, and what it is served can be
silent indefinitely. The zswap and dust event subscriptions have no progress arm at all — they say nothing when there is
nothing to say — and the unshielded subscription's progress arm reports only how far this address's timeline goes,
carrying no version. So on a chain that crossed a protocol boundary and then produced no shielded traffic, no dust
traffic, or nothing addressed to this wallet, the wallet was told nothing and stayed on the pre-fork variant
indefinitely, with everything the facade built through it routed to the pre-fork ledger. It crossed only once somebody
made a transaction it happened to see.

The check is gated so it can never outrun unread history. Handing over parks the sync cursor where it stands and the
next variant resumes from there, so anything still unread below the source's tip would arrive at a variant that cannot
read it — or, on the unshielded side, would be applied by a variant that never saw the history leading to it. Each check
therefore reads the chain's tip first and the far end of the relevant timeline second (that order is what makes the
answer sound), and the version is recorded only when the wallet is level with that far end. A check that cannot be
completed is skipped in silence; the next one is the retry, and sync is never failed by one.

Each wallet's second question is the one its own source can answer:

- **Shielded** asks the zswap event timeline for its `maxId`, and short-circuits on a chain whose commitment tree has
  never grown — such a chain provably holds no zswap event.
- **Dust** asks the dust event timeline for its `maxId`. It has no equivalent short-circuit, and deliberately does not
  invent one: a `ParamChange` is a dust ledger event and moves neither the commitment tree nor the generation tree, so
  the block's two end indices at zero prove nothing about the timeline being empty. A chain holding literally no dust
  event therefore crosses on its first dust event rather than on the watcher.
- **Unshielded** asks its own address's timeline for `highestTransactionId`, one past its own cursor — the indexer's
  cursor is inclusive, so asking at the cursor itself would re-deliver the already-applied boundary transaction. An
  address the chain has never mentioned reports zero, which is how a wallet that has never been paid still crosses.

Each package's `DefaultSyncConfiguration` takes an optional `versionWatch: { intervalMs }`, defaulting to 30 seconds;
zero or less turns the check off, which is what a source driving a wallet from something other than a live chain wants.
A wallet on a chain that has not moved off the version it started from spends one small query per interval and opens
nothing else.

The shielded and dust `WalletSyncUpdate` types gain a `VersionSignal` arm and become tagged unions on both variants —
code matching on them exhaustively, or reading `.updates` off them without narrowing, has to narrow on `_tag` now. The
unshielded `WalletSyncUpdate` likewise gains a `VersionSignal` member, narrowed on `type`; the schema-decoded shape it
had is still exported, now as `IndexerSyncUpdate`. The simulator-backed sources are unchanged and need no watcher: their
blocks carry their version, so a quiet chain cannot strand a wallet there. Dust's projections-based fast sync
(`makeEventLessSyncService`) is also unchanged — it keeps no event cursor for the gate to compare against, so its
existing no-hand-over limitation stands, now noted as such.

`indexer-client` gains three subscriptions that ask an existing field a different question and carry their own injection
tags: `ZswapEventTip` and `DustLedgerEventTip` (`id` and `maxId` only, never the event bytes) and
`UnshieldedTransactionTip` (the progress arm's `highestTransactionId`, and nothing but a type discriminator on the
transaction arm).
