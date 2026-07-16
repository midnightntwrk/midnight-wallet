---
paths:
  - 'packages/shielded-wallet/**'
  - 'packages/unshielded-wallet/**'
  - 'packages/dust-wallet/**'
  - 'packages/capabilities/**'
  - 'packages/facade/**'
  - 'packages/docs-snippets/**'
  - 'packages/wallet-integration-tests/**'
  - 'packages/e2e-tests/**'
---

# Transactions — domain knowledge

When building or inspecting transactions, consult the spec — don't guess protocol semantics.

## Type and spec sources

- **Ledger types**: `node_modules/@midnight-ntwrk/ledger-v8/ledger-v8.d.ts` — `Transaction`, `Intent`, `ZswapOffer`,
  `DustActions`, etc.
- **Ledger spec** (midnight-ledger repo, `spec/`): `intents-transactions.md` (structure, intents, segments, binding),
  `zswap.md` (shielded protocol), `dust.md` (fee mechanics), `night.md` (unshielded), `cost-model.md` (fees).
- **Wallet spec** (midnight-architecture repo): `components/WalletEngine/Specification.md` — transaction lifecycle
  (pending → confirmed → finalized/discarded), coin lifecycle, balance types, state operations.

## Key facts

- **Type parameters**: `Transaction<Signaturish, Proofish, Bindingish>` encodes signature/proof/binding state.
  `FinalizedTransaction = Transaction<SignatureEnabled, Proof, Binding>` — ready for submission.
- **Segments**: 0 = guaranteed (executes first), 1–65535 = fallible (can fail independently).
- **Balance check**: `tx.imbalances(segmentId)` returns `Map<TokenType, bigint>` — zero means balanced.
- **Fees**: paid in Dust via `intent.dustActions.spends` (`DustSpend`). Dust is a resource generated from Night — never
  call it a token.

## Working examples

- API usage patterns: `packages/docs-snippets/src/` (transfers, swap, balancing, initialization) — always check here
  first.
- Transaction building: `packages/unshielded-wallet/src/v1/Transacting.ts`; tests
  `packages/unshielded-wallet/src/v1/test/transacting.test.ts`,
  `packages/shielded-wallet/src/v1/test/transacting.test.ts` (imbalance assertions).
- Balancing: `packages/capabilities/src/balancer/test/Balancer.test.ts`.
