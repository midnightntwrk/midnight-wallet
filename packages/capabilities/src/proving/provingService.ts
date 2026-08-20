// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import * as ledger from '@midnightntwrk/ledger-v9';
import type { KeyMaterialProvider } from '@midnight-ntwrk/zkir-v2';
import { ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { HttpProverClient, WasmProver } from '@midnightntwrk/wallet-sdk-prover-client/effect';
import {
  ClientError,
  type InvalidProtocolSchemeError,
  ServerError,
} from '@midnightntwrk/wallet-sdk-utilities/networking';
import { Data, Effect, Either, Option, pipe } from 'effect';

export class ProvingError extends Data.TaggedError('Wallet.Proving')<{
  message: string;
  cause: Error;
}> {}

/**
 * Turns an unproven transaction into a proven one.
 *
 * @typeParam TProven The proven transaction this backend produces.
 * @typeParam TUnproven The unproven transaction it accepts. Defaults to the current ledger's, because a proving backend
 *   is only ever written against one ledger version — which is exactly why choosing between backends is
 *   {@link VersionedProvingServiceEffect}'s job and not this interface's.
 */
export interface ProvingServiceEffect<TProven, TUnproven = ledger.UnprovenTransaction> {
  prove(transaction: TUnproven): Effect.Effect<TProven, ProvingError>;
}

export interface ProvingService<TProven, TUnproven = ledger.UnprovenTransaction> {
  prove(transaction: TUnproven): Promise<TProven>;
}

/** Raised when no proving backend is registered for the protocol version a transaction was built for. */
export class UnsupportedProvingVersionError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/proving/provingService/UnsupportedProvingVersionError',
)<{
  readonly message: string;
  /** The version the transaction was built for, which no registered backend serves. */
  readonly protocolVersion: ProtocolVersion.ProtocolVersion;
}> {}

/**
 * Proves a transaction with the backend registered for the protocol version it was built for.
 *
 * @remarks
 *   The version is the transaction's own stamp, taken when it was built, and never the version the chain has reached by
 *   the time proving happens. A fork can land between balancing and proving; the bytes the prover has to read were
 *   fixed before it did.
 */
export interface VersionedProvingServiceEffect<TProven, TUnproven = ledger.UnprovenTransaction> {
  prove(
    transaction: TUnproven,
    protocolVersion: ProtocolVersion.ProtocolVersion,
  ): Effect.Effect<TProven, ProvingError | UnsupportedProvingVersionError>;
}

export interface VersionedProvingService<TProven, TUnproven = ledger.UnprovenTransaction> {
  prove(transaction: TUnproven, protocolVersion: ProtocolVersion.ProtocolVersion): Promise<TProven>;
}

/** The proving backends a wallet can use, keyed by the protocol version range each one serves. */
export type ProvingServices<TProven, TUnproven = ledger.UnprovenTransaction> = ProtocolVersion.Registry<
  ProvingServiceEffect<TProven, TUnproven>
>;

/**
 * Builds a proving service that routes on the version a transaction was built for.
 *
 * @param services The backends and the version ranges they serve.
 * @returns A proving service that fails with {@link UnsupportedProvingVersionError} for a version nothing serves.
 */
export const makeVersionedProvingServiceEffect = <TProven, TUnproven>(
  services: ProvingServices<TProven, TUnproven>,
): VersionedProvingServiceEffect<TProven, TUnproven> => ({
  prove: (transaction, protocolVersion) =>
    Option.match(ProtocolVersion.select(services, protocolVersion), {
      onNone: () =>
        Effect.fail(
          new UnsupportedProvingVersionError({
            message: `No proving backend is registered for protocol version ${protocolVersion}.`,
            protocolVersion,
          }),
        ),
      onSome: (service) => service.prove(transaction),
    }),
});

/**
 * Lets one backend answer for every protocol version.
 *
 * @remarks
 *   Says out loud what an unversioned proving service was implicitly claiming: that it can prove anything, whatever
 *   version produced it. True for a wallet on one side of a fork, and a lie the moment it crosses — so it has to be
 *   written down rather than assumed.
 * @param service The backend to use for every version.
 * @returns The same backend, addressed by version.
 */
export const singleVersionProvingServiceEffect = <TProven, TUnproven>(
  service: ProvingServiceEffect<TProven, TUnproven>,
): VersionedProvingServiceEffect<TProven, TUnproven> => ({
  prove: (transaction) => service.prove(transaction),
});

export type UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

const wrapEffectService = <TProven, TUnproven>(
  effectService: ProvingServiceEffect<TProven, TUnproven>,
): ProvingService<TProven, TUnproven> => ({
  prove: (transaction) => Effect.runPromise(effectService.prove(transaction)),
});

/** Adapts a version-routed proving service to the promise-facing surface the facade exposes. */
export const wrapVersionedEffectService = <TProven, TUnproven>(
  effectService: VersionedProvingServiceEffect<TProven, TUnproven>,
): VersionedProvingService<TProven, TUnproven> => ({
  prove: (transaction, protocolVersion) => Effect.runPromise(effectService.prove(transaction, protocolVersion)),
});

export const fromProvingProviderEffect = (
  provider: Effect.Effect<ledger.ProvingProvider, InvalidProtocolSchemeError>,
): ProvingServiceEffect<UnboundTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<UnboundTransaction, ProvingError> {
      return pipe(
        provider,
        Effect.flatMap((provider) =>
          Effect.tryPromise({
            try: () => transaction.prove(provider, ledger.CostModel.initialCostModel()),
            catch: (error) =>
              error instanceof ClientError || error instanceof ServerError
                ? error
                : new ClientError({ message: 'Failed to prove transaction', cause: error }),
          }),
        ),
        Effect.catchAll((error) =>
          Effect.fail(
            new ProvingError({
              message: error.message,
              cause: error,
            }),
          ),
        ),
      );
    },
  };
};

export const fromProvingProvider = (provider: ledger.ProvingProvider): ProvingServiceEffect<UnboundTransaction> => {
  return fromProvingProviderEffect(Effect.succeed(provider));
};

export type ServerProvingConfiguration = {
  provingServerUrl: URL;
};

export type WasmProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

/** A proof server together with the protocol version it starts serving. */
export type ProvingServerActivation = Readonly<{
  sinceVersion: ProtocolVersion.ProtocolVersion;
  url: URL;
}>;

/**
 * Which proof server serves which protocol version.
 *
 * @remarks
 *   The two settings are alternatives, not a pair: `provingServers` is the version-keyed form, and `provingServerUrl` is
 *   the single-server form that reads as one server for every version. Giving both is not an error — the list wins —
 *   but naming neither is, because there is then nothing to prove with.
 */
export type DefaultProvingConfiguration = {
  /** One proof server for every protocol version. */
  provingServerUrl?: URL;
  /** Proof servers keyed by the protocol version each one starts serving, in ascending order. */
  provingServers?: readonly ProvingServerActivation[];
};

/** Raised when the proving configuration names no proof server, or names them out of order. */
export class ProvingConfigurationError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/proving/provingService/ProvingConfigurationError',
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Reads a proving configuration as the proof servers it names, keyed by protocol version.
 *
 * @param configuration The proving configuration.
 * @returns The proof server URLs by version range, or the reason the configuration names none.
 */
export const resolveProvingServers = (
  configuration: DefaultProvingConfiguration,
): Either.Either<ProtocolVersion.Registry<URL>, ProvingConfigurationError> => {
  const activations =
    configuration.provingServers !== undefined && configuration.provingServers.length > 0
      ? configuration.provingServers.map(({ sinceVersion, url }) => ({ sinceVersion, value: url }))
      : configuration.provingServerUrl !== undefined
        ? [{ sinceVersion: ProtocolVersion.MinSupportedVersion, value: configuration.provingServerUrl }]
        : [];

  return activations.length === 0
    ? Either.left(
        new ProvingConfigurationError({
          message:
            "Missing required configuration: set 'provingServers' (or 'provingServerUrl'), or provide a custom provingService in init parameters.",
        }),
      )
    : ProtocolVersion.makeRegistryFromActivations(activations).pipe(
        Either.mapLeft(
          (cause) =>
            new ProvingConfigurationError({
              message: 'Proof servers must be listed in strictly ascending order of the version each starts serving.',
              cause,
            }),
        ),
      );
};

/**
 * Builds the version-routed proving service a proving configuration describes.
 *
 * @param configuration The proving configuration.
 * @returns The routed proving service, or the reason the configuration names no proof server.
 */
export const makeDefaultVersionedProvingServiceEffect = (
  configuration: DefaultProvingConfiguration,
): Either.Either<VersionedProvingServiceEffect<UnboundTransaction>, ProvingConfigurationError> =>
  resolveProvingServers(configuration).pipe(
    Either.map((servers) =>
      makeVersionedProvingServiceEffect<UnboundTransaction, ledger.UnprovenTransaction>({
        entries: servers.entries.map((entry) => ({
          range: entry.range,
          value: makeServerProvingServiceEffect({ provingServerUrl: entry.value }),
        })),
      }),
    ),
  );

/**
 * Builds the version-routed proving service a proving configuration describes, on the promise-facing surface.
 *
 * @param configuration The proving configuration.
 * @returns The routed proving service, or the reason the configuration names no proof server.
 */
export const makeDefaultVersionedProvingService = (
  configuration: DefaultProvingConfiguration,
): Either.Either<VersionedProvingService<UnboundTransaction>, ProvingConfigurationError> =>
  makeDefaultVersionedProvingServiceEffect(configuration).pipe(Either.map(wrapVersionedEffectService));

/**
 * Registers the in-process WASM prover for the protocol versions it can actually prove.
 *
 * @remarks
 *   The bundled prover resolves its key material at a single, fixed ledger version, so there is no local proving for
 *   anything below the fork. Registering nothing there is what turns that into an {@link UnsupportedProvingVersionError}
 *   naming the version, rather than a proof built from the wrong keys.
 * @param sinceVersion The first protocol version the bundled prover's key material covers.
 * @param configuration Optional key material override.
 * @returns The proving backends, keyed by version.
 */
export const makeWasmProvingServices = (
  sinceVersion: ProtocolVersion.ProtocolVersion,
  configuration?: WasmProvingConfiguration,
): ProvingServices<UnboundTransaction> => ({
  entries: [
    {
      range: ProtocolVersion.makeRange(sinceVersion, ProtocolVersion.MaxSupportedVersion),
      value: makeWasmProvingServiceEffect(configuration),
    },
  ],
});

export const makeServerProvingServiceEffect = (
  configuration: ServerProvingConfiguration,
): ProvingServiceEffect<UnboundTransaction> => {
  return pipe(
    HttpProverClient.create({
      url: configuration.provingServerUrl,
    }),
    Effect.map((client) => client.asProvingProvider()),
    fromProvingProviderEffect,
  );
};

export const makeWasmProvingServiceEffect = (
  configuration?: WasmProvingConfiguration,
): ProvingServiceEffect<UnboundTransaction> => {
  return pipe(
    WasmProver.create({
      keyMaterialProvider: configuration?.keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
    }),
    Effect.map((prover) => prover.asProvingProvider()),
    fromProvingProviderEffect,
  );
};

export const makeSimulatorProvingServiceEffect = (): ProvingServiceEffect<ledger.ProofErasedTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<ledger.ProofErasedTransaction, ProvingError> {
      return Effect.succeed(transaction.eraseProofs());
    },
  };
};

export const makeDefaultProvingServiceEffect = (
  configuration: ServerProvingConfiguration,
): ProvingServiceEffect<UnboundTransaction> => makeServerProvingServiceEffect(configuration);

export const makeDefaultProvingService = (
  configuration: ServerProvingConfiguration,
): ProvingService<UnboundTransaction> => wrapEffectService(makeDefaultProvingServiceEffect(configuration));

export const makeServerProvingService = (
  configuration: ServerProvingConfiguration,
): ProvingService<UnboundTransaction> => wrapEffectService(makeServerProvingServiceEffect(configuration));

export const makeWasmProvingService = (configuration?: WasmProvingConfiguration): ProvingService<UnboundTransaction> =>
  wrapEffectService(makeWasmProvingServiceEffect(configuration));

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> =>
  wrapEffectService(makeSimulatorProvingServiceEffect());
