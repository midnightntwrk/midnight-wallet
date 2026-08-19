// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import { OtherWalletError } from '../WalletError.js';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as Arr, pipe, Schema } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeDefaultV1SerializationCapability } from '../Serialization.js';
import { Either } from 'effect';
import { CoreWallet } from '../CoreWallet.js';
import { EitherOps } from '@midnightntwrk/wallet-sdk-utilities';

const minutes = (mins: number) => 1_000 * 60 * mins;
vi.setConfig({ testTimeout: minutes(1) });

const tokenTypeArbitrary = (maxSize: number) => {
  const number = fc.nat(maxSize);
  const types = Array(number).map(() => ledger.sampleRawTokenType());
  const tokenTypeArbitrary = fc.constantFrom(...types);

  const nativeTokenTypeArbitrary = fc.constant(ledger.shieldedToken().raw);
  return fc.oneof({ weight: 1, arbitrary: nativeTokenTypeArbitrary }, { weight: 1, arbitrary: tokenTypeArbitrary });
};
const secretKeysArbitrary: fc.Arbitrary<ledger.ZswapSecretKeys> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((seed) => ledger.ZswapSecretKeys.fromSeed(seed));

type OutputPreimage = { coin: ledger.ShieldedCoinInfo; recipient: ledger.ZswapSecretKeys };
const outputPreimageArbitrary = (
  keysArbitrary: fc.Arbitrary<ledger.ZswapSecretKeys>,
  tokenTypeArbitrary: fc.Arbitrary<ledger.RawTokenType>,
): fc.Arbitrary<OutputPreimage> => {
  return fc.record({
    coin: fc.record({
      type: tokenTypeArbitrary,
      value: fc.nat().map(BigInt),
      nonce: fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => Buffer.from(bytes).toString('hex')),
    }),
    recipient: keysArbitrary,
  });
};
const transactionArbitrary = (
  outputPreimageArbitrary: fc.Arbitrary<OutputPreimage>,
  depth: number,
): fc.Arbitrary<{
  outputPreimages: OutputPreimage[];
  offer: ledger.ZswapOffer<ledger.PreProof>;
}> => {
  return fc.array(outputPreimageArbitrary, { maxLength: depth, minLength: 1 }).map((outputPreimages) => {
    return {
      outputPreimages,
      offer: pipe(
        outputPreimages,
        Arr.map((preimage) => {
          const output = ledger.ZswapOutput.new(
            preimage.coin,
            0,
            preimage.recipient.coinPublicKey,
            preimage.recipient.encryptionPublicKey,
          );
          return ledger.ZswapOffer.fromOutput(output, preimage.coin.type, preimage.coin.value);
        }),
        (arr) => arr.reduce((offerA, offerB) => offerA.merge(offerB)), // effect lacks equivalent "fold" definition for Array,
      ),
    };
  });
};
const walletArbitrary = (txDepth: number) => {
  return secretKeysArbitrary
    .chain((keys) => {
      return fc
        .array(transactionArbitrary(outputPreimageArbitrary(fc.constant(keys), tokenTypeArbitrary(3)), 5), {
          maxLength: txDepth,
        })
        .map((transactions) => ({ transactions, keys }));
    })
    .chain((acc) => {
      return fc.string().map((networkId) => ({ ...acc, networkId }));
    })
    .map(({ transactions, keys, networkId }) => {
      const state: ledger.ZswapLocalState = transactions.reduce(
        (state: ledger.ZswapLocalState, tx): ledger.ZswapLocalState => {
          return state.apply(keys, tx.offer);
        },
        new ledger.ZswapLocalState(),
      );
      const wallet = CoreWallet.init(state, keys, networkId);

      return {
        keys,
        transactions,
        wallet,
        networkId,
      };
    });
};

describe('V1 Wallet serialization', () => {
  it.each([
    { seed: '0000000000000000000000000000000000000000000000000000000000000001' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000002' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000003' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000004' },
  ])('maintains serialize ◦ deserialize == id property, including transaction history', ({ seed }) => {
    const networkId = NetworkId.NetworkId.Undeployed;
    const capability = makeDefaultV1SerializationCapability();
    const keys = ledger.ZswapSecretKeys.fromSeed(Buffer.from(seed, 'hex'));
    const wallet = CoreWallet.initEmpty(keys, networkId);

    const firstIteration = capability.serialize(wallet);

    const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });
  it('maintains serialize ◦ deserialize == id property', () => {
    const capability = makeDefaultV1SerializationCapability();
    fc.assert(
      fc.property(walletArbitrary(10), ({ wallet }) => {
        const firstIteration = capability.serialize(wallet);
        const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
        const secondIteration = capability.serialize(restored);

        //We can't meaningfully compare equality, so we compare the result of second serialization
        expect(firstIteration).toEqual(secondIteration);
      }),
      {
        numRuns: 10,
      },
    );
  });

  it('handles invalid JSON strings gracefully', () => {
    const capability = makeDefaultV1SerializationCapability();

    fc.assert(
      fc.property(fc.string(), (invalidJson) => {
        const result = capability.deserialize(null, invalidJson);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left instanceof OtherWalletError).toBe(true);
        }
      }),
    );
  });

  it('handles random valid JSON strings gracefully', () => {
    const capability = makeDefaultV1SerializationCapability();

    fc.assert(
      fc.property(fc.json(), (randomJsonValue) => {
        const result = capability.deserialize(null, randomJsonValue);

        expect(Either.isLeft(result)).toBe(true);
        if (Either.isLeft(result)) {
          expect(result.left instanceof OtherWalletError).toBe(true);
        }
      }),
    );
  });
});

// The property above asserts snapshot-to-snapshot equality, so a break tells you a byte moved but not which field. It
// also draws its wallet from an arbitrary whose transaction array has no minimum length, so a run can legitimately
// assert over an empty wallet. `coinHashes` is the field that most deserves better: it is derived from the secret keys,
// deserialization is handed none, and a wallet that loses it cannot recognise its own coins after an upgrade. So it gets
// a guaranteed non-empty fixture and an assertion by value.
const fundedWallet = (seed: string) => {
  const keys = ledger.ZswapSecretKeys.fromSeed(Buffer.from(seed, 'hex'));
  const coin: ledger.ShieldedCoinInfo = {
    type: ledger.shieldedToken().raw,
    value: 500n,
    nonce: 'ab'.repeat(32),
  };
  const offer = ledger.ZswapOffer.fromOutput(
    ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey),
    coin.type,
    coin.value,
  );
  return { keys, wallet: CoreWallet.init(new ledger.ZswapLocalState().apply(keys, offer), keys, 'undeployed') };
};

describe('V1 Wallet serialization carries derived coin hashes', () => {
  const seed = '0000000000000000000000000000000000000000000000000000000000000005';

  it('holds coin hashes before anything is asserted about carrying them', () => {
    // Guards the fixture: an empty wallet would make every assertion below pass vacuously.
    expect(Object.keys(fundedWallet(seed).wallet.coinHashes).length).toBeGreaterThan(0);
  });

  it('carries the nullifier and commitment for every coin', () => {
    const capability = makeDefaultV1SerializationCapability();
    const { wallet } = fundedWallet(seed);

    const restored = pipe(capability.deserialize(null, capability.serialize(wallet)), EitherOps.getOrThrowLeft);

    expect(restored.coinHashes).toEqual(wallet.coinHashes);
    expect([...restored.state.coins]).toEqual([...wallet.state.coins]);
  });

  it('carries coin hashes for arbitrary non-empty wallets', () => {
    const capability = makeDefaultV1SerializationCapability();
    fc.assert(
      fc.property(walletArbitrary(10), ({ wallet }) => {
        fc.pre(Object.keys(wallet.coinHashes).length > 0);
        const restored = pipe(capability.deserialize(null, capability.serialize(wallet)), EitherOps.getOrThrowLeft);

        expect(restored.coinHashes).toEqual(wallet.coinHashes);
      }),
      { numRuns: 10 },
    );
  });

  it('pins the top-level field names', () => {
    // The envelope is a cross-release contract: a rename or a dropped field has to fail here rather than be read as a
    // default by the next SDK line.
    const capability = makeDefaultV1SerializationCapability();

    const parsed: unknown = JSON.parse(capability.serialize(fundedWallet(seed).wallet));
    const envelope = Schema.decodeUnknownSync(Schema.Record({ key: Schema.String, value: Schema.Unknown }))(parsed);

    expect(Object.keys(envelope).sort()).toEqual(
      ['coinHashes', 'networkId', 'offset', 'protocolVersion', 'publicKeys', 'state'].sort(),
    );
  });
});
