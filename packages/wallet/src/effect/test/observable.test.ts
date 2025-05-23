import { jest } from '@jest/globals';
import { Stream, Effect, identity, Fiber } from 'effect';
import { Observable } from '../index';
import * as rx from 'rxjs';

describe('Observable', () => {
  const makeGenerator = (iterations: number) => {
    let iteration = 0;

    // eslint-disable-next-line @typescript-eslint/require-await
    const generator = async function* () {
      while (iteration < iterations) {
        yield iteration++;
      }
    };

    return {
      generator,
      iterationsYielded: () => iteration,
    };
  };

  const MAX_ITERATIONS = 100;
  const TAKEN_ITERATIONS = 10;

  describe('toStream', () => {
    it('should close underlying Observable', async () => {
      const { generator, iterationsYielded } = makeGenerator(MAX_ITERATIONS);

      const observable = rx.from(generator());
      const stream = Observable.toStream(observable).pipe(Stream.takeWhile((i) => i < TAKEN_ITERATIONS));
      const collected = await Effect.runPromise(Stream.runCollect(stream));

      expect(collected.length).toEqual(TAKEN_ITERATIONS);
      expect(iterationsYielded()).toBeLessThan(MAX_ITERATIONS);
    });
  });

  describe('fromStream', () => {
    it('should close underlying Stream', async () => {
      const { generator, iterationsYielded } = makeGenerator(MAX_ITERATIONS);

      const stream = Stream.fromAsyncIterable(generator(), identity);
      const observable = Observable.fromStream(stream).pipe(rx.takeWhile((i) => i < TAKEN_ITERATIONS));
      const collected = await rx.lastValueFrom(observable.pipe(rx.toArray()));

      expect(collected.length).toEqual(TAKEN_ITERATIONS);
      expect(iterationsYielded()).toBeLessThan(MAX_ITERATIONS);
    });

    it('should cleanup allocated resource in underlying Stream', async () => {
      const { generator } = makeGenerator(MAX_ITERATIONS);
      const anyResource = 'A Resource';
      const cleanupFn = jest.fn((_) => Effect.void);

      const runStream = Effect.gen(function* () {
        // Create a stream that makes use of a resource.
        const stream = Stream.acquireRelease(Effect.succeed(anyResource), cleanupFn).pipe(
          Stream.flatMap(() => Stream.fromAsyncIterable(generator(), identity)),
        );
        const observable = Observable.fromStream(stream).pipe(rx.takeWhile((i) => i < TAKEN_ITERATIONS));

        yield* Effect.promise(() => rx.lastValueFrom(observable.pipe(rx.toArray())));
      });

      // Fork the `runStream` Effect and await its completion. This will ensure that stream finalization
      // will have completed...
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Fiber.await(yield* Effect.fork(runStream));
        }),
      );

      // ...allowing us to assert that the cleanup function was executed for the resource.
      expect(cleanupFn).toHaveBeenCalledWith(anyResource, expect.any(Object));
    });
  });

  describe('with chained Observables', () => {
    it('should close all underlying elements', async () => {
      const { generator, iterationsYielded } = makeGenerator(MAX_ITERATIONS);

      const observable = rx.from(generator());
      const stream = Observable.toStream(observable);
      const chainedObservable = Observable.fromStream(stream).pipe(rx.takeWhile((i) => i < TAKEN_ITERATIONS));
      const collected = await rx.lastValueFrom(chainedObservable.pipe(rx.toArray()));

      expect(collected.length).toEqual(TAKEN_ITERATIONS);
      expect(iterationsYielded()).toBeLessThan(MAX_ITERATIONS);
    });
  });
});
