import { Effect, Either, Exit, Option, Scope, Stream, SubscriptionRef, SynchronizedRef } from 'effect';
import {
  ProtocolState,
  ProtocolVersion,
  StateChange,
  VersionChangeType,
  HList,
  Poly,
} from '@midnight-ntwrk/abstractions';
import { Variant, WalletRuntimeError } from './abstractions/index';
import { EitherOps } from './effect';

/**
 * The {@link Runtime} service type.
 */
export interface Runtime<Variants extends Variant.AnyVersionedVariantArray> {
  readonly stateChanges: Stream.Stream<
    ProtocolState.ProtocolState<Variant.StateOf<HList.Each<Variants>>>,
    WalletRuntimeError
  >;

  readonly progress: Effect.Effect<Progress>;

  readonly currentVariant: Effect.Effect<EachRunningVariant<Variants>>;

  dispatch<TResult, E = never>(
    impl: Poly.PolyFunction<Variant.RunningVariantOf<HList.Each<Variants>>, Effect.Effect<TResult, E>>,
  ): Effect.Effect<TResult, WalletRuntimeError | E>;
}

export type RunningVariant<
  TVariant extends Variant.AnyVersionedVariant,
  TRest extends Variant.AnyVersionedVariantArray,
> = Poly.WithTagFrom<TVariant['variant']> & {
  variant: TVariant;
  runningVariant: Variant.RunningVariantOf<TVariant>;
  initialState: Variant.StateOf<TVariant>;
  variantScope: Scope.CloseableScope;
  currentStateRef: SynchronizedRef.SynchronizedRef<Variant.StateOf<TVariant>>;
  restVariants: TRest;
  initProtocolVersion: ProtocolVersion.ProtocolVersion;
  validVersionRange: ProtocolVersion.ProtocolVersion.Range;
  nextProtocolVersion: ProtocolVersion.ProtocolVersion | null;
};
type EachRunningVariant<TAll extends Variant.AnyVersionedVariantArray> = TAll extends [
  infer THead extends Variant.AnyVersionedVariant,
  ...infer TRest extends Variant.AnyVersionedVariantArray,
]
  ? RunningVariant<THead, TRest> | EachRunningVariant<TRest>
  : never;
/**
 * A type that represents the reported progress of a variant expressed in terms of gaps to reaching synced
 * progress in application site and data source site
 */
type Progress = { readonly sourceGap: bigint; readonly applyGap: bigint };

export type InitRuntimeHeadArgs<Variants extends Variant.AnyVersionedVariantArray> = {
  variants: Variants;
  state: Variant.StateOf<HList.Head<Variants>>;
};
export const initHead = <Variants extends Variant.AnyVersionedVariantArray>(
  initArgs: InitRuntimeHeadArgs<Variants>,
): Effect.Effect<Runtime<Variants>, WalletRuntimeError, Scope.Scope> => {
  const headVariant: HList.Head<Variants> = HList.head(initArgs.variants);
  return init({ variants: initArgs.variants, tag: Poly.getTag(headVariant.variant), state: initArgs.state });
};

export type InitRuntimeArgs<Variants extends Variant.AnyVersionedVariantArray, InitTag extends string | symbol> = {
  variants: Variants;
  tag: InitTag;
  state: Variant.StateOf<HList.Find<Variants, { variant: Poly.WithTag<InitTag> }>>;
};
export const init = <Variants extends Variant.AnyVersionedVariantArray, InitTag extends string | symbol>(
  initArgs: InitRuntimeArgs<Variants, InitTag>,
): Effect.Effect<Runtime<Variants>, WalletRuntimeError, Scope.Scope> => {
  //Rewritten from generators to better track type issues reported
  return Effect.Do.pipe(
    Effect.bind('initiatedFirstVariant', () => initVariant(initArgs)),
    Effect.bind('currentStateRef', ({ initiatedFirstVariant }) =>
      initiatedFirstVariant.currentStateRef.get.pipe(
        Effect.flatMap((state: Variant.StateOf<HList.Each<Variants>>) =>
          SubscriptionRef.make<
            Either.Either<ProtocolState.ProtocolState<Variant.StateOf<HList.Each<Variants>>>, WalletRuntimeError>
          >(Either.right({ version: initiatedFirstVariant.initProtocolVersion, state })),
        ),
      ),
    ),
    Effect.bind('progressRef', () => SynchronizedRef.make<Progress>({ applyGap: 0n, sourceGap: 0n })),
    Effect.bind('currentVariantRef', ({ initiatedFirstVariant }) =>
      Effect.acquireRelease(SynchronizedRef.make<EachRunningVariant<Variants>>(initiatedFirstVariant), (ref, exit) =>
        Effect.gen(function* () {
          // This is needed to properly close variant scope when whole runtime closes
          // Otherwise variant would be running in the background
          // TODO: For somewhat unclear reason the existing test case does not cover this scenario
          const runningVariant = yield* SynchronizedRef.get(ref);
          yield* Scope.close(runningVariant.variantScope, exit);
        }),
      ),
    ),
    Effect.bind('runningStream', ({ initiatedFirstVariant, currentStateRef, progressRef, currentVariantRef }) => {
      return runVariantStream(initiatedFirstVariant, currentStateRef, progressRef, currentVariantRef).pipe(
        Effect.catchAll((error: WalletRuntimeError) => {
          return SubscriptionRef.set(currentStateRef, Either.left(error));
        }),
        Effect.forkScoped,
      );
    }),
    Effect.flatMap(
      ({ currentStateRef, progressRef, currentVariantRef }): Effect.Effect<Runtime<Variants>, never, Scope.Scope> => {
        return Effect.gen(function* () {
          const changesStream = yield* currentStateRef.changes.pipe(
            Stream.mapEffect((value) => EitherOps.toEffect(value)),
            Stream.share({ capacity: 'unbounded', replay: 1 }),
          );
          const runtime = {
            stateChanges: changesStream,
            progress: progressRef.get,
            currentVariant: currentVariantRef.get,
            dispatch: <TResult, E = never>(
              impl: Poly.PolyFunction<Variant.RunningVariantOf<HList.Each<Variants>>, Effect.Effect<TResult, E>>,
            ): Effect.Effect<TResult, WalletRuntimeError | E> => dispatch(runtime, impl),
          };

          return runtime;
        });
      },
    ),
  );
};

export const dispatch = <Variants extends Variant.AnyVersionedVariantArray, TResult, E = never>(
  runtime: Runtime<Variants>,
  impl: Poly.PolyFunction<Variant.RunningVariantOf<HList.Each<Variants>>, Effect.Effect<TResult, E>>,
): Effect.Effect<TResult, WalletRuntimeError | E> => {
  return runtime.currentVariant.pipe(
    Effect.flatMap((current) =>
      Poly.dispatch(current.runningVariant as Variant.RunningVariantOf<HList.Each<Variants>>, impl),
    ),
  );
};

type MigrateArgs<Variants extends Variant.AnyVersionedVariantArray> = {
  variants: Variants;
  state: Variant.PreviousStateOf<HList.Head<Variants>>;
  initProtocolVersion?: ProtocolVersion.ProtocolVersion;
};
const migrateToNextVariant = <Variants extends Variant.AnyVersionedVariantArray>(
  migrateArgs: MigrateArgs<Variants>,
): Effect.Effect<EachRunningVariant<Variants>, WalletRuntimeError> => {
  return Effect.gen(function* () {
    const [headVersionedVariant] = migrateArgs.variants;
    if (!headVersionedVariant) {
      yield* Effect.fail(new WalletRuntimeError({ message: 'No variant to init' }));
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- It seems that TS is defaulting to the constraint provided for a generic type with its inference, which includes any
    const newState = yield* headVersionedVariant.variant.migrateState(migrateArgs.state);

    return yield* initHeadVariant({
      variants: migrateArgs.variants,
      state: newState as Variant.StateOf<HList.Head<Variants>>,
      initProtocolVersion: migrateArgs.initProtocolVersion,
    });
  });
};

type InitArgs<Variants extends Variant.AnyVersionedVariantArray, TTag extends string | symbol> = {
  variants: Variants;
  tag: TTag;
  state: Variant.StateOf<HList.Find<Variants, { variant: Poly.WithTag<TTag> }>>;
};
// Arguments are gathered to a separate type because presence of HList.Find is crashing TS compiler ¯\_(ツ)_/¯
const initVariant = <Variants extends Variant.AnyVersionedVariantArray, TTag extends string | symbol>(
  init: InitArgs<Variants, TTag>,
): Effect.Effect<EachRunningVariant<Variants>, WalletRuntimeError> => {
  return Effect.gen(function* () {
    const index = init.variants.findIndex((variant) => Poly.getTag(variant.variant) === init.tag);
    const theRest = init.variants.toSpliced(0, index);

    //These casts are terrible, but they allow to call the initHeadVariant
    return yield* initHeadVariant({
      variants: theRest as Variants,
      state: init.state as unknown as Variant.StateOf<HList.Head<Variants>>,
    });
  });
};

type InitHeadArgs<Variants extends Variant.AnyVersionedVariantArray> = {
  variants: Variants;
  state: Variant.StateOf<HList.Head<Variants>>;
  initProtocolVersion?: ProtocolVersion.ProtocolVersion | undefined;
};
// Following pattern from `initVariant` for consistency
const initHeadVariant = <Variants extends Variant.AnyVersionedVariantArray>(
  init: InitHeadArgs<Variants>,
): Effect.Effect<EachRunningVariant<Variants>, WalletRuntimeError> => {
  return Effect.gen(function* () {
    const [anyHeadVersionedVariant, maybeNextVersionedVariant] = init.variants;
    if (!anyHeadVersionedVariant) {
      yield* Effect.fail(new WalletRuntimeError({ message: 'No variant to init' }));
    }
    const headVersionedVariant = anyHeadVersionedVariant as HList.Head<Variants> & Variant.AnyVersionedVariant;

    const actualInitProtocolVersion = init.initProtocolVersion ?? headVersionedVariant.sinceVersion;
    const nextActivationVersion = maybeNextVersionedVariant
      ? maybeNextVersionedVariant.sinceVersion
      : ProtocolVersion.MaxSupportedVersion;
    const validVersionRange = ProtocolVersion.makeRange(headVersionedVariant.sinceVersion, nextActivationVersion);

    const stateRef = yield* SubscriptionRef.make(init.state);
    const variantScope = yield* Scope.make();
    const runningVariant = yield* headVersionedVariant.variant
      .start({ stateRef }, init.state)
      .pipe(Effect.provideService(Scope.Scope, variantScope)) as Effect.Effect<
      Variant.RunningVariantOf<HList.Head<Variants>>,
      WalletRuntimeError
    >;
    //This type declaration helps with setting right properties...
    const out: RunningVariant<HList.Head<Variants> & Variant.AnyVersionedVariant, HList.Tail<Variants>> = {
      __polyTag__: headVersionedVariant.variant.__polyTag__ as Poly.TagOf<HList.Each<Variants>['variant']>,
      variant: headVersionedVariant,
      initialState: init.state,
      runningVariant: runningVariant,
      currentStateRef: stateRef,
      restVariants: HList.tail(init.variants),
      initProtocolVersion: actualInitProtocolVersion,
      validVersionRange,
      nextProtocolVersion: maybeNextVersionedVariant ? maybeNextVersionedVariant.sinceVersion : null,
      variantScope,
    };
    // ...while this type casting makes things bearable in the rest of the code (TS's type inference is great, but still limited)
    return out as unknown as EachRunningVariant<Variants>;
  });
};

const runVariantStream = <Variants extends Variant.AnyVersionedVariantArray>(
  initiatedVariant: EachRunningVariant<Variants>,
  stateRef: SubscriptionRef.SubscriptionRef<
    Either.Either<ProtocolState.ProtocolState<Variant.StateOf<HList.Each<Variants>>>, WalletRuntimeError>
  >,
  progressRef: SynchronizedRef.SynchronizedRef<Progress>,
  currentVariantRef: SynchronizedRef.SynchronizedRef<EachRunningVariant<Variants>>,
): Effect.Effect<void, WalletRuntimeError> => {
  type Accumulator = {
    protocolVersion: ProtocolVersion.ProtocolVersion;
    followEffect: Effect.Effect<void, WalletRuntimeError>;
    shouldInitChange: boolean;
    lastState: Variant.StateOf<HList.Each<Variants>>;
  };
  type StreamState = StateChange.StateChange<Variant.StateOf<HList.Each<Variants>>>;

  const initialAcc: Accumulator = {
    protocolVersion: initiatedVariant.initProtocolVersion,
    shouldInitChange: false,
    followEffect: Effect.void,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    lastState: initiatedVariant.initialState,
  };
  return initiatedVariant.runningVariant.state.pipe(
    Stream.scanEffect(initialAcc, (accumulator: Accumulator, change: StreamState) => {
      return StateChange.match(change, {
        State: ({ state }) => {
          return SubscriptionRef.set(
            stateRef,
            Either.right({ version: accumulator.protocolVersion, state } as const),
          ).pipe(Effect.as({ ...accumulator, lastState: state }));
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
              followEffect: Effect.gen(function* () {
                yield* Scope.close(initiatedVariant.variantScope, Exit.void);
                const newInitiatedVariant = yield* migrateToNextVariant({
                  variants: initiatedVariant.restVariants,
                  state: accumulator.lastState as Variant.PreviousStateOf<
                    HList.Head<typeof initiatedVariant.restVariants>
                  >,
                  initProtocolVersion: newProtocolVersion,
                });
                yield* SynchronizedRef.set(currentVariantRef, newInitiatedVariant);
                return yield* runVariantStream(newInitiatedVariant, stateRef, progressRef, currentVariantRef);
              }),
            });
          } else {
            return Effect.succeed({
              ...accumulator,
              protocolVersion: newProtocolVersion ?? accumulator.protocolVersion,
            });
          }
        },
      });
    }),
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
