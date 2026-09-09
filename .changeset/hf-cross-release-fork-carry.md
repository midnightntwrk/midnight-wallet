---
---

test(shielded-wallet): carry a snapshot from an earlier release across the ledger boundary

Test-only, and it closes `HFW-MIG-09`.

The corpus cases stop once a foreign snapshot has decoded; every crossing test in the suite migrates state this build
wrote a moment earlier. Neither reaches the step between them, and it is the one that can only fail for a wallet that
upgraded: the shielded carry is `ZswapLocalState.deserialize(previous.state.serialize())`, so a state decoded from
another release's bytes is re-serialized by *this* build's ledger-v8 and handed to ledger-v9. The corpus was written
against ledger-v8 8.1.2 and the build resolves 8.1.0, so those are genuinely not the same encoder.

Two cases, folded into `crossReleaseCorpus.test.ts` rather than a new file, since they rest on the same fixtures and
the same argument. Assertions are the corpus's own literals: comparing the migrated wallet against the source would be
satisfied by a carry that returned its input untouched.

**No equivalent for unshielded or dust, deliberately.** Both were written, measured and cut. Unshielded's carry is a
field copy, so once bytes have decoded their provenance cannot matter, and the booking-release mutation it would have
covered is already caught by four existing tests. Dust carries no ledger object from the previous state at all. Only
shielded re-encodes across two WASM modules, which is the only place a format drift between releases can hide.

Honest about the evidence: no source mutation isolates these cases — the carry is shared, so `v2/test/migration.test.ts`
catches a broken one first. Their value is as a drift canary against a class of failure that lives in the fixture data
rather than in the code, which is the same argument that justified the corpus itself.
