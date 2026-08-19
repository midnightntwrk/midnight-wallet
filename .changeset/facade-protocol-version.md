---
'@midnightntwrk/wallet-sdk-facade': minor
---

`FacadeState` gains two additive readings of where the wallets are in the protocol timeline.

`protocolVersion` reports the version each of the three wallets has reached. `activeProtocolVersion` is the lowest of
them: the three follow the same chain but not in lock-step — each recognises a protocol version change when its own
synchronization reaches it — so around a fork they disagree for a while, and a transaction needs all three. The lowest
is the version every wallet is known to understand.

`WalletProtocolVersions` and `lowestProtocolVersion` are exported for callers that want the same rule over versions they
hold themselves.

Purely additive: nothing consumers read today changes shape.
