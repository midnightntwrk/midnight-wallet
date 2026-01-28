import { describe, expect, it, vi } from 'vitest';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import crypto from 'node:crypto';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import type { SubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { WalletFacade } from '../src/index.js';
import { sleep } from './utils/index.js';
import { PendingTransactions } from '@midnight-ntwrk/wallet-sdk-capabilities/pendingTransactions';
import * as rx from 'rxjs';

describe('Wallet Facade handling pending transactions', () => {
  it('reverts transaction after it misses and was not submitted yet', async () => {
    const config = {
      networkId: NetworkId.NetworkId.Undeployed,
      relayURL: new URL('http://localhost:9944'),
      indexerClientConnection: {
        indexerHttpUrl: 'http://localhost:8080',
      },
      provingServerUrl: new URL('http://localhost:6300'),
      costParameters: {
        additionalFeeOverhead: 0n,
        feeBlocksMargin: 0,
      },
      txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    };
    const seed = crypto.randomBytes(32);
    const shielded = ShieldedWallet(config).startWithShieldedSeed(seed);
    const unshielded = UnshieldedWallet(config).startWithPublicKey(
      PublicKey.fromKeyStore(createKeystore(seed, config.networkId)),
    );
    const dust = DustWallet(config).startWithSeed(seed, ledger.LedgerParameters.initialParameters().dust);
    const fakeSubmission = new (class implements SubmissionService<ledger.FinalizedTransaction> {
      submitTransaction = () => Promise.reject(new Error('Submission failed'));
      close = () => Promise.resolve();
    })();

    const facade: WalletFacade = new WalletFacade(shielded, unshielded, dust, fakeSubmission);

    const spiedShieldedRevert = vi.spyOn(shielded, 'revertTransaction');
    const spiedUnshieldedRevert = vi.spyOn(unshielded, 'revertTransaction');
    const spiedDustRevert = vi.spyOn(dust, 'revertTransaction');

    const ttl = new Date(Date.now() + 10);
    const transaction = ledger.Transaction.fromParts(config.networkId, undefined, undefined, ledger.Intent.new(ttl));

    const finalized = await facade.finalizeTransaction(transaction); //Any action involving wallet should save transaction to pending

    const state = await rx.firstValueFrom(facade.state());

    await sleep(5); //Buffer for processing

    expect(spiedShieldedRevert).toHaveBeenCalled();
    expect(spiedUnshieldedRevert).toHaveBeenCalled();
    expect(spiedDustRevert).toHaveBeenCalled();
    expect(
      PendingTransactions.has(state.pendingTransactions, finalized, PendingTransactions.TransactionTrait.Finalized),
    );
  });
});
