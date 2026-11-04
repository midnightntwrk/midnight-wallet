---
'@midnightntwrk/wallet-sdk-testkit': patch
---

Tests only: the remote funding script tops wallets up instead of sending fixed amounts. A test wallet is brought to five
Night UTxOs, one of them ten times the usual amount, and to minimum shielded balances of tNight and native tokens 1 and
2. A wallet with no Dust has that larger UTxO registered for Dust generation, so it can pay fees. The stable wallet is
brought to the balances the balance-constant suite asserts, read from one shared table, and is left untouched when it
already holds more. The script runs on its own with `yarn test-fund`. The native token transfer suite's coin-count
checks now hold on a long-lived wallet.

`eventLessDustWallet` now honours `skipLedgerV8DustHistory` as `DustWallet` does, and the testkit environment and the e2e
fixture set it, so a new wallet on a network that crossed the v9 fork starts its Dust at the boundary instead of replaying the ledger-v8 history.
On qanet this cuts a cold sync from about 36 minutes to under 30 seconds. The qanet preset's indexer subscription now uses the indexer host: the host it named does not serve it, so a wallet restored from a snapshot never connected and waited out its ten-minute catch-up before being rebuilt.
