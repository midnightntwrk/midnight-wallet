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
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';

export const mnemonicToWords: (mnemonic: string) => string[] = (mnemonic: string) => mnemonic.split(' ');

/** A wrapper around the bip39 package function, with default strength applied to produce 24 words */
export const generateMnemonicWords: (strength?: number) => string[] = (strength = 256) =>
  mnemonicToWords(bip39.generateMnemonic(english, strength));

export const joinMnemonicWords: (mnenomic: string[]) => string = (mnenomic: string[]) => mnenomic.join(' ');

export const generateRandomSeed = (strength = 256): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(Math.ceil(strength / 8)));
};

/** A wrapper around the bip39 package function */
export const validateMnemonic = (mnemonic: string): boolean => bip39.validateMnemonic(mnemonic, english);
