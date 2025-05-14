import * as Brand from 'effect/Brand';
import * as Schema from 'effect/Schema';

/**
 * A branded `string` representing serialized (JSON) wallet state made up of local state, transaction history,
 * and block height.
 */
export type WalletState = Brand.Branded<string, 'WalletState'>;

/**
 * Constructs a branded `string` representing serialized (JSON) wallet state.
 */
export const WalletState = Brand.nominal<WalletState>();

/**
 * A schema that transforms a string into a {@link WalletState}.
 */
export const WalletStateSchema = Schema.String.pipe(Schema.fromBrand(WalletState));

/**
 * A type predicate that determines if a given value is a {@link WalletState}.
 *
 * @param u The value to test.
 * @returns `true` if `u` has the type {@link WalletState}.
 */
export const is = Schema.is(WalletStateSchema);
