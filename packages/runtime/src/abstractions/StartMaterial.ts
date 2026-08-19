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
import { type WalletSeed } from '@midnightntwrk/wallet-sdk-abstractions';
import { Data, Either, Option } from 'effect';

/**
 * How a variant produces the key material its own sync needs from a seed.
 *
 * @remarks
 *   The seed is the only key material that crosses a protocol boundary. Key _objects_ do not: they belong to one ledger
 *   version's runtime, and the variant on the other side of a fork cannot use them even though the public keys they
 *   yield are identical. So each variant is asked to derive its own, and the wallet layer never names a ledger.
 * @typeParam TStartAux The key material this variant's sync is started with.
 */
export type StartAuxCapability<TStartAux> = {
  /**
   * Derives this variant's start-auxiliary data from a seed.
   *
   * @param seed The seed the application started the wallet from.
   * @returns The key material this variant's sync service expects.
   */
  fromSeed(seed: WalletSeed.WalletSeed): TStartAux;
};

/**
 * What a wallet retains so it can start synchronization on whichever variant becomes current.
 *
 * @remarks
 *   A wallet that follows the chain across a protocol boundary starts sync more than once: the variant it began on, and
 *   then every variant a migration activates. Sync needs key material, which is deliberately absent from anything the
 *   wallet serializes, so the wallet holds on to whatever the application started it with — and what it holds decides
 *   whether it can answer for a variant it has not met yet.
 *
 *   `FromSeed` can: every variant derives its own. `ForVariants` can only answer for the variants it was given key
 *   objects for, which is why it is a map rather than a single value — a caller that insists on holding key objects has
 *   to hold one per protocol version, and a partial set is a miss rather than a wrong answer.
 * @typeParam TStartAux The key material a variant's sync is started with.
 */
export type StartMaterial<TStartAux> =
  | Readonly<{ _tag: 'FromSeed'; seed: WalletSeed.WalletSeed }>
  | Readonly<{ _tag: 'ForVariants'; byTag: ReadonlyMap<string | symbol, TStartAux> }>;

/**
 * Retains a seed, from which every variant derives its own key material.
 *
 * @param seed The seed the application started the wallet from.
 * @returns Start material that answers for any variant.
 */
export const fromSeed = <TStartAux>(seed: WalletSeed.WalletSeed): StartMaterial<TStartAux> => ({
  _tag: 'FromSeed',
  seed,
});

/**
 * Retains key objects supplied per variant.
 *
 * @param entries The key material, paired with the tag of the variant it belongs to.
 * @returns Start material that answers only for the variants named in `entries`.
 */
export const forVariants = <TStartAux>(
  entries: Iterable<readonly [string | symbol, TStartAux]>,
): StartMaterial<TStartAux> => ({
  _tag: 'ForVariants',
  byTag: new Map(entries),
});

/**
 * Retains key objects for a single variant.
 *
 * @param variantTag The tag of the variant the key material belongs to.
 * @param aux The key material.
 * @returns Start material that answers only for `variantTag`.
 */
export const forVariant = <TStartAux>(variantTag: string | symbol, aux: TStartAux): StartMaterial<TStartAux> =>
  forVariants([[variantTag, aux]]);

/**
 * Produces the key material a given variant should start its synchronization with.
 *
 * @param material What the wallet retained when the application started it.
 * @param variantTag The tag of the variant asking.
 * @param deriveFromSeed That variant's own derivation, consulted only for retained seeds.
 * @returns The key material, or `Option.none()` when the wallet holds nothing that variant can use.
 */
export const auxFor = <TStartAux>(
  material: StartMaterial<TStartAux>,
  variantTag: string | symbol,
  deriveFromSeed: (seed: WalletSeed.WalletSeed) => TStartAux,
): Option.Option<TStartAux> =>
  material._tag === 'FromSeed'
    ? Option.some(deriveFromSeed(material.seed))
    : Option.fromNullable(material.byTag.get(variantTag));

/**
 * Raised when a wallet holds no key material a given variant is able to use.
 *
 * @remarks
 *   Only reachable for a wallet started with key objects rather than a seed: the objects belong to one ledger version's
 *   runtime, so a variant on the other side of a protocol boundary has nothing to start with. Handing over what the
 *   wallet does have would be worse than failing — the keys would be silently wrong, and the wallet would sync itself
 *   into nonsense. Starting from a seed cannot reach this.
 */
export class MissingStartAuxError extends Data.TaggedError(
  '@midnightntwrk/wallet-sdk-runtime/abstractions/StartMaterial/MissingStartAuxError',
)<{
  readonly message: string;
  /** The variant that asked and could not be answered. */
  readonly variantTag: string | symbol;
}> {}

/**
 * Produces the key material a given variant should start its synchronization with, or says why it cannot.
 *
 * @param material What the wallet retained when the application started it.
 * @param variantTag The tag of the variant asking.
 * @param deriveFromSeed That variant's own derivation, consulted only for retained seeds.
 * @returns The key material, or a {@link MissingStartAuxError} naming the variant.
 */
export const requireAuxFor = <TStartAux>(
  material: StartMaterial<TStartAux>,
  variantTag: string | symbol,
  deriveFromSeed: (seed: WalletSeed.WalletSeed) => TStartAux,
): Either.Either<TStartAux, MissingStartAuxError> =>
  Either.fromOption(
    auxFor(material, variantTag, deriveFromSeed),
    () =>
      new MissingStartAuxError({
        message:
          `This wallet was started with key material for other variants only, and holds none the variant ` +
          `${String(variantTag)} can use. Start it from a seed so every variant can derive its own.`,
        variantTag,
      }),
  );

/**
 * Produces key material for a variant whose key type is not the one the wallet retains.
 *
 * @remarks
 *   A wallet's public API speaks one ledger version's key objects, but the variants either side of a protocol boundary do
 *   not agree on that type. Only a retained seed can serve the odd one out: key objects belong to one ledger version's
 *   runtime, so there is nothing to convert, and a wallet holding only those has nothing that variant can start with.
 * @param material What the wallet retained when the application started it.
 * @param variantTag The tag of the variant asking.
 * @param deriveFromSeed That variant's own derivation.
 * @returns The key material, or a {@link MissingStartAuxError} naming the variant.
 */
export const requireDerivedAuxFor = <TAux>(
  material: StartMaterial<unknown>,
  variantTag: string | symbol,
  deriveFromSeed: (seed: WalletSeed.WalletSeed) => TAux,
): Either.Either<TAux, MissingStartAuxError> =>
  Either.fromOption(
    Option.map(seedOf(material), deriveFromSeed),
    () =>
      new MissingStartAuxError({
        message:
          `This wallet was started with key material of another protocol version, which the variant ` +
          `${String(variantTag)} cannot use. Start it from a seed so every variant can derive its own.`,
        variantTag,
      }),
  );

/**
 * The seed a wallet retained, if it retained one rather than key objects.
 *
 * @param material What the wallet retained when the application started it.
 * @returns The seed, or `Option.none()` when the wallet holds key objects instead.
 */
export const seedOf = <TStartAux>(material: StartMaterial<TStartAux>): Option.Option<WalletSeed.WalletSeed> =>
  material._tag === 'FromSeed' ? Option.some(material.seed) : Option.none();
