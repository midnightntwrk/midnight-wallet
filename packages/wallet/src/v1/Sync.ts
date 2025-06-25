import {
  DefaultSyncCapability,
  DefaultSyncService,
  DefaultTxHistoryCapability,
  IndexerClient,
  IndexerUpdate,
  JsEither,
  TracerCarrier,
  V1Combination,
  V1EvolveState,
  V1Transaction,
} from '@midnight-ntwrk/wallet';
import { ShieldedEncryptionSecretKey } from '@midnight-ntwrk/wallet-sdk-address-format';
import * as zswap from '@midnight-ntwrk/zswap';
import { Effect, Stream } from 'effect';
import * as rx from 'rxjs';
import { ObservableOps } from '../effect/index';
import { V1State } from './RunningV1Variant';

export interface SyncService<TState, TUpdate> {
  updates: (state: TState) => Stream.Stream<TUpdate>;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => TState;
}

export type DefaultSyncConfiguration = {
  indexerWsUrl: string;
  networkId: zswap.NetworkId;
};

export const makeDefaultSyncService = ({
  indexerWsUrl,
  networkId,
}: DefaultSyncConfiguration): SyncService<V1State, IndexerUpdate> => {
  return {
    updates: (state: V1State) => {
      const bech32mESK = ShieldedEncryptionSecretKey.codec
        .encode(networkId, new ShieldedEncryptionSecretKey(state.secretKeys.encryptionSecretKey))
        .asString();
      const tracer = TracerCarrier.createLoggingTracer('debug');
      return Stream.acquireRelease(
        Effect.promise(() => IndexerClient.create(indexerWsUrl, tracer).allocate()),
        (client) => Effect.promise(() => client.deallocate()),
      ).pipe(
        Stream.flatMap((client) =>
          Stream.fromEffect(Effect.succeed(DefaultSyncService.create(client.value, bech32mESK, state.state.firstFree))),
        ),
        Stream.flatMap((service) =>
          ObservableOps.toStream(
            service.sync$().pipe(rx.concatMap((update) => V1Combination.mapIndexerEvent(update, networkId))),
          ),
        ),
      );
    },
  };
};

export const makeDefaultSyncCapability = (): SyncCapability<V1State, IndexerUpdate> => {
  const syncCapability = new DefaultSyncCapability(new DefaultTxHistoryCapability(), V1Transaction, V1EvolveState);

  return {
    applyUpdate(state: V1State, update: IndexerUpdate) {
      return JsEither.fold(
        syncCapability.applyUpdate(state, update),
        (error) => {
          // TODO: return Either instead?
          throw error;
        },
        (state) => state,
      );
    },
  };
};
