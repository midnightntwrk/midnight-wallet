import * as ledger from '@midnight-ntwrk/ledger-v6';
import { Effect, ParseResult, Scope, Stream, Schema, pipe, Either } from 'effect';
import { CoreWallet } from './CoreWallet.js';
import { Simulator, SimulatorState } from './Simulator.js';
import { ZswapEvents } from '@midnight-ntwrk/wallet-sdk-indexer-client';
import { WsSubscriptionClient, ConnectionHelper } from '@midnight-ntwrk/wallet-sdk-indexer-client/effect';
import { SyncWalletError, WalletError } from './WalletError.js';
import { WsURL } from '@midnight-ntwrk/wallet-sdk-utilities/networking';
import { TransactionHistoryCapability } from './TransactionHistory.js';
import { EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';

export interface SyncService<TState, TStartAux, TUpdate> {
  updates: (state: TState, auxData: TStartAux) => Stream.Stream<TUpdate, WalletError, Scope.Scope>;
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
};

export type DefaultSyncContext = {
  transactionHistoryCapability: TransactionHistoryCapability<CoreWallet, ledger.FinalizedTransaction>;
};

const Uint8ArraySchema = Schema.declare(
  (input: unknown): input is Uint8Array => input instanceof Uint8Array,
).annotations({
  identifier: 'Uint8Array',
});

type SecretKeysResource = <A>(cb: (keys: ledger.ZswapSecretKeys) => A) => A;
export const SecretKeysResource = {
  create: (secretKeys: ledger.ZswapSecretKeys): SecretKeysResource => {
    /**
     * TODO: future Ledger version will include `clear` function to clear the secret keys,
     * it is intentend to be used here instead of `null`
     */
    let sk: ledger.ZswapSecretKeys | null = secretKeys;
    return (cb) => {
      if (sk === null) {
        throw new Error('Secret keys have been consumed');
      }
      const result = cb(sk);
      sk = null;
      return result;
    };
  },
};

export type WalletSyncUpdate = {
  update: EventsSyncUpdate;
  secretKeys: SecretKeysResource;
};
export const WalletSyncUpdate = {
  create: (update: EventsSyncUpdate, secretKeys: ledger.ZswapSecretKeys): WalletSyncUpdate => {
    return {
      update,
      secretKeys: SecretKeysResource.create(secretKeys),
    };
  },
};

const LedgerEventSchema = Schema.declare(
  (input: unknown): input is ledger.Event => input instanceof ledger.Event,
).annotations({
  identifier: 'ledger.Event',
});

const LedgerEventFromUint8Array: Schema.Schema<ledger.Event, Uint8Array> = Schema.transformOrFail(
  Uint8ArraySchema,
  LedgerEventSchema,
  {
    encode: (event) =>
      Effect.try({
        try: () => event.serialize(),
        catch: (error) => new ParseResult.Unexpected(error, 'Could not serialize ledger event'),
      }),
    decode: (bytes) =>
      Effect.try({
        try: () => ledger.Event.deserialize(bytes),
        catch: (error) => new ParseResult.Unexpected(error, 'Could not deserialize ledger event'),
      }),
  },
);

const HexedLedgerEvent: Schema.Schema<ledger.Event, string> = pipe(
  Schema.Uint8ArrayFromHex,
  Schema.compose(LedgerEventFromUint8Array),
);

const EventsSyncUpdatePayload = Schema.Struct({
  id: Schema.Number,
  raw: Schema.String,
  maxId: Schema.Number,
});

export const EventsSyncUpdate = Schema.TaggedStruct('EventsSyncUpdate', {
  id: Schema.Number,
  maxId: Schema.Number,
  event: LedgerEventSchema,
});

export type EventsSyncUpdate = Schema.Schema.Type<typeof EventsSyncUpdate>;

const EventsSyncUpdateFromPayload = Schema.transformOrFail(EventsSyncUpdatePayload, EventsSyncUpdate, {
  decode: (input) =>
    pipe(
      Schema.decodeUnknownEither(HexedLedgerEvent)(input.raw),
      Either.map((event) => ({
        _tag: 'EventsSyncUpdate' as const,
        id: input.id,
        maxId: input.maxId,
        event,
      })),
      Either.mapLeft((error) => new ParseResult.Unexpected(error, 'Failed to decode ledger event payload')),
      EitherOps.toEffect,
    ),
  encode: (output) =>
    pipe(
      Schema.encodeEither(HexedLedgerEvent)(output.event),
      Either.map((raw) => ({
        id: output.id,
        raw,
        maxId: output.maxId,
      })),
      Either.mapLeft((error) => new ParseResult.Unexpected(error, 'Failed to encode ledger event payload')),
      EitherOps.toEffect,
    ),
});

export const makeEventsSyncService = (
  config: DefaultSyncConfiguration,
): SyncService<CoreWallet, ledger.ZswapSecretKeys, WalletSyncUpdate> => {
  return {
    updates: (
      state: CoreWallet,
      secretKeys: ledger.ZswapSecretKeys,
    ): Stream.Stream<WalletSyncUpdate, WalletError, Scope.Scope> => {
      const { indexerClientConnection } = config;

      const webSocketUrlResult = ConnectionHelper.createWebSocketUrl(
        indexerClientConnection.indexerHttpUrl,
        indexerClientConnection.indexerWsUrl,
      );
      if (Either.isLeft(webSocketUrlResult)) {
        return Stream.fail(
          new SyncWalletError(
            new Error(`Could not derive WebSocket URL from indexer HTTP URL: ${webSocketUrlResult.left.message}`),
          ),
        );
      }

      const indexerWsUrlResult = WsURL.make(webSocketUrlResult.right);

      if (Either.isLeft(indexerWsUrlResult)) {
        return Stream.fail(
          new SyncWalletError(new Error(`Invalid indexer WS URL: ${indexerWsUrlResult.left.message}`)),
        );
      }

      const indexerWsUrl = indexerWsUrlResult.right;
      const appliedIndex = state.progress?.appliedIndex ?? 0n;

      return pipe(
        ZswapEvents.run({ id: Number(appliedIndex) }),
        Stream.provideLayer(WsSubscriptionClient.layer({ url: indexerWsUrl })),
        Stream.mapError((error) => new SyncWalletError(error)),
        Stream.mapEffect((subscription) =>
          pipe(
            Schema.decodeUnknownEither(EventsSyncUpdateFromPayload)(subscription.zswapLedgerEvents),
            Either.mapLeft((err) => new SyncWalletError(err)),
            EitherOps.toEffect,
          ),
        ),
        Stream.map((data) => WalletSyncUpdate.create(data, secretKeys)),
      );
    },
  };
};

export const makeEventsSyncCapability = (): SyncCapability<CoreWallet, WalletSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, wrappedUpdate: WalletSyncUpdate): CoreWallet => {
      const nextAppliedIndex = BigInt(wrappedUpdate.update.id);
      const highestRelevantWalletIndex = BigInt(wrappedUpdate.update.maxId);
      // in case the nextAppliedIndex is less than or equal to the appliedIndex
      // just update highestRelevantWalletIndex
      if (nextAppliedIndex <= state.progress.appliedIndex) {
        return CoreWallet.updateProgress(state, {
          appliedIndex: nextAppliedIndex,
          highestRelevantWalletIndex,
          isConnected: true,
        });
      }

      return wrappedUpdate.secretKeys((keys) => {
        return CoreWallet.updateProgress(CoreWallet.replayEvents(state, keys, [wrappedUpdate.update.event]), {
          highestRelevantWalletIndex,
          appliedIndex: nextAppliedIndex,
          isConnected: true,
        });
      });
    },
  };
};

export type SimulatorSyncConfiguration = {
  simulator: Simulator;
};

export type SimulatorSyncUpdate = {
  update: SimulatorState;
  secretKeys: ledger.ZswapSecretKeys;
};

export const makeSimulatorSyncService = (
  config: SimulatorSyncConfiguration,
): SyncService<CoreWallet, ledger.ZswapSecretKeys, SimulatorSyncUpdate> => {
  return {
    updates: (_state: CoreWallet, secretKeys: ledger.ZswapSecretKeys) =>
      config.simulator.state$.pipe(Stream.map((state) => ({ update: state, secretKeys: secretKeys }))),
  };
};

export const makeSimulatorSyncCapability = (): SyncCapability<CoreWallet, SimulatorSyncUpdate> => {
  return {
    applyUpdate: (state: CoreWallet, update: SimulatorSyncUpdate) => {
      const {
        update: {
          lastTxResult: { events },
        },
        secretKeys,
      } = update;

      return CoreWallet.replayEvents(state, secretKeys, events);
    },
  };
};
