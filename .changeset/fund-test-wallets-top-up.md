---
---

Tests only: the remote funding script tops wallets up instead of sending fixed amounts. A test wallet is brought to five
Night UTxOs, one of them ten times the usual amount, and to minimum shielded balances of tNight and native tokens 1 and
2. A wallet with no Dust has that larger UTxO registered for Dust generation, so it can pay fees. The stable wallet is
brought to the balances the balance-constant suite asserts, read from one shared table, and is left untouched when it
already holds more. The script runs on its own with `yarn test-fund`. The native token transfer suite's coin-count
checks now hold on a long-lived wallet.
