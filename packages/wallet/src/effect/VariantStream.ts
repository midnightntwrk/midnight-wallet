import { Effect, Context, SubscriptionRef, SynchronizedRef, Stream, identity, Types } from 'effect';
import {
  Variant,
  ProtocolVersion,
  ProtocolState,
  StateChange,
  VersionChangeType,
} from '@midnight-ntwrk/wallet-ts/abstractions';

/**
 * Manages an array of variants, keeping track of the current variant as stream updates occur.
 */
export class VariantStream extends Context.Tag('@midnight-ntwrk/wallet#Runtime')<
  VariantStream,
  VariantStream.Service
>() {}

export declare namespace VariantStream {
  /**
   * The {@link VariantStream} service type.
   */
  interface Service {
    readonly stateChanges: <TState>() => Stream.Stream<ProtocolState<TState>>;

    readonly progress: () => Effect.Effect<VariantStream.Progress>;

    readonly currentVariant: Effect.Effect<Variant.AnyVersionedVariant>;
  }

  /**
   * A tuple type that represents a reference to a 'current' variant, and the Midnight protocol version that
   * follows it.
   *
   * @remarks
   * Given a `Ref` of `[100, V]`, `V` would represent the _current_ variant, and 100 would be the protocol version
   * that is the next highest after that registered for `V`.
   */
  type Ref = readonly [nextProtocolVersion: ProtocolVersion.ProtocolVersion, Variant.AnyVersionedVariant];

  /**
   * A tuple type that represents the reported synchronization progress of a variant.
   *
   * @remarks
   * `sourceGap` represents the number of blocks that the underlying datasource has left to process. `applyGap`
   * represents the number of blocks that the variant has left to apply. When both these properties are `'0'`, then
   * the _current_ variant is considered to be fully up-to-date.
   */
  type Progress = readonly [sourceGap: bigint, applyGap: bigint];
}

/**
 * Constructs a new {@link VariantStream}.
 *
 * @param variants The array of variants that are to be managed.
 * @param state The starting state.
 * @returns An `Effect` that when executed returns a {@link VariantStream} implementation.
 */
export const make = (
  variants: Variant.AnyVersionedVariantArray,
  state: unknown,
): Effect.Effect<VariantStream.Service> =>
  Effect.gen(function* () {
    const variantRef = findVersionedVariant(variants, ProtocolVersion.MinSupportedVersion);
    const currentRef = yield* SubscriptionRef.make(variantRef);
    const progressRef = yield* SynchronizedRef.make<VariantStream.Progress>([1n, 1n] as const);
    const stateRef = yield* SynchronizedRef.make(state ?? (yield* initialState(variantRef)));

    return {
      stateChanges() {
        return Stream.map(currentRef.changes, identity).pipe(
          Stream.flatMap(forVersionedVariant(variants, currentRef, stateRef, progressRef)),
        );
      },
      progress() {
        return SynchronizedRef.get(progressRef);
      },
      currentVariant: Effect.map(currentRef.get, ([, variant]) => variant),
    } as VariantStream.Service;
  });

const initialState = ([, versionedVariant]: VariantStream.Ref) => {
  const [, variant] = versionedVariant;

  return variant.migrateState(null);
};

const withinProtocolVersionRange =
  (range: ProtocolVersion.ProtocolVersion.Range) =>
  (version: ProtocolVersion.ProtocolVersion): boolean =>
    ProtocolVersion.withinRange(version, range);

const migrateToNextVariant = (
  variants: Variant.AnyVersionedVariantArray,
  currentRef: SubscriptionRef.SubscriptionRef<VariantStream.Ref>,
  stateRef: SynchronizedRef.SynchronizedRef<unknown>,
  nextVersion: ProtocolVersion.ProtocolVersion,
) =>
  Effect.gen(function* () {
    const nextVersionedVariantRef = findVersionedVariant(variants, nextVersion);
    const [, nextVersionedVariant] = nextVersionedVariantRef;
    const [, nextVariant] = nextVersionedVariant;
    const currentState = yield* SynchronizedRef.get(stateRef);

    yield* SynchronizedRef.updateEffect(stateRef, () => nextVariant.migrateState(currentState));
    yield* SubscriptionRef.set(currentRef, nextVersionedVariantRef);
  });

const forVersionedVariant =
  (
    variants: Variant.AnyVersionedVariantArray,
    currentRef: SubscriptionRef.SubscriptionRef<VariantStream.Ref>,
    stateRef: SynchronizedRef.SynchronizedRef<unknown>,
    progressRef: SynchronizedRef.SynchronizedRef<VariantStream.Progress>,
  ) =>
  ([nextVersion, [sinceVersion, variant]]: VariantStream.Ref) => {
    const withinVariantVersionRange = withinProtocolVersionRange(ProtocolVersion.makeRange(sinceVersion, nextVersion));

    return Stream.fromEffect(stateRef.get).pipe(
      Stream.flatMap((state) => variant.start(state)),
      Stream.scanEffect(
        [sinceVersion, null] as const,
        (streamState: readonly [ProtocolVersion.ProtocolVersion, StateChange.StateChange<unknown> | null], state) =>
          Effect.gen(function* () {
            const [currentVersion] = streamState;
            const stateVersion = yield* StateChange.match(state, {
              State: ({ state }) =>
                Effect.andThen(SynchronizedRef.set(stateRef, state), Effect.succeed(currentVersion)),
              ProgressUpdate: ({ sourceGap, applyGap }) =>
                Effect.andThen(
                  SynchronizedRef.set(progressRef, [sourceGap, applyGap] as const),
                  Effect.succeed(currentVersion),
                ),
              VersionChange: ({ change }) =>
                VersionChangeType.match(change, {
                  Version: ({ version }) => Effect.succeed(version),
                  Next: () => Effect.succeed(nextVersion),
                }),
            });

            if (!withinVariantVersionRange(stateVersion)) {
              yield* migrateToNextVariant(variants, currentRef, stateRef, nextVersion);
            }

            return [stateVersion, state] as const;
          }),
      ),
      Stream.takeWhile(([stateVersion]) => withinVariantVersionRange(stateVersion)),
      Stream.filter(([, state]) => StateChange.isState(state)),
      Stream.map(
        ([stateVersion, state]) =>
          [stateVersion, (state as Types.ExtractTag<StateChange.StateChange<unknown>, 'State'>).state] as const,
      ),
    );
  };

const findVersionedVariant = (
  variants: Variant.AnyVersionedVariantArray,
  version: ProtocolVersion.ProtocolVersion,
): VariantStream.Ref => {
  let selectedIdx = 0;

  // Simple scan of the variant array. If we're going to encounter large numbers of variants then
  // consider other options, such as an array based binary search. We assume that the variant array is in
  // `sinceVersion` order.
  for (let idx = 0; idx < variants.length; idx++) {
    const variant = variants[idx];
    const [sinceVersion] = variant;

    if (sinceVersion > version) break;

    selectedIdx = idx;
  }

  const nextProtocolVersion = variants[selectedIdx + 1]?.[0] ?? ProtocolVersion.MaxSupportedVersion;

  return [nextProtocolVersion, variants[selectedIdx]] as const;
};
