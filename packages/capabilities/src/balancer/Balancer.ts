import { CoinInfo, QualifiedCoinInfo, TokenType } from '@midnight-ntwrk/zswap';
import { CounterOffer, TransactionCostModel } from './CounterOffer';
import { Imbalance, Imbalances } from './Imbalances';

export class InsufficientFundsError extends Error {
  readonly tokenType: TokenType;

  constructor(tokenType: TokenType) {
    super(`Insufficient Funds: could not balance ${tokenType}`);
    this.tokenType = tokenType;
  }
}

export interface BalanceRecipe {
  inputs: QualifiedCoinInfo[];
  outputs: CoinInfo[];
}

export type CoinSelection = (
  coins: readonly QualifiedCoinInfo[],
  tokenType: TokenType,
  amountNeeded: bigint,
  costModel: TransactionCostModel,
) => QualifiedCoinInfo | undefined;

//TODO: make this interface immutable
export const getBalanceRecipe = (
  coins: QualifiedCoinInfo[],
  initialImbalances: Imbalances,
  transactionCostModel: TransactionCostModel,
  feeTokenType: string,
  coinSelection: CoinSelection = chooseCoin,
  targetImbalances: Imbalances = new Map(),
): BalanceRecipe => {
  const counterOffer = createCounterOffer(
    coins,
    initialImbalances,
    transactionCostModel,
    feeTokenType,
    coinSelection,
    targetImbalances,
  );

  return {
    inputs: counterOffer.inputsRecipe,
    outputs: counterOffer.outputsRecipe,
  };
};

export const createCounterOffer = (
  coins: QualifiedCoinInfo[],
  initialImbalances: Imbalances,
  transactionCostModel: TransactionCostModel,
  feeTokenType: string,
  coinSelection: CoinSelection,
  targetImbalances: Imbalances = new Map(),
): CounterOffer => {
  // 1. Create an empty offer
  // 2. Calculate total fees to be paid for the unbalanced transaction and the offer
  // 3. Calculate resulting imbalances by merging ones from the unbalanced transaction, the offer and target imbalances
  const counterOffer = new CounterOffer(initialImbalances, transactionCostModel, feeTokenType, targetImbalances);

  let imbalance: Imbalance | undefined;

  // 4. Verify if target imbalances are met. If they are, create transaction from the offer, merge with the unbalanced transaction, and return
  // 5. Sort token types present in result imbalances in a way, that DUST is left last and select first token type
  while ((imbalance = counterOffer.findNonNativeImbalance())) {
    coins = doBalance(imbalance, coins, counterOffer, coinSelection);
  }

  while ((imbalance = counterOffer.findNativeImbalance())) {
    coins = doBalance(imbalance, coins, counterOffer, coinSelection);
  }

  return counterOffer;
};

const doBalance = (
  imbalance: Imbalance,
  coins: QualifiedCoinInfo[],
  counterOffer: CounterOffer,
  coinSelection: CoinSelection,
): QualifiedCoinInfo[] => {
  const [tokenType, imbalanceAmount] = imbalance;
  // 6a. If the imbalance is positive and greater than the output fee,
  // create an output for self with the amount equal to imbalance
  const shouldAddOutput =
    (tokenType === counterOffer.feeTokenType &&
      imbalanceAmount >=
        counterOffer.getTargetImbalance(counterOffer.feeTokenType) +
          counterOffer.transactionCostModel.outputFeeOverhead) ||
    (tokenType !== counterOffer.feeTokenType && imbalanceAmount > counterOffer.getTargetImbalance(tokenType));

  if (shouldAddOutput) {
    counterOffer.addOutput({ type: tokenType, value: imbalanceAmount - counterOffer.getTargetImbalance(tokenType) });
  } else {
    // 6b. If the imbalance is negative, select a single coin of the selected type, and create an input
    const coin = coinSelection(coins, tokenType, imbalanceAmount, counterOffer.transactionCostModel);

    if (typeof coin === 'undefined') {
      throw new InsufficientFundsError(tokenType);
    }

    counterOffer.addInput(coin);

    coins = coins.filter((c) => c.nonce !== coin.nonce);
  }

  return coins;
};

export const chooseCoin: CoinSelection = (
  coins: readonly QualifiedCoinInfo[],
  tokenType: TokenType,
): QualifiedCoinInfo | undefined => {
  return coins
    .filter((coin) => coin.type === tokenType)
    .sort((a, b) => Number(a.value - b.value))
    .at(0);
};
