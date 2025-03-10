import { CoinInfo, QualifiedCoinInfo } from '@midnight-ntwrk/zswap';
import { CounterOffer, TransactionCostModel } from './CounterOffer';
import { CoinRecipe, Imbalance, Imbalances } from './Imbalances';

export interface BalanceRecipe {
  inputs: QualifiedCoinInfo[];
  outputs: CoinInfo[];
}

export const getBalanceRecipe = (
  coins: QualifiedCoinInfo[],
  targetImbalances: Imbalances,
  transactionCostModel: TransactionCostModel,
  feeTokenType: string,
): BalanceRecipe => {
  const counterOffer = createCounterOffer(coins, targetImbalances, transactionCostModel, feeTokenType);

  return {
    inputs: counterOffer.inputsRecipe,
    outputs: counterOffer.outputsRecipe,
  };
};

export const createCounterOffer = (
  coins: QualifiedCoinInfo[],
  targetImbalances: Imbalances,
  transactionCostModel: TransactionCostModel,
  feeTokenType: string,
): CounterOffer => {
  // 1. Create an empty offer
  // 2. Calculate total fees to be paid for the unbalanced transaction and the offer
  // 3. Calculate resulting imbalances by merging ones from the unbalanced transaction, the offer and target imbalances
  const counterOffer = new CounterOffer(targetImbalances, transactionCostModel, feeTokenType);

  let imbalance: Imbalance | undefined;

  // 4. Verify if target imbalances are met. If they are, create transaction from the offer, merge with the unbalanced transaction, and return
  // 5. Sort token types present in result imbalances in a way, that DUST is left last and select first token type
  while ((imbalance = counterOffer.findNonNativeImbalance())) {
    coins = doBalance(imbalance, coins, counterOffer);
  }

  while ((imbalance = counterOffer.findNativeImbalance())) {
    coins = doBalance(imbalance, coins, counterOffer);
  }

  return counterOffer;
};

const doBalance = (
  imbalance: Imbalance,
  coins: QualifiedCoinInfo[],
  counterOffer: CounterOffer,
): QualifiedCoinInfo[] => {
  const [tokenType, imbalanceAmount] = imbalance;
  // 6a. If the imbalance is positive and greater than the output fee,
  // create an output for self with the amount equal to imbalance
  const shouldAddOutput =
    (tokenType === counterOffer.feeTokenType &&
      imbalanceAmount >= counterOffer.transactionCostModel.outputFeeOverhead) ||
    (tokenType !== counterOffer.feeTokenType && imbalanceAmount > 0n);

  if (shouldAddOutput) {
    counterOffer.addOutput({ type: tokenType, value: imbalanceAmount });
  } else {
    // 6b. If the imbalance is negative, select a single coin of the selected type, and create an input
    const coin = chooseCoin(coins, { type: tokenType, value: imbalanceAmount });

    if (typeof coin === 'undefined') {
      throw new Error(tokenType);
    }

    counterOffer.addInput(coin);

    coins = coins.filter((c) => c !== coin);
  }

  return coins;
};

const chooseCoin = (coins: QualifiedCoinInfo[], coinToChoose: CoinRecipe): QualifiedCoinInfo | undefined => {
  const filteredAndSortedCoins = coins
    .filter((coin) => coin.type === coinToChoose.type)
    .sort((a, b) => Number(a.value - b.value));

  return filteredAndSortedCoins[0] ?? undefined;
};
