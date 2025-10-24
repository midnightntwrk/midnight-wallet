import { combineLatest, map, Observable } from 'rxjs';
import { ShieldedWalletState, type ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWallet, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { AnyTransaction, DustWallet, DustWalletState } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { ProvingRecipe } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger-v6';

export interface TokenTransfer {
  type: string;
  receiverAddress: string;
  amount: bigint;
}

export type CombinedTokenTransfer = {
  type: 'shielded' | 'unshielded';
  outputs: TokenTransfer[];
};

export type NightUtxoWithMeta = ledger.Utxo & { ctime: number };

export class WalletFacade {
  shielded: ShieldedWallet;
  unshielded: UnshieldedWallet;
  dust: DustWallet;

  constructor(shieldedWallet: ShieldedWallet, unshieldedWallet: UnshieldedWallet, dustWallet: DustWallet) {
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
    this.dust = dustWallet;
  }

  state(): Observable<{
    shielded: ShieldedWalletState;
    unshielded: UnshieldedWalletState;
    dust: DustWalletState;
  }> {
    return combineLatest([this.shielded.state, this.unshielded.state(), this.dust.state]).pipe(
      map(([shieldedState, unshieldedState, dustState]) => ({
        shielded: shieldedState,
        unshielded: unshieldedState,
        dust: dustState,
      })),
    );
  }

  async submitTransaction(tx: ledger.FinalizedTransaction): Promise<string> {
    const submittedTransaction = await this.shielded.submitTransaction(tx, 'Finalized');

    return submittedTransaction.txHash;
  }

  async balanceTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKeys: ledger.DustSecretKey,
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish>,
    ttl: Date,
  ): Promise<ProvingRecipe.ProvingRecipe<ledger.FinalizedTransaction>> {
    const unshieldedBalancedTx = await this.unshielded.balanceTransaction(tx);

    const recipe = await this.shielded.balanceTransaction(zswapSecretKeys, unshieldedBalancedTx, []);

    switch (recipe.type) {
      case ProvingRecipe.TRANSACTION_TO_PROVE:
        return await this.dust.addFeePayment(dustSecretKeys, recipe.transaction, new Date(), ttl);
      case ProvingRecipe.BALANCE_TRANSACTION_TO_PROVE: {
        // if the shielded wallet returned a proven transaction, we need to pay fees with the dust wallet
        const balancedTx = await this.dust.addFeePayment(dustSecretKeys, recipe.transactionToProve, new Date(), ttl);

        if (balancedTx.type !== ProvingRecipe.TRANSACTION_TO_PROVE) {
          throw Error('Unexpected transaction type after adding fee payment.');
        }

        return {
          ...recipe,
          transactionToProve: balancedTx.transaction,
        };
      }
      case ProvingRecipe.NOTHING_TO_PROVE: {
        // @TODO fix casting
        const txToBalance = recipe.transaction as unknown as ledger.UnprovenTransaction;
        return await this.dust.addFeePayment(dustSecretKeys, txToBalance, new Date(), ttl);
      }
    }
  }

  async finalizeTransaction(
    recipe: ProvingRecipe.ProvingRecipe<ledger.FinalizedTransaction>,
  ): Promise<ledger.FinalizedTransaction> {
    return await this.shielded.finalizeTransaction(recipe);
  }

  async signTransaction(
    tx: ledger.UnprovenTransaction,
    signSegment: (data: Uint8Array) => ledger.Signature,
  ): Promise<ledger.UnprovenTransaction> {
    return await this.unshielded.signTransaction(tx, signSegment);
  }

  async calculateTransactionFee(tx: AnyTransaction): Promise<bigint> {
    return await this.dust.calculateFee(tx);
  }

  async transferTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    dustSecretKey: ledger.DustSecretKey,
    outputs: CombinedTokenTransfer[],
    ttl: Date,
  ): Promise<ProvingRecipe.TransactionToProve> {
    const unshieldedOutputs = outputs
      .filter((output) => output.type === 'unshielded')
      .flatMap((output) => output.outputs);

    const shieldedOutputs = outputs.filter((output) => output.type === 'shielded').flatMap((output) => output.outputs);

    if (unshieldedOutputs.length === 0 && shieldedOutputs.length === 0) {
      throw Error('At least one shielded or unshielded output is required.');
    }

    let shieldedTxRecipe = undefined;
    let unshieldedTx = undefined;

    if (unshieldedOutputs.length > 0) {
      unshieldedTx = await this.unshielded.transferTransaction(unshieldedOutputs, ttl);
    }

    if (shieldedOutputs.length > 0) {
      shieldedTxRecipe = await this.shielded.transferTransaction(zswapSecretKeys, shieldedOutputs);
    }

    // if there's a shielded tx only, return it as it's already balanced
    if (shieldedTxRecipe !== undefined && unshieldedTx === undefined) {
      if (shieldedTxRecipe.type !== 'TransactionToProve') {
        throw Error('Unexpected transaction type.');
      }

      const recipe = await this.dust.addFeePayment(dustSecretKey, shieldedTxRecipe.transaction, new Date(), ttl);

      if (recipe.type !== 'TransactionToProve') {
        throw Error('Unexpected transaction type after adding fee payment.');
      }

      return recipe;
    }

    // if there's an unshielded tx only, pay fees (balance) with shielded wallet
    if (shieldedTxRecipe === undefined && unshieldedTx !== undefined) {
      const recipe = await this.dust.addFeePayment(dustSecretKey, unshieldedTx, new Date(), ttl);
      if (recipe.type !== 'TransactionToProve') {
        throw Error('Unexpected transaction type after adding fee payment.');
      }
      return recipe;
    }

    // if there's a shielded and unshielded tx, pay fees for unshielded and merge them
    if (shieldedTxRecipe !== undefined && unshieldedTx !== undefined) {
      if (shieldedTxRecipe.type !== 'TransactionToProve') {
        throw Error('Unexpected transaction type.');
      }
      const txToBalance = shieldedTxRecipe.transaction.merge(unshieldedTx);

      const recipe = await this.dust.addFeePayment(dustSecretKey, txToBalance, new Date(), ttl);

      if (recipe.type !== 'TransactionToProve') {
        throw Error('Unexpected transaction type after adding fee payment.');
      }

      return recipe;
    }

    throw Error('Unexpected transaction state.');
  }

  async registerNightUtxosForDustGeneration(
    nightUtxos: NightUtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => Promise<ledger.Signature> | ledger.Signature,
    dustReceiverAddress?: string,
  ): Promise<ProvingRecipe.TransactionToProve> {
    if (nightUtxos.length === 0) {
      throw Error('At least one Night UTXO is required.');
    }

    const dustState = await this.dust.waitForSyncedState();
    const receiverAddress = dustReceiverAddress ?? dustState.dustAddress;
    const nextBlock = new Date();
    const ttl = new Date(nextBlock.getTime() + 60 * 60 * 1000);

    const transaction = await this.dust.createDustGenerationTransaction(
      nextBlock,
      ttl,
      nightUtxos.map((utxo) => ({ ...utxo, ctime: new Date(utxo.ctime) })),
      nightVerifyingKey,
      receiverAddress,
    );

    const intent = transaction.intents?.get(1);
    if (!intent) {
      throw Error('Dust generation transaction is missing intent segment 1.');
    }

    const signatureData = intent.signatureData(1);
    const signature = await Promise.resolve(signDustRegistration(signatureData));

    const recipe = await this.dust.addDustGenerationSignature(transaction, signature);
    if (recipe.type !== ProvingRecipe.TRANSACTION_TO_PROVE) {
      throw Error('Unexpected recipe type returned when registering Night UTXOs.');
    }

    return recipe;
  }

  async deregisterFromDustGeneration(
    nightUtxos: NightUtxoWithMeta[],
    nightVerifyingKey: ledger.SignatureVerifyingKey,
    signDustRegistration: (payload: Uint8Array) => Promise<ledger.Signature> | ledger.Signature,
  ): Promise<ProvingRecipe.TransactionToProve> {
    const nextBlock = new Date();
    const ttl = new Date(nextBlock.getTime() + 60 * 60 * 1000);

    const transaction = await this.dust.createDustGenerationTransaction(
      nextBlock,
      ttl,
      nightUtxos.map((utxo) => ({ ...utxo, ctime: new Date(utxo.ctime) })),
      nightVerifyingKey,
      undefined,
    );

    const intent = transaction.intents?.get(1);
    if (!intent) {
      throw Error('Dust generation transaction is missing intent segment 1.');
    }

    const signatureData = intent.signatureData(1);
    const signature = await Promise.resolve(signDustRegistration(signatureData));

    const recipe = await this.dust.addDustGenerationSignature(transaction, signature);
    if (recipe.type !== ProvingRecipe.TRANSACTION_TO_PROVE) {
      throw Error('Unexpected recipe type returned when registering Night UTXOs.');
    }

    return recipe;
  }

  async start(zswapSecretKeys: ledger.ZswapSecretKeys, dustSecretKey: ledger.DustSecretKey): Promise<void> {
    await Promise.all([this.shielded.start(zswapSecretKeys), this.unshielded.start(), this.dust.start(dustSecretKey)]);
  }

  async stop(): Promise<void> {
    await Promise.all([this.shielded.stop(), this.unshielded.stop(), this.dust.stop()]);
  }
}
