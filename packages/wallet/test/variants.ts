import { VariantBuilder, Variant, StateChange, VersionChangeType } from '@midnight-ntwrk/wallet-ts/abstractions';
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

  start(state: number): Stream.Stream<StateChange.StateChange<number>> {
    const max = this.configuration.max ?? 10;
    this.#state = state ?? this.configuration.min ?? 0;

    return Stream.fromAsyncIterable(
      // eslint-disable-next-line @typescript-eslint/require-await
      (async function* (self: NumericRange) {
        for (let value = self.#state; value <= max; value++) {
          self.#state = value;
          yield StateChange.State({ state: value });

          if (--self.yieldCount === 0) {
            if (self.throwError) throw new Error('NumericRange: forced break');

            yield StateChange.VersionChange({ change: VersionChangeType.Next() });
          }
        }
      })(this),
      (e) => e,
    ) as Stream.Stream<StateChange.StateChange<number>>;
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

  start(state: number): Stream.Stream<StateChange.StateChange<number>> {
    const max = this.configuration.max ?? 10;
    this.#state = state ?? this.configuration.min ?? 0;

    return Stream.fromIterable(
      (function* (self: NumericRangeMultiplier) {
        for (let value = self.#state; value <= max; value++) {
          self.#state = value;
          yield StateChange.State({ state: value * self.configuration.multiplier });
        }
        return Option.none();
      })(this),
    );
  }

  migrateState(state: number): Effect.Effect<number> {
    return Effect.succeed(state + 1);
  }
}

// eslint-disable-next-line prettier/prettier
export class NumericRangeMultiplierBuilder implements VariantBuilder<number, number, RangeConfig & { multiplier: number }> {
  build(configuration: RangeConfig & { multiplier: number }): NumericRangeMultiplier {
    return new NumericRangeMultiplier(configuration);
  }
}
