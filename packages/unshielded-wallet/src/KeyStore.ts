import { UnshieldedKeystore, Roles } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { UnshieldedAddress, MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NetworkId } from '@midnight-ntwrk/ledger';
import { Effect } from 'effect';

export interface Keystore {
  keystore: UnshieldedKeystore;
  getBech32Address(): Effect.Effect<MidnightBech32m, Error>;
}

export const createKeystore = (
  seed: Buffer,
  networkId: NetworkId,
  accountIndex = 0,
  addressIndex = 0,
  role = Roles.NightExternal,
): Effect.Effect<Keystore, Error> =>
  Effect.try({
    try: () => {
      const keystore = new UnshieldedKeystore(seed, accountIndex, addressIndex, role);

      return {
        keystore,
        getBech32Address: () =>
          Effect.gen(function* () {
            const address = yield* keystore.getAddress(false);
            const addressBuffer = Buffer.from(address, 'hex');
            return UnshieldedAddress.codec.encode(networkId, new UnshieldedAddress(addressBuffer));
          }),
      };
    },
    catch: (error) =>
      new Error(`something went wrong ${error instanceof Error ? error.message : JSON.stringify(error)}`),
  });
