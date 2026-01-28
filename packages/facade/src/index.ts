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
import * as ledger from '@midnight-ntwrk/ledger-v7';
import {
  type DefaultSubmissionConfiguration,
  makeDefaultSubmissionService,
  type SubmissionService,
} from '@midnight-ntwrk/wallet-sdk-capabilities';
import {
  type AnyTransaction,
  type DefaultDustConfiguration,
  type CoinsAndBalances as DustCoinsAndBalances,
  type DustWalletAPI,
  type DustWalletState,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  type DefaultShieldedConfiguration,
  type ShieldedWalletAPI,
  type ShieldedWalletState,
} from '@midnight-ntwrk/wallet-sdk-shielded';
import type { DefaultUnshieldedConfiguration, UnshieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Array as Arr, pipe } from 'effect';
import { combineLatest, map, type Observable } from 'rxjs';
import {
  DefaultPendingTransactionsServiceConfiguration,
  PendingTransactions,
  PendingTransactionsService,
  PendingTransactionsServiceImpl,
} from '@midnight-ntwrk/wallet-sdk-capabilities/pendingTransactions';

export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export type FinalizedTransactionRecipe = {
  type: 'FINALIZED_TRANSACTION';
  originalTransaction: ledger.FinalizedTransaction;
  balancingTransaction: ledger.UnprovenTransaction;
};

export type UnboundTransactionRecipe = {
  type: 'UNBOUND_TRANSACTION';
  baseTransaction: UnboundTransaction;
  balancingTransaction: ledger.UnprovenTransaction;
};

export type UnprovenTransactionRecipe = {
  type: 'UNPROVEN_TRANSACTION';
  transaction: ledger.UnprovenTransaction;
};

export type BalancingRecipe = FinalizedTransactionRecipe | UnboundTransactionRecipe | UnprovenTransactionRecipe;

export const BalancingRecipe = {
  isRecipe: (value: unknown): value is BalancingRecipe => {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      typeof value.type === 'string' &&
      ['FINALIZED_TRANSACTION', 'UNBOUND_TRANSACTION', 'UNPROVEN_TRANSACTION'].includes(value.type)
    );
  },
  getTransactions: (recipe: BalancingRecipe): readonly AnyTransaction[] => {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        return [recipe.originalTransaction, recipe.balancingTransaction];
      }
      case 'UNBOUND_TRANSACTION': {
        return [recipe.baseTransaction, recipe.balancingTransaction];
      }
      case 'UNPROVEN_TRANSACTION': {
        return [recipe.transaction];
      }
    }
  },
};

export interface TokenTransfer {
  type: ledger.RawTokenType;
  receiverAddress: string;
  amount: bigint;
}

export type CombinedTokenTransfer = {
  type: 'shielded' | 'unshielded';
  outputs: TokenTransfer[];
};

export type CombinedSwapInputs = {
  shielded?: Record<ledger.RawTokenType, bigint>;
  unshielded?: Record<ledger.RawTokenType, bigint>;
};

export type CombinedSwapOutputs = CombinedTokenTransfer;

export type TransactionIdentifier = string;

export type UtxoWithMeta = {
  utxo: ledger.Utxo;
  meta: {
    ctime: Date;
  };
};

export class FacadeState {
  public readonly shielded: ShieldedWalletState;
  public readonly unshielded: UnshieldedWalletState;
  public readonly dust: DustWalletState;
  public readonly pending: PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>;

  public get isSynced(): boolean {
    return (
      this.shielded.state.progress.isStrictlyComplete() &&
      this.dust.state.progress.isStrictlyComplete() &&
      this.unshielded.progress.isStrictlyComplete()
    );
  }

  constructor(
    shielded: ShieldedWalletState,
    unshielded: UnshieldedWalletState,
    dust: DustWalletState,
    pending: PendingTransactions.PendingTransactions<ledger.FinalizedTransaction>,
  ) {
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
    this.pending = pending;
  }
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export type DefaultConfiguration = DefaultUnshieldedConfiguration &
  DefaultShieldedConfiguration &
  DefaultDustConfiguration &
  DefaultSubmissionConfiguration &
  DefaultPendingTransactionsServiceConfiguration;

export type MaybePromise<T> = Promise<T> | T;

export type InitParams<TConfig extends DefaultConfiguration> = {
  configuration: TConfig;
  submissionService?: (config: TConfig) => MaybePromise<SubmissionService<ledger.FinalizedTransaction>>;
  pendingTransactionsService?: (
    config: TConfig,
  ) => MaybePromise<PendingTransactionsService<ledger.FinalizedTransaction>>;
  shielded: (config: TConfig) => MaybePromise<ShieldedWalletAPI>;
  unshielded: (config: TConfig) => MaybePromise<UnshieldedWalletAPI>;
  dust: (config: TConfig) => MaybePromise<DustWalletAPI>;
};

export class WalletFacade {
  static makeDefaultSubmissionService<TConfig extends DefaultSubmissionConfiguration>(
    config: TConfig,
  ): SubmissionService<ledger.FinalizedTransaction> {
    return makeDefaultSubmissionService<ledger.FinalizedTransaction>(config);
  }

  static makeDefaultPendingTransactionsService<TConfig extends DefaultPendingTransactionsServiceConfiguration>(
    config: TConfig,
  ): Promise<PendingTransactionsServiceImpl<ledger.FinalizedTransaction>> {
    return PendingTransactionsServiceImpl.init<ledger.FinalizedTransaction>({
      configuration: config,
      txTrait: PendingTransactions.TransactionTrait.Finalized,
    });
  }

  static async init<TConfig extends DefaultConfiguration>(initParams: InitParams<TConfig>): Promise<WalletFacade> {
    const submissionService = await Promise.resolve(
      initParams.submissionService
        ? initParams.submissionService(initParams.configuration)
        : WalletFacade.makeDefaultSubmissionService(initParams.configuration),
    );
    const pendingTransactionsService = await Promise.resolve(
      initParams.pendingTransactionsService
        ? initParams.pendingTransactionsService(initParams.configuration)
        : WalletFacade.makeDefaultPendingTransactionsService(initParams.configuration),
    );
    const shielded = await Promise.resolve(initParams.shielded(initParams.configuration));
    const unshielded = await Promise.resolve(initParams.unshielded(initParams.configuration));
    const dust = await Promise.resolve(initParams.dust(initParams.configuration));
    return new WalletFacade(shielded, unshielded, dust, submissionService, pendingTransactionsService);
  }

  readonly shielded: ShieldedWalletAPI;
  readonly unshielded: UnshieldedWalletAPI;
  readonly dust: DustWalletAPI;
  readonly submissionService: SubmissionService<ledger.FinalizedTransaction>;
  readonly pendingTransactionsService: PendingTransactionsService<ledger.FinalizedTransaction>;

  constructor(
    shieldedWallet: ShieldedWalletAPI,
    unshieldedWallet: UnshieldedWalletAPI,
    dustWallet: DustWalletAPI,
    submissionService: SubmissionService<ledger.FinalizedTransaction>,
    pendingTransactionsService: PendingTransactionsService<ledger.FinalizedTransaction>,
  ) {
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
    this.dust = dustWallet;
    this.submissionService = submissionService;
    this.pendingTransactionsService = pendingTransactionsService;
  }

  private defaultTtl(): Date {
    return new Date(Date.now() + DEFAULT_TTL_MS);
  }

  private mergeUnprovenTransactions(
    a: ledger.UnprovenTransaction | undefined,
    b: ledger.UnprovenTransaction | undefined,
  ): ledger.UnprovenTransaction | undefined {
    if (a && b) return a.merge(b);
    return a ?? b;
  }

  private async createDustActionTransaction(
    action: { type: 'registration'; dustReceiverAddress: string } | { type: 'deregistration' },
    nightUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => Promise<ledger.Signature> | ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    const ttl = this.defaultTtl();

    const transaction = await this.dust.createDustGenerationTransaction(
      undefined,
      ttl,
      nightUtxos.map(({ utxo, meta }) => ({ ...utxo, ctime: meta.ctime })),
      nightVerifyingKey,
      action.type === 'registration' ? action.dustReceiverAddress : undefined,
    );

    const intent = transaction.intents?.get(1);
    if (!intent) {
      throw Error('Dust generation transaction is missing intent segment 1.');
    }

    const signatureData = intent.signatureData(1);
    const signature = await Promise.resolve(signDustRegistration(signatureData));

    return await this.dust.addDustGenerationSignature(transaction, signature);
  }

  state(): Observable<FacadeState> {
    return combineLatest([this.shielded.state, this.unshielded.state, this.dust.state]).pipe(
      map(([shieldedState, unshieldedState, dustState]) => new FacadeState(shieldedState, unshieldedState, dustState)),
    );
  }

  async waitForSyncedState(): Promise<FacadeState> {
    const [shieldedState, unshieldedState, dustState] = await Promise.all([
      this.shielded.waitForSyncedState(),
      this.unshielded.waitForSyncedState(),
      this.dust.waitForSyncedState(),
    ]);

    return new FacadeState(shieldedState, unshieldedState, dustState);
  }

  async submitTransaction(tx: ledger.FinalizedTransaction): Promise<TransactionIdentifier> {
    try {
      await this.submissionService.submitTransaction(tx, 'Finalized');

      return tx.identifiers().at(-1)!;
    } catch (error) {
      await this.revert(tx);
      throw error;
    }
  }

  async balanceFinalizedTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKeys: ledger.DustSecretKey,
    tx: ledger.FinalizedTransaction,
    ttl: Date,
  ): Promise<FinalizedTransactionRecipe> {
    const unshieldedBalancing = await this.unshielded.balanceFinalizedTransaction(tx);
    const shieldedBalancing = await this.shielded.balanceTransaction(zswapSecretKeys, tx);

    const mergedBalancing = this.mergeUnprovenTransactions(shieldedBalancing, unshieldedBalancing);

    const feeBalancingTransaction = await this.dust.balanceTransactions(
      dustSecretKeys,
      mergedBalancing ? [tx, mergedBalancing] : [tx],
      ttl,
    );

    const balancingTransaction = mergedBalancing
      ? mergedBalancing.merge(feeBalancingTransaction)
      : feeBalancingTransaction;

    return {
      type: 'FINALIZED_TRANSACTION',
      originalTransaction: tx,
      balancingTransaction,
    };
  }

  async balanceUnboundTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKeys: ledger.DustSecretKey,
    tx: UnboundTransaction,
    ttl: Date,
  ): Promise<UnboundTransactionRecipe> {
    // For unbound transactions, unshielded balancing happens in place not with a balancing transaction
    const balancedUnshieldedTx = await this.unshielded.balanceUnboundTransaction(tx);
    const shieldedBalancingTx = await this.shielded.balanceTransaction(zswapSecretKeys, tx);

    // unbound unshielded tx are balanced in place, check if balancedUnshieldedTx is present and use it as base tx
    const baseTx = balancedUnshieldedTx ?? tx;

    // Add fee payment - pass shielded balancing if present, otherwise just calculate fee for base tx
    const transactionsToPayFeesFor = shieldedBalancingTx ? [baseTx, shieldedBalancingTx] : [baseTx];
    const feeBalancingTransaction = await this.dust.balanceTransactions(dustSecretKeys, transactionsToPayFeesFor, ttl);

    // Create the final balancing transaction
    const balancingTransaction = shieldedBalancingTx
      ? shieldedBalancingTx.merge(feeBalancingTransaction)
      : feeBalancingTransaction;

    return {
      type: 'UNBOUND_TRANSACTION',
      baseTransaction: baseTx,
      balancingTransaction,
    };
  }

  async balanceUnprovenTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKeys: ledger.DustSecretKey,
    tx: ledger.UnprovenTransaction,
    ttl: Date,
  ): Promise<UnprovenTransactionRecipe> {
    // For unproven transactions, unshielded balancing happens in place
    const balancedUnshieldedTx = await this.unshielded.balanceUnprovenTransaction(tx);
    const shieldedBalancingTx = await this.shielded.balanceTransaction(zswapSecretKeys, tx);

    // Use the balanced unshielded tx if present, otherwise use the original tx
    const baseTx = balancedUnshieldedTx ?? tx;

    // Merge shielded balancing into base tx if present
    const mergedTx = shieldedBalancingTx ? baseTx.merge(shieldedBalancingTx) : baseTx;

    // Add fee payment
    const feeBalancingTransaction = await this.dust.balanceTransactions(dustSecretKeys, [mergedTx], ttl);

    const balancedTransaction = mergedTx.merge(feeBalancingTransaction);

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: balancedTransaction,
    };
  }

  async finalizeRecipe(recipe: BalancingRecipe): Promise<ledger.FinalizedTransaction> {
    return Promise.resolve(recipe)
      .then(async (recipe) => {
        switch (recipe.type) {
          case 'FINALIZED_TRANSACTION': {
            const finalizedBalancing = await this.finalizeTransaction(recipe.balancingTransaction);
            return recipe.originalTransaction.merge(finalizedBalancing);
          }
          case 'UNBOUND_TRANSACTION': {
            const finalizedBalancingTx = await this.finalizeTransaction(recipe.balancingTransaction);
            const finalizedTransaction = recipe.baseTransaction.bind();
            return finalizedTransaction.merge(finalizedBalancingTx);
          }
          case 'UNPROVEN_TRANSACTION': {
            return await this.finalizeTransaction(recipe.transaction);
          }
        }
      })
      .then(async (finalizedTx) => {
        await this.pendingTransactionsService.addPendingTransaction(finalizedTx);
        return finalizedTx;
      });
  }

  async signRecipe(
    recipe: BalancingRecipe,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<BalancingRecipe> {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        const signedBalancing = await this.signTransaction(recipe.balancingTransaction, signSegment);
        return {
          type: 'FINALIZED_TRANSACTION',
          originalTransaction: recipe.originalTransaction,
          balancingTransaction: signedBalancing,
        };
      }
      case 'UNBOUND_TRANSACTION': {
        const signedBalancing = await this.signTransaction(recipe.balancingTransaction, signSegment);
        return {
          type: 'UNBOUND_TRANSACTION',
          baseTransaction: recipe.baseTransaction,
          balancingTransaction: signedBalancing,
        };
      }
      case 'UNPROVEN_TRANSACTION': {
        const signedTransaction = await this.signTransaction(recipe.transaction, signSegment);
        return {
          type: 'UNPROVEN_TRANSACTION',
          transaction: signedTransaction,
        };
      }
    }
  }

  async signTransaction(
    tx: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    return await this.unshielded.signTransaction(tx, signSegment);
  }

  async finalizeTransaction(tx: ledger.UnprovenTransaction): Promise<ledger.FinalizedTransaction> {
    const finalizedTx = await this.shielded.finalizeTransaction(tx);
    await this.pendingTransactionsService.addPendingTransaction(finalizedTx);
    return finalizedTx;
  }

  async calculateTransactionFee(tx: AnyTransaction): Promise<bigint> {
    return await this.dust.calculateFee([tx]);
  }

  async transferTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKey: ledger.DustSecretKey,
    outputs: CombinedTokenTransfer[],
    ttl: Date,
  ): Promise<UnprovenTransactionRecipe> {
    const unshieldedOutputs = outputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const shieldedOutputs = outputs.filter((output) => output.type === 'shielded').flatMap((output) => output.outputs);

    if (unshieldedOutputs.length === 0 && shieldedOutputs.length === 0) {
      throw Error('At least one shielded or unshielded output is required.');
    }

    let shieldedTx: ledger.UnprovenTransaction | undefined;
    let unshieldedTx: ledger.UnprovenTransaction | undefined;

    if (unshieldedOutputs.length > 0) {
      unshieldedTx = await this.unshielded.transferTransaction(unshieldedOutputs, ttl);
    }

    if (shieldedOutputs.length > 0) {
      shieldedTx = await this.shielded.transferTransaction(zswapSecretKeys, shieldedOutputs);
    }

    const mergedTxs = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx)!;

    // Add fee payment
    const feeBalancingTransaction = await this.dust.balanceTransactions(dustSecretKey, [mergedTxs], ttl);

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: mergedTxs.merge(feeBalancingTransaction),
    };
  }

  /**
   * Provides estimate of the fee of issuing registration transaction with provided UTxOs
   * @param nightUtxos - Night UTxOs to use for the registration
   * @returns And object informing about fee at the moment, as well as estimation of dust generation of the UTxO(s), that would be used for paying the fee. These include data that allows to compute when the fee could be paid
   */
  async estimateRegistration(nightUtxos: readonly UtxoWithMeta[]): Promise<{
    fee: bigint;
    dustGenerationEstimations: ReadonlyArray<DustCoinsAndBalances.UtxoWithFullDustDetails>;
  }> {
    const now = new Date();
    const dustState = await this.dust.waitForSyncedState();
    const dustGenerationEstimations = pipe(
      nightUtxos,
      Arr.map(({ utxo, meta }) => ({ ...utxo, ctime: meta.ctime })),
      (utxosWithMeta) => dustState.estimateDustGeneration(utxosWithMeta, now),
      (estimatedUtxos) => dustState.capabilities.coinsAndBalances.splitNightUtxos(estimatedUtxos),
      (split) => split.guaranteed,
    );
    const fakeSigningKey = ledger.sampleSigningKey();
    const fakeVerifyingKey = ledger.signatureVerifyingKey(fakeSigningKey);
    const fakeRegistrationRecipe = await this.registerNightUtxosForDustGeneration(
      nightUtxos,
      fakeVerifyingKey,
      (payload) => ledger.signData(fakeSigningKey, payload),
      dustState.dustAddress,
    );
    const finalizedFakeTx = fakeRegistrationRecipe.transaction.mockProve().bind();

    const fee = await this.calculateTransactionFee(finalizedFakeTx);

    return {
      fee,
      dustGenerationEstimations,
    };
  }

  async initSwap(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    desiredInputs: CombinedSwapInputs,
    desiredOutputs: CombinedSwapOutputs[],
    ttl: Date,
  ): Promise<UnprovenTransactionRecipe> {
    const { shielded: shieldedInputs, unshielded: unshieldedInputs } = desiredInputs;

    const shieldedOutputs = desiredOutputs
      .filter((output) => output.type === 'shielded')
      .flatMap((output) => output.outputs);

    const unshieldedOutputs = desiredOutputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const hasShieldedPart = (shieldedInputs && Object.keys(shieldedInputs).length > 0) || shieldedOutputs.length > 0;

    const hasUnshieldedPart =
      (unshieldedInputs && Object.keys(unshieldedInputs).length > 0) || unshieldedOutputs.length > 0;

    if (!hasShieldedPart && !hasUnshieldedPart) {
      throw Error('At least one shielded or unshielded swap is required.');
    }

    const shieldedTx =
      hasShieldedPart && shieldedInputs !== undefined
        ? await this.shielded.initSwap(zswapSecretKeys, shieldedInputs, shieldedOutputs)
        : undefined;

    const unshieldedTx =
      hasUnshieldedPart && unshieldedInputs !== undefined
        ? await this.unshielded.initSwap(unshieldedInputs, unshieldedOutputs, ttl)
        : undefined;

    const combinedTx = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx);

    if (!combinedTx) {
      throw Error('Unexpected transaction state.');
    }

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: combinedTx,
    };
  }

  async registerNightUtxosForDustGeneration(
    nightUtxos: readonly UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => ledger.Signature,
    dustReceiverAddress?: string,
  ): Promise<UnprovenTransactionRecipe> {
    if (nightUtxos.length === 0) {
      throw Error('At least one Night UTXO is required.');
    }

    const dustState = await this.dust.waitForSyncedState();
    const receiverAddress = dustReceiverAddress ?? dustState.dustAddress;

    const dustRegistrationTx = await this.createDustActionTransaction(
      { type: 'registration', dustReceiverAddress: receiverAddress },
      nightUtxos,
      nightVerifyingKey,
      signDustRegistration,
    );

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: dustRegistrationTx,
    };
  }

  async deregisterFromDustGeneration(
    nightUtxos: UtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => ledger.Signature,
  ): Promise<UnprovenTransactionRecipe> {
    const dustDeregistrationTx = await this.createDustActionTransaction(
      { type: 'deregistration' },
      nightUtxos,
      nightVerifyingKey,
      signDustRegistration,
    );
    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: dustDeregistrationTx,
    };
  }

  async revert(txOrRecipe: AnyTransaction | BalancingRecipe): Promise<void> {
    // avoid instanceof check
    const transactionsToRevert = BalancingRecipe.isRecipe(txOrRecipe)
      ? BalancingRecipe.getTransactions(txOrRecipe)
      : [txOrRecipe];

    await Promise.all(transactionsToRevert.map((tx) => this.revertTransaction(tx)));
  }

  async revertTransaction(tx: AnyTransaction): Promise<void> {
    await Promise.all([
      this.shielded.revertTransaction(tx),
      this.unshielded.revertTransaction(tx),
      this.dust.revertTransaction(tx),
    ]);
  }

  async start(zswapSecretKeys: ledger.ZswapSecretKeys, dustSecretKey: ledger.DustSecretKey): Promise<void> {
    await Promise.all([this.shielded.start(zswapSecretKeys), this.unshielded.start(), this.dust.start(dustSecretKey)]);
  }

  async stop(): Promise<void> {
    await Promise.all([this.shielded.stop(), this.unshielded.stop(), this.dust.stop(), this.submissionService.close()]);
  }
}
