import * as Brand from 'effect/Brand';

/**
 * A branded `Uint8Array` representing serialized transaction data.
 */
export type SerializedTransaction = Brand.Branded<Uint8Array, 'SerializedTransaction'>;

/**
 * Constructs a branded `Uint8Array` representing serialized transaction data.
 */
export const SerializedTransaction = Brand.nominal<SerializedTransaction>();
