import { Effect, Layer, Stream } from 'effect';
import * as Context from 'effect/Context';
import { pipeArguments } from 'effect/Pipeable';
import type * as Runtime from '../Runtime';
import { dual, identity } from 'effect/Function';
import { Mutable } from 'effect/Types';
import type { Variant, ProtocolState } from '@midnight-ntwrk/wallet-ts/abstractions';
import * as VariantStream from '../VariantStream';

/** @internal */
export const RuntimeSymbol: {
  readonly typeId: unique symbol;
  readonly layer: unique symbol;
  readonly variantStream: unique symbol;
} = {
  typeId: Symbol('@midnight-ntwrk/wallet#Runtime.typeId') as (typeof RuntimeSymbol)['typeId'],
  layer: Symbol('@midnight-ntwrk/wallet#Runtime.layer') as (typeof RuntimeSymbol)['layer'],
  variantStream: Symbol('@midnight-ntwrk/wallet#Runtime.variantStream') as (typeof RuntimeSymbol)['variantStream'],
} as const;

/** @internal */
export const RuntimeTag = Context.GenericTag<Runtime.AnyRuntime>('@midnight-ntwrk/wallet#Runtime');

const Prototype = {
  [RuntimeSymbol.typeId]: {
    _R: (_: never) => _,
  },
  pipe() {
    return pipeArguments(this, arguments); // eslint-disable-line prefer-rest-params
  },
};

type MutableRuntime<R> = Mutable<
  Runtime.Runtime<R> & {
    [RuntimeSymbol.layer]?: Layer.Layer<R>;
    [RuntimeSymbol.variantStream]?: Effect.Effect<VariantStream.VariantStream.Service>;
  }
>;

/** @internal */
export const is = (u: unknown): u is Runtime.AnyRuntime =>
  typeof u === 'object' && u != null && RuntimeSymbol.typeId in u;

/** @internal */
export const make = (): Runtime.Runtime => {
  const self = Object.create(Prototype) as Mutable<Runtime.AnyRuntime>;
  return self;
};

/** @internal */
export const withVariants = dual<
  <R>(
    variants: Variant.AnyVersionedVariantArray,
    state: unknown,
  ) => (self: Runtime.Runtime<R>) => Runtime.Runtime<Exclude<R, VariantStream.VariantStream>>,
  <R>(
    self: Runtime.Runtime<R>,
    variants: Variant.AnyVersionedVariantArray,
    state: unknown,
  ) => Runtime.Runtime<Exclude<R, VariantStream.VariantStream>>
>(3, <R>(self: Runtime.Runtime<R>, variants: Variant.AnyVersionedVariantArray, state: unknown) => {
  const runtime = Object.create(Prototype) as MutableRuntime<R>;
  let singleton: VariantStream.VariantStream.Service | null = null;
  runtime[RuntimeSymbol.layer] = Layer.effect(
    VariantStream.VariantStream,
    Effect.gen(function* () {
      return yield* singleton
        ? Effect.succeed(singleton)
        : VariantStream.make(variants, state).pipe(Effect.tap((instance) => (singleton = instance)));
    }),
  ) as Layer.Layer<R>;
  return runtime as Runtime.Runtime<Exclude<R, VariantStream.VariantStream>>;
});

/** @internal */
export const asStream = <TState>(self: Runtime.Runtime<never>): Stream.Stream<ProtocolState<TState>> =>
  variantStream(self).pipe(Stream.flatMap((stream) => stream.stateChanges()));

/** @internal */
export const getProgress = (
  self: Runtime.Runtime<never>,
): Effect.Effect<readonly [sourceGap: bigint, applyGap: bigint]> =>
  variantStream(self).pipe(Effect.flatMap((stream) => stream.progress()));

const variantStream = (self: Runtime.Runtime<never>): Effect.Effect<VariantStream.VariantStream.Service> => {
  const init = () =>
    Effect.map(VariantStream.VariantStream, identity).pipe(
      Effect.provide(
        (self as MutableRuntime<Runtime.Runtime.Context>)[RuntimeSymbol.layer] as Layer.Layer<Runtime.Runtime.Context>,
      ),
    );
  const mutableSelf = self as MutableRuntime<Runtime.Runtime.Context>;

  return mutableSelf[RuntimeSymbol.variantStream] ?? (mutableSelf[RuntimeSymbol.variantStream] = init());
};
