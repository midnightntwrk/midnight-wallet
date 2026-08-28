---
'@midnightntwrk/wallet-sdk-shielded': minor
'@midnightntwrk/wallet-sdk-indexer-client': minor
---

**Crossing a hard fork, the shielded wallet now carries its coins instead of starting empty.** The migration records
each coin the pre-fork wallet held — token type, nonce, value and the index it occupies in the commitment tree — along
with the size that tree had reached, all as plain data. On the first synchronization after the hand-over the new
variant rebuilds its local state from that payload before applying any event: it inserts the carried coins back at
their original indices and fast-forwards over everybody else's commitments with Merkle-tree collapsed updates, fetched
from the indexer's `zswapMerkleTreeCollapsedUpdate` query, or built from the simulated chain in tests. Nothing here
depends on the indexer replaying pre-fork history as new-version events — it does not replay it, and a wallet that
waited for it lost its coins.

A snapshot written mid-crossing carries the pending payload with it and finishes anchoring when the wallet resumes, so
an application that saves state between the fork and the next sync loses nothing. Snapshots written by earlier versions
load exactly as before.

`PreviousLedgerWallet`, the shape a wallet must present to be migrated across the boundary, now also requires the
previous wallet's local state — its unspent coins and the tree size — since that is what the coins are read from. The
previous variant's own state object satisfies this as it is, so wallets built through the SDK are unaffected; only code
that hand-builds a migration input rather than letting the wallet layer pass the previous variant's state has to add
the field.

`@midnightntwrk/wallet-sdk-indexer-client` gains the `zswapMerkleTreeCollapsedUpdate` query that supplies those
collapsed updates, usable on its own.

The dust and unshielded crossings are unchanged and remain correct as they are: the chain itself wipes dust state at the
fork and replays it, so the dust wallet re-discovers its own through ordinary synchronization, and unshielded state is
public UTXO data carried over field for field.
