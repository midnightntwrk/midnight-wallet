import { describe, it, expect, vi } from 'vitest';
import { DefaultV1Variant, V1Builder } from '../V1Builder';
import { CoreWallet, NetworkId } from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import { WalletError } from '../WalletError';
import { Effect, Either, Encoding, Option, pipe, Ref, SubscriptionRef } from 'effect';
import { SubmissionService } from '../Submission';
import { makeDefaultTransactingCapability } from '../Transacting';
import { TestTransactions } from '@midnight-ntwrk/wallet-node-client-ts/testing';
import { NodeContext } from '@effect/platform-node';
import { WalletSeed } from '@midnight-ntwrk/abstractions';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { makeDefaultKeysCapability } from '../Keys';
import { V1State } from '../RunningV1Variant';

describe('V1 Variant', () => {
  it('gracefully stops submission service', async () => {
    const makeFakeSubmission = Ref.make<boolean>(false).pipe(
      Effect.map((ref) => ({
        wasClosedRef: ref,
        submitTransaction: () =>
          Effect.fail(WalletError.submission(new Error('This submission implementation does not submit'))),
        close: (): Effect.Effect<void> => Ref.set(ref, true),
      })),
    );

    const result = await Effect.gen(function* () {
      const fakeSubmission = yield* makeFakeSubmission;
      const variant: DefaultV1Variant = new V1Builder()
        .withDefaults()
        .withSubmission(() => fakeSubmission)
        .build({
          networkId: zswap.NetworkId.Undeployed,
          relayURL: new URL('http://localhost:9944'),
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8080',
          },
          provingServerUrl: new URL('http://localhost:6300'),
          costParameters: {
            additionalFeeOverhead: 1n,
            ledgerParams: zswap.LedgerParameters.dummyParameters(),
          },
        });
      const initialState = V1State.initEmpty(
        zswap.SecretKeys.fromSeed(
          WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
        ),
        zswap.NetworkId.Undeployed,
      );
      yield* variant.start({ stateRef: yield* SubscriptionRef.make(initialState) }, initialState);
      return fakeSubmission.wasClosedRef;
    }).pipe(
      Effect.scoped,
      Effect.flatMap((ref) => Ref.get(ref)),
      Effect.runPromise,
    );

    //Having the wallet start and end before getting ref allows to meaningfully read
    // its state as a sign whether close was called or not
    expect(result).toBe(true);
  });

  it('reverts transaction, which failed submission', async () => {
    const config = {
      networkId: zswap.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        additionalFeeOverhead: 1n,
        ledgerParams: zswap.LedgerParameters.dummyParameters(),
      },
    };
    const expectedState = V1State.initEmpty(zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1)), zswap.NetworkId.Undeployed);
    const testProgram = Effect.gen(function* () {
      const theTransaction = yield* TestTransactions.load.pipe(Effect.map((t) => t.initial_tx));
      const failingSubmission: SubmissionService<zswap.Transaction> = {
        submitTransaction: () => Effect.fail(WalletError.submission(new Error('boo!'))),
        close: () => Effect.void,
      };
      const transacting = makeDefaultTransactingCapability(config, () => ({
        coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
        coinSelection: chooseCoin,
        keysCapability: makeDefaultKeysCapability(),
      }));
      const spiedRevert = vi.spyOn(transacting, 'revert');
      spiedRevert.mockImplementation((state, transaction) => {
        if (
          Encoding.encodeHex(transaction.serialize(zswap.NetworkId.Undeployed)) ===
          Encoding.encodeHex(theTransaction.serialize(zswap.NetworkId.Undeployed))
        ) {
          // Returning a completely different state allows to later test that it is properly connected, without invoking the actual logic
          return Either.right(expectedState);
        } else {
          return Either.left(WalletError.other('Unexpected tx'));
        }
      });

      const variant = new V1Builder()
        .withDefaults()
        .withSubmission(() => failingSubmission)
        .withTransacting(() => transacting)
        .build(config);
      const initialState = CoreWallet.emptyV1(
        new zswap.LocalState(),
        zswap.SecretKeys.fromSeed(
          WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
        ),
        NetworkId.fromJs(zswap.NetworkId.Undeployed),
      );
      const stateRef = yield* SubscriptionRef.make(initialState);
      const running = yield* variant.start({ stateRef: stateRef }, initialState);
      const submissionResult = yield* running.submitTransaction(theTransaction).pipe(Effect.either);
      const lastState = yield* SubscriptionRef.get(stateRef);

      return { submissionResult, lastState };
    });

    const result = await pipe(testProgram, Effect.scoped, Effect.provide(NodeContext.layer), Effect.runPromise);

    expect(pipe(result.submissionResult, Either.getLeft, Option.getOrThrow).message).toMatch('boo!');
    expect(result.lastState).toBe(expectedState);
  });
});
