// This file is part of MIDNIGHT-WALLET-SDK.
// Copyright (C) 2025 Midnight Foundation
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

import * as ledger from '@midnight-ntwrk/ledger-v7';
import { NetworkId, ProtocolVersion } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { chooseCoin } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { ArrayOps, DateOps, EitherOps } from '@midnight-ntwrk/wallet-sdk-utilities';
import { Array as Arr, pipe, Record as Rec } from 'effect';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createKeystore, PublicKey } from '../../KeyStore.js';
import { makeDefaultCoinsAndBalancesCapability } from '../CoinsAndBalances.js';
import { CoreWallet } from '../CoreWallet.js';
import { makeDefaultKeysCapability } from '../Keys.js';
import {
  type DefaultTransactingConfiguration,
  type DefaultTransactingContext,
  makeDefaultTransactingCapability,
  type TokenTransfer,
} from '../Transacting.js';
import { UnshieldedState, UtxoWithMeta } from '../UnshieldedState.js';

const NIGHT = ledger.nativeToken().raw;
const tokenA = ledger.sampleRawTokenType();
const tokenB = ledger.sampleRawTokenType();

type TestUtxo = UtxoWithMeta;
const utxoArbitrary = (tokenType: ledger.RawTokenType, owner: PublicKey): fc.Arbitrary<TestUtxo> => {
  return fc
    .record({
      utxo: fc.record<ledger.Utxo>({
        value: fc.bigInt({ min: 1n, max: (1n << 64n) - 1n }),
        owner: fc.constant(owner.addressHex),
        type: fc.constant(tokenType),
        intentHash: fc.context().map(() => ledger.sampleIntentHash()),
        outputNo: fc.nat(10),
      }),
      meta: fc.record({
        ctime: fc.date(),
        registeredForDustGeneration: fc.boolean(),
      }),
    })
    .map((data) => new UtxoWithMeta(data));
};

const outputArbitrary = (tokenType: ledger.RawTokenType, value: bigint): fc.Arbitrary<TokenTransfer> => {
  return fc.record({
    amount: fc.constant(value),
    type: fc.constant(tokenType),
    receiverAddress: fc
      .uint8Array({ minLength: 32, maxLength: 32 })
      .map((bytes) => Buffer.from(bytes))
      .map((bytes) => new UnshieldedAddress(bytes))
      .map((addr) => MidnightBech32m.encode(NetworkId.NetworkId.Undeployed, addr).toString()),
  });
};

const walletAndTransfersArbitrary = (): fc.Arbitrary<{
  wallet: CoreWallet;
  outputs: Record<ledger.RawTokenType, ReadonlyArray<TokenTransfer>>;
}> => {
  const keystore = createKeystore(Buffer.from(ledger.sampleSigningKey(), 'hex'), NetworkId.NetworkId.Undeployed);
  const ownerPK = PublicKey.fromKeyStore(keystore);
  return fc
    .record({
      [NIGHT]: fc.array(utxoArbitrary(NIGHT, ownerPK), { minLength: 1, maxLength: 20 }),
      [tokenA]: fc.array(utxoArbitrary(tokenA, ownerPK), { minLength: 1, maxLength: 20 }),
      [tokenB]: fc.array(utxoArbitrary(tokenB, ownerPK), { minLength: 1, maxLength: 20 }),
    })
    .chain((allUtxos: Record<ledger.RawTokenType, ReadonlyArray<TestUtxo>>) => {
      const balances: Record<ledger.RawTokenType, bigint> = pipe(
        allUtxos,
        Rec.map((utxos) =>
          pipe(
            utxos,
            Arr.map((utxo) => utxo.utxo.value),
            ArrayOps.sumBigInt,
          ),
        ),
      );

      const outputsArbitrary = (type: ledger.RawTokenType): fc.Arbitrary<ReadonlyArray<TokenTransfer>> => {
        return fc.integer({ min: 1, max: allUtxos[type].length }).chain((numberOfOutputs) => {
          return fc.bigInt({ min: 1n, max: balances[type] / BigInt(numberOfOutputs) }).chain((valuePerOutput) => {
            return fc.array(outputArbitrary(type, valuePerOutput), {
              minLength: numberOfOutputs,
              maxLength: numberOfOutputs,
            });
          });
        });
      };

      return fc.record({
        utxos: fc.constant(pipe(allUtxos, Rec.values, Arr.flatten)),
        outputs: fc.record({
          [NIGHT]: outputsArbitrary(NIGHT),
          [tokenA]: outputsArbitrary(tokenA),
          [tokenB]: outputsArbitrary(tokenB),
        }),
      });
    })
    .map(({ utxos, outputs }) => {
      const state = UnshieldedState.restore(utxos, []);
      const wallet = CoreWallet.restore(
        state,
        ownerPK,
        { appliedId: 0n, highestTransactionId: 0n },
        ProtocolVersion.ProtocolVersion(1n),
        NetworkId.NetworkId.Undeployed,
      );

      return { keystore, wallet, outputs };
    });
};

describe('Unshielded wallet transacting', () => {
  const config: DefaultTransactingConfiguration = {
    networkId: NetworkId.NetworkId.Undeployed,
  };
  const context: DefaultTransactingContext = {
    coinSelection: chooseCoin,
    coinsAndBalancesCapability: makeDefaultCoinsAndBalancesCapability(),
    keysCapability: makeDefaultKeysCapability(),
  };

  it('uses fallible section for issuing transfers involving Night', () => {
    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    fc.assert(
      fc.property(walletAndTransfersArbitrary(), ({ wallet, outputs }) => {
        const outputsToUse = pipe(outputs, Rec.values, Arr.flatten);
        const { transaction } = transacting.makeTransfer(wallet, outputsToUse, ttl).pipe(EitherOps.getOrThrowLeft);

        const theIntent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish> = transaction
          .intents!.values()
          .take(1)
          .next().value!;

        expect(transaction.intents).toBeDefined();
        expect(transaction.intents!.size).toEqual(1);
        expect(theIntent).toBeDefined();
        // There are/should be other tests verifying intent contents. Here we only want to ensure usage of a proper section
        expect(theIntent.fallibleUnshieldedOffer).toBeDefined();
        expect(theIntent.guaranteedUnshieldedOffer).toBeUndefined();
      }),
    );
  });

  it('uses guaranteed section for issuing transfers not involving Night', () => {
    const transacting = makeDefaultTransactingCapability(config, () => context);
    const ttl = DateOps.addSeconds(new Date(), 1800);

    fc.assert(
      fc.property(walletAndTransfersArbitrary(), ({ wallet, outputs }) => {
        const outputsToUse = pipe(
          outputs,
          Rec.filter((_value, key) => key != NIGHT),
          Rec.values,
          Arr.flatten,
        );

        const { transaction } = transacting.makeTransfer(wallet, outputsToUse, ttl).pipe(EitherOps.getOrThrowLeft);

        const theIntent: ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.Bindingish> = transaction
          .intents!.values()
          .take(1)
          .next().value!;

        expect(transaction.intents).toBeDefined();
        expect(transaction.intents!.size).toEqual(1);
        expect(theIntent).toBeDefined();
        // There are/should be other tests verifying intent contents. Here we only want to ensure usage of a proper section
        expect(theIntent.fallibleUnshieldedOffer).toBeUndefined();
        expect(theIntent.guaranteedUnshieldedOffer).toBeDefined();
      }),
    );
  });
});
