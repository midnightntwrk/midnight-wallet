import {
  Bindingish,
  DustLocalState,
  DustNullifier,
  DustParameters,
  DustPublicKey,
  DustSecretKey,
  Proofish,
  Signaturish,
  Transaction,
  Event,
} from '@midnight-ntwrk/ledger-v6';
import { ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { SyncProgress } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Array as Arr, pipe } from 'effect';
import { DustToken, DustTokenWithNullifier } from './types/Dust';
import { CoinWithValue } from './CoinsAndBalances';
import { NetworkId, UnprovenDustSpend } from './types/ledger';
import { dateToSeconds, secondsToDate } from './common';

export type PublicKeys = {
  publicKey: DustPublicKey;
};

export const PublicKeys = {
  fromSecretKey: (secretKey: DustSecretKey): PublicKeys => {
    return {
      publicKey: secretKey.publicKey,
    };
  },
};

export class DustCoreWallet {
  readonly state: DustLocalState;
  readonly publicKeys: PublicKeys;
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;

  readonly isConnected: boolean;
  readonly progress: SyncProgress.SyncProgress;
  readonly networkId: NetworkId;
  readonly pendingDustTokens: Array<DustTokenWithNullifier>;

  constructor(
    state: DustLocalState,
    publicKeys: PublicKeys,
    networkId: NetworkId,
    pendingDustTokens: Array<DustTokenWithNullifier> = [],
    syncProgress?: Omit<SyncProgress.SyncProgressData, 'isConnected'>,
    protocolVersion: ProtocolVersion.ProtocolVersion = ProtocolVersion.MinSupportedVersion,
  ) {
    this.state = state;
    this.publicKeys = publicKeys;
    this.networkId = networkId;
    this.pendingDustTokens = pendingDustTokens;
    this.isConnected = true;
    this.protocolVersion = protocolVersion;
    this.progress = syncProgress ? SyncProgress.createSyncProgress(syncProgress) : SyncProgress.createSyncProgress();
  }

  static init(localState: DustLocalState, secretKey: DustSecretKey, networkId: NetworkId): DustCoreWallet {
    return new DustCoreWallet(localState, PublicKeys.fromSecretKey(secretKey), networkId);
  }

  static readonly initEmpty = (
    dustParameters: DustParameters,
    secretKey: DustSecretKey,
    networkId: NetworkId,
  ): DustCoreWallet => {
    return DustCoreWallet.empty(new DustLocalState(dustParameters), PublicKeys.fromSecretKey(secretKey), networkId);
  };

  static empty(localState: DustLocalState, publicKeys: PublicKeys, networkId: NetworkId): DustCoreWallet {
    return new DustCoreWallet(localState, publicKeys, networkId);
  }

  static restore(
    localState: DustLocalState,
    publicKeys: PublicKeys,
    pendingTokens: Array<DustTokenWithNullifier>,
    syncProgress: SyncProgress.SyncProgressData,
    protocolVersion: bigint,
    networkId: NetworkId,
  ): DustCoreWallet {
    return new DustCoreWallet(
      localState,
      publicKeys,
      networkId,
      pendingTokens,
      syncProgress,
      ProtocolVersion.ProtocolVersion(protocolVersion),
    );
  }

  applyEvents(secretKey: DustSecretKey, events: Event[], blockNumber: bigint): DustCoreWallet {
    if (!events.length) return this;

    const updatedState = this.state.replayEvents(secretKey, events).processTtls(secondsToDate(blockNumber));

    let updatedPending = this.pendingDustTokens;
    if (updatedPending.length) {
      const newAvailable = updatedState.utxos.map((utxo) => utxo.nonce);
      updatedPending = updatedPending.filter((pendingToken) => newAvailable.includes(pendingToken.nonce));
    }

    return new DustCoreWallet(updatedState, this.publicKeys, this.networkId, updatedPending, this.progress);
  }

  applyFailed(tx: Transaction<Signaturish, Proofish, Bindingish>): DustCoreWallet {
    const removedPending: DustNullifier[] = [];
    let updatedState = this.state;
    if (tx.intents) {
      const pendingTokensMap = DustCoreWallet.pendingDustTokensToMap(this.pendingDustTokens);
      for (const intent of tx.intents.values()) {
        if (intent.dustActions && intent.dustActions.spends) {
          for (const spend of intent.dustActions.spends) {
            const pending = pendingTokensMap.get(spend.oldNullifier);
            if (pending === undefined) continue;
            removedPending.push(spend.oldNullifier);
            updatedState = updatedState.processTtls(
              secondsToDate(dateToSeconds(pending.ctime) + this.state.params.dustGracePeriodSeconds),
            );
          }
        }
      }
    }
    const pendingLeft = this.pendingDustTokens.filter((token) => !removedPending.includes(token.nullifier));
    return new DustCoreWallet(updatedState, this.publicKeys, this.networkId, pendingLeft, this.progress);
  }

  revertTransaction<TTransaction extends Transaction<Signaturish, Proofish, Bindingish>>(
    tx: TTransaction,
  ): DustCoreWallet {
    return this.applyFailed(tx);
  }

  updateProgress({
    appliedIndex,
    highestRelevantWalletIndex,
    highestIndex,
    highestRelevantIndex,
    isConnected,
  }: Partial<SyncProgress.SyncProgressData>): DustCoreWallet {
    const updatedProgress = SyncProgress.createSyncProgress({
      appliedIndex: appliedIndex ?? this.progress.appliedIndex,
      highestRelevantWalletIndex: highestRelevantWalletIndex ?? this.progress.highestRelevantWalletIndex,
      highestIndex: highestIndex ?? this.progress.highestIndex,
      highestRelevantIndex: highestRelevantIndex ?? this.progress.highestRelevantIndex,
      isConnected: isConnected ?? this.progress.isConnected,
    });

    return new DustCoreWallet(this.state, this.publicKeys, this.networkId, this.pendingDustTokens, updatedProgress);
  }

  spendCoins(
    secretKey: DustSecretKey,
    coins: ReadonlyArray<CoinWithValue<DustToken>>,
    nextBlock: Date,
  ): [ReadonlyArray<UnprovenDustSpend>, DustCoreWallet] {
    const [output, newState, newPending] = pipe(
      coins,
      Arr.reduce(
        [[], this.state, this.pendingDustTokens],
        (
          [spends, localState]: [ReadonlyArray<UnprovenDustSpend>, DustLocalState, Array<DustTokenWithNullifier>],
          { token: coinToSpend, value: takeFee },
        ) => {
          const [newState, dustSpend] = localState.spend(secretKey, coinToSpend, takeFee, nextBlock);
          const newPending = [...this.pendingDustTokens, { ...coinToSpend, nullifier: dustSpend.oldNullifier }];
          return [Arr.append(spends, dustSpend), newState, newPending];
        },
      ),
    );
    const updatedState = new DustCoreWallet(newState, this.publicKeys, this.networkId, newPending, this.progress);
    return [output, updatedState];
  }

  static pendingDustTokensToMap(tokens: Array<DustTokenWithNullifier>): Map<DustNullifier, DustToken> {
    return new Map<DustNullifier, DustToken>(tokens.map(({ nullifier, ...token }) => [nullifier, token]));
  }
}
