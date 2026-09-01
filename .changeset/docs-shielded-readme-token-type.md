---
'@midnightntwrk/wallet-sdk-shielded': patch
---

docs(shielded-wallet): replace 'NIGHT' placeholder in examples — NIGHT is unshielded

The transfer and swap examples used `'NIGHT'` and `'TOKEN_A'` as token types. Both are placeholders the API rejects:
`type` feeds `ledger.createShieldedCoinInfo()`, which needs a real shielded token type (raw hex), and NIGHT is an
unshielded token that can never appear in a shielded offer. The examples now use `tokenType` / `tokenTypeA` /
`tokenTypeB` bindings with a comment saying what to pass. The README's ledger import is also aligned with the package's
actual dependency (`@midnight-ntwrk/ledger-v8`).
