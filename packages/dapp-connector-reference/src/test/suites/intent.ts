/** Intent test suite. Tests makeIntent method for creating swap/intent transactions. */

import { describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import type { DesiredInput, DesiredOutput } from '@midnight-ntwrk/dapp-connector-api';
import { deserializeTransaction, verifyTransaction, hasDustSpend } from '../../testing.js';
import type { DappConnectorTestContext } from '../context.js';
import { matchesString } from './_matchers.js';

/** Run intent tests against the provided context. */
export const runIntentTests = (context: DappConnectorTestContext): void => {
  const { environment } = context;
  const { addresses, addressKeys, tokenTypes } = environment;

  describe('API contract', () => {
    it('should have makeIntent method on ConnectedAPI', async () => {
      vi.setConfig({ testTimeout: 1_000, hookTimeout: 1_000 });
      const { api, disconnect } = await context.createConnectedAPI();

      try {
        expect(typeof api.makeIntent).toBe('function');
      } finally {
        await disconnect();
      }
    });
  });

  describe('result structure', () => {
    it('should return deserializable sealed transaction', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded },
        ];

        const result = await setup.wallets.alice.api.makeIntent(desiredInputs, desiredOutputs, {
          intentId: 'random',
          payFees: true,
        });
        const { bindingRandomness } = deserializeTransaction(result.tx);

        expect(typeof bindingRandomness).toBe('bigint');
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('input handling', () => {
    // SKIPPED — pending SDK bug: cross-kind intents silently drop the kind that has no inputs.
    //
    // Spec expectation: a swap intent declaring 100 shielded standard IN and 50 unshielded alternate OUT is a valid
    // intent. The unshielded side is the user's *request*, to be satisfied by a counterparty when intents are merged.
    //
    // Actual behaviour today: the unshielded output is silently dropped. The returned transaction's intent carries no
    // `guaranteedUnshieldedOffer` and no `fallibleUnshieldedOffer` — only a dust fee spend. Caller has no signal that
    // anything went wrong. The assertion above on `imbalances.unshielded` and `containsUnshieldedOutputs` both fail.
    //
    // Root cause (confirmed by a standalone throwaway probe — `UnshieldedOffer.new([], outputs, [])` constructs and
    // round-trips through Intent serialisation just fine, so this is a wallet bug, not a ledger constraint):
    //
    //   1. `packages/facade/src/index.ts:905-908` gates the unshielded path on `unshieldedInputs !== undefined`. With
    //      no unshielded inputs requested, `parseDesiredInputs` returns `undefined` for that side, so
    //      `this.unshielded.initSwap(...)` is never called and the outputs disappear.
    //
    //   2. Even if (1) is fixed by passing `unshieldedInputs = {}`,
    //      `packages/unshielded-wallet/src/v1/Transacting.ts:284` `initSwap` builds `targetImbalances` only from
    //      `desiredInputs`. The resulting tx then reaches `dust.balanceTransactions` at facade index.ts:916, which
    //      observes a −N imbalance on the output token kind and fails with `InsufficientFundsError` — the fee balancer
    //      treats the user-declared swap imbalance as a deficit to source rather than as the intent's whole point.
    //
    // Fix needed (both must land):
    //   (a) drop the `&& xxxInputs !== undefined` gates in `facade.initSwap`;
    //   (b) make `dust.balanceTransactions` (or its caller) balance only the fee-token imbalance, preserving the
    //       user-declared swap imbalance through to the intent-merge step.
    it.skip('should create swap with shielded input and unshielded output', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // Alice has the INPUT token (shielded standard) and Night for fees, but NOT the OUTPUT token (unshielded
      // alternate). Otherwise the wallet would auto-source the output from her own balance and the unshielded
      // imbalance wouldn't appear.
      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded },
        ];

        const result = await setup.wallets.alice.api.makeIntent(desiredInputs, desiredOutputs, {
          intentId: 'random',
          payFees: true,
        });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.imbalances).toEqual({
          shielded: { [tokenTypes.standard]: -100n },
          unshielded: { [tokenTypes.alternate]: 50n },
        });

        if (addressKeys !== undefined) {
          expect(
            verification.containsUnshieldedOutputs([
              { owner: addressKeys.unshielded.verifyingKey, tokenType: tokenTypes.alternate, value: 50n },
            ]),
          ).toBe(true);
        }

        expect(verification.hasDustSpend).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    // SKIPPED — pending SDK bug: cross-kind intents silently drop the kind that has no inputs (mirror of the test
    // above; same family of bugs but the shielded-side failure mode differs).
    //
    // Spec expectation: a swap intent declaring 100 unshielded alternate IN and 50 shielded alternate OUT is valid.
    //
    // Actual behaviour today: the shielded output is silently dropped. The returned transaction ends up with two
    // intent segments — one for the user's unshielded path (converted to a self-balanced no-op transfer since the
    // wallet insists on producing a balanced offer), one for the dust fee — both with empty imbalances. The
    // `imbalances.shielded` assertion above fails because the shielded side never appeared.
    //
    // Root cause:
    //
    //   1. `packages/facade/src/index.ts:900-903` gates the shielded path on `shieldedInputs !== undefined`; with no
    //      shielded inputs requested, `this.shielded.initSwap(...)` is never called.
    //
    //   2. If (1) is fixed by passing `shieldedInputs = {}`, the wallet refuses for a different reason than the
    //      unshielded mirror does. `packages/shielded-wallet/src/v1/Transacting.ts:208` `initSwap` *does* build the
    //      output offer via `#processDesiredOutputsPossiblyEmpty` (line 233 — empty inputs are tolerated on the output
    //      side). But it then calls `#balanceGuaranteedSection` with empty initial AND target imbalances, which
    //      reaches `#prepareOffer` (line 271) with an empty recipe. `Arr.match.onEmpty` at line 292 returns
    //      `Option.none`; the caller at lines 414-419 throws `"Could not create a valid guaranteed offer"`. The
    //      wallet refuses to produce an empty balancing offer to merge with the user's output.
    //
    // Fix needed (both must land):
    //   (a) drop the `&& xxxInputs !== undefined` gates in `facade.initSwap`;
    //   (b) when `shielded.initSwap` sees empty initial+target imbalances, skip `#balanceGuaranteedSection` and
    //       return `outputsParseResult.unprovenTxToBalance` directly (or change `#prepareOffer` to return an empty
    //       `ZswapOffer` instead of `Option.none` when both inputs and outputs are empty). Plus the same fee-balancer
    //       fix from the test above (the shielded output produces an unshielded-side imbalance once it's been merged
    //       with the unshielded input side).
    it.skip('should create swap with unshielded input and shielded output', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // Alice has the INPUT token (unshielded alternate) and Night for fees, but not shielded alternate (output).
      const setup = await setupWallets({
        alice: {
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredInputs: DesiredInput[] = [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n }];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded },
        ];

        const result = await setup.wallets.alice.api.makeIntent(desiredInputs, desiredOutputs, {
          intentId: 'random',
          payFees: true,
        });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.imbalances).toEqual({
          shielded: { [tokenTypes.alternate]: 50n },
          unshielded: { [tokenTypes.alternate]: -100n },
        });

        if (addressKeys !== undefined) {
          expect(
            verification.containsShieldedOutputs(addressKeys.shielded.secretKeys, [
              { tokenType: tokenTypes.alternate, value: 50n },
            ]),
          ).toBe(true);
        }

        expect(verification.hasDustSpend).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    it('should create balanced swap with multiple inputs and outputs', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const desiredInputs: DesiredInput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n },
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n },
        ];
        const desiredOutputs: DesiredOutput[] = [
          { kind: 'shielded', type: tokenTypes.standard, value: 100n, recipient: addresses.shielded },
          { kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded },
        ];

        const result = await setup.wallets.alice.api.makeIntent(desiredInputs, desiredOutputs, {
          intentId: 'random',
          payFees: true,
        });
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.isBalanced).toBe(true);

        if (addressKeys !== undefined) {
          expect(
            verification.containsOutputs({
              shielded: {
                secretKeys: addressKeys.shielded.secretKeys,
                outputs: [{ tokenType: tokenTypes.standard, value: 100n }],
              },
              unshielded: [{ owner: addressKeys.unshielded.verifyingKey, tokenType: tokenTypes.alternate, value: 50n }],
            }),
          ).toBe(true);
        }
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('intentId option', () => {
    it('should accept intentId as "random" and place in non-zero segment', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded }],
          { intentId: 'random', payFees: true },
        );
        const segmentIds = Array.from(deserializeTransaction(result.tx).intents?.keys() ?? []);

        expect(segmentIds).toHaveLength(1);
        const [segmentId] = segmentIds;
        expect(segmentId).toBeGreaterThanOrEqual(1);
        expect(segmentId).toBeLessThanOrEqual(65535);
      } finally {
        await setup.disconnect();
      }
    });

    it('should place intent in exact segment when intentId is 1', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded }],
          { intentId: 1, payFees: true },
        );
        const segmentIds = Array.from(deserializeTransaction(result.tx).intents?.keys() ?? []);

        expect(segmentIds).toEqual([1]);
      } finally {
        await setup.disconnect();
      }
    });

    it('should place intent in exact segment when intentId is arbitrary value', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded }],
          { intentId: 42, payFees: true },
        );
        const segmentIds = Array.from(deserializeTransaction(result.tx).intents?.keys() ?? []);

        expect(segmentIds).toEqual([42]);
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('payFees option', () => {
    it('should include DustSpend when payFees is true', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n, [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded }],
          { intentId: 'random', payFees: true },
        );
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });

    it('should NOT include DustSpend when payFees is false', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

      // No Night needed when payFees=false
      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.alternate]: 10_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded }],
          { intentId: 'random', payFees: false },
        );
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(false);
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('transaction properties', () => {
    // NOTE: "sealed transaction (binding randomness present)" is verified in result structure > should return
    // deserializable sealed transaction — not duplicated here.

    it('should return transaction with valid TTL', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n, recipient: addresses.unshielded }],
          { intentId: 'random', payFees: true },
        );
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.hasValidTtl).toBe(true);
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('imbalance verification', () => {
    // SKIPPED — same SDK bug as `should create swap with shielded input and unshielded output` (cross-kind drop).
    // This test exercises the same flow but asserts the *imbalance shape* directly. With the unshielded output
    // silently dropped (see the breakdown on that test for the full file:line chain), the unshielded entry of
    // `verification.imbalances` is empty and the `toEqual` comparison fails.
    it.skip('should create exact imbalances matching desired inputs/outputs', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // Alice has the INPUT token but not the OUTPUT token, so the unshielded output remains imbalanced.
      const setup = await setupWallets({
        alice: {
          shielded: { [tokenTypes.standard]: 10_000n },
          unshielded: { [tokenTypes.night]: 100_000n },
        },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded }],
          { intentId: 'random', payFees: true },
        );
        const verification = verifyTransaction(deserializeTransaction(result.tx));

        expect(verification.imbalances).toEqual({
          shielded: { [tokenTypes.standard]: -100n },
          unshielded: { [tokenTypes.alternate]: 50n },
        });
      } finally {
        await setup.disconnect();
      }
    });
  });

  describe('property-based tests', () => {
    // Each iteration uses a fresh `setupWallets` so the wallet's pending-tx tracking from prior iterations doesn't
    // leak. Coin selection between iterations is irrelevant since each iteration sees full inventory.
    const intentIdArbitrary = fc.oneof(fc.constant('random' as const), fc.integer({ min: 1, max: 65535 }));

    const desiredInputArbitrary = fc.oneof(
      fc.record({
        kind: fc.constant('shielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
      }),
      fc.record({
        kind: fc.constant('unshielded' as const),
        type: fc.constantFrom(tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
      }),
    );

    const desiredOutputArbitrary = fc.oneof(
      fc.record({
        kind: fc.constant('shielded' as const),
        type: fc.constantFrom(tokenTypes.standard, tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
        recipient: fc.constantFrom(addresses.shielded, addresses.shielded2),
      }),
      fc.record({
        kind: fc.constant('unshielded' as const),
        type: fc.constantFrom(tokenTypes.alternate),
        value: fc.bigInt({ min: 1n, max: 100n }),
        recipient: fc.constantFrom(addresses.unshielded, addresses.unshielded2),
      }),
    );

    // Property-test arbitrary is constrained to same-kind / both-kinds layouts because of two independent SDK bugs.
    // Each is also filed as its own `it.skip` test above; the filter exists so that the remaining property tests can
    // run honestly until the SDK is fixed.
    //
    //   1. Empty `inputs` arrays — `facade.initSwap` throws `'Unexpected transaction state'`
    //      (`packages/facade/src/index.ts:913`) because with no inputs at all both `hasShieldedPart` and
    //      `hasUnshieldedPart` are false, even though an intent with outputs-only is perfectly valid per spec.
    //
    //   2. Cross-kind layouts (inputs of one kind, outputs of another) — see the three `it.skip` tests above. The
    //      kind without inputs is silently dropped by the facade gate at `facade.initSwap:900-908`; even if the gate
    //      is removed, the wallet's `initSwap` plus the dust fee balancer refuse to preserve the declared imbalance.
    //
    // Once both are fixed in the SDK, drop this filter so the arbitrary covers the full intent-shape space.
    const inputsOutputsArbitrary = fc
      .tuple(
        fc.array(desiredInputArbitrary, { minLength: 1, maxLength: 3 }),
        fc.array(desiredOutputArbitrary, { maxLength: 3 }),
      )
      .filter(([inputs, outputs]) => {
        const inputKinds = new Set(inputs.map((i) => i.kind));
        return outputs.every((o) => inputKinds.has(o.kind));
      });

    it('should have DustSpend iff payFees is true', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

      await fc.assert(
        fc.asyncProperty(
          inputsOutputsArbitrary,
          intentIdArbitrary,
          fc.boolean(),
          async ([inputs, outputs], intentId, payFees) => {
            const setup = await setupWallets({
              alice: {
                shielded: { [tokenTypes.standard]: 100_000n, [tokenTypes.alternate]: 100_000n },
                unshielded: { [tokenTypes.alternate]: 100_000n, [tokenTypes.night]: 100_000n },
              },
            });
            try {
              const result = await setup.wallets.alice.api.makeIntent(inputs, outputs, { intentId, payFees });
              const verification = verifyTransaction(deserializeTransaction(result.tx));
              expect(verification.hasDustSpend).toBe(payFees);
            } finally {
              await setup.disconnect();
            }
          },
        ),
        { numRuns: 5 },
      );
    });

    // SKIPPED — pending SDK bug: `intentId` is not honoured by the wallet, and the connector's workaround is
    // incomplete. This property test catches the regression correctly; the assertion is right and the failure is
    // real.
    //
    // Spec expectation: `makeIntent` places the user's intent at the segment specified by `intentId`. The property
    // iterates over arbitrary `segmentId` and asserts the resulting intent map's keys equal `[segmentId]` — i.e., a
    // single intent, at the requested segment.
    //
    // Actual behaviour today, in two layers:
    //
    //   1. `packages/facade/src/index.ts:866` `initSwap` does not accept `intentId` (the connector passes it in
    //      `swapOptions` at `ConnectedAPI.ts:387-394`, but the facade signature drops it on the floor).
    //      `packages/unshielded-wallet/src/v1/Transacting.ts:284` `initSwap` builds an `Intent.new(ttl)` and hands it
    //      to `Transaction.fromParts(...)`, which places it at the default segment (typically 1). For unshielded
    //      inputs that need balancing, an additional fee-balancing intent is added at another segment by the dust
    //      balancer path (see also the `findAvailableSegmentId` use at line 210, called from the balanceTransaction
    //      path; the TODO at line 211 notes "ledger 8.1.0 will be able to set the segment id when constructing the
    //      tx" — same family of root cause).
    //
    //   2. The connector tries to compensate in `ConnectedAPI.placeIntentAtSegment` (`ConnectedAPI.ts:131`), but
    //      that helper only handles the single-intent case: when `entries.length !== 1` it returns the recipe
    //      UNCHANGED. So for `payFees=true` with unshielded inputs (and any other path that adds a fee intent), the
    //      connector relocation is a silent no-op and the user's intent stays at segment 1 instead of `segmentId`.
    //
    // Note: the two non-property tests above (`intentId is 1`, `intentId is arbitrary`) happen to pass only because
    // their specific wallet setup (shielded input + unshielded-output that gets silently dropped per the cross-kind
    // bug above) produces a single-intent recipe. They are not exhaustive evidence the placement contract holds.
    //
    // Fix needed: thread `intentId` through `facade.initSwap` → `unshielded.initSwap` / `shielded.initSwap`, so the
    // wallet places the user's intent at the requested segment from the start. Fee balancing then picks any *other*
    // available segment via `findAvailableSegmentId`. The connector's `placeIntentAtSegment` helper can be deleted
    // once the wallet honours `intentId`.
    it.skip('should place intent in exact segment specified by numeric intentId', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

      await fc.assert(
        fc.asyncProperty(
          inputsOutputsArbitrary,
          fc.integer({ min: 1, max: 65535 }),
          fc.boolean(),
          async ([inputs, outputs], segmentId, payFees) => {
            const setup = await setupWallets({
              alice: {
                shielded: { [tokenTypes.standard]: 100_000n, [tokenTypes.alternate]: 100_000n },
                unshielded: { [tokenTypes.alternate]: 100_000n, [tokenTypes.night]: 100_000n },
              },
            });
            try {
              const result = await setup.wallets.alice.api.makeIntent(inputs, outputs, {
                intentId: segmentId,
                payFees,
              });
              const segmentIds = Array.from(deserializeTransaction(result.tx).intents?.keys() ?? []);

              expect(segmentIds).toEqual([segmentId]);
            } finally {
              await setup.disconnect();
            }
          },
        ),
        { numRuns: 5 },
      );
    });

    it('should have correct output counts', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 });

      await fc.assert(
        fc.asyncProperty(
          inputsOutputsArbitrary,
          intentIdArbitrary,
          fc.boolean(),
          async ([inputs, outputs], intentId, payFees) => {
            const setup = await setupWallets({
              alice: {
                shielded: { [tokenTypes.standard]: 100_000n, [tokenTypes.alternate]: 100_000n },
                unshielded: { [tokenTypes.alternate]: 100_000n, [tokenTypes.night]: 100_000n },
              },
            });
            try {
              const shieldedOutputCount = outputs.filter((o) => o.kind === 'shielded').length;
              const unshieldedOutputCount = outputs.filter((o) => o.kind === 'unshielded').length;

              const result = await setup.wallets.alice.api.makeIntent(inputs, outputs, { intentId, payFees });
              const verification = verifyTransaction(deserializeTransaction(result.tx));

              expect(verification.shieldedOutputCount).toBeGreaterThanOrEqual(shieldedOutputCount);
              expect(verification.unshieldedOutputCount).toBeGreaterThanOrEqual(unshieldedOutputCount);
            } finally {
              await setup.disconnect();
            }
          },
        ),
        { numRuns: 5 },
      );
    });
  });

  describe('insufficient balance', () => {
    it('should reject with InsufficientFunds when wallet lacks shielded balance for inputs', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // Has Night for fees, but no shielded standard token
      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        await expect(
          setup.wallets.alice.api.makeIntent(
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
            { intentId: 1, payFees: true },
          ),
        ).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: matchesString(/insufficient|balance/i),
        });
      } finally {
        await setup.disconnect();
      }
    });

    it('should reject with InsufficientFunds when wallet lacks unshielded balance for inputs', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

      // tokenTypes.standard and tokenTypes.night are the same hex string; use alternate to test
      // "lacks this non-Night unshielded token" without conflating with Night funding.
      const setup = await setupWallets({
        alice: { unshielded: { [tokenTypes.night]: 100_000n } },
      });

      try {
        await expect(
          setup.wallets.alice.api.makeIntent(
            [{ kind: 'unshielded', type: tokenTypes.alternate, value: 100n }],
            [{ kind: 'unshielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.unshielded }],
            { intentId: 1, payFees: true },
          ),
        ).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: matchesString(/insufficient|balance/i),
        });
      } finally {
        await setup.disconnect();
      }
    });

    it('should reject with InsufficientFunds when wallet lacks dust for fees', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

      const setup = await setupWallets({
        alice: { shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n } },
      });

      try {
        await expect(
          setup.wallets.alice.api.makeIntent(
            [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
            [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
            { intentId: 1, payFees: true },
          ),
        ).rejects.toMatchObject({
          code: 'InsufficientFunds',
          reason: matchesString(/insufficient|dust|fee/i),
        });
      } finally {
        await setup.disconnect();
      }
    });

    it('should NOT reject for insufficient dust when payFees is false', async () => {
      const setupWallets = context.setupWallets;
      if (setupWallets === undefined) return;
      vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

      const setup = await setupWallets({
        alice: { shielded: { [tokenTypes.standard]: 10_000n, [tokenTypes.alternate]: 10_000n } },
      });

      try {
        const result = await setup.wallets.alice.api.makeIntent(
          [{ kind: 'shielded', type: tokenTypes.standard, value: 100n }],
          [{ kind: 'shielded', type: tokenTypes.alternate, value: 50n, recipient: addresses.shielded }],
          { intentId: 1, payFees: false },
        );
        expect(result.tx).toMatch(/^[0-9a-f]+$/i);
        expect(hasDustSpend(deserializeTransaction(result.tx))).toBe(false);
      } finally {
        await setup.disconnect();
      }
    });
  });
};
