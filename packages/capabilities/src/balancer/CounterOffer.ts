import { CoinRecipe, Imbalance, Imbalances } from './Imbalances';
import { QualifiedCoinInfo, CoinInfo, createCoinInfo } from '@midnight-ntwrk/zswap';

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

  constructor(imbalances: Imbalances, transactionCostModel: TransactionCostModel, feeTokenType: string) {
    this.imbalances = imbalances;
    this.transactionCostModel = transactionCostModel;
    this.feeTokenType = feeTokenType;
    this.inputsRecipe = [];
    this.outputsRecipe = [];
  }

  findNonNativeImbalance(): Imbalance | undefined {
    for (const [tokenType, value] of this.imbalances) {
      if (tokenType !== this.feeTokenType && value !== 0n) {
        return [tokenType, value];
      }
    }
    return undefined;
  }

  findNativeImbalance(): Imbalance | undefined {
    const nativeImbalance = this.imbalances.get(this.feeTokenType);
    if (nativeImbalance !== undefined && nativeImbalance !== 0n) {
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
