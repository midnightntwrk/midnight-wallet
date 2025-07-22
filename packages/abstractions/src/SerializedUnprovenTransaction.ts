import { Brand } from 'effect';

/**
 * A branded `Uint8Array` representing serialized unproven transaction data.
 */
export type SerializedUnprovenTransaction = Brand.Branded<Uint8Array, 'SerializedUnprovenTransaction'>;

/**
 * Constructs a branded `Uint8Array` representing serialized unproven transaction data.
 */
export const SerializedUnprovenTransaction = Brand.nominal<SerializedUnprovenTransaction>();
