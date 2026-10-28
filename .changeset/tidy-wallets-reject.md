---
'@midnightntwrk/wallet-sdk-unshielded-wallet': major
'@midnightntwrk/wallet-sdk-shielded': major
'@midnightntwrk/wallet-sdk-dust-wallet': major
---

fix: wallet Promise methods reject with the wallet error itself, not an Effect `FiberFailure`

Every public Promise method of the unshielded, shielded and dust wallets ran its Effect with
`Effect.runPromise`, so a failure rejected with Effect's `FiberFailure` wrapper: `instanceof` against the
wallet's error classes was `false` and the error's `_tag` and fields (`tokenType`, `amount`, ...) were
`undefined`, reachable only through Effect internals. The methods now cross the Promise boundary through
the `runPromiseThrowingFailure` helper the dust wallet already used for `ensureFeeCoverage`, so a typed
failure rejects with the wallet's own error object and a defect or interruption rejects with an `Error`
carrying the pretty-printed cause. Consumers that matched on the `"(FiberFailure) ..."` name string need
to switch to `_tag` or `instanceof`.
