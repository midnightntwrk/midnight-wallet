import { describe } from '@jest/globals';
import * as ledger from '@midnight-ntwrk/ledger';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolVersion } from '@midnight-ntwrk/abstractions';
import { initEmptyState, Proving, Simulator, Sync, V1Builder, V1Tag } from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Array as EArray, Effect, pipe } from 'effect';
import * as rx from 'rxjs';

describe('Working in simulation mode', () => {
  //TODO: This test needs to pass once transacting capability is rewritten and made flexible enough to work with proof-erased transactions
  it.skip('allows to make transactions', async () => {
    const senderKeys = zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0));
    const receiverKeys = zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1));

    const genesisMints = [
      {
        amount: 10000n,
        type: ledger.nativeToken(),
        recipient: senderKeys,
      },
    ] as const;

    const simulator = Simulator.Simulator.init(genesisMints).pipe(Effect.runSync);

    const WalletBase = WalletBuilderTs.init()
      .withVariant(
        ProtocolVersion.MinSupportedVersion,
        new V1Builder()
          .withTransactionType<zswap.ProofErasedTransaction>()
          .withProving(Proving.makeProofErasingProvingService)
          .withSerializationDefaults()
          .withSync(Sync.makeSimulatorSyncService, Sync.makeSimulatorSyncCapability),
      )
      .build({
        simulator,
        networkId: zswap.NetworkId.Undeployed,
      });

    class Wallet extends WalletBase {
      static init(keys: zswap.SecretKeys): Wallet {
        return Wallet.startFirst(Wallet, initEmptyState(keys, Wallet.configuration.networkId));
      }
    }

    const senderWallet = Wallet.init(senderKeys);
    const receiverWallet = Wallet.init(receiverKeys);

    //Making the transfer is meant to run in background
    void senderWallet.runtime
      .dispatch({
        [V1Tag]: (v1) => {
          return v1
            .transferTransaction([
              {
                type: ledger.nativeToken(),
                amount: 42n,
                receiverAddress: ShieldedAddress.codec
                  .encode(
                    ledger.NetworkId.Undeployed,
                    new ShieldedAddress(
                      new ShieldedCoinPublicKey(Buffer.from(receiverKeys.coinPublicKey, 'hex')),
                      new ShieldedEncryptionPublicKey(Buffer.from(receiverKeys.encryptionPublicKey, 'hex')),
                    ),
                  )
                  .asString(),
              },
            ])
            .pipe(
              Effect.flatMap((recipe) => v1.finalizeTransaction(recipe)),
              Effect.flatMap((tx) => {
                //TODO: replace with proper submission: v1.submitTx(tx)
                return simulator.submitRegularTx(
                  ledger.ProofErasedTransaction.deserialize(
                    tx.serialize(zswap.NetworkId.Undeployed),
                    ledger.NetworkId.Undeployed,
                  ),
                );
              }),
            );
        },
      })
      .pipe(Effect.flatten, Effect.runPromise);

    const finalBalance = await pipe(
      receiverWallet.state,
      rx.concatMap((state) => (state.state.state.coins.size > 0 ? [Array.from(state.state.state.coins)] : [])),
      rx.map(EArray.reduce(0n, (acc, coin: zswap.QualifiedCoinInfo) => acc + coin.value)),
      (a) => rx.firstValueFrom(a),
    );

    expect(finalBalance).toEqual(42n);
  });
});
