import { VariantBuilder, Variant, StateChange, VersionChangeType, WalletRuntimeError } from '../abstractions/index';
import { Effect, Stream, Option } from 'effect';

export type RangeConfig = {
  min: number;
  max: number;
};

export class NumericRange implements Variant.Variant<number, null> {
  #state: number = 0;

  constructor(
    protected configuration: RangeConfig,
    protected yieldCount: number,
    protected throwError: boolean,
  ) {}

  get currentState(): number {
    return this.#state;
  }

  start(
    _context: Variant.VariantContext<number>,
    state: number,
  ): Effect.Effect<Variant.RunningVariant<number, object>> {
    const max = this.configuration.max ?? 10;
    this.#state = state ?? this.configuration.min ?? 0;

    return Effect.succeed({
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
    });
  }

  migrateState(): Effect.Effect<number> {
    return Effect.succeed(0);
  }
}

export class NumericRangeBuilder implements VariantBuilder<number, null, RangeConfig> {
  constructor(
    private yieldCount: number = 10,
    private throwError: boolean = false,
  ) {}

  build(configuration: RangeConfig): NumericRange {
    return new NumericRange(configuration, this.yieldCount, this.throwError);
  }
}

export class NumericRangeMultiplier implements Variant.Variant<number, number> {
  #state: number = 0;

  constructor(protected configuration: RangeConfig & { multiplier: number }) {}

  get currentState(): number {
    return this.#state;
  }

  start(
    _context: Variant.VariantContext<number>,
    state: number,
  ): Effect.Effect<Variant.RunningVariant<number, object>> {
    const max = this.configuration.max ?? 10;
    this.#state = state ?? this.configuration.min ?? 0;

    return Effect.succeed({
      state: Stream.fromIterable(
        (function* (self: NumericRangeMultiplier) {
          for (let value = self.#state; value <= max; value++) {
            self.#state = value;
            yield StateChange.State({ state: value * self.configuration.multiplier });
          }
          return Option.none();
        })(this),
      ),
    });
  }

  migrateState(state: number): Effect.Effect<number> {
    return Effect.succeed(state + 1);
  }
}

export class NumericRangeMultiplierBuilder
  implements VariantBuilder<number, number, RangeConfig & { multiplier: number }>
{
  build(configuration: RangeConfig & { multiplier: number }): NumericRangeMultiplier {
    return new NumericRangeMultiplier(configuration);
  }
}
