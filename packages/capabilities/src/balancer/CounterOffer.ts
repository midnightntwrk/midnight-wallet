// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { CoinRecipe, Imbalance, Imbalances, TokenType } from './Imbalances.js';

export interface TransactionCostModel {
  inputFeeOverhead: bigint;
  outputFeeOverhead: bigint;
}

export class CounterOffer<TInput extends CoinRecipe, TOutput extends CoinRecipe> {
  public readonly imbalances: Imbalances;
  public readonly transactionCostModel: TransactionCostModel;
  public readonly feeTokenType: string;
  public readonly inputs: TInput[];
  public readonly outputs: TOutput[];
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
    this.inputs = [];
    this.outputs = [];
    this.targetImbalances = targetImbalances;
  }

  getTargetImbalance(tokenType: TokenType): bigint {
    return this.targetImbalances.get(tokenType) ?? 0n;
  }

  findNonNativeImbalance(): Imbalance | undefined {
    return Array.from(this.imbalances.entries())
      .filter(([tokenType]) => tokenType !== this.feeTokenType)
      .find(([tokenType, value]) => value !== this.getTargetImbalance(tokenType));
  }

  findNativeImbalance(): Imbalance | undefined {
    if (!this.feeTokenType) {
      return undefined;
    }

    const nativeImbalance = this.imbalances.get(this.feeTokenType);
    if (nativeImbalance !== undefined && nativeImbalance !== this.getTargetImbalance(this.feeTokenType)) {
      return [this.feeTokenType, nativeImbalance];
    }
    return undefined;
  }

  addInput(input: TInput): void {
    this.inputs.push(input);
    const imbalance = this.imbalances.get(input.type) || 0n;
    this.imbalances.set(input.type, imbalance + input.value);
    const nativeImbalance = this.imbalances.get(this.feeTokenType) || 0n;

    this.imbalances.set(this.feeTokenType, nativeImbalance - this.transactionCostModel.inputFeeOverhead);
  }

  addOutput(output: TOutput): void {
    const imbalance = this.imbalances.get(output.type) || 0n;
    const subtractFee = output.type === this.feeTokenType ? this.transactionCostModel.outputFeeOverhead : 0n;
    const absoluteCoinValue = output.value < 0n ? -output.value : output.value;

    this.outputs.push({ ...output, type: output.type, value: absoluteCoinValue - subtractFee });

    this.imbalances.set(output.type, imbalance - absoluteCoinValue);

    if (output.type !== this.feeTokenType) {
      const nativeImbalance = this.imbalances.get(this.feeTokenType) || 0n;
      this.imbalances.set(this.feeTokenType, nativeImbalance - this.transactionCostModel.outputFeeOverhead);
    }
  }
}
