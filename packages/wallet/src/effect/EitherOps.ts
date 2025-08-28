import { Effect, Either } from 'effect';
import { dual } from 'effect/Function';

export const toEffect = <L, R>(either: Either.Either<R, L>): Effect.Effect<R, L> => {
  return Either.match(either, {
    onLeft: (l) => Effect.fail(l),
    onRight: (r) => Effect.succeed(r),
  });
};

export const flatMapLeft: {
  <R, L, L2>(either: Either.Either<R, L>, cb: (l: L) => Either.Either<R, L2>): Either.Either<R, L2>;
  <R, L, L2>(cb: (l: L) => Either.Either<R, L2>): (either: Either.Either<R, L>) => Either.Either<R, L2>;
} = dual(2, <R, L, L2>(either: Either.Either<R, L>, cb: (l: L) => Either.Either<R, L2>) => {
  return Either.match(either, {
    onRight: (r) => Either.right(r),
    onLeft: cb,
  });
});
