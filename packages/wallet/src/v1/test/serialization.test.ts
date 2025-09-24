import { OtherWalletError } from '../WalletError';
import * as ledger from '@midnight-ntwrk/ledger';
import { Array as Arr, Chunk, pipe } from 'effect';
import * as fc from 'fast-check';
import { makeDefaultV1SerializationCapability } from '../Serialization';
import { Either } from 'effect';
import { CoreWallet } from '../CoreWallet';
import { EitherOps } from '../../effect';
import { ProofErasedTransaction } from '../Transaction';
import { makeFakeTx } from '../../test/genTxs';

const minutes = (mins: number) => 1_000 * 60 * mins;
vi.setConfig({ testTimeout: minutes(1) });

const tokenTypeArbitrary = (maxSize: number) => {
  const number = fc.nat(maxSize);
  const types = Array(number).map(() => ledger.sampleRawTokenType());
  const tokenTypeArbitrary = fc.constantFrom(...types);

  const nativeTokenTypeArbitrary = fc.constant((ledger.shieldedToken() as { tag: 'shielded'; raw: string }).raw);
  return fc.oneof({ weight: 1, arbitrary: nativeTokenTypeArbitrary }, { weight: 1, arbitrary: tokenTypeArbitrary });
};
const secretKeysArbitrary: fc.Arbitrary<ledger.ZswapSecretKeys> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((seed) => ledger.ZswapSecretKeys.fromSeed(seed));

type OutputPreimage = { coin: ledger.ShieldedCoinInfo; recipient: ledger.ZswapSecretKeys };
const outputPreimageArbitrary = (
  keysArbitrary: fc.Arbitrary<ledger.ZswapSecretKeys>,
  tokenTypeArbitrary: fc.Arbitrary<ledger.RawTokenType>,
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
  transaction: ProofErasedTransaction;
}> => {
  return fc.array(outputPreimageArbitrary, { maxLength: depth, minLength: 1 }).map((outputPreimages) => {
    return {
      outputPreimages,
      transaction: pipe(
        outputPreimages,
        Arr.map((preimage) => {
          const output = ledger.ZswapOutput.new(
            preimage.coin,
            0,
            preimage.recipient.coinPublicKey,
            preimage.recipient.encryptionPublicKey,
          );
          return ledger.ZswapOffer.fromOutput(output, preimage.coin.type, preimage.coin.value);
        }),
        (arr) => arr.reduce((offerA, offerB) => offerA.merge(offerB)), // effect lacks equivalent "fold" definition for Array
        (offer) => ledger.Transaction.fromParts(offer),
        (tx) => tx.eraseProofs(),
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
          ledger.NetworkId.Undeployed,
          ledger.NetworkId.DevNet,
          ledger.NetworkId.TestNet,
          ledger.NetworkId.MainNet,
        )
        .map((networkId) => ({ ...acc, networkId }));
    })
    .map(({ transactions, keys, networkId }) => {
      const state: ledger.ZswapLocalState = transactions.reduce(
        (state: ledger.ZswapLocalState, tx): ledger.ZswapLocalState => {
          return state.applyTx(keys, tx.transaction, 'success');
        },
        new ledger.ZswapLocalState(),
      );
      const wallet = CoreWallet.init(state, keys, networkId);

      return {
        keys,
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
  ])('maintains serialize ◦ deserialize == id property, including transaction history', ({ seed }) => {
    const networkId = ledger.NetworkId.Undeployed;
    const capability = makeDefaultV1SerializationCapability({ networkId });
    const testTxs = Chunk.fromIterable([makeFakeTx(10n), makeFakeTx(20n), makeFakeTx(30n)]);
    const keys = ledger.ZswapSecretKeys.fromSeed(Buffer.from(seed, 'hex'));
    const wallet = CoreWallet.initEmpty(keys, networkId);
    const preparedWallet = Chunk.reduce(testTxs, wallet, (wallet, tx) => {
      const newState = wallet.applyTransaction(keys, tx, { type: 'success' });

      return newState.updateProgress({ appliedIndex: newState.state.firstFree });
    });

    const firstIteration = capability.serialize(preparedWallet);

    const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });
  it('maintains serialize ◦ deserialize == id property', () => {
    const networkId = ledger.NetworkId.Undeployed;
    const capability = makeDefaultV1SerializationCapability({ networkId });
    fc.assert(
      fc.property(walletArbitrary(10), ({ wallet }) => {
        const firstIteration = capability.serialize(wallet);
        const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
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
    const networkId = ledger.NetworkId.Undeployed;
    const capability = makeDefaultV1SerializationCapability({ networkId });

    fc.assert(
      fc.property(fc.string(), (invalidJson) => {
        const result = capability.deserialize(null, invalidJson);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left instanceof OtherWalletError).toBe(true);
        }
      }),
    );
  });

  it('handles random valid JSON strings gracefully', () => {
    const networkId = ledger.NetworkId.Undeployed;
    const capability = makeDefaultV1SerializationCapability({ networkId });

    fc.assert(
      fc.property(fc.json(), (randomJsonValue) => {
        const result = capability.deserialize(null, randomJsonValue);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left instanceof OtherWalletError).toBe(true);
        }
      }),
    );
  });
});
