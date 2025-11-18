// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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
import { ProtocolState, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { Equal, Expect } from '@midnight-ntwrk/wallet-sdk-utilities/types';
import { Effect, Option, PubSub, Scope, Stream } from 'effect';
import * as rx from 'rxjs';
import { describe, expect, it } from 'vitest';
import { StateChange, Variant, VariantBuilder, WalletLike } from '../abstractions/index.js';
import { Runtime } from '../Runtime.js';
import { isRange, reduceToChunk, toProtocolStateArray } from '../testing/utils.js';
import {
  NumericRange,
  NumericRangeBuilder,
  NumericRangeMultiplier,
  NumericRangeMultiplierBuilder,
  RangeConfig,
} from '../testing/variants.js';
import { WalletBuilder } from '../WalletBuilder.js';

describe('Wallet Builder', () => {
  describe('without variants', () => {
    it('should not build a valid wallet', () => {
      //TODO: it should be possible to play with types to hide build method unless variant is registered
      expect(() => WalletBuilder.init().build()).toThrow();
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
    type _3 = Expect<Equal<typeof wallet.runtime, Runtime<[Variant.VersionedVariant<NumericRange>]>>>;
    type _4 = Expect<Equal<typeof wallet.rawState, rx.Observable<ProtocolState.ProtocolState<number>>>>;

    expect(wallet).toBeDefined();

    const state = wallet.rawState.pipe(rx.take(3)); // We expect two values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 1 },
    ]);
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
    type _2 = Expect<Equal<typeof wallet.runtime, Runtime<Variants>>>;
    type _3 = Expect<Equal<typeof wallet.rawState, rx.Observable<ProtocolState.ProtocolState<number>>>>;

    expect(wallet).toBeDefined();

    const state = wallet.rawState.pipe(rx.take(6)); // We expect five values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 0 },
      { version: ProtocolVersion.MinSupportedVersion, state: 1 },
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      { version: ProtocolVersion.ProtocolVersion(100n), state: 4 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 6 },
      { version: ProtocolVersion.ProtocolVersion(100n), state: 8 },
    ]);
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
