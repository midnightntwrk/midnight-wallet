import { describe } from '@jest/globals';
import { CoreWallet, DefaultSerializeCapability, JsEither, NetworkId } from '@midnight-ntwrk/wallet';
import * as zswap from '@midnight-ntwrk/zswap';
import { CoinInfo } from '@midnight-ntwrk/zswap';
import { Array as Arr, pipe } from 'effect';
import * as fc from 'fast-check';

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
  it('maintains serialize ◦ deserialize === id property', () => {
    const serializationCapability = DefaultSerializeCapability.createV1<
      CoreWallet<zswap.LocalState, zswap.SecretKeys>,
      zswap.SecretKeys
    >(
      (wallet) => wallet.toSnapshot(),
      (aux, snapshot) => CoreWallet.fromSnapshot(aux, snapshot),
    );
    fc.assert(
      fc.property(walletArbitrary(10), ({ wallet }) => {
        const firstIteration = serializationCapability.serialize(wallet);
        const restored = pipe(serializationCapability.deserialize(wallet.secretKeys, firstIteration), (r) =>
          JsEither.get(r),
        );
        const secondIteration = serializationCapability.serialize(restored);

        //We can't meaningfully compare equality, so we compare the result of second serialization
        expect(firstIteration).toEqual(secondIteration);
      }),
      {
        numRuns: 10,
      },
    );
  });
});
