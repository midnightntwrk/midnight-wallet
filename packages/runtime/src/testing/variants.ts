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
import { StateChange, Variant, VariantBuilder, VersionChangeType, WalletRuntimeError } from '../abstractions/index.js';
import { Effect, Option, PubSub, Scope, Stream } from 'effect';

export type RangeConfig = {
  min: number;
  max: number;
};

export const Numeric = 'NumericRange' as const;
export class NumericRange
  implements Variant.Variant<typeof Numeric, number, null, Variant.RunningVariant<typeof Numeric, number>>
{
  __polyTag__: typeof Numeric = Numeric;
  #state: number = 0;

  protected configuration: RangeConfig;
  protected yieldCount: number;
  protected throwError: boolean;

  constructor(configuration: RangeConfig, yieldCount: number, throwError: boolean) {
    this.throwError = throwError;
    this.yieldCount = yieldCount;
    this.configuration = configuration;
  }

  get currentState(): number {
    return this.#state;
  }

  start(context: Variant.VariantContext<number>): Effect.Effect<Variant.RunningVariant<typeof Numeric, number>> {
    const max = this.configuration.max ?? 10;

    return context.stateRef.get.pipe(
      Effect.flatMap((state) => {
        return Effect.sync(() => {
          this.#state = state;
        });
      }),
      Effect.map(() => ({
        __polyTag__: Numeric,
        state: Stream.fromAsyncIterable<StateChange.StateChange<number>, WalletRuntimeError>(
          // eslint-disable-next-line @typescript-eslint/require-await
          (async function* (self: NumericRange) {
            for (let value = self.#state; value <= max; value++) {
              self.#state = value;
              yield StateChange.State({ state: value });

              if (--self.yieldCount === 0) {
                if (self.throwError) {
                  throw new Error('NumericRange: forced break');
                }

                yield StateChange.VersionChange({ change: VersionChangeType.Next() });
              }
            }
          })(this),
          (e) => new WalletRuntimeError({ message: 'NumericRange error', cause: e }),
        ),
      })),
    );
  }

  migrateState(): Effect.Effect<number> {
    return Effect.succeed(0);
  }
}

export class NumericRangeBuilder implements VariantBuilder.VariantBuilder<NumericRange, RangeConfig> {
  private readonly yieldCount: number;
  private readonly throwError: boolean;

  constructor(yieldCount: number = 10, throwError: boolean = false) {
    this.throwError = throwError;
    this.yieldCount = yieldCount;
  }

  build(configuration: RangeConfig): NumericRange {
    return new NumericRange(configuration, this.yieldCount, this.throwError);
  }
}

export type RangeMultiplierConfig = RangeConfig & { multiplier: number };
export const NumericMultiplier = 'NumericMultiplier';
export class NumericRangeMultiplier
  implements
    Variant.Variant<typeof NumericMultiplier, number, number, Variant.RunningVariant<typeof NumericMultiplier, number>>
{
  __polyTag__: typeof NumericMultiplier = NumericMultiplier;
  #state: number = 0;

  protected configuration: RangeMultiplierConfig;

  constructor(configuration: RangeMultiplierConfig) {
    this.configuration = configuration;
  }

  get currentState(): number {
    return this.#state;
  }

  start(
    context: Variant.VariantContext<number>,
  ): Effect.Effect<Variant.RunningVariant<typeof NumericMultiplier, number>> {
    return context.stateRef.get.pipe(
      Effect.flatMap((state) => {
        return Effect.sync(() => {
          this.#state = state;
        });
      }),
      Effect.map(() => {
        const max = this.configuration.max ?? 10;

        return {
          __polyTag__: NumericMultiplier,
          state: Stream.fromIterable(
            (function* (self: NumericRangeMultiplier) {
              for (let value = self.#state; value <= max; value++) {
                self.#state = value;
                yield StateChange.State({ state: value * self.configuration.multiplier });
              }
              return Option.none();
            })(this),
          ),
        };
      }),
    );
  }

  migrateState(state: number): Effect.Effect<number> {
    return Effect.succeed(state + 1);
  }
}

export class NumericRangeMultiplierBuilder
  implements VariantBuilder.VariantBuilder<NumericRangeMultiplier, RangeMultiplierConfig>
{
  build(configuration: RangeMultiplierConfig): NumericRangeMultiplier {
    return new NumericRangeMultiplier(configuration);
  }
}

export type InterceptingRunningVariant<TTag extends string | symbol, TState> = Variant.RunningVariant<TTag, TState> & {
  emitProtocolVersionChange: (change: VersionChangeType.VersionChangeType) => Effect.Effect<void>;
};
export class InterceptingVariant<TTag extends string | symbol, TState>
  implements Variant.Variant<TTag, TState, TState, InterceptingRunningVariant<TTag, TState>>
{
  __polyTag__: TTag;
  constructor(tag: TTag) {
    this.__polyTag__ = tag;
  }

  migrateState(previousState: TState): Effect.Effect<TState> {
    return Effect.succeed(previousState);
  }
  start(
    context: Variant.VariantContext<TState>,
  ): Effect.Effect<InterceptingRunningVariant<TTag, TState>, WalletRuntimeError, Scope.Scope> {
    const tag = this.__polyTag__;
    return Effect.gen(this, function* () {
      const pubsub = yield* PubSub.bounded<StateChange.StateChange<TState>>({
        capacity: 1,
        replay: 1,
      });
      const state = yield* context.stateRef.get;
      yield* PubSub.publish(pubsub, StateChange.State({ state }));
      return {
        __polyTag__: tag,
        state: Stream.fromPubSub(pubsub, {
          shutdown: true,
        }),
        emitProtocolVersionChange: (change: VersionChangeType.VersionChangeType) => {
          return PubSub.publish(pubsub, StateChange.VersionChange({ change }));
        },
      };
    });
  }
}

/**
 * Builder of an intercepting variant
 * It allows removing the possibility of race conditions by requiring an explicit gesture to migrate to a next/specific protocol version
 */
export class InterceptingVariantBuilder<TTag extends string | symbol, TState>
  implements VariantBuilder.VariantBuilder<InterceptingVariant<TTag, TState>, object>
{
  tag: TTag;
  constructor(tag: TTag) {
    this.tag = tag;
  }
  build(): InterceptingVariant<TTag, TState> {
    return new InterceptingVariant(this.tag);
  }
}
