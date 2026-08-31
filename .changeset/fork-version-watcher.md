---
'@midnightntwrk/wallet-sdk-indexer-client': minor
'@midnightntwrk/wallet-sdk-shielded': minor
---

**The shielded wallet now notices a protocol-version change even when no shielded traffic reaches it.** Both variants'
indexer-backed sync source re-asks the chain which version its tip is on, on a timer, and feeds the answer into the same
state-recording path the events use — so recording a version past the boundary hands the wallet over exactly as an event
carrying that version would.

Until now a shielded wallet observed the chain's version only from event payloads, and the zswap event subscription has
no progress arm: it says nothing at all when there is nothing to say. On a chain that crossed a protocol boundary and
then produced no shielded traffic, the wallet was told nothing and stayed on the pre-fork variant indefinitely, with
everything the facade built through it routed to the pre-fork ledger. It crossed only once somebody made a transaction
that emitted zswap events.

The check is gated so it can never outrun unread history. Handing over parks the sync cursor where it stands and the
next variant re-fetches from there, so an event still unread below the source's tip would arrive as bytes of the version
that preceded it — unreadable by the ledger now reading them, and possibly carrying a coin that would then never reach
the far side. Each check therefore reads the chain's tip first and the far end of its event timeline second (that order
is what makes the answer sound), and the version is recorded only when the wallet is level with that far end, or when
the chain provably holds no zswap event at all. A check that cannot be completed is skipped in silence; the next one is
the retry, and sync is never failed by one.

`DefaultSyncConfiguration` takes an optional `versionWatch: { intervalMs }`, defaulting to 30 seconds; zero or less
turns the check off, which is what a source driving a wallet from something other than a live chain wants. A wallet on a
chain that has not moved off the version it started from spends one small query per interval and opens nothing else.

`WalletSyncUpdate` gains a `VersionSignal` arm on both variants, and on the pre-fork variant the type becomes a tagged
union — code matching on it exhaustively, or reading `.updates` off it without narrowing, has to narrow on `_tag` now.
The simulator-backed source is unchanged and needs no watcher: its blocks carry their version, so a quiet chain cannot
strand a wallet there.

`indexer-client` gains a `ZswapEventTip` subscription: the same `zswapLedgerEvents` field asked a different question —
how far the timeline goes, rather than what is on it — so it selects only `id` and `maxId` and carries its own injection
tag.
