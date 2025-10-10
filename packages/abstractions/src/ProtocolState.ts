import * as ProtocolVersion from './ProtocolVersion.js';

/**
 * A type that associates some state with a given version of the Midnight protocol.
 *
 * @typeParam TState The type of state.
 */
export type ProtocolState<TState> = Readonly<{ version: ProtocolVersion.ProtocolVersion; state: TState }>;

export const state = <TState>(ps: ProtocolState<TState>): TState => ps.state;
