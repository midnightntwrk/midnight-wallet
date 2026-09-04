---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
---

The projections-based dust synchronization now says, at debug level, where each pass resumed from: the block height it
asked the indexer for generations at, the generation and commitment tree indices it already held, and what the chain
reported for each. A pass is a single snapshot fetch, so when one comes back with less dust than expected the only
question worth asking is where it started — and until now those three cursors were visible nowhere outside the
function. They matter most to a wallet that reached this path by migrating across a hard fork, whose first pass runs on
a state produced by the migration rather than by a previous pass.

No behaviour changes; nothing is emitted at the default log level.
