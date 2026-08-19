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
import { ProtocolState, ProtocolVersion } from '@midnightntwrk/wallet-sdk-abstractions';
import { type Equal, type Expect } from '@midnightntwrk/wallet-sdk-utilities/types';
import { Effect, Option, PubSub, Scope, Stream } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  StateChange,
  Variant,
  type VariantBuilder,
  VersionChangeType,
  type WalletLike,
} from '../abstractions/index.js';
import type * as Runtime from '../Runtime.js';
import { type Runtime as RuntimeService } from '../Runtime.js';
import {
  isOrderedSubsequenceOf,
  isRange,
  protocolStateEquals,
  reduceToChunk,
  toProtocolStateArray,
} from '../testing/utils.js';
import {
  InterceptingVariantBuilder,
  Numeric,
  NumericMultiplier,
  type NumericRange,
  NumericRangeBuilder,
  type NumericRangeMultiplier,
  NumericRangeMultiplierBuilder,
  type RangeConfig,
} from '../testing/variants.js';
import { WalletBuilder } from '../WalletBuilder.js';

describe('Wallet Builder', () => {
  describe('without variants', () => {
    it('should not build a valid wallet', () => {
      //TODO: it should be possible to play with types to hide build method unless variant is registered
      expect(() => WalletBuilder.init().build()).toThrow();
    });
  });

  describe('resolving a variant by protocol version', () => {
    const Wallet = WalletBuilder.init()
      .withVariant(ProtocolVersion.ProtocolVersion(10n), new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
      .build({ min: 0, max: 4, multiplier: 2 });

    it('resolves the variant registered for a version', () => {
      const [preFork, postFork] = Wallet.allVariants();

      expect(Wallet.variantFor(ProtocolVersion.ProtocolVersion(10n))).toStrictEqual(Option.some(preFork));
      expect(Wallet.variantFor(ProtocolVersion.ProtocolVersion(99n))).toStrictEqual(Option.some(preFork));
      expect(Wallet.variantFor(ProtocolVersion.ProtocolVersion(100n))).toStrictEqual(Option.some(postFork));
      expect(Wallet.variantFor(ProtocolVersion.ProtocolVersion(4_000n))).toStrictEqual(Option.some(postFork));
    });

    it('reports a miss rather than throwing for a version nothing is registered for', () => {
      expect(Wallet.variantFor(ProtocolVersion.ProtocolVersion(9n))).toStrictEqual(Option.none());
      expect(Wallet.variantFor(ProtocolVersion.MinSupportedVersion)).toStrictEqual(Option.none());
    });

    it('resolves to a variant whose tag addresses the variant record', () => {
      const resolved = Wallet.variantFor(ProtocolVersion.ProtocolVersion(100n)).pipe(Option.getOrThrow);

      expect(Wallet.allVariantsRecord()[Variant.getVersionedVariantTag(resolved)]).toBe(resolved);
    });

    it('infers the union of the registered variants', () => {
      const _resolved = Wallet.variantFor(ProtocolVersion.ProtocolVersion(100n));

      type _1 = Expect<
        Equal<
          typeof _resolved,
          Option.Option<Variant.VersionedVariant<NumericRange> | Variant.VersionedVariant<NumericRangeMultiplier>>
        >
      >;
    });
  });

  describe('registering a variant with its own configuration', () => {
    it('builds the variant from that configuration and asks for none at build time', async () => {
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(), { min: 0, max: 2 })
        .build();
      const wallet = Wallet.startEmpty(Wallet);

      const receivedStates = await toProtocolStateArray(
        wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 2, true)),
      );

      expect(receivedStates.at(-1)).toEqual({
        version: ProtocolVersion.MinSupportedVersion,
        variantTag: Numeric,
        state: 2,
      });
    });

    it('keeps each variant on its own configuration when both carry one', async () => {
      // The two configurations name the same keys with values only one variant can use — the shape
      // a fork wallet has, where each side is configured for its own ledger. Merging them would put
      // `multiplier: 5` out of reach of the variant that needs it.
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2), { min: 0, max: 4 })
        .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder(), {
          min: 0,
          max: 2,
          multiplier: 5,
        })
        .build();
      const wallet = Wallet.startEmpty(Wallet);

      const receivedStates = await toProtocolStateArray(
        wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 10, true)),
      );

      expect(receivedStates.at(-1)).toEqual({
        version: ProtocolVersion.ProtocolVersion(100n),
        variantTag: NumericMultiplier,
        state: 10,
      });
    });

    it('still takes the configuration of the variants that carry none', async () => {
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
        .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder(), {
          min: 0,
          max: 2,
          multiplier: 5,
        })
        .build({ min: 0, max: 4 });
      const wallet = Wallet.startEmpty(Wallet);

      const receivedStates = await toProtocolStateArray(
        wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 10, true)),
      );

      expect(receivedStates.at(-1)).toEqual({
        version: ProtocolVersion.ProtocolVersion(100n),
        variantTag: NumericMultiplier,
        state: 10,
      });
    });

    it('reports the configuration it was built with, without the self-configured variants', () => {
      const Wallet = WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
        .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder(), {
          min: 0,
          max: 2,
          multiplier: 5,
        })
        .build({ min: 0, max: 4 });

      expect(Wallet.configuration).toEqual({ min: 0, max: 4 });
      type _1 = Expect<Equal<typeof Wallet.configuration, Readonly<RangeConfig>>>;
    });

    it('rejects a variant registered out of protocol version order, configuration or not', () => {
      const builder = WalletBuilder.init().withVariant(
        ProtocolVersion.ProtocolVersion(50n),
        new NumericRangeBuilder(),
        {
          min: 0,
          max: 1,
        },
      );

      expect(() =>
        builder.withVariant(ProtocolVersion.ProtocolVersion(10n), new NumericRangeMultiplierBuilder(), {
          min: 0,
          max: 1,
          multiplier: 2,
        }),
      ).toThrow('ProtocolMismatch: sinceVersion is prior to previously registered version');
    });
  });

  describe('starting at a variant resolved from a protocol version', () => {
    // The two variants deliberately keep different state types: a tag alone cannot say which of them a
    // state belongs to once the version is runtime data, which is exactly what this entry point is for.
    const walletOverTwoStateTypes = () =>
      WalletBuilder.init()
        .withVariant(ProtocolVersion.MinSupportedVersion, new InterceptingVariantBuilder<'pre', string>('pre'))
        .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeBuilder(10))
        .build({ min: 0, max: 2 });

    it('starts on the resolved variant, at the version that variant was registered from', async () => {
      const Wallet = walletOverTwoStateTypes();
      const resolved = Wallet.variantFor(ProtocolVersion.ProtocolVersion(120n)).pipe(Option.getOrThrow);

      const wallet = Wallet.startAtVariant(Wallet, resolved, 0);

      expect(await rx.firstValueFrom(wallet.rawState)).toEqual({
        version: ProtocolVersion.ProtocolVersion(100n),
        variantTag: Numeric,
        state: 0,
      });
      await wallet.stop();
    });

    it('starts on the head variant when that is the one resolved, taking its own state type', async () => {
      const Wallet = walletOverTwoStateTypes();
      const resolved = Wallet.variantFor(ProtocolVersion.MinSupportedVersion).pipe(Option.getOrThrow);

      const wallet = Wallet.startAtVariant(Wallet, resolved, 'restored');

      expect(await rx.firstValueFrom(wallet.rawState)).toEqual({
        version: ProtocolVersion.MinSupportedVersion,
        variantTag: 'pre',
        state: 'restored',
      });
      await wallet.stop();
    });

    it('narrows an emission s state to the variant its tag names', async () => {
      const Wallet = walletOverTwoStateTypes();
      const resolved = Wallet.variantFor(ProtocolVersion.MinSupportedVersion).pipe(Option.getOrThrow);
      const wallet = Wallet.startAtVariant(Wallet, resolved, 'restored');

      const emission = await rx.firstValueFrom(wallet.rawState);

      // Only compiles if `variantTag` discriminates `state`: a string operation on one side of the
      // branch, arithmetic on the other. That is the zero-cast capability selection the tag exists for.
      const described = emission.variantTag === 'pre' ? emission.state.toUpperCase() : emission.state + 1;

      expect(described).toBe('RESTORED');
      await wallet.stop();
    });

    it('takes the union of the registered variants states, so a resolved variant is callable at all', () => {
      const Wallet = walletOverTwoStateTypes();
      const _resolved = Wallet.variantFor(ProtocolVersion.MinSupportedVersion).pipe(Option.getOrThrow);

      type _1 = Expect<
        Equal<Parameters<typeof Wallet.startAtVariant<typeof Wallet, typeof _resolved>>[2], string | number>
      >;

      expect(Option.isSome(Wallet.variantFor(ProtocolVersion.MinSupportedVersion))).toBe(true);
    });
  });

  describe('protocol version ordering', () => {
    it('should reject adding a variant with the same protocol version as the previous one', () => {
      const version = ProtocolVersion.ProtocolVersion(10n);
      const builder = WalletBuilder.init().withVariant(version, new NumericRangeBuilder());

      expect(() => builder.withVariant(version, new NumericRangeMultiplierBuilder())).toThrow(
        'ProtocolMismatch: sinceVersion is prior to previously registered version',
      );
    });

    it('should reject adding a variant with a lower protocol version than the previous one', () => {
      const builder = WalletBuilder.init().withVariant(ProtocolVersion.ProtocolVersion(50n), new NumericRangeBuilder());

      expect(() =>
        builder.withVariant(ProtocolVersion.ProtocolVersion(10n), new NumericRangeMultiplierBuilder()),
      ).toThrow('ProtocolMismatch: sinceVersion is prior to previously registered version');
    });
  });

  it('should support single variant implementations', async () => {
    const builder = WalletBuilder.init().withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder());
    const Wallet = builder.build({
      min: 0,
      max: 1,
    });
    const wallet = Wallet.startEmpty(Wallet);

    type _1 = Expect<
      Equal<typeof Wallet, WalletLike.BaseWalletClass<[Variant.VersionedVariant<NumericRange>], RangeConfig>>
    >;
    type _2 = Expect<Equal<typeof wallet, WalletLike.WalletLike<[Variant.VersionedVariant<NumericRange>]>>>;
    type _3 = Expect<Equal<typeof wallet.runtime, RuntimeService<[Variant.VersionedVariant<NumericRange>]>>>;
    type _4 = Expect<Equal<typeof wallet.rawState, rx.Observable<ProtocolState.ProtocolState<number, typeof Numeric>>>>;

    expect(wallet).toBeDefined();

    // Latest-value semantics: intermediate states may be skipped, but order is preserved and the
    // stream converges on the terminal state.
    const fullStateSequence = [
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 1 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 1, true)),
    );

    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.MinSupportedVersion,
      variantTag: Numeric,
      state: 1,
    });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('should support multiple variant implementations through state migration', async () => {
    const builder = WalletBuilder.init()
      // Have the first variant complete after producing two values, signifying a protocol change.
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());

    const Wallet = builder.build({
      min: 0,
      max: 4,
      multiplier: 2,
    });
    const wallet = Wallet.startEmpty(Wallet);

    type Variants = [Variant.VersionedVariant<NumericRange>, Variant.VersionedVariant<NumericRangeMultiplier>];
    type _1 = Expect<Equal<typeof wallet, WalletLike.WalletLike<Variants>>>;
    type _2 = Expect<Equal<typeof wallet.runtime, RuntimeService<Variants>>>;
    type _3 = Expect<
      Equal<
        typeof wallet.rawState,
        rx.Observable<
          | ProtocolState.ProtocolState<number, typeof Numeric>
          | ProtocolState.ProtocolState<number, typeof NumericMultiplier>
        >
      >
    >;

    expect(wallet).toBeDefined();

    // Latest-value semantics: intermediate states may be skipped, but order is preserved and the
    // stream converges on the terminal state.
    const fullStateSequence = [
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 1 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 4 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 6 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 8 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 8, true)),
    );

    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 8,
    });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('stamps every state emission with the tag of the variant that produced it', async () => {
    const Wallet = WalletBuilder.init()
      // Have the first variant complete after producing two values, signifying a protocol change.
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
      .build({ min: 0, max: 4, multiplier: 2 });
    const wallet = Wallet.startEmpty(Wallet);

    type Variants = [Variant.VersionedVariant<NumericRange>, Variant.VersionedVariant<NumericRangeMultiplier>];
    type _1 = Expect<Equal<typeof wallet.rawState, rx.Observable<Runtime.RuntimeState<Variants>>>>;

    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 8, true)),
    );

    // The tag travels with the emission, so a reader can pick the right capabilities for a state
    // without inferring the producing variant from the version.
    expect(receivedStates.filter(({ version }) => version === ProtocolVersion.MinSupportedVersion)).toSatisfy(
      (preFork: typeof receivedStates) =>
        preFork.length > 0 && preFork.every(({ variantTag }) => variantTag === Numeric),
    );
    expect(receivedStates.filter(({ version }) => version === ProtocolVersion.ProtocolVersion(100n))).toSatisfy(
      (postFork: typeof receivedStates) =>
        postFork.length > 0 && postFork.every(({ variantTag }) => variantTag === NumericMultiplier),
    );
    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 8,
    });
  });

  it('should support three sequential variant migrations', async () => {
    const V2Tag = 'V2' as const;

    // A middle variant that emits two state changes then automatically triggers migration via Next()
    const v2Builder: VariantBuilder.VariantBuilder<
      Variant.Variant<typeof V2Tag, number, number, Variant.RunningVariant<typeof V2Tag, number>>
    > = {
      build: () => ({
        __polyTag__: V2Tag,
        start(context) {
          return context.stateRef.get.pipe(
            Effect.map((state) => ({
              __polyTag__: V2Tag,
              state: Stream.fromIterable(
                (function* () {
                  yield StateChange.State({ state });
                  yield StateChange.State({ state: state + 1 });
                  yield StateChange.VersionChange({ change: VersionChangeType.Next() });
                })(),
              ),
            })),
          );
        },
        migrateState(previousState: number) {
          return Effect.succeed(previousState + 1);
        },
      }),
    };

    const builder = WalletBuilder.init()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(50n), v2Builder)
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder());

    const Wallet = builder.build({
      min: 0,
      max: 6,
      multiplier: 2,
    });
    const wallet = Wallet.startEmpty(Wallet);

    // V1 (NumericRange): migrateState(null) → 0, emits State(0), State(1), then Next()
    // V2 (inline):       migrateState(1) → 2,    emits State(2), State(3), then Next()
    // V3 (Multiplier):   migrateState(3) → 4,    emits State(4*2=8), State(5*2=10), State(6*2=12)
    //
    // Latest-value semantics: intermediate states may be skipped, but order is preserved and the
    // stream converges on the terminal state.
    const fullStateSequence = [
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, variantTag: Numeric, state: 1 },
      { version: ProtocolVersion.ProtocolVersion(50n), variantTag: V2Tag, state: 2 },
      { version: ProtocolVersion.ProtocolVersion(50n), variantTag: V2Tag, state: 3 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 8 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 10 },
      { version: ProtocolVersion.ProtocolVersion(100n), variantTag: NumericMultiplier, state: 12 },
    ];
    const receivedStates = await toProtocolStateArray(
      wallet.rawState.pipe(rx.takeWhile(({ state }) => state !== 12, true)),
    );

    expect(receivedStates.at(-1)).toEqual({
      version: ProtocolVersion.ProtocolVersion(100n),
      variantTag: NumericMultiplier,
      state: 12,
    });
    expect(receivedStates).toSatisfy((received: typeof receivedStates) =>
      isOrderedSubsequenceOf(received, fullStateSequence, protocolStateEquals),
    );
  });

  it('should stop variant once stop is called', async () => {
    const pubsub = Effect.runSync(PubSub.bounded<number>({ capacity: 1, replay: 1 }));

    const pubSubVariantBuilder: VariantBuilder.VariantBuilder<
      Variant.Variant<'pubsub', number, null, Variant.RunningVariant<'pubsub', number>>
    > = {
      build: () => {
        return {
          __polyTag__: 'pubsub',
          start(context) {
            return Stream.fromEffect(context.stateRef.get).pipe(
              Stream.flatMap((state) => {
                return Stream.unfold(state, (previous: number) => {
                  const next = previous + 1;
                  return Option.some([next, next] as const);
                });
              }),
              Stream.mapEffect((value) => PubSub.publish(pubsub, value).pipe(Effect.delay(1))),
              Stream.takeUntilEffect(() => PubSub.isShutdown(pubsub)),
              Stream.runDrain,
              Effect.forkScoped,
              Effect.flatMap(() => Scope.Scope),
              Effect.map((scope) => ({
                __polyTag__: 'pubsub',
                state: Stream.acquireRelease(Effect.succeed(pubsub), () => PubSub.shutdown(pubsub)).pipe(
                  Stream.mapEffect(PubSub.subscribe),
                  Stream.flatMap(Stream.fromQueue),
                  Stream.map((number) => StateChange.State({ state: number })),
                  Stream.provideService(Scope.Scope, scope),
                ),
              })),
            );
          },
          migrateState() {
            return Effect.succeed(0);
          },
        };
      },
    };

    const Wallet = WalletBuilder.init().withVariant(ProtocolVersion.MinSupportedVersion, pubSubVariantBuilder).build();
    const wallet = Wallet.startEmpty(Wallet);

    const stopSubject = new rx.Subject<boolean>();

    const valuesP = rx.firstValueFrom(
      wallet.rawState.pipe(rx.map(ProtocolState.state), rx.takeUntil(stopSubject), rx.takeLast(5), reduceToChunk()),
    );

    await wallet.stop();
    stopSubject.next(true);

    const values = await valuesP;

    const isShutDown = await PubSub.awaitShutdown(pubsub).pipe(
      Effect.timeoutTo({
        duration: 1_000,
        onTimeout: () => PubSub.shutdown(pubsub).pipe(Effect.as(false)),
        onSuccess: () => Effect.succeed(true),
      }),
      Effect.flatten,
      Effect.runPromise,
    );

    expect(isRange(values)).toBe(true);
    expect(isShutDown).toBe(true);
  });

  const staticConfigCases = [
    () => {
      const config = {
        min: 0,
        max: 1,
      };
      return {
        config: config,
        Wallet: WalletBuilder.init()
          .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder())
          .build(config),
      };
    },
    () => {
      const config = {
        min: 0,
        max: 4,
        multiplier: 2,
      };
      return {
        config: config,
        Wallet: WalletBuilder.init()
          .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
          .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
          .build(config),
      };
    },
  ] as const;

  it.each(staticConfigCases)('should make config available statically', (factory) => {
    const { Wallet, config } = factory();
    expect(Wallet.configuration).toEqual(config);
  });
});
