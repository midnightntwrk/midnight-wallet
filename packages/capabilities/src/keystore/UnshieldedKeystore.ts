import {
  addressFromKey,
  type SignatureVerifyingKey,
  type UserAddress,
  type Signature,
  signatureVerifyingKey,
  signData,
} from '@midnight-ntwrk/ledger';
import { HDWallet, type Role, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { Data, Effect } from 'effect';

export class UnshieldedKeystoreDeriveError extends Data.TaggedError('UnshieldedKeystoreDeriveError')<{
  readonly error?: string;
}> {}

export type UnshieldedKeystoreError = UnshieldedKeystoreDeriveError;

export class UnshieldedKeystore {
  #hdWallet: HDWallet;
  readonly account: number;
  readonly index: number;
  readonly role: Role;

  constructor(seed: Uint8Array, account: number, index: number, role: Role) {
    const hdWalletResult = HDWallet.fromSeed(seed);

    if (hdWalletResult.type === 'seedError') {
      throw new Error('Wrong seed');
    }

    if (role !== Roles.NightExternal && role !== Roles.NightInternal) {
      throw new Error('Unsupported role provided');
    }

    const { hdWallet } = hdWalletResult as {
      type: 'seedOk';
      hdWallet: HDWallet;
    };

    this.#hdWallet = hdWallet;
    this.account = account;
    this.index = index;
    this.role = role;
  }

  getSecretKey(): Effect.Effect<Buffer, UnshieldedKeystoreError> {
    const derivationResult = this.#hdWallet.selectAccount(this.account).selectRole(this.role).deriveKeyAt(this.index);
    if (derivationResult.type == 'keyOutOfBounds') {
      return Effect.fail(
        new UnshieldedKeystoreDeriveError({ error: 'Unable to derive the secret key by given account and role' }),
      );
    }

    const MAJOR_VERSION = 1;
    const MINOR_VERSION = 0;

    return Effect.succeed(Buffer.from([MAJOR_VERSION, MINOR_VERSION, ...derivationResult.key]));
  }

  getPublicKey(): Effect.Effect<SignatureVerifyingKey, UnshieldedKeystoreError> {
    return Effect.map(this.getSecretKey(), (privateKey: Buffer) => signatureVerifyingKey(privateKey.toString('hex')));
  }

  getAddress(includeVersion = true): Effect.Effect<UserAddress, UnshieldedKeystoreError> {
    return Effect.map(this.getPublicKey(), (publicKey: SignatureVerifyingKey) => {
      const address = addressFromKey(publicKey);

      if (!includeVersion) {
        return address.slice(4); // Remove the version prefix
      }

      return address;
    });
  }

  signData(data: Uint8Array): Effect.Effect<Signature, UnshieldedKeystoreError> {
    return Effect.map(this.getSecretKey(), (privateKey: Buffer) => signData(privateKey.toString('hex'), data));
  }
}

export { Roles, Role };
