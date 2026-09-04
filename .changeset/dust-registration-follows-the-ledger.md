---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

After the hard fork, a wallet holding native NIGHT can re-register for dust generation and the registration funds its
own fee from retroactive dust. Previously it could not: the fork wipes the ledger's dust generation state and the
chain-side replay restores cNIGHT-backed generation only, so such a wallet arrived post-fork with zero dust — while
every carried Night UTxO still reported `registeredForDustGeneration: true`, the value it was created with. The SDK
reads that flag to decide whether a registration is self-funding, so it built a zero-fee "re-registration" the node
rejected with `Malformed(BalanceCheckOverspend)`; `waitForGeneratedDust` never resolved, and every subsequent transfer
failed at build with `InsufficientFunds: could not balance dust`.

The cross-ledger migration now carries `registeredForDustGeneration` as `false` on every carried Night UTxO. That is
what the ledger says of them after the fork, and what indexer 4.4.0-rc.5 and later reports for them — it scopes the
flag to the chain's current dust epoch, so a UTxO whose generation the fork wiped reads `false`. The indexer never
re-emits a UTxO the wallet already synced before the fork, so the crossing is the only place the wallet's copy can be
brought in line.

`claimableFeePayment(dustState, nightUtxos, now)` is exported from the dust wallet for callers that want the amount
`waitForGeneratedDust` waits on.

Requires indexer >= 4.4.0-rc.5 for a wallet synced fresh after the fork. Older indexers report
`registeredForDustGeneration` as of the UTxO's creation and never revise it, so carried Night still reads `true`, the
SDK builds a zero-fee re-registration, and the node rejects it.
