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
 * Raised when a proving backend is handed a transaction from the other side of a protocol boundary.
 *
 * @remarks
 *   Every backend is written against exactly one ledger version, and the two ledger versions' transactions are different
 *   classes that neither can read. The router has already chosen a backend by the version stamped on the transaction,
 *   so reaching this error means the stamp and the bytes disagreed — which is worth saying out loud, and in terms of
 *   the epoch the backend serves, rather than letting a foreign object reach the wasm-bindgen boundary and fail there
 *   as something unreadable.
 */
export class ProvingEpochMismatchError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/proving/provingService/ProvingEpochMismatchError',
)<{
  readonly message: string;
  /** The range of protocol versions the backend that refused the transaction serves. */
  readonly epoch: ProtocolVersion.ProtocolVersion.Range;
}> {}

/** Everything a proving backend can fail with. */
export type ProvingFailure = ProvingError | ProvingEpochMismatchError;

/**
 * Turns an unproven transaction into a proven one.
 *
 * @typeParam TProven The proven transaction this backend produces.
 * @typeParam TUnproven The unproven transaction it accepts. Defaults to ledger-v9's, because a proving backend is only
 *   ever written against one ledger version — which is exactly why choosing between backends is
 *   {@link VersionedProvingServiceEffect}'s job and not this interface's.
 */
export interface ProvingServiceEffect<TProven, TUnproven = ledger.UnprovenTransaction> {
  prove(transaction: TUnproven): Effect.Effect<TProven, ProvingFailure>;
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
  ): Effect.Effect<TProven, ProvingFailure | UnsupportedProvingVersionError>;
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

export type V9UnboundTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

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

export const fromV9ProvingProviderEffect = (
  provider: Effect.Effect<ledger.ProvingProvider, InvalidProtocolSchemeError>,
): ProvingServiceEffect<V9UnboundTransaction> => {
  return {
    prove(transaction: ledger.UnprovenTransaction): Effect.Effect<V9UnboundTransaction, ProvingFailure> {
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

export const fromV9ProvingProvider = (provider: ledger.ProvingProvider): ProvingServiceEffect<V9UnboundTransaction> => {
  return fromV9ProvingProviderEffect(Effect.succeed(provider));
};

export type ServerProvingConfiguration = {
  provingServerUrl: URL;
};

export type WasmProvingConfiguration = {
  keyMaterialProvider?: KeyMaterialProvider;
};

/**
 * Where proving happens: at a proof server over HTTP, or in this process.
 *
 * @remarks
 *   Deliberately says nothing about a ledger version. Which ledger drives a backend follows from the key it is registered
 *   under in {@link ProvingBackends}, so the same description can be named for either side of a fork and mean the right
 *   thing both times.
 */
export type ProvingBackend =
  Readonly<{ kind: 'server'; url: URL }> | Readonly<{ kind: 'wasm'; keyMaterialProvider?: KeyMaterialProvider }>;

/**
 * Which proving backend proves the transactions each ledger version authors.
 *
 * @remarks
 *   Keyed the way {@link ProtocolVersion.ForkSchedule} is, so a configuration states each boundary once: `v8` proves below
 *   `forks.v9` and `v9` from it, and where one ends and the next begins is read off the schedule rather than restated
 *   here. The newest ledger version's backend is required, because it is what every new transaction is proved with; an
 *   older one may be left out on a chain whose history below the boundary the wallet will never author for, and a
 *   transaction stamped there then fails with {@link UnsupportedProvingVersionError}. The next hard fork adds a key
 *   (`v10`) rather than changing this shape.
 */
export type ProvingBackends = Readonly<{
  /** Proves the transactions ledger-v8 authored, below `forks.v9`. */
  v8?: ProvingBackend;
  /** Proves the transactions ledger-v9 authored, from `forks.v9`. */
  v9: ProvingBackend;
}>;

/**
 * Which proving backend serves which ledger version.
 *
 * @remarks
 *   The two settings are alternatives, not a set: `provers` is the general form and `provingServerUrl` the shorthand for
 *   "this one proof server, for every ledger version". Giving both is not an error — `provers` wins — but naming
 *   neither is, because there is then nothing to prove with.
 *
 *   The single URL is registered once per ledger version and driven by each in turn, which is what makes it frame its
 *   requests correctly on both sides of a fork. Whether a given proof server can in fact serve both is an operational
 *   fact about that server, not something the SDK can know or enforce — today's images serve one side each, so a chain
 *   that spans a fork wants `provers` with a server per side.
 */
export type DefaultProvingConfiguration = {
  /** One proof server for every ledger version. */
  provingServerUrl?: URL;
  /** A proving backend per ledger version. */
  provers?: ProvingBackends;
};

/** Raised when the proving configuration names no backend at all. */
export class ProvingConfigurationError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-capabilities/proving/provingService/ProvingConfigurationError',
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const noBackendNamed = () =>
  new ProvingConfigurationError({
    message:
      "Missing required configuration: set 'provers' (or 'provingServerUrl'), or provide a custom provingService in init parameters.",
  });

/**
 * Reads a proving configuration as the backend it names for each ledger version.
 *
 * @remarks
 *   Where the precedence between the two settings is decided, once, so that reading a configuration and building services
 *   from it cannot disagree about which one was meant. Says nothing about protocol versions: which range each backend
 *   serves is the fork schedule's to say, and `makeDefaultProvingServices` reads it there.
 * @param configuration The proving configuration.
 * @returns The backend per ledger version, or the reason the configuration names none.
 */
export const resolveProvingBackends = (
  configuration: DefaultProvingConfiguration,
): Either.Either<ProvingBackends, ProvingConfigurationError> =>
  configuration.provers !== undefined
    ? Either.right(configuration.provers)
    : configuration.provingServerUrl !== undefined
      ? Either.right({
          v8: { kind: 'server', url: configuration.provingServerUrl },
          v9: { kind: 'server', url: configuration.provingServerUrl },
        })
      : Either.left(noBackendNamed());

/**
 * Registers the in-process WASM prover, driven by ledger-v9, from a given protocol version upwards.
 *
 * @remarks
 *   Every entry here is ledger-v9's backend, so `sinceVersion` should not be below a protocol boundary: what a version
 *   below it needs is the ledger-v8 driver, which `makeDefaultProvingServices` registers for the epoch the fork
 *   schedule it is given places below `forks.v9`. Registering nothing below is what turns that into an
 *   {@link UnsupportedProvingVersionError} naming the version, rather than a ledger-v8 transaction handed to a ledger
 *   that cannot read it.
 * @param sinceVersion The first protocol version to register the bundled prover for.
 * @param configuration Optional key material override.
 * @returns The proving backends, keyed by version.
 */
export const makeWasmProvingServices = (
  sinceVersion: ProtocolVersion.ProtocolVersion,
  configuration?: WasmProvingConfiguration,
): ProvingServices<V9UnboundTransaction> => ({
  entries: [
    {
      range: ProtocolVersion.makeRange(sinceVersion, ProtocolVersion.MaxSupportedVersion),
      value: makeV9WasmProvingServiceEffect(configuration),
    },
  ],
});

export const makeV9ServerProvingServiceEffect = (
  configuration: ServerProvingConfiguration,
): ProvingServiceEffect<V9UnboundTransaction> => {
  return pipe(
    HttpProverClient.create({
      url: configuration.provingServerUrl,
    }),
    Effect.map((client) => client.asProvingProvider()),
    fromV9ProvingProviderEffect,
  );
};

export const makeV9WasmProvingServiceEffect = (
  configuration?: WasmProvingConfiguration,
): ProvingServiceEffect<V9UnboundTransaction> => {
  return pipe(
    WasmProver.create({
      keyMaterialProvider: configuration?.keyMaterialProvider ?? WasmProver.makeDefaultKeyMaterialProvider(),
    }),
    Effect.map((prover) => prover.asProvingProvider()),
    fromV9ProvingProviderEffect,
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
): ProvingServiceEffect<V9UnboundTransaction> => makeV9ServerProvingServiceEffect(configuration);

export const makeDefaultProvingService = (
  configuration: ServerProvingConfiguration,
): ProvingService<V9UnboundTransaction> => wrapEffectService(makeDefaultProvingServiceEffect(configuration));

export const makeV9ServerProvingService = (
  configuration: ServerProvingConfiguration,
): ProvingService<V9UnboundTransaction> => wrapEffectService(makeV9ServerProvingServiceEffect(configuration));

export const makeV9WasmProvingService = (
  configuration?: WasmProvingConfiguration,
): ProvingService<V9UnboundTransaction> => wrapEffectService(makeV9WasmProvingServiceEffect(configuration));

export const makeSimulatorProvingService = (): ProvingService<ledger.ProofErasedTransaction> =>
  wrapEffectService(makeSimulatorProvingServiceEffect());
