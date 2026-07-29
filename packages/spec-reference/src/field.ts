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
export type Field = {
  bytes: number;
  modulus: bigint;
};

export const ErisScalar: Field = {
  bytes: 56,
  modulus: BigInt(
    '0x24000000000024000130e0000d7f70e4a803ca76f439266f443f9a5cda8a6c7be4a7a5fe8fadffd6a2a7e8c30006b9459ffffcd300000001',
  ),
};

export const PlutoScalar: Field = {
  bytes: 56,
  modulus: BigInt(
    '0x24000000000024000130e0000d7f70e4a803ca76f439266f443f9a5cda8a6c7be4a7a5fe8fadffd6a2a7e8c30006b9459ffffcd300000001',
  ),
};

export const JubJubScalar: Field = {
  bytes: 32,
  modulus: BigInt('0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7'),
};

export const BLSScalar: Field = {
  bytes: 32,
  modulus: BigInt('0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001'),
};

// Take little endian bytes representation and convert to a bigint
export function toScalar(bytes: Buffer): bigint {
  return BigInt(`0x${Buffer.from(bytes).reverse().toString('hex')}`);
}

// A little-endian bytes representation of a field element
export function fromScalar(scalar: bigint, padToField?: Field): Buffer {
  const stringified = scalar.toString(16);
  const padded = padToField != undefined ? stringified.padStart(padToField.bytes * 2, '0') : stringified;
  return Buffer.from(padded, 'hex').reverse();
}
