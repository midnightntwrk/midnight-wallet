import { combineLatest, map, Observable } from 'rxjs';
import { ShieldedWalletState, type ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { type UnshieldedWallet, UnshieldedWalletState } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { type ProvingRecipe } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import * as ledger from '@midnight-ntwrk/ledger';

export interface TokenTransfer {
  type: string;
  receiverAddress: string;
  amount: bigint;
}

export type CombinedTokenTransfer = {
  type: 'shielded' | 'unshielded';
  outputs: TokenTransfer[];
};

export class WalletFacade {
  shielded: ShieldedWallet;
  unshielded: UnshieldedWallet;

  constructor(shieldedWallet: ShieldedWallet, unshieldedWallet: UnshieldedWallet) {
    this.shielded = shieldedWallet;
    this.unshielded = unshieldedWallet;
  }

  state(): Observable<{
    shielded: ShieldedWalletState;
    unshielded: UnshieldedWalletState;
  }> {
    return combineLatest([this.shielded.state, this.unshielded.state()]).pipe(
      map(([shieldedState, unshieldedState]) => ({ shielded: shieldedState, unshielded: unshieldedState })),
    );
  }

  async submitTransaction(
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>,
  ): Promise<string> {
    const submittedTransaction = await this.shielded.submitTransaction(tx, 'Finalized');

    return submittedTransaction.txHash;
  }

  async balanceTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    tx: ledger.Transaction<ledger.SignatureEnabled, ledger.PreProof, ledger.PreBinding>,
  ): Promise<
    ProvingRecipe.ProvingRecipe<ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>>
  > {
    const unshieldedBalancedTx = await this.unshielded.balanceTransaction(tx);

    return await this.shielded.balanceTransaction(zswapSecretKeys, unshieldedBalancedTx, []);
  }

  async finalizeTransaction(
    recipe: ProvingRecipe.ProvingRecipe<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>>,
  ): Promise<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>> {
    return await this.shielded.finalizeTransaction(recipe);
  }

  async transferTransaction(
    zswapSecretKeys: ledger.ZswapSecretKeys,
    outputs: CombinedTokenTransfer[],
  ): Promise<
    ProvingRecipe.ProvingRecipe<ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>>
  > {
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
      unshieldedTx = await this.unshielded.transferTransaction(unshieldedOutputs);
    }

    if (shieldedOutputs.length > 0) {
      shieldedTxRecipe = await this.shielded.transferTransaction(zswapSecretKeys, shieldedOutputs);
    }

    // if there's a shielded tx only, return it as it's already balanced
    if (shieldedTxRecipe !== undefined && unshieldedTx === undefined) {
      return shieldedTxRecipe;
    }

    // if there's an unshielded tx only, pay fees (balance) with shielded wallet
    if (shieldedTxRecipe === undefined && unshieldedTx !== undefined) {
      const unshieldedTxFinalized = await this.shielded.finalizeTransaction({
        type: 'TransactionToProve',
        transaction: unshieldedTx,
      });
      return await this.shielded.balanceTransaction(zswapSecretKeys, unshieldedTxFinalized, []);
    }

    // if there's a shielded and unshielded tx, pay fees for unshielded and merge them
    if (shieldedTxRecipe !== undefined && unshieldedTx !== undefined) {
      if (shieldedTxRecipe.type !== 'TransactionToProve') {
        throw Error('Unexpected transaction type.');
      }
      const txToBalance = shieldedTxRecipe.transaction.merge(unshieldedTx);

      return await this.shielded.balanceTransaction(zswapSecretKeys, txToBalance, []);
    }

    throw Error('Unexpected transaction state.');
  }

  async start(zswapSecretKeys: ledger.ZswapSecretKeys): Promise<void> {
    await Promise.all([this.shielded.start(zswapSecretKeys), this.unshielded.start()]);
  }

  async stop(): Promise<void> {
    await Promise.all([this.shielded.stop(), this.unshielded.stop()]);
    await this.unshielded.stop();
  }
}
