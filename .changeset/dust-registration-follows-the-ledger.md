---
'@midnightntwrk/wallet-sdk-dust-wallet': patch
'@midnightntwrk/wallet-sdk-unshielded-wallet': patch
'@midnightntwrk/wallet-sdk-facade': patch
---

After the hard fork, a wallet holding native NIGHT can re-register for dust generation and the registration funds its
own fee from retroactive dust. Previously it could not: the fork wipes the ledger's dust generation state and the
chain-side replay restores cNIGHT-backed generation only, so such a wallet arrived post-fork with zero dust — while
every carried Night UTxO still reported `registeredForDustGeneration: true`, because that is a creation-time value the
indexer never revises. The SDK read that flag to decide whether a registration was self-funding, so it built a
zero-fee "re-registration" the node rejected with `Malformed(BalanceCheckOverspend)`; `waitForGeneratedDust` never
resolved, and every subsequent transfer failed at build with `InsufficientFunds: could not balance dust`.

The fee decision now follows the ledger's own `generationless_fee_availability` rule instead of the carried flag: a
Night UTxO earns a registration's fee allowance exactly when the dust wallet holds no dust coin backed by it. The
dust wallet answers that from its own state (`CoinsAndBalancesCapability.isGenerationless`,
`DustWalletState.isGenerationless`), and the three decisions that used to read the flag — the registration fee sum,
the facade's pre-submission fail-fast, and the `waitForGeneratedDust` wait — all follow it now. Crossing the fork also
reports carried Night UTxOs as generating no dust, which is what the ledger says of them. The
`registeredForDustGeneration` flag remains available as display metadata.

`NightUtxoSplitForDustRegistration` gains `hasGenerationlessGuaranteed`, saying whether the registration funds its own
fee at all; `claimableFeePayment(dustState, nightUtxos, now)` is exported from the dust wallet for callers that want
the amount `waitForGeneratedDust` waits on. Callers of the dust wallet's public API are unaffected — the added state
argument is internal to the variant capabilities.

Known limitation, deliberately accepted until the indexer reports `registeredForDustGeneration` as of the queried block
rather than as of the UTxO's creation: Night registered to generate dust for _another_ wallet has no dust coin in the
registering wallet, so it reads as generationless there, and a later re-registration by that wallet would claim a
self-funding allowance the ledger does not grant. The node refuses it (`InsufficientDustForRegistrationFee`), so nothing
is lost, but such a redesignation cannot be built for now. When the indexer flag becomes trustworthy the rule will
combine both signals: generationless iff no backing dust coin and the flag is false.
