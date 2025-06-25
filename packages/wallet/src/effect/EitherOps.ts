import { JsEither, ScalaEither } from '@midnight-ntwrk/wallet';
import { Effect, Either } from 'effect';

export const fromScala = <A, B>(scalaEither: ScalaEither<A, B>): Either.Either<B, A> => {
  return JsEither.fold<A, B, Either.Either<B, A>>(
    scalaEither,
    (a) => Either.left(a),
    (b) => Either.right(b),
  );
};

export const toEffect = <L, R>(either: Either.Either<R, L>): Effect.Effect<R, L> => {
  return Either.match(either, {
    onLeft: (l) => Effect.fail(l),
    onRight: (r) => Effect.succeed(r),
  });
};
