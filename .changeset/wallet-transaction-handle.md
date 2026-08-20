---
'@midnightntwrk/wallet-sdk-abstractions': minor
---

**A transaction an application carries no longer has to name a ledger version.** `WalletTransaction` is an opaque
handle: it seals a transaction of whichever ledger version built it, and carries the protocol version that version
serves as ordinary readable data.

Additive — nothing existing changes shape. What it makes possible is the thing an SDK spanning a protocol boundary
otherwise cannot offer: one type an application can hold across the fork. A transaction built before the boundary and
one built after it are objects of two different runtimes with no conversion between them, so any signature naming
either one names a ledger version, and breaks when the chain moves on.

- **The carried transaction is unreachable.** It lives behind a `#private` field, so an application cannot come to
  depend on which version produced it — which is the whole point, and why this is a class rather than a record. What is
  readable is `protocolVersion`, `stage` and `serialize()`.
- **The stage is a type parameter**, spelled `UnprovenTx`, `UnboundTx` and `FinalizedTx`, so a signature that needs a
  finalized transaction still says so and a caller holding an unproven one still finds out at compile time. `AnyTx`
  covers the operations — reverting, say — that take a transaction at whatever stage it reached.
- **`WalletTransaction.adopt(stage, tx, version)`** seals a transaction an application built for itself, with the
  ledger version it imported directly. The version passed is a claim, and the SDK holds the caller to it.
- **`WalletTransaction.unwrapWithin(handle, range)`** is where that claim is enforced: a caller states the range of
  protocol versions it can act at and is refused, with a typed `ProtocolVersionMismatchError`, when the stamp falls
  outside it. Having the check in one place is why no caller has to invent it, and why "pre-fork bytes cannot be used
  post-fork" is a fact about the type rather than a convention.
- **`toWire`/`fromWire`** move a handle between processes as a JSON envelope carrying its own format version, the
  protocol version, the stage and the bytes. Deliberately minimal: the dApp-connector contract is still open, and an
  envelope that guessed at it would be harder to reconcile than one carrying the minimum. `fromWire` takes the decoder,
  because choosing a ledger version is the caller's to make and hardcoding one here would be the very thing the handle
  removes.

This is the type the wallets and the facade are stated in terms of. Nothing routed through it at the point this landed;
by the end of this release everything does — every public method that took or returned a ledger transaction takes or
returns a handle instead (see *The facade speaks transaction handles* and *Transact on either side of the protocol
boundary*).
