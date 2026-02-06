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
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk-address-format';
import * as ledger from '@midnight-ntwrk/ledger-v7';
import * as fc from 'fast-check';
import { Record } from 'effect';

import { Transacting } from '@midnight-ntwrk/wallet-sdk-shielded/v1';
type TokenTransfer = Transacting.TokenTransfer;

export const recipientArbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => ledger.ZswapSecretKeys.fromSeed(bytes));

export const shieldedAddressArbitrary = (whoArb: fc.Arbitrary<ledger.ZswapSecretKeys>): fc.Arbitrary<ShieldedAddress> =>
  whoArb.map(
    (who) =>
      new ShieldedAddress(
        new ShieldedCoinPublicKey(Buffer.from(who.coinPublicKey, 'hex')),
        new ShieldedEncryptionPublicKey(Buffer.from(who.encryptionPublicKey, 'hex')),
      ),
  );

export const outputsArbitrary = <TRecipient>(
  balances: Record<ledger.RawTokenType, bigint>,
  recipientArb: fc.Arbitrary<TRecipient>,
): fc.Arbitrary<
  ReadonlyArray<{
    readonly amount: bigint;
    readonly type: ledger.RawTokenType;
    readonly receiverAddress: TRecipient;
  }>
> => {
  const coinTypeArbitrary: fc.Arbitrary<ledger.RawTokenType> = fc.constantFrom(...Object.keys(balances));
  const outputArbitrary = coinTypeArbitrary.chain((coinType) =>
    fc.record({
      type: fc.constant(coinType),
      amount: fc.bigInt({ max: balances[coinType], min: 1n }),
      receiverAddress: recipientArb,
    }),
  );
  return fc.array(outputArbitrary, { size: 'xsmall', minLength: 1 }).filter((transfers) => {
    const transferBalances = transfers.reduce((acc: Record<string, bigint>, transfer) => {
      return {
        ...acc,
        [transfer.type]: acc[transfer.type] === undefined ? transfer.amount : acc[transfer.type] + transfer.amount,
      };
    }, {});

    return Object.entries(transferBalances).every(([tokenType, transferAmount]) => {
      const availableAmount = balances[tokenType] ?? 0n;

      return availableAmount > transferAmount;
    });
  });
};

export const swapParamsArbitrary = (
  balances: Record<ledger.RawTokenType, bigint>,
  selfAddress: ShieldedAddress,
): fc.Arbitrary<{
  inputs: Record<ledger.RawTokenType, bigint>;
  outputs: TokenTransfer[];
}> => {
  const availableTypes = Record.keys(balances);
  const valueAssignments: fc.Arbitrary<Record<ledger.RawTokenType, bigint>> = availableTypes.reduce(
    (accArbitrary: fc.Arbitrary<Record<ledger.RawTokenType, bigint>>, tokenType) => {
      return accArbitrary.chain((acc) => {
        return fc.bigInt({ min: 1n, max: balances[tokenType] - 1_000_000n }).map((value) => ({
          ...acc,
          [tokenType]: value,
        }));
      });
    },
    fc.constant({}),
  );
  const inputOutputTypeAssignments = fc
    .integer({ min: 0, max: availableTypes.length })
    .chain((inputTypesCount) => {
      return fc
        .integer({ min: 0, max: availableTypes.length - inputTypesCount })
        .map((outputTypesCount) => ({ inputTypesCount, outputTypesCount }));
    })
    .chain(({ inputTypesCount, outputTypesCount }) => {
      return fc
        .shuffledSubarray(availableTypes, { minLength: availableTypes.length, maxLength: availableTypes.length })
        .map((shuffledTypes) => {
          const inputTypes = shuffledTypes.splice(0, inputTypesCount);
          const outputTypes = shuffledTypes.splice(0, outputTypesCount);
          return { inputTypes, outputTypes };
        });
    });
  return fc
    .record({
      valueAssignments: valueAssignments,
      inputOutputTypeAssignments: inputOutputTypeAssignments,
    })
    .map((params) => {
      const inputs: Record<ledger.RawTokenType, bigint> = params.inputOutputTypeAssignments.inputTypes.reduce(
        (acc, type) => ({
          ...acc,
          [type]: params.valueAssignments[type],
        }),
        {},
      );
      const outputs = params.inputOutputTypeAssignments.outputTypes.map((outputType): TokenTransfer => {
        return {
          amount: params.valueAssignments[outputType],
          type: outputType,
          receiverAddress: selfAddress,
        };
      });

      return { inputs, outputs };
    });
};
