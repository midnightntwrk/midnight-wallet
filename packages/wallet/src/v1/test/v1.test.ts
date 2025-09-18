import { describe, it, expect, vi } from 'vitest';
import { DefaultV1Variant, V1Builder } from '../V1Builder';
import * as ledger from '@midnight-ntwrk/ledger';
import { WalletError } from '../WalletError';
import { Effect, Either, Encoding, Option, pipe, Ref, SubscriptionRef } from 'effect';
import { SubmissionService } from '../Submission';
import { makeDefaultTransactingCapability } from '../Transacting';
import { NodeContext } from '@effect/platform-node';
import { WalletSeed } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { makeDefaultKeysCapability } from '../Keys';
import { V1State } from '../RunningV1Variant';
import { CoreWallet } from '../CoreWallet';
import { FinalizedTransaction } from '../Transaction';
import { makeFakeTx } from '../../test/genTxs';

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
          networkId: ledger.NetworkId.Undeployed,
          relayURL: new URL('http://localhost:9944'),
          indexerClientConnection: {
            indexerHttpUrl: 'http://localhost:8080',
          },
          provingServerUrl: new URL('http://localhost:6300'),
          costParameters: {
            additionalFeeOverhead: 1n,
            ledgerParams: ledger.LedgerParameters.dummyParameters(),
          },
        });
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(
        WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
      );
      const initialState = V1State.initEmpty(secretKeys, ledger.NetworkId.Undeployed);
      yield* variant.start({ stateRef: yield* SubscriptionRef.make(initialState) });
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
      networkId: ledger.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        additionalFeeOverhead: 1n,
        ledgerParams: ledger.LedgerParameters.dummyParameters(),
      },
    };
    const expectedState = V1State.initEmpty(
      ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 1)),
      ledger.NetworkId.Undeployed,
    );
    const testProgram = Effect.gen(function* () {
      const theTransaction = makeFakeTx(100n) as unknown as FinalizedTransaction; // @TODO optimize
      const failingSubmission: SubmissionService<FinalizedTransaction> = {
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
          Encoding.encodeHex(transaction.serialize(ledger.NetworkId.Undeployed)) ===
          Encoding.encodeHex(theTransaction.serialize(ledger.NetworkId.Undeployed))
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
      const secretKeys = ledger.ZswapSecretKeys.fromSeed(
        WalletSeed.fromString('0000000000000000000000000000000000000000000000000000000000000001'),
      );
      const initialState = CoreWallet.empty(new ledger.ZswapLocalState(), secretKeys, ledger.NetworkId.Undeployed);
      const stateRef = yield* SubscriptionRef.make(initialState);
      const running = yield* variant.start({ stateRef: stateRef });
      const submissionResult = yield* running.submitTransaction(theTransaction).pipe(Effect.either);
      const lastState = yield* SubscriptionRef.get(stateRef);

      return { submissionResult, lastState };
    });

    const result = await pipe(testProgram, Effect.scoped, Effect.provide(NodeContext.layer), Effect.runPromise);

    expect(pipe(result.submissionResult, Either.getLeft, Option.getOrThrow).message).toMatch('boo!');
    expect(result.lastState).toBe(expectedState);
  });
});
