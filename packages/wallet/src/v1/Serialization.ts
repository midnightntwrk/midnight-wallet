import { Either, pipe } from 'effect';
import { V1State } from './RunningV1Variant';
import { WalletError } from './WalletError';
import * as zswap from '@midnight-ntwrk/zswap';
import { CoreWallet, DefaultSerializeCapability } from '@midnight-ntwrk/wallet';
import { EitherOps } from '../effect';

export type SerializationCapability<TWallet, TAux, TSerialized> = {
  serialize(wallet: TWallet): TSerialized;
  deserialize(aux: TAux, data: TSerialized): Either.Either<TWallet, WalletError>;
};

export const makeDefaultV1SerializationCapability = (): SerializationCapability<V1State, zswap.SecretKeys, string> => {
  const scalaImpl = DefaultSerializeCapability.createV1<
    CoreWallet<zswap.LocalState, zswap.SecretKeys>,
    zswap.SecretKeys
  >(
    (wallet) => wallet.toSnapshot(),
    (aux, snapshot) => CoreWallet.fromSnapshot(aux, snapshot),
  );

  return {
    serialize: (wallet) => scalaImpl.serialize(wallet),
    deserialize: (aux, serialized) =>
      pipe(
        scalaImpl.deserialize(aux, serialized),
        EitherOps.fromScala,
        Either.mapLeft((err) => WalletError.fromScala(err)),
      ),
  };
};
