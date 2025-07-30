import * as ledger from '@midnight-ntwrk/ledger';
import { describe, expect, it, vi } from 'vitest';
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import { WalletBuilderTs } from '@midnight-ntwrk/wallet-ts';
import { ProtocolVersion } from '@midnight-ntwrk/abstractions';
import {
  Proving,
  Simulator,
  Sync,
  Transacting,
  V1Builder,
  V1State,
  V1Tag,
  Submission,
} from '@midnight-ntwrk/wallet-ts/v1';
import * as zswap from '@midnight-ntwrk/zswap';
import { Array as EArray, Effect, pipe } from 'effect';
import * as rx from 'rxjs';

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

      const WalletBase = WalletBuilderTs.init()
        .withVariant(
          ProtocolVersion.MinSupportedVersion,
          new V1Builder()
            .withTransactionType<zswap.ProofErasedTransaction>()
            .withProving(Proving.makeSimulatorProvingService)
            .withCoinSelectionDefaults()
            .withTransacting(Transacting.makeSimulatorTransactingCapability)
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
        static init(keys: zswap.SecretKeys): Wallet {
          return Wallet.startFirst(Wallet, V1State.initEmpty(keys, Wallet.configuration.networkId));
        }
      }

      const senderWallet = Wallet.init(senderKeys);
      const receiverWallet = Wallet.init(receiverKeys);

      yield* Effect.promise(() => {
        return pipe(
          senderWallet.state,
          rx.filter((s) => s.state.state.coins.size > 0),
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
        Effect.flatten,
      );

      const finalBalance = yield* Effect.promise(() =>
        pipe(
          receiverWallet.state,
          rx.concatMap((state) => (state.state.state.coins.size > 0 ? [Array.from(state.state.state.coins)] : [])),
          rx.map(EArray.reduce(0n, (acc, coin: zswap.QualifiedCoinInfo) => acc + coin.value)),
          (a) => rx.firstValueFrom(a),
        ),
      );

      expect(finalBalance).toEqual(42n);
    }).pipe(Effect.scoped, Effect.runPromise);
  });
});
