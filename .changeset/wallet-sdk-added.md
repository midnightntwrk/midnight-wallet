---
'@midnightntwrk/wallet-sdk': minor
---

Additions since 1.x

- `./ledger/v8` and `./ledger/v9` re-export each ledger version, for applications that build their own transactions.
- `./shielded/v2`, `./dust/v2` and `./unshielded/v2` export the ledger-v9 variants beside the ledger-v8 `/v1` subpaths,
  and `./capabilities/codecs` exports `LedgerParametersCodec`.
- The root exports `Signing` and `UnsupportedSignatureKindError`, and, through the packages it re-exports,
  `Token.night`, `parseTokenType`, `DustGenerationRates`, `asV8DustParameters` and `asV9DustParameters`, so token types,
  signatures and Dust parameters need no ledger import.
