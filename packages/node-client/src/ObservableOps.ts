import { Effect, Stream, Fiber, Option, Chunk } from 'effect';
import { Observable } from 'rxjs';

// Temporary copy from wallet/effect/ObservableOps - to be removed after Tim's PR settles
export const fromStream = <A, E = never>(stream: Stream.Stream<A, E>): Observable<A> =>
  new Observable<A>((subscriber) => {
    const fiber = Effect.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const pull = yield* Stream.toPull(stream);

          while (true) {
            const shouldBreak = yield* Effect.match(pull, {
              onSuccess(values) {
                Chunk.forEach(values, (element) => {
                  subscriber.next(element);
                });
                return false;
              },
              onFailure(error) {
                return Option.match(error, {
                  onNone() {
                    subscriber.complete();
                    return true; // Stream has completed, signal the break.
                  },
                  onSome: (err) => {
                    subscriber.error(err);
                    return true;
                  },
                });
              },
            });
            if (shouldBreak) break;
          }
        }),
      ),
    );

    // Ensure that if the subscription ends we also dispose of the fiber pulling from the stream.
    subscriber.add(() => Effect.runFork(Fiber.interrupt(fiber)));
  });

/**
 * A utility that creates an Effect `Stream` from a given Rx.js `Observable`.
 *
 * @param observable The Rx.js `Observable` from which a `Stream` is required.
 * @returns A `Stream` the consumes elements from `observable`.
 */
export const toStream = <A, E = never>(observable: Observable<A>): Stream.Stream<A, E> =>
  Stream.async<A, E>((emit) => {
    const subscription = observable.subscribe({
      next: (value) => void emit.single(value),
      error: (err) => void emit.fail(err as E),
      complete: () => void emit.end(),
    });

    return Effect.sync(() => subscription.unsubscribe());
  });
