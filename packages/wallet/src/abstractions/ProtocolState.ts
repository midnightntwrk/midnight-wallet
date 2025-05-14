import * as ProtocolVersion from './ProtocolVersion';

/**
 * A tuple that associates some state with a given version of the Midnight protocol.
 *
 * @typeParam TState The type of state.
 */
export type ProtocolState<TState> = readonly [ProtocolVersion.ProtocolVersion, TState];
