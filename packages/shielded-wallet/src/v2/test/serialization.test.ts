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
import * as ledger from '@midnightntwrk/ledger-v9';
import { NetworkId } from '@midnightntwrk/wallet-sdk-abstractions';
import { Array as Arr, pipe } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeDefaultV2SerializationCapability } from '../Serialization.js';
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

describe('V2 Wallet serialization', () => {
  it.each([
    { seed: '0000000000000000000000000000000000000000000000000000000000000001' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000002' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000003' },
    { seed: '0000000000000000000000000000000000000000000000000000000000000004' },
  ])('maintains serialize ◦ deserialize == id property, including transaction history', ({ seed }) => {
    const networkId = NetworkId.NetworkId.Undeployed;
    const capability = makeDefaultV2SerializationCapability();
    const keys = ledger.ZswapSecretKeys.fromSeed(Buffer.from(seed, 'hex'));
    const wallet = CoreWallet.initEmpty(keys, networkId);

    const firstIteration = capability.serialize(wallet);

    const restored = pipe(capability.deserialize(null, firstIteration), EitherOps.getOrThrowLeft);
    const secondIteration = capability.serialize(restored);

    expect(firstIteration).toEqual(secondIteration);
  });
  it('maintains serialize ◦ deserialize == id property', () => {
    const capability = makeDefaultV2SerializationCapability();
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

  describe('a wallet caught mid-crossing', () => {
    // The wallet as the cross-ledger migration leaves it: a full local state — carried across the boundary as bytes —
    // beside an empty hash map, because deriving hashes needs secret keys a migration is not given. That combination
    // is exactly what `restoreWithCoinHashes` refuses as inconsistent, so a snapshot taken in this window is only
    // loadable because it declares itself.
    const crossingKeys = (): ledger.ZswapSecretKeys => ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 5));
    const heldCoin = (): ledger.ShieldedCoinInfo => ({
      type: ledger.shieldedToken().raw,
      nonce: 'bb'.repeat(32),
      value: 100n,
    });
    const crossedState = (): ledger.ZswapLocalState =>
      new ledger.ZswapLocalState().insertCoin(crossingKeys(), heldCoin());

    const midCrossing = (): CoreWallet =>
      CoreWallet.fromPreviousVersion({
        state: crossedState(),
        publicKeys: {
          coinPublicKey: crossingKeys().coinPublicKey,
          encryptionPublicKey: crossingKeys().encryptionPublicKey,
        },
        networkId: NetworkId.NetworkId.Undeployed,
        protocolVersion: 7n,
        progress: {
          appliedIndex: 4321n,
          highestRelevantWalletIndex: 4400n,
          highestIndex: 4400n,
          highestRelevantIndex: 4400n,
          isConnected: false,
        },
      });

    it('restores a full state with no hashes over it, still marked pending', () => {
      const capability = makeDefaultV2SerializationCapability();
      const wallet = midCrossing();
      expect(wallet.coinHashes).toEqual({});

      const serialized = capability.serialize(wallet);
      const restored = pipe(capability.deserialize(null, serialized), EitherOps.getOrThrowLeft);

      // Pinned against the literal coin, not against `wallet.state`, so that a restore which dropped the state could
      // not make this pass with nothing on both sides.
      expect([...restored.state.coins].map((coin) => [coin.nonce, coin.value, coin.mt_index])).toEqual([
        [heldCoin().nonce, heldCoin().value, 0n],
      ]);
      expect(restored.state.firstFree).toBe(1n);
      expect(restored.coinHashes).toEqual({});
      expect(restored.coinHashesPending).toBe(true);
      expect(capability.serialize(restored)).toEqual(serialized);
    });

    it('writes nothing new into the snapshot of a wallet that is not crossing', () => {
      // A settled wallet's snapshot is byte-for-byte what this schema produced before the field existed, which is
      // exactly what makes the next test a test of old snapshots.
      const capability = makeDefaultV2SerializationCapability();
      const settled = CoreWallet.initEmpty(crossingKeys(), NetworkId.NetworkId.Undeployed);

      const parsed: unknown = JSON.parse(capability.serialize(settled));

      expect(parsed).not.toHaveProperty('coinHashesPending');
    });

    it('reads a snapshot without the field as a wallet with nothing pending', () => {
      const capability = makeDefaultV2SerializationCapability();
      const settled = CoreWallet.initEmpty(crossingKeys(), NetworkId.NetworkId.Undeployed);

      const restored = pipe(capability.deserialize(null, capability.serialize(settled)), EitherOps.getOrThrowLeft);

      expect(restored.coinHashesPending).toBeUndefined();
    });

    it('goes on refusing a snapshot whose hashes do not cover its coins and does not declare itself', () => {
      // The check the marker buys an exemption from, still doing its job for everybody else: without the declaration,
      // a state holding a coin with no hash for it is a corrupt snapshot and not a crossing.
      const capability = makeDefaultV2SerializationCapability();
      const undeclared: string = JSON.stringify(
        Object.fromEntries(
          Object.entries(JSON.parse(capability.serialize(midCrossing())) as Record<string, unknown>).filter(
            ([key]) => key !== 'coinHashesPending',
          ),
        ),
      );

      expect(Either.isLeft(capability.deserialize(null, undeclared))).toBe(true);
    });
  });

  it('handles invalid JSON strings gracefully', () => {
    const capability = makeDefaultV2SerializationCapability();

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
    const capability = makeDefaultV2SerializationCapability();

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
