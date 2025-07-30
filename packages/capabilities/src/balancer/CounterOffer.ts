import { CoinRecipe, Imbalance, Imbalances } from './Imbalances';
import { QualifiedCoinInfo, CoinInfo, createCoinInfo, TokenType } from '@midnight-ntwrk/zswap';

export interface TransactionCostModel {
  inputFeeOverhead: bigint;
  outputFeeOverhead: bigint;
}

export class CounterOffer {
  public readonly imbalances: Imbalances;
  public readonly transactionCostModel: TransactionCostModel;
  public readonly feeTokenType: string;
  public readonly inputsRecipe: QualifiedCoinInfo[];
  public readonly outputsRecipe: CoinInfo[];
  public readonly targetImbalances: Imbalances;

  constructor(
    imbalances: Imbalances,
    transactionCostModel: TransactionCostModel,
    feeTokenType: string,
    targetImbalances: Imbalances,
  ) {
    this.imbalances = Imbalances.ensureZerosFor(imbalances, Imbalances.typeSet(targetImbalances));
    this.transactionCostModel = transactionCostModel;
    this.feeTokenType = feeTokenType;
    this.inputsRecipe = [];
    this.outputsRecipe = [];
    this.targetImbalances = targetImbalances;
  }

  getTargetImbalance(tokenType: TokenType): bigint {
    return this.targetImbalances.get(tokenType) ?? 0n;
  }

  findNonNativeImbalance(): Imbalance | undefined {
    return this.imbalances
      .entries()
      .filter(([tokenType]) => tokenType !== this.feeTokenType)
      .find(([tokenType, value]) => value !== this.getTargetImbalance(tokenType));
  }

  findNativeImbalance(): Imbalance | undefined {
    const nativeImbalance = this.imbalances.get(this.feeTokenType);
    if (nativeImbalance !== undefined && nativeImbalance !== this.getTargetImbalance(this.feeTokenType)) {
      return [this.feeTokenType, nativeImbalance];
    }
    return undefined;
  }

  addInput(input: QualifiedCoinInfo): void {
    this.inputsRecipe.push(input);
    const imbalance = this.imbalances.get(input.type) || 0n;
    this.imbalances.set(input.type, imbalance + input.value);
    const nativeImbalance = this.imbalances.get(this.feeTokenType) || 0n;

    this.imbalances.set(this.feeTokenType, nativeImbalance - this.transactionCostModel.inputFeeOverhead);
  }

  addOutput(output: CoinRecipe): void {
    const imbalance = this.imbalances.get(output.type) || 0n;
    const subtractFee = output.type === this.feeTokenType ? this.transactionCostModel.outputFeeOverhead : 0n;
    const absoluteCoinValue = output.value < 0n ? -output.value : output.value;

    this.outputsRecipe.push(createCoinInfo(output.type, absoluteCoinValue - subtractFee));

    this.imbalances.set(output.type, imbalance - absoluteCoinValue);

    if (output.type !== this.feeTokenType) {
      const nativeImbalance = this.imbalances.get(this.feeTokenType) || 0n;
      this.imbalances.set(this.feeTokenType, nativeImbalance - this.transactionCostModel.outputFeeOverhead);
    }
  }
}
