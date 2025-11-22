import { Effect, Either, pipe, Schema } from 'effect';
import { WalletError } from './WalletError.js';
import { CoreWallet } from './CoreWallet.js';
import { NetworkId, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { UnshieldedStateSchema } from '@midnight-ntwrk/wallet-sdk-unshielded-state';

export type SerializationCapability<TWallet, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(data: TSerialized): Either.Either<TWallet, WalletError>;
};

export type DefaultSerializationConfiguration = {
  networkId: NetworkId.NetworkId;
};

export const makeDefaultV1SerializationCapability = (): SerializationCapability<CoreWallet, string> => {
  const SnapshotSchema = Schema.Struct({
    publicKeys: Schema.Struct({
      publicKey: Schema.String,
      address: Schema.String,
    }),
    state: UnshieldedStateSchema,
    protocolVersion: Schema.BigInt,
    appliedId: Schema.optional(Schema.BigInt),
    networkId: Schema.String,
  });

  type Snapshot = Schema.Schema.Type<typeof SnapshotSchema>;
  return {
    serialize: (wallet) => {
      const buildSnapshot = (w: CoreWallet): Snapshot => ({
        publicKeys: w.publicKeys,
        state: Effect.runSync(w.state.getLatestState()),
        protocolVersion: w.protocolVersion,
        networkId: w.networkId,
        appliedId: w.progress?.appliedId,
      });

      return pipe(wallet, buildSnapshot, Schema.encodeSync(SnapshotSchema), JSON.stringify);
    },
    deserialize: (serialized): Either.Either<CoreWallet, WalletError> =>
      pipe(
        serialized,
        Schema.decodeUnknownEither(Schema.parseJson(SnapshotSchema)),
        Either.mapLeft((err) => WalletError.other(err)),
        Either.map((snapshot) => {
          return CoreWallet.restore(
            snapshot.state,
            snapshot.publicKeys,
            {
              highestTransactionId: snapshot.appliedId ?? 0n,
              appliedId: snapshot.appliedId ?? 0n,
            },
            ProtocolVersion.ProtocolVersion(snapshot.protocolVersion),
            snapshot.networkId,
          );
        }),
      ),
  };
};
