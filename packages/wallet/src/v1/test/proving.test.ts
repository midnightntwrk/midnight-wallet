import * as zswap from '@midnight-ntwrk/zswap';
import { Effect } from 'effect';
import { makeSimulatorProvingService } from '../Proving';
import { BALANCE_TRANSACTION_TO_PROVE, NOTHING_TO_PROVE, TRANSACTION_TO_PROVE } from '../ProvingRecipe';

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = zswap.SecretKeys.fromSeed(seed);
  const amount = 42n;
  const coin = zswap.createCoinInfo(zswap.nativeToken(), amount);
  const output = zswap.UnprovenOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = zswap.UnprovenOffer.fromOutput(output, zswap.nativeToken(), amount);
  return new zswap.UnprovenTransaction(offer);
};

describe('Simulator proving service', () => {
  const testUnprovenTx = makeTransaction();
  const testErasedTx = makeTransaction().eraseProofs();

  const recipes = [
    { recipe: { type: NOTHING_TO_PROVE, transaction: testErasedTx }, expectedImbalance: -42n },
    {
      recipe: {
        type: BALANCE_TRANSACTION_TO_PROVE,
        transactionToBalance: testErasedTx,
        transactionToProve: testUnprovenTx,
      },
      expectedImbalance: -84n,
    },
    { recipe: { type: TRANSACTION_TO_PROVE, transaction: testUnprovenTx }, expectedImbalance: -42n },
  ] as const;

  it.each(recipes)(
    'does transform proving recipe into final, proof-erased transaction',
    async ({ recipe, expectedImbalance }) => {
      const service = makeSimulatorProvingService();
      const finalTx: zswap.ProofErasedTransaction = await service.prove(recipe).pipe(Effect.runPromise);

      expect(finalTx).toBeInstanceOf(zswap.ProofErasedTransaction);
      expect(finalTx.imbalances(true).get(zswap.nativeToken())).toEqual(expectedImbalance);
    },
  );
});
