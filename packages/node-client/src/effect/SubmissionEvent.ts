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
import { Data } from 'effect';
import { SerializedMnTransaction } from './NodeClient.js';

export type HexString = string;

export type SubmissionEvent = Cases.Submitted | Cases.InBlock | Cases.Finalized;
export const { Submitted, InBlock, Finalized, $match: match, $is: is } = Data.taggedEnum<SubmissionEvent>();
export declare namespace Cases {
  export type Submitted = {
    _tag: 'Submitted';
    tx: SerializedMnTransaction;
    txHash: HexString;
  };
  export type InBlock = {
    _tag: 'InBlock';
    blockHash: HexString;
    blockHeight: bigint;
    tx: SerializedMnTransaction;
    txHash: HexString;
  };
  export type Finalized = {
    _tag: 'Finalized';
    blockHash: HexString;
    blockHeight: bigint;
    tx: SerializedMnTransaction;
    txHash: HexString;
  };
}
