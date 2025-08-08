import { CoreWallet, NetworkId } from '@midnight-ntwrk/wallet';
import { OtherWalletError } from '../WalletError';
import * as zswap from '@midnight-ntwrk/zswap';
import { CoinInfo } from '@midnight-ntwrk/zswap';
import { Array as Arr, Chunk, Effect, pipe, Stream } from 'effect';
import * as fc from 'fast-check';
import { makeDefaultV1SerializationCapability } from '../Serialization';
import { Either } from 'effect';
import { V1State } from '../RunningV1Variant';
import { TestTransactions } from '@midnight-ntwrk/wallet-node-client-ts/testing';
import { NodeContext } from '@effect/platform-node';
import * as ledger from '@midnight-ntwrk/ledger';

const minutes = (mins: number) => 1_000 * 60 * mins;
vi.setConfig({ testTimeout: minutes(1) });

const tokenTypeArbitrary = (maxSize: number) => {
  const number = fc.nat(maxSize);
  const types = Array(number).map(() => zswap.sampleTokenType());
  const tokenTypeArbitrary = fc.constantFrom(...types);

  const nativeTokenTypeArbitrary = fc.constant(zswap.nativeToken());
  return fc.oneof({ weight: 1, arbitrary: nativeTokenTypeArbitrary }, { weight: 1, arbitrary: tokenTypeArbitrary });
};
const secretKeysArbitrary: fc.Arbitrary<zswap.SecretKeys> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((seed) => zswap.SecretKeys.fromSeed(seed));

type OutputPreimage = { coin: CoinInfo; recipient: zswap.SecretKeys };
const outputPreimageArbitrary = (
  keysArbitrary: fc.Arbitrary<zswap.SecretKeys>,
  tokenTypeArbitrary: fc.Arbitrary<zswap.TokenType>,
): fc.Arbitrary<OutputPreimage> => {
  return fc.record({
    coin: fc.record({
      type: tokenTypeArbitrary,
      value: fc.nat().map(BigInt),
      nonce: fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => Buffer.from(bytes).toString('hex')),
    }),
    recipient: keysArbitrary,
  });
};
const transactionArbitrary = (
  outputPreimageArbitrary: fc.Arbitrary<OutputPreimage>,
  depth: number,
): fc.Arbitrary<{
  outputPreimages: OutputPreimage[];
  transaction: zswap.ProofErasedTransaction;
}> => {
  return fc.array(outputPreimageArbitrary, { maxLength: depth, minLength: 1 }).map((outputPreimages) => {
    return {
      outputPreimages,
      transaction: pipe(
        outputPreimages,
        Arr.map((preimage) => {
          const output = zswap.UnprovenOutput.new(
            preimage.coin,
            0,
            preimage.recipient.coinPublicKey,
            preimage.recipient.encryptionPublicKey,
          );
          return zswap.UnprovenOffer.fromOutput(output, preimage.coin.type, preimage.coin.value);
        }),
        (arr) => arr.reduce((offerA, offerB) => offerA.merge(offerB)), // effect lacks equivalent "fold" definition for Array
        (offer) => new zswap.UnprovenTransaction(offer),
        (tx: zswap.UnprovenTransaction) => tx.eraseProofs(),
      ),
    };
  });
};
const walletArbitrary = (txDepth: number) => {
  return secretKeysArbitrary
    .chain((keys) => {
      return fc
        .array(transactionArbitrary(outputPreimageArbitrary(fc.constant(keys), tokenTypeArbitrary(3)), 5), {
          maxLength: txDepth,
        })
        .map((transactions) => ({ transactions, keys }));
    })
    .chain((acc) => {
      return fc
        .constantFrom(
          zswap.NetworkId.Undeployed,
          zswap.NetworkId.DevNet,
          zswap.NetworkId.TestNet,
          zswap.NetworkId.MainNet,
        )
        .map((networkId) => ({ ...acc, networkId }));
    })
    .map(({ transactions, keys, networkId }) => {
      const state: zswap.LocalState = transactions.reduce((state: zswap.LocalState, tx): zswap.LocalState => {
        return state.applyProofErasedTx(keys, tx.transaction, 'success');
      }, new zswap.LocalState());
      const wallet = CoreWallet.emptyV1(state, keys, NetworkId.fromJs(networkId));

      return {
        transactions,
        wallet,
        networkId,
      };
    });
};

describe('V1 Wallet serialization', () => {
  it.each([
    { seed: '0000000000000000000000000000000000000000000000000000000000000001' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000002' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000003' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000004' },
  ])('maintains serialize ◦ deserialize, including transaction history', async ({ seed }) => {
    const capability = makeDefaultV1SerializationCapability();
    const testTxs = await TestTransactions.load.pipe(
      Effect.flatMap((txs) => TestTransactions.streamAllValid(txs).pipe(Stream.runCollect)),
      Effect.provide(NodeContext.layer),
      Effect.runPromise,
    );
    const keys = zswap.SecretKeys.fromSeed(Buffer.from(seed, 'hex'));
    const wallet = V1State.initEmpty(keys, zswap.NetworkId.Undeployed);
    const preparedWallet = Chunk.reduce(testTxs, wallet, (wallet, tx) => {
      const serializedLedgerTx = tx.serialize(ledger.NetworkId.Undeployed);
      const deserializedZswapTx = zswap.Transaction.deserialize(serializedLedgerTx, zswap.NetworkId.Undeployed);

      const newState = wallet.state.applyTx(keys, deserializedZswapTx, 'success');

      return wallet.applyState(newState).addTransaction(deserializedZswapTx).setOffset(newState.firstFree);
    });

    const firstIteration = capability.serialize(preparedWallet);

    const restored = pipe(capability.deserialize(preparedWallet.secretKeys, firstIteration), Either.getOrThrow);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });
  it('maintains serialize ◦ deserialize', () => {
    const capability = makeDefaultV1SerializationCapability();
    fc.assert(
      fc.property(walletArbitrary(10), ({ wallet }) => {
        const firstIteration = capability.serialize(wallet);
        const restored = pipe(capability.deserialize(wallet.secretKeys, firstIteration), Either.getOrThrow);
        const secondIteration = capability.serialize(restored);

        //We can't meaningfully compare equality, so we compare the result of second serialization
        expect(firstIteration).toEqual(secondIteration);
      }),
      {
        numRuns: 10,
      },
    );
  });

  it('handles invalid JSON strings gracefully', () => {
    const capability = makeDefaultV1SerializationCapability();
    const keys = zswap.SecretKeys.fromSeed(
      Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
    );

    fc.assert(
      fc.property(fc.string(), (invalidJson) => {
        const result = capability.deserialize(keys, invalidJson);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left instanceof OtherWalletError).toBe(true);
        }
      }),
    );
  });

  it('handles random valid JSON strings gracefully', () => {
    const capability = makeDefaultV1SerializationCapability();
    const keys = zswap.SecretKeys.fromSeed(
      Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex'),
    );

    fc.assert(
      fc.property(fc.json(), (randomJsonValue) => {
        const result = capability.deserialize(keys, randomJsonValue);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left instanceof OtherWalletError).toBe(true);
        }
      }),
    );
  });
});
