import { Effect, Either, Layer, ParseResult, pipe, Schema, Scope, Stream } from 'effect';
import { DustSecretKey, Event as LedgerEvent } from '@midnight-ntwrk/ledger-v6';
import { DustLedgerEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import {
  WsSubscriptionClient,
  ConnectionHelper,
  SubscriptionClient,
} from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { URLError, WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { WalletError } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { Simulator, SimulatorState } from './Simulator.js';
import { DustCoreWallet } from './DustCoreWallet.js';
import { NetworkId } from './types/ledger.js';
import { Uint8ArraySchema } from './Serialization.js';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError.WalletError, Scope.Scope>;
}

export interface SyncCapability<TState, TUpdate> {
  applyUpdate: (state: TState, update: TUpdate) => TState;
}

export type IndexerClientConnection = {
  indexerHttpUrl: string;
  indexerWsUrl?: string;
};

export type DefaultSyncConfiguration = {
  indexerClientConnection: IndexerClientConnection;
  networkId: NetworkId;
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
  networkId: NetworkId;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
  secretKey: DustSecretKey;
};

type SecretKeysResource = <A>(cb: (key: DustSecretKey) => A) => A;
export const SecretKeysResource = {
  create: (secretKey: DustSecretKey): SecretKeysResource => {
    let sk: DustSecretKey | null = secretKey;
    return (cb) => {
      if (sk === null || sk === undefined) {
        throw new Error('Secret key has been consumed');
      }
      const result = cb(sk);
      sk = null;
      return result;
    };
  },
};

const LedgerEventSchema = Schema.declare(
  (input: unknown): input is LedgerEvent => input instanceof LedgerEvent,
).annotations({
  identifier: 'ledger.Event',
});

const LedgerEventFromUInt8Array: Schema.Schema<LedgerEvent, Uint8Array> = Schema.asSchema(
  Schema.transformOrFail(Uint8ArraySchema, LedgerEventSchema, {
    encode: (e) => {
      return Effect.try({
        try: () => e.serialize(),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not serialize Ledger Event');
        },
      });
    },
    decode: (bytes) =>
      Effect.try({
        try: () => LedgerEvent.deserialize(bytes),
        catch: (err) => {
          return new ParseResult.Unexpected(err, 'Could not deserialize Ledger Event');
        },
      }),
  }),
);

const HexedEvent: Schema.Schema<LedgerEvent, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerEventFromUInt8Array),
);

export const SyncEventsUpdateSchema = Schema.Struct({
  id: Schema.Number,
  raw: HexedEvent,
  maxId: Schema.Number,
});

export type WalletSyncSubscription = Schema.Schema.Type<typeof SyncEventsUpdateSchema>;

export type WalletSyncUpdate = {
  update: WalletSyncSubscription;
  secretKeys: SecretKeysResource;
};
export const WalletSyncUpdate = {
  create: (update: WalletSyncSubscription, secretKey: DustSecretKey): WalletSyncUpdate => {
    return {
      update,
      secretKeys: SecretKeysResource.create(secretKey),
    };
  },
};
export const makeDefaultSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<DustCoreWallet, DustSecretKey, WalletSyncUpdate> => {
  const indexerSyncService = makeIndexerSyncService(config);
  return {
    updates: (
      state: DustCoreWallet,
      secretKey: DustSecretKey,
    ): Stream.Stream<WalletSyncUpdate, WalletError.WalletError, Scope.Scope> => {
      return pipe(
        indexerSyncService.subscribeWallet(state),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKey)),
        Stream.provideSomeLayer(indexerSyncService.connectionLayer()),
      );
    },
  };
};

export type IndexerSyncService = {
  connectionLayer: () => Layer.Layer<SubscriptionClient, WalletError.WalletError, Scope.Scope>;
  subscribeWallet: (
    state: DustCoreWallet,
  ) => Stream.Stream<WalletSyncSubscription, WalletError.WalletError, Scope.Scope | SubscriptionClient>;
};

export const makeIndexerSyncService = (config: DefaultSyncConfiguration): IndexerSyncService => {
  return {
    connectionLayer(): Layer.Layer<SubscriptionClient, WalletError.WalletError, Scope.Scope> {
      const { indexerClientConnection } = config;

      return ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      ).pipe(
        Either.flatMap((url) => WsURL.make(url)),
        Either.match({
          onLeft: (error) => Layer.fail(error),
          onRight: (url: WsURL.WsURL) => WsSubscriptionClient.layer({ url }),
        }),
        Layer.mapError(
          (e: URLError) =>
            new WalletError.SyncWalletError({ message: 'Failed to to obtain correct indexer URLs', cause: e }),
        ),
      );
    },
    subscribeWallet(
      state: DustCoreWallet,
    ): Stream.Stream<WalletSyncSubscription, WalletError.WalletError, Scope.Scope | SubscriptionClient> {
      const { appliedIndex } = state.progress;

      return pipe(
        DustLedgerEvents.run({
          id: Number(appliedIndex),
        }),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(SyncEventsUpdateSchema)(subscription.dustLedgerEvents),
            Either.mapLeft((err) => new WalletError.SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.mapError((error) => new WalletError.SyncWalletError(error)),
      );
    },
  };
};

export const makeDefaultSyncCapability = (): SyncCapability<DustCoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate(state: DustCoreWallet, wrappedUpdate: WalletSyncUpdate): DustCoreWallet {
      const { update, secretKeys } = wrappedUpdate;
      const appliedIndex = BigInt(update.id);
      const highestRelevantWalletIndex = BigInt(update.maxId);

      // in case the appliedIndex is less than or equal to the current appliedIndex
      // just update highestRelevantWalletIndex
      if (appliedIndex <= state.progress.appliedIndex) {
        return state.updateProgress({ appliedIndex, highestRelevantWalletIndex, isConnected: true });
      }

      const events = [update.raw].filter((event) => event !== null);
      return secretKeys((keys) =>
        state
          .applyEvents(keys, events, appliedIndex)
          .updateProgress({ appliedIndex, highestRelevantWalletIndex, isConnected: true }),
      );
    },
  };
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<DustCoreWallet, DustSecretKey, SimulatorSyncUpdate> => {
  return {
    updates: (_state: DustCoreWallet, secretKey: DustSecretKey) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKey }))),
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<DustCoreWallet, SimulatorSyncUpdate> => ({
  applyUpdate: (state: DustCoreWallet, update: SimulatorSyncUpdate) =>
    state
      .applyEvents(update.secretKey, update.update.lastTxResult?.events || [], update.update.lastTxNumber)
      .updateProgress({ appliedIndex: update.update.lastTxNumber }),
});
