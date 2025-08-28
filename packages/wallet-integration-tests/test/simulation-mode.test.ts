import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/abstractions';
import * as ledger from '@midnight-ntwrk/ledger';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilder } from '@midnight-ntwrk/wallet-ts';
import {
  Proving,
  Simulator,
  Submission,
  Sync,
  Transacting,
  TransactionHistory,
  V1Builder,
  V1State,
  V1Tag,
} from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, pipe } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 10_000 });

describe('Working in simulation mode', () => {
  it('allows to make transactions', async () => {
    return Effect.gen(function* () {
      const senderKeys = zswap.SecretKeys.fromSeed(Buffer.alloc(32, 0));
      const receiverKeys = zswap.SecretKeys.fromSeed(Buffer.alloc(32, 1));

      const genesisMints = [
        {
          amount: 10_000_000n,
          type: ledger.nativeToken(),
          recipient: senderKeys,
        },
      ] as const;
      const simulator = yield* Simulator.Simulator.init(genesisMints);

      const WalletBase = WalletBuilder.init()
        .withVariant(
          ProtocolVersion.MinSupportedVersion,
          new V1Builder()
            .withTransactionType<zswap.ProofErasedTransaction>()
            .withProving(Proving.makeSimulatorProvingService)
            .withCoinSelectionDefaults()
            .withTransacting(Transacting.makeSimulatorTransactingCapability)
            .withTransactionHistory(TransactionHistory.makeSimulatorTransactionHistoryCapability)
            .withSync(Sync.makeSimulatorSyncService, Sync.makeSimulatorSyncCapability)
            .withCoinsAndBalancesDefaults()
            .withKeysDefaults()
            .withSubmission(Submission.makeSimulatorSubmissionService())
            .withSerializationDefaults(),
        )
        .build({
          simulator,
          networkId: zswap.NetworkId.Undeployed,
          costParameters: {
            ledgerParams: zswap.LedgerParameters.dummyParameters(),
            additionalFeeOverhead: 0n,
          },
        });

      const getAddress = (keys: zswap.SecretKeys): string => {
        return ShieldedAddress.codec
          .encode(
            ledger.NetworkId.Undeployed,
            new ShieldedAddress(
              new ShieldedCoinPublicKey(Buffer.from(keys.coinPublicKey, 'hex')),
              new ShieldedEncryptionPublicKey(Buffer.from(keys.encryptionPublicKey, 'hex')),
            ),
          )
          .asString();
      };

      class Wallet extends WalletBase {
        static coinsAndBalances = Wallet.allVariantsRecord()[V1Tag].variant.coinsAndBalances;
        static init(keys: zswap.SecretKeys): Wallet {
          return Wallet.startFirst(Wallet, V1State.initEmpty(keys, Wallet.configuration.networkId));
        }
      }

      const senderWallet = Wallet.init(senderKeys);
      const receiverWallet = Wallet.init(receiverKeys);

      yield* Effect.promise(() => {
        return pipe(
          senderWallet.rawState,
          rx.map(ProtocolState.state),
          rx.filter((s) => Wallet.coinsAndBalances.getAvailableCoins(s).length > 0),
          rx.firstValueFrom,
        );
      });

      //Making the transfer is meant to run in background
      yield* pipe(
        senderWallet.runtime.dispatch({
          [V1Tag]: (v1) => {
            return v1
              .transferTransaction([
                { type: ledger.nativeToken(), amount: 42n, receiverAddress: getAddress(receiverKeys) },
              ])
              .pipe(
                Effect.flatMap((recipe) => v1.finalizeTransaction(recipe)),
                Effect.flatMap((tx) => v1.submitTransaction(tx)),
              );
          },
        }),
      );

      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverWallet.rawState,
          rx.map(ProtocolState.state),
          rx.filter((state) => Wallet.coinsAndBalances.getAvailableCoins(state).length > 0),
          rx.map((state) => Wallet.coinsAndBalances.getTotalBalances(state)[zswap.nativeToken()]),
          (a) => rx.firstValueFrom(a),
        ),
      );

      expect(finalBalance).toEqual(42n);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
