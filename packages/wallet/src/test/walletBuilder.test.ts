import { expect } from '@jest/globals';
import { Effect, Option, PubSub, Scope, Stream } from 'effect';
import * as rx from 'rxjs';
import { ProtocolState, ProtocolVersion, StateChange, VariantBuilder } from '../abstractions/index';
import { WalletBuilderTs } from '../index';
import { isRange, reduceToChunk, toProtocolStateArray } from './testUtils';
import { NumericRangeBuilder, NumericRangeMultiplierBuilder } from './variants';

describe('Wallet Builder', () => {
  it('should support single variant implementations', async () => {
    const builder = new WalletBuilderTs()
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder())
      .withConfiguration({
        min: 0,
        max: 1,
      });
    const wallet = builder.build();

    expect(wallet).toBeDefined();

    const state = wallet.state.pipe(rx.take(2)); // We expect two values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      [ProtocolVersion.MinSupportedVersion, 0],
      [ProtocolVersion.MinSupportedVersion, 1],
    ]);
  });

  it('should support multiple variant implementations through state migration', async () => {
    const builder = new WalletBuilderTs()
      // Have the first variant complete after producing two values, signifying a protocol change.
      .withVariant(ProtocolVersion.MinSupportedVersion, new NumericRangeBuilder(2))
      .withVariant(ProtocolVersion.ProtocolVersion(100n), new NumericRangeMultiplierBuilder())
      .withConfiguration({
        min: 0,
        max: 4,
        multiplier: 2,
      });
    const wallet = builder.build();

    expect(wallet).toBeDefined();

    const state = wallet.state.pipe(rx.take(5)); // We expect five values.
    const receivedStates = await toProtocolStateArray(state);

    expect(receivedStates).toEqual([
      [ProtocolVersion.MinSupportedVersion, 0],
      [ProtocolVersion.MinSupportedVersion, 1],
      // The second variant starts applying the multiplier to the state (represents a protocol change).
      [ProtocolVersion.ProtocolVersion(100n), 4],
      [ProtocolVersion.ProtocolVersion(100n), 6],
      [ProtocolVersion.ProtocolVersion(100n), 8],
    ]);
  });

  it('should stop variant once state observable is unsubscribed', async () => {
    const pubsub = Effect.runSync(PubSub.bounded<number>({ capacity: 1, replay: 1 }));

    const pubSubVariantBuilder: VariantBuilder<number> = {
      build: () => {
        return {
          start(_context, state: number) {
            return Stream.unfold(state, (previous: number) => {
              const next = previous + 1;
              return Option.some([next, next] as const);
            }).pipe(
              Stream.mapEffect((value) => PubSub.publish(pubsub, value).pipe(Effect.delay(1))),
              Stream.takeUntilEffect(() => PubSub.isShutdown(pubsub)),
              Stream.runDrain,
              Effect.forkScoped,
              Effect.flatMap(() => Scope.Scope),
              Effect.map((scope) => ({
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

    const wallet = new WalletBuilderTs().withVariant(ProtocolVersion.MinSupportedVersion, pubSubVariantBuilder).build();

    const values = await rx.firstValueFrom(wallet.state.pipe(rx.map(ProtocolState.state), rx.take(5), reduceToChunk()));
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
});
