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
import { combineLatest, map, Observable } from 'rxjs';
import { ShieldedWalletState, type ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWallet, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { Array as Arr, pipe } from 'effect';
import {
  AnyTransaction,
  DustWallet,
  DustWalletState,
  CoinsAndBalances as DustCoinsAndBalances,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v7';

export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export type TokenKind = 'dust' | 'shielded' | 'unshielded';

export type TokenKindsToBalance = 'all' | TokenKind[];

export const TokenKindsToBalance = new (class {
  allTokenKinds = ['shielded', 'unshielded', 'dust'];
  toFlags = (tokenKinds: TokenKindsToBalance) => {
    return pipe(
      tokenKinds,
      (kinds) => (kinds === 'all' ? this.allTokenKinds : kinds),
      (kinds) => ({
        shouldBalanceUnshielded: kinds.includes('unshielded'),
        shouldBalanceShielded: kinds.includes('shielded'),
        shouldBalanceDust: kinds.includes('dust'),
      }),
    );
  };
})();

export type FinalizedTransactionRecipe = {
  type: 'FINALIZED_TRANSACTION';
  originalTransaction: ledger.FinalizedTransaction;
  balancingTransaction: ledger.UnprovenTransaction;
};

export type UnboundTransactionRecipe = {
  type: 'UNBOUND_TRANSACTION';
  baseTransaction: UnboundTransaction;
  // balancingTransaction is optional because if the user decides to balance only the unshielded part,
  // it occurs "in place" so the baseTransaction is modified
  balancingTransaction?: ledger.UnprovenTransaction | undefined;
};

export type UnprovenTransactionRecipe = {
  type: 'UNPROVEN_TRANSACTION';
  transaction: ledger.UnprovenTransaction;
};

export type BalancingRecipe = FinalizedTransactionRecipe | UnboundTransactionRecipe | UnprovenTransactionRecipe;

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

  public get isSynced(): boolean {
    return (
      this.shielded.state.progress.isStrictlyComplete() &&
      this.dust.state.progress.isStrictlyComplete() &&
      this.unshielded.progress.isStrictlyComplete()
    );
  }

  constructor(shielded: ShieldedWalletState, unshielded: UnshieldedWalletState, dust: DustWalletState) {
    this.shielded = shielded;
    this.unshielded = unshielded;
    this.dust = dust;
  }
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export class WalletFacade {
  readonly shielded: ShieldedWallet;
  readonly unshielded: UnshieldedWallet;
  readonly dust: DustWallet;

  constructor(shieldedWallet: ShieldedWallet, unshieldedWallet: UnshieldedWallet, dustWallet: DustWallet) {
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
    this.dust = dustWallet;
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
    await this.shielded.submitTransaction(tx, 'Finalized');

    return tx.identifiers().at(-1)!;
  }

  async balanceFinalizedTransaction(
    tx: ledger.FinalizedTransaction,
    secretKeys: {
      zswapSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      tokenTypesToBalance?: TokenKindsToBalance;
    },
  ): Promise<FinalizedTransactionRecipe> {
    const { zswapSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, tokenTypesToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenTypesToBalance);

    // Step 1: Run unshielded and shielded balancing
    const unshieldedBalancingTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceFinalizedTransaction(tx)
      : undefined;

    const shieldedBalancingTx = shouldBalanceShielded
      ? await this.shielded.balanceTransaction(zswapSecretKeys, tx)
      : undefined;

    // Step 2: Merge unshielded and shielded balancing
    const mergedBalancingTx = this.mergeUnprovenTransactions(shieldedBalancingTx, unshieldedBalancingTx);

    // Step 3: Conditionally add dust/fee balancing
    const feeBalancingTx = shouldBalanceDust
      ? await this.dust.balanceTransactions(dustSecretKey, mergedBalancingTx ? [tx, mergedBalancingTx] : [tx], ttl)
      : undefined;

    // Step 4: Merge fee balancing and create final recipe
    const balancingTx = this.mergeUnprovenTransactions(mergedBalancingTx, feeBalancingTx);

    if (!balancingTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'FINALIZED_TRANSACTION',
      originalTransaction: tx,
      balancingTransaction: balancingTx,
    };
  }

  async balanceUnboundTransaction(
    tx: UnboundTransaction,
    secretKeys: {
      zswapSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      tokenTypesToBalance?: TokenKindsToBalance;
    },
  ): Promise<UnboundTransactionRecipe> {
    const { zswapSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, tokenTypesToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenTypesToBalance);

    // Step 1: Run unshielded and shielded balancing
    const shieldedBalancingTx = shouldBalanceShielded
      ? await this.shielded.balanceTransaction(zswapSecretKeys, tx)
      : undefined;

    // For unbound transactions, unshielded balancing happens in place not with a balancing transaction
    const balancedUnshieldedTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceUnboundTransaction(tx)
      : undefined;

    // Step 2: Unbound unshielded tx are balanced in place, use it as base tx if present
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Conditionally add dust/fee balancing
    const feeBalancingTransaction = shouldBalanceDust
      ? await this.dust.balanceTransactions(
          dustSecretKey,
          shieldedBalancingTx ? [baseTx, shieldedBalancingTx] : [baseTx],
          ttl,
        )
      : undefined;

    // Step 4: Create the final balancing transaction
    const balancingTransaction = this.mergeUnprovenTransactions(shieldedBalancingTx, feeBalancingTransaction);

    // if there is no balancingTransaction and there was no unshielded tx balancing (in place) throw an error.
    if (!balancingTransaction && !balancedUnshieldedTx) {
      throw new Error('No balancing transaction was created. Please check your transaction.');
    }

    return {
      type: 'UNBOUND_TRANSACTION',
      baseTransaction: baseTx,
      balancingTransaction: balancingTransaction ?? undefined,
    };
  }

  async balanceUnprovenTransaction(
    tx: ledger.UnprovenTransaction,
    secretKeys: {
      zswapSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      tokenTypesToBalance?: TokenKindsToBalance;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { zswapSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, tokenTypesToBalance = 'all' } = options;

    const { shouldBalanceDust, shouldBalanceShielded, shouldBalanceUnshielded } =
      TokenKindsToBalance.toFlags(tokenTypesToBalance);

    // Step 1: Run unshielded and shielded balancing
    const shieldedBalancingTx = shouldBalanceShielded
      ? await this.shielded.balanceTransaction(zswapSecretKeys, tx)
      : undefined;

    // For unproven transactions, unshielded balancing happens in place
    const balancedUnshieldedTx = shouldBalanceUnshielded
      ? await this.unshielded.balanceUnprovenTransaction(tx)
      : undefined;

    // Step 2: Use the balanced unshielded tx if present, otherwise use the original tx
    const baseTx = balancedUnshieldedTx ?? tx;

    // Step 3: Merge shielded balancing into base tx if present
    const mergedTx = this.mergeUnprovenTransactions(baseTx, shieldedBalancingTx)!;

    // Step 4: Conditionally add dust/fee balancing
    const feeBalancingTx = shouldBalanceDust
      ? await this.dust.balanceTransactions(dustSecretKey, [mergedTx], ttl)
      : undefined;

    // Step 5: Merge fee balancing if present
    const balancedTx = this.mergeUnprovenTransactions(mergedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: balancedTx,
    };
  }

  async finalizeRecipe(recipe: BalancingRecipe): Promise<ledger.FinalizedTransaction> {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        const finalizedBalancing = await this.finalizeTransaction(recipe.balancingTransaction);
        return recipe.originalTransaction.merge(finalizedBalancing);
      }
      case 'UNBOUND_TRANSACTION': {
        const finalizedBalancingTx = recipe.balancingTransaction
          ? await this.finalizeTransaction(recipe.balancingTransaction)
          : undefined;
        const finalizedTransaction = recipe.baseTransaction.bind();
        return finalizedBalancingTx ? finalizedTransaction.merge(finalizedBalancingTx) : finalizedTransaction;
      }
      case 'UNPROVEN_TRANSACTION': {
        return await this.finalizeTransaction(recipe.transaction);
      }
    }
  }

  async signRecipe(
    recipe: BalancingRecipe,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<BalancingRecipe> {
    switch (recipe.type) {
      case 'FINALIZED_TRANSACTION': {
        const signedBalancingTx = await this.signUnprovenTransaction(recipe.balancingTransaction, signSegment);
        return {
          type: 'FINALIZED_TRANSACTION',
          originalTransaction: recipe.originalTransaction,
          balancingTransaction: signedBalancingTx,
        };
      }
      case 'UNBOUND_TRANSACTION': {
        const signedBalancingTx = recipe.balancingTransaction
          ? await this.signUnprovenTransaction(recipe.balancingTransaction, signSegment)
          : undefined;
        const signedBaseTx = await this.signUnboundTransaction(recipe.baseTransaction, signSegment);
        return {
          type: 'UNBOUND_TRANSACTION',
          baseTransaction: signedBaseTx,
          balancingTransaction: signedBalancingTx,
        };
      }
      case 'UNPROVEN_TRANSACTION': {
        const signedTx = await this.signUnprovenTransaction(recipe.transaction, signSegment);
        return {
          type: 'UNPROVEN_TRANSACTION',
          transaction: signedTx,
        };
      }
    }
  }

  async signUnprovenTransaction(
    tx: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    return await this.unshielded.signUnprovenTransaction(tx, signSegment);
  }

  async signUnboundTransaction(
    tx: UnboundTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<UnboundTransaction> {
    return await this.unshielded.signUnboundTransaction(tx, signSegment);
  }

  async finalizeTransaction(tx: ledger.UnprovenTransaction): Promise<ledger.FinalizedTransaction> {
    return await this.shielded.finalizeTransaction(tx);
  }

  async calculateTransactionFee(tx: AnyTransaction): Promise<bigint> {
    return await this.dust.calculateFee([tx]);
  }

  async transferTransaction(
    outputs: CombinedTokenTransfer[],
    secretKeys: {
      zswapSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      payFees?: boolean;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { zswapSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, payFees = true } = options;

    const unshieldedOutputs = outputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const shieldedOutputs = outputs.filter((output) => output.type === 'shielded').flatMap((output) => output.outputs);

    if (unshieldedOutputs.length === 0 && shieldedOutputs.length === 0) {
      throw Error('At least one shielded or unshielded output is required.');
    }

    const shieldedTx =
      shieldedOutputs.length > 0
        ? await this.shielded.transferTransaction(zswapSecretKeys, shieldedOutputs)
        : undefined;

    const unshieldedTx =
      unshieldedOutputs.length > 0 ? await this.unshielded.transferTransaction(unshieldedOutputs, ttl) : undefined;

    const mergedTxs = this.mergeUnprovenTransactions(shieldedTx, unshieldedTx)!;

    // Add fee payment
    const feeBalancingTx = payFees ? await this.dust.balanceTransactions(dustSecretKey, [mergedTxs], ttl) : undefined;

    const finalTx = this.mergeUnprovenTransactions(mergedTxs, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: finalTx,
    };
  }

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
    desiredInputs: CombinedSwapInputs,
    desiredOutputs: CombinedSwapOutputs[],
    secretKeys: {
      zswapSecretKeys: ledger.ZswapSecretKeys;
      dustSecretKey: ledger.DustSecretKey;
    },
    options: {
      ttl: Date;
      payFees?: boolean;
    },
  ): Promise<UnprovenTransactionRecipe> {
    const { zswapSecretKeys, dustSecretKey } = secretKeys;
    const { ttl, payFees = false } = options;

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

    const feeBalancingTx = payFees ? await this.dust.balanceTransactions(dustSecretKey, [combinedTx], ttl) : undefined;

    const finalTx = this.mergeUnprovenTransactions(combinedTx, feeBalancingTx)!;

    return {
      type: 'UNPROVEN_TRANSACTION',
      transaction: finalTx,
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

  async start(zswapSecretKeys: ledger.ZswapSecretKeys, dustSecretKey: ledger.DustSecretKey): Promise<void> {
    await Promise.all([this.shielded.start(zswapSecretKeys), this.unshielded.start(), this.dust.start(dustSecretKey)]);
  }

  async stop(): Promise<void> {
    await Promise.all([this.shielded.stop(), this.unshielded.stop(), this.dust.stop()]);
  }
}
