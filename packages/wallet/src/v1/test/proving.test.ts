import * as ledger from '@midnight-ntwrk/ledger';
import { Effect } from 'effect';
import { makeSimulatorProvingService } from '../Proving';
import { BALANCE_TRANSACTION_TO_PROVE, NOTHING_TO_PROVE, TRANSACTION_TO_PROVE } from '../ProvingRecipe';
import { ProofErasedTransaction, shieldedToken } from '../types/ledger';
import { getNonDustImbalance } from '../../test/testUtils';

const makeTransaction = () => {
  const seed = Buffer.alloc(32, 0);
  const recipient = ledger.ZswapSecretKeys.fromSeed(seed);
  const amount = 42n;
  const shieldedTokenType = shieldedToken();
  const coin = ledger.createShieldedCoinInfo(shieldedTokenType.raw, amount);
  const output = ledger.ZswapOutput.new(coin, 0, recipient.coinPublicKey, recipient.encryptionPublicKey);
  const offer = ledger.ZswapOffer.fromOutput(output, shieldedTokenType.raw, amount);
  return ledger.Transaction.fromParts(offer);
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
      const finalTx: ProofErasedTransaction = await service.prove(recipe).pipe(Effect.runPromise);

      expect(finalTx).toBeInstanceOf(ledger.Transaction);
      expect(getNonDustImbalance(finalTx.imbalances(0), shieldedToken().raw)).toEqual(expectedImbalance);
    },
  );
});
