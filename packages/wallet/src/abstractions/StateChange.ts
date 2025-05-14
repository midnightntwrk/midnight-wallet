import { Data } from 'effect';
import { VersionChangeType } from './VersionChangeType';

/**
 * A tagged enum data type that represents the state changes across wallet implementation variants.
 *
 * @remarks
 * A variant can report changes in state using the {@link StateChange.State} enum variant. The
 * {@link StateChange.ProgressUpdate} and {@link StateChange.VersionChange} enum variants should be used when a
 * variant needs to report a sync progress update, or a detected change in protocol version respectively.
 */
export type StateChange<TState> = Data.TaggedEnum<{
  /** A change in state. */
  State: { readonly state: TState };

  /** A change in reported progress. */
  ProgressUpdate: {
    /**
     * The number of blocks that remain for the underlying datasource to process in order to be fully synchronized.
     */
    readonly sourceGap: bigint;
    /**
     * The number of blocks that remain for the variant to apply in order to be fully synchronized.
     */
    readonly applyGap: bigint;
  };

  /** A change in Midnight protocol version. */
  VersionChange: { readonly change: VersionChangeType };
}>;
const StateChange = Data.taggedEnum<_StateChange>();

interface _StateChange extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: StateChange<this['A']>;
}

/**
 * A type predicate that determines if a given value is a {@link StateChange.State} enum variant.
 */
export const isState = StateChange.$is('State');

/**
 * A type predicate that determines if a given value is a {@link StateChange.ProgressUpdate} enum variant.
 */
export const isProgressUpdate = StateChange.$is('ProgressUpdate');

/**
 * A type predicate that determines if a given value is a {@link StateChange.VersionChange} enum variant.
 */
export const isVersionChange = StateChange.$is('VersionChange');

export const { $match: match, State, ProgressUpdate, VersionChange } = StateChange;
