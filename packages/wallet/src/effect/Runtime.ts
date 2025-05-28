import {
  ProtocolState,
  ProtocolVersion,
  StateChange,
  Variant,
  VersionChangeType,
  WalletRuntimeError,
} from '../abstractions/index';
import { Context, Effect, Either, Option, Scope, Stream, SubscriptionRef, SynchronizedRef } from 'effect';

/**
 * Manages an array of variants, keeping track of the current variant as stream updates occur.
 */
export class Runtime extends Context.Tag('@midnight-ntwrk/wallet#Runtime')<Runtime, Runtime.Service>() {}

export declare namespace Runtime {
  /**
   * The {@link Runtime} service type.
   */
  //TODO: It needs take state type from variants it is built from
  interface Service {
    readonly stateChanges: Stream.Stream<unknown, WalletRuntimeError>;

    readonly progress: Effect.Effect<Runtime.Progress>;

    readonly currentVariant: Effect.Effect<RunningVariant>;
  }

  type RunningVariant = {
    variant: Variant.AnyVersionedVariant;
    runningVariant: Variant.AnyRunningVariant;
    initialState: unknown;
    variantScope: Scope.CloseableScope;
    currentStateRef: SynchronizedRef.SynchronizedRef<unknown>;
    restVariants: Variant.AnyVersionedVariantArray;
    initProtocolVersion: ProtocolVersion.ProtocolVersion;
    validVersionRange: ProtocolVersion.ProtocolVersion.Range;
    nextProtocolVersion: ProtocolVersion.ProtocolVersion | null;
  };

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
   * A type that represents the reported progress of a variant expressed in terms of gaps to reaching synced
   * progress in application site and data source site
   */
  type Progress = { readonly sourceGap: bigint; readonly applyGap: bigint };
}

export const make = (
  variants: Variant.AnyVersionedVariantArray,
  state: unknown,
): Effect.Effect<Runtime.Service, WalletRuntimeError, Scope.Scope> => {
  //Rewritten from generators to better track type issues reported
  return Effect.Do.pipe(
    Effect.bind('initiatedFirstVariant', () => initHeadVariant(variants, state)),
    Effect.bind('currentStateRef', ({ initiatedFirstVariant }) =>
      initiatedFirstVariant.currentStateRef.get.pipe(
        Effect.flatMap((state) =>
          SubscriptionRef.make<Either.Either<ProtocolState.ProtocolState<unknown>, WalletRuntimeError>>(
            Either.right([initiatedFirstVariant.initProtocolVersion, state] as const),
          ),
        ),
      ),
    ),
    Effect.bind('progressRef', () => SynchronizedRef.make<Runtime.Progress>({ applyGap: 0n, sourceGap: 0n })),
    Effect.bind('currentVariantRef', ({ initiatedFirstVariant }) =>
      SynchronizedRef.make<Runtime.RunningVariant>(initiatedFirstVariant),
    ),
    Effect.bind('runningStream', ({ initiatedFirstVariant, currentStateRef, progressRef, currentVariantRef }) => {
      return runVariantStream(initiatedFirstVariant, currentStateRef, progressRef, currentVariantRef).pipe(
        Effect.catchAll((error: WalletRuntimeError) => {
          return SubscriptionRef.set(currentStateRef, Either.left(error));
        }),
        Effect.forkScoped,
      );
    }),
    Effect.map(({ currentStateRef, progressRef, currentVariantRef }) => {
      return {
        stateChanges: currentStateRef.changes.pipe(
          Stream.mapEffect((value) => {
            return Either.match(value, {
              onLeft: (error) => Effect.fail(error),
              onRight: (value) => Effect.succeed(value),
            });
          }),
          Stream.drop(1), // Orchestration requires first setting value in the ref, so we're dropping it here to only receive values emitted in the variant streams
        ),
        progress: progressRef.get,
        currentVariant: currentVariantRef.get,
      };
    }),
  );
};

const initHeadVariant = (
  variants: Variant.AnyVersionedVariantArray,
  previousState: unknown,
  initProtocolVersion?: ProtocolVersion.ProtocolVersion,
): Effect.Effect<Runtime.RunningVariant, WalletRuntimeError> => {
  return Effect.gen(function* () {
    const [headVersionedVariant, maybeNextVersionedVariant, ...rest] = variants;
    if (!headVersionedVariant) {
      yield* Effect.fail(new WalletRuntimeError({ message: 'No variant to init' }));
    }

    const [sinceVersionHead, headVariant] = headVersionedVariant;
    const actualInitProtocolVersion = initProtocolVersion ?? sinceVersionHead;
    const nextActivationVersion = maybeNextVersionedVariant
      ? maybeNextVersionedVariant[0]
      : ProtocolVersion.MaxSupportedVersion;
    const validVersionRange = ProtocolVersion.makeRange(sinceVersionHead, nextActivationVersion);

    const initialState = yield* headVariant.migrateState(previousState);
    const stateRef = yield* SubscriptionRef.make(initialState);
    const variantScope = yield* Scope.make();
    const runningVariant = yield* headVariant
      .start({ stateRef }, initialState)
      .pipe(Effect.provideService(Scope.Scope, variantScope));

    return {
      variant: headVersionedVariant,
      initialState,
      runningVariant,
      currentStateRef: stateRef,
      restVariants: [maybeNextVersionedVariant, ...rest],
      initProtocolVersion: actualInitProtocolVersion,
      validVersionRange,
      nextProtocolVersion: maybeNextVersionedVariant ? maybeNextVersionedVariant[0] : null,
      variantScope,
    };
  });
};

const runVariantStream = (
  initiatedVariant: Runtime.RunningVariant,
  stateRef: SubscriptionRef.SubscriptionRef<Either.Either<ProtocolState.ProtocolState<unknown>, WalletRuntimeError>>,
  progressRef: SynchronizedRef.SynchronizedRef<Runtime.Progress>,
  currentVariantRef: SynchronizedRef.SynchronizedRef<Runtime.RunningVariant>,
): Effect.Effect<void, WalletRuntimeError> => {
  return initiatedVariant.runningVariant.state.pipe(
    Stream.scanEffect(
      {
        protocolVersion: initiatedVariant.initProtocolVersion,
        shouldInitChange: false,
        followEffect: Effect.void,
        lastState: initiatedVariant.initialState,
      },
      (
        accumulator: {
          protocolVersion: ProtocolVersion.ProtocolVersion;
          followEffect: Effect.Effect<void, WalletRuntimeError>;
          shouldInitChange: boolean;
          lastState: unknown;
        },
        change,
      ) => {
        return StateChange.match(change, {
          State: ({ state }) => {
            return SubscriptionRef.set(stateRef, Either.right([accumulator.protocolVersion, state] as const)).pipe(
              Effect.as({ ...accumulator, lastState: state }),
            );
          },
          ProgressUpdate: (progress) => {
            return SynchronizedRef.set(progressRef, progress).pipe(Effect.as(accumulator));
          },
          VersionChange: ({ change }) => {
            const newProtocolVersion: ProtocolVersion.ProtocolVersion | null = VersionChangeType.match(change, {
              Version: ({ version }) => version,
              Next: () => initiatedVariant.nextProtocolVersion,
            });
            if (
              newProtocolVersion != null &&
              !ProtocolVersion.withinRange(newProtocolVersion, initiatedVariant.validVersionRange)
            ) {
              return Effect.succeed({
                ...accumulator,
                protocolVersion: newProtocolVersion,
                shouldInitChange: true,
                followEffect: initHeadVariant(
                  initiatedVariant.restVariants,
                  accumulator.lastState,
                  newProtocolVersion,
                ).pipe(
                  Effect.flatMap((newInitiatedVariant) =>
                    SynchronizedRef.setAndGet(currentVariantRef, newInitiatedVariant),
                  ),
                  Effect.flatMap((newInitiatedVariant) =>
                    runVariantStream(newInitiatedVariant, stateRef, progressRef, currentVariantRef),
                  ),
                ),
              });
            } else {
              return Effect.succeed({
                ...accumulator,
                protocolVersion: newProtocolVersion ?? accumulator.protocolVersion,
              });
            }
          },
        });
      },
    ),
    Stream.filter((streamAcc) => streamAcc.shouldInitChange),
    Stream.runHead,
    Effect.flatMap((streamAccOption) => {
      return Option.match(streamAccOption, {
        onSome: (value) => {
          return value.followEffect;
        },
        onNone: () => {
          return Effect.void;
        },
      });
    }),
  );
};
