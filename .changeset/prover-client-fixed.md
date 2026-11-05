---
'@midnightntwrk/wallet-sdk-prover-client': patch
---

Fixes and other changes since 1.x

- The bundled key material providers (`makeDefaultKeyMaterialProvider`, `makeV8KeyMaterialProvider`,
  `makeV9KeyMaterialProvider`) check what they read before it is used. Every file is checked against the SHA-256 its
  ledger release declares, and a mismatch fails with `KeyMaterialIntegrityError`. An error answer from the host is no
  longer taken for key material: it fails with `KeyMaterialFetchError` (5xx and 429 answers are retried first), and an
  unreachable host fails with `KeyMaterialTransferError` (also retried). A parameter size the ledger does not publish
  fails with `UnknownPublicParametersError`. Through `proveTransaction` they surface as a `ClientError` whose `cause` is
  the ledger's own error, which names the key material error in its message. These providers need Web Crypto.
- The default key material is read from the ledger's public host rather than a development bucket.
