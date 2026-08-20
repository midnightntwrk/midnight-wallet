---
'@midnightntwrk/wallet-sdk': minor
---

**Both ledger versions now ship from the umbrella package, at `./ledger/v8` and `./ledger/v9`.** An application that
authors its own transactions has always had to import a ledger package directly — depending on something this package
does not promise, and pinning a version by hand in its own `package.json`. Now it imports the one package it already
depends on, and the import line says which ledger version's rules the bytes follow.

The subpaths are named for the **ledger** version rather than a variant ordinal, because that is what an author is
choosing. Seal what you build with `WalletTransaction.adopt('Unproven', tx, version)` to hand it back to the wallet.

**Neither is re-exported from the root barrel.** These are WebAssembly modules, and an application that only carries
transactions should not pay for a ledger it never names; having to ask for one by name is what keeps that true.

**Which one to import is a property of the chain, not of this release.** Both are shipped side by side because both are
real: a chain is pre-fork until it forks, and mainnet is pre-fork until then. An authoring path that only ever imports
`./ledger/v9` compiles cleanly and **fails at run time on every chain that has not yet crossed**, with a
`ProtocolVersionMismatchError` — the wallet refuses a transaction built for a version it is not acting at. Read the
protocol version from the wallet's state and author against the version the chain is on. The check is a run-time one by
design: the compiler cannot know which chain an application will be pointed at.

The package also gains a test runner, which is how the above is pinned rather than asserted.
