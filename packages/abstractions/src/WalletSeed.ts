import * as Brand from 'effect/Brand';
import * as Schema from 'effect/Schema';

/**
 * A branded `Uint8Array` that represents a BIP32 compatible seed phrase.
 */
export type WalletSeed = Brand.Branded<Uint8Array, 'WalletSeed'>;

/**
 * Constructs a branded `Uint8Array` representing a BIP32 compatible seed phrase.
 */
export const WalletSeed = Brand.nominal<WalletSeed>();

/**
 * A schema that transforms an array of numbers into a {@link WalletSeed}.
 */
export const WalletSeedSchema = Schema.Uint8Array.pipe(Schema.fromBrand(WalletSeed));

/**
 * A type predicate that determines if a given value is a {@link WalletSeed}.
 *
 * @param u The value to test.
 * @returns `true` if `u` has the type {@link WalletSeed}.
 */
export const is = Schema.is(WalletSeedSchema);

/**
 * Constructs a {@link WalletSeed} from a string representation of a BIP32 compatible seed phrase.
 *
 * @param strValue The string value.
 * @returns A {@link WalletSeed} created from `strValue`.
 */
export const fromString: (strValue: string) => WalletSeed = (strValue) => WalletSeed(Buffer.from(strValue, 'hex'));
