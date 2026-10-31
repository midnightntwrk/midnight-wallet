---
'@midnightntwrk/wallet-sdk-capabilities': major
'@midnightntwrk/wallet-sdk-facade': major
---

fix(capabilities)!: reject the promise-facing services with their typed failure

Every promise-facing service in capabilities rejected with Effect's `FiberFailure` wrapping its failure, so a caller
could not catch the class the service names. They now reject with the failure itself.

BREAKING CHANGE:

- The provers, `makeDefaultSubmissionService`, `makeIndexerChainVersionProbe`, the block-data fetchers and
  `PendingTransactionsServiceImpl` reject with their typed failure, such as `ProvingError`, `SubmissionError` or
  `ChainVersionUnavailableError`, and so does the facade's `finalizeTransaction`. Catch the class itself instead of
  unwrapping the fiber failure.
