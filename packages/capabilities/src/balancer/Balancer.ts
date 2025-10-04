import { CounterOffer, TransactionCostModel } from './CounterOffer';
import { CoinRecipe, Imbalance, Imbalances, TokenType, TokenValue } from './Imbalances';

export class InsufficientFundsError extends Error {
  readonly tokenType: TokenType;

  constructor(tokenType: TokenType) {
    super(`Insufficient Funds: could not balance ${tokenType}`);
    this.tokenType = tokenType;
  }
}

export interface BalanceRecipe<TInput extends CoinRecipe, TOutput extends CoinRecipe> {
  inputs: TInput[];
  outputs: TOutput[];
}

export type CoinSelection<TInput extends CoinRecipe> = (
  coins: readonly TInput[],
  tokenType: TokenType,
  amountNeeded: TokenValue,
  costModel: TransactionCostModel,
) => TInput | undefined;

export type BalanceRecipeProps<TInput extends CoinRecipe, TOutput extends CoinRecipe> = {
  coins: TInput[];
  initialImbalances: Imbalances;
  transactionCostModel: TransactionCostModel;
  feeTokenType: string;
  createOutput: (coin: CoinRecipe) => TOutput;
  isCoinEqual: (a: TInput, b: TInput) => boolean;
  coinSelection?: CoinSelection<TInput> | undefined;
  targetImbalances?: Imbalances;
};

export const getBalanceRecipe = <TInput extends CoinRecipe, TOutput extends CoinRecipe>({
  coins,
  initialImbalances,
  transactionCostModel,
  feeTokenType,
  createOutput,
  coinSelection,
  isCoinEqual,
  targetImbalances,
}: BalanceRecipeProps<TInput, TOutput>): BalanceRecipe<TInput, TOutput> => {
  const counterOffer = createCounterOffer(
    coins,
    initialImbalances,
    transactionCostModel,
    feeTokenType,
    coinSelection ?? chooseCoin,
    createOutput,
    isCoinEqual,
    targetImbalances,
  );

  return {
    inputs: counterOffer.inputs,
    outputs: counterOffer.outputs,
  };
};

export const createCounterOffer = <TInput extends CoinRecipe, TOutput extends CoinRecipe>(
  coins: TInput[],
  initialImbalances: Imbalances,
  transactionCostModel: TransactionCostModel,
  feeTokenType: string,
  coinSelection: CoinSelection<TInput>,
  createOutput: (coin: CoinRecipe) => TOutput,
  isCoinEqual: (a: TInput, b: TInput) => boolean,
  targetImbalances: Imbalances = new Map(),
): CounterOffer<TInput, TOutput> => {
  const counterOffer = new CounterOffer<TInput, TOutput>(
    initialImbalances,
    transactionCostModel,
    feeTokenType,
    targetImbalances,
  );

  let imbalance: Imbalance | undefined;

  while ((imbalance = counterOffer.findNonNativeImbalance())) {
    coins = doBalance(imbalance, coins, counterOffer, coinSelection, createOutput, isCoinEqual);
  }

  while ((imbalance = counterOffer.findNativeImbalance())) {
    coins = doBalance(imbalance, coins, counterOffer, coinSelection, createOutput, isCoinEqual);
  }

  return counterOffer;
};

const doBalance = <TInput extends CoinRecipe, TOutput extends CoinRecipe>(
  imbalance: Imbalance,
  coins: TInput[],
  counterOffer: CounterOffer<TInput, TOutput>,
  coinSelection: CoinSelection<TInput>,
  createOutput: (coin: CoinRecipe) => TOutput,
  isCoinEqual: (a: TInput, b: TInput) => boolean,
): TInput[] => {
  const [tokenType, imbalanceAmount] = imbalance;
  const shouldAddOutput =
    (tokenType === counterOffer.feeTokenType &&
      imbalanceAmount >=
        counterOffer.getTargetImbalance(counterOffer.feeTokenType) +
          counterOffer.transactionCostModel.outputFeeOverhead) ||
    (tokenType !== counterOffer.feeTokenType && imbalanceAmount > counterOffer.getTargetImbalance(tokenType));

  if (shouldAddOutput) {
    const output = createOutput({
      type: tokenType,
      value: imbalanceAmount - counterOffer.getTargetImbalance(tokenType),
    });

    counterOffer.addOutput(output);
  } else {
    const coin = coinSelection(coins, tokenType, imbalanceAmount, counterOffer.transactionCostModel);

    if (typeof coin === 'undefined') {
      throw new InsufficientFundsError(tokenType);
    }

    counterOffer.addInput(coin);

    coins = coins.filter((c) => !isCoinEqual(c, coin));
  }

  return coins;
};

export const chooseCoin = <TInput extends CoinRecipe>(
  coins: readonly TInput[],
  tokenType: TokenType,
): TInput | undefined => {
  return coins
    .filter((coin) => coin.type === tokenType)
    .sort((a, b) => Number(a.value - b.value))
    .at(0);
};
