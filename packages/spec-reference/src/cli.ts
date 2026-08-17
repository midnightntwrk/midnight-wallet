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
/* eslint-disable no-console */
/** A small CLI utility to generate test vectors for wallet keys given a set of predefined seeds */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { Option, program } from 'commander';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateTestVectors, seeds } from './test-vectors.js';
import { dustKeys } from './key-derivation-reference.js';
import { DustAddress } from './address-format-reference.js';

program.description('Generate test vectors for key derivation and address formatting').showHelpAfterError();

program
  .command('gen', {
    isDefault: true,
  })
  .description('Generate test vectors and print them or save to a file')
  .option('--dir <dir>', 'If and where to output generated vectors')
  .option('--print', 'Whether to print generated values', false)
  .action((options: { dir?: string; print: boolean }) => {
    const results = generateTestVectors(seeds);
    if (options.print) {
      process.stdout.write(JSON.stringify(results, null, 2));
      process.stdout.write('\n');
    }

    const dir = options.dir;
    if (dir) {
      Object.entries(results).forEach(([key, value]) => {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.resolve(dir, `${key}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
      });
    }
  });

program
  .command('find-seeds')
  .addOption(
    new Option('--key <key>', 'Key type to find seeds for: either shielded encryption secret key or dust public key')
      .choices(['shield-esk', 'dust-pk'])
      .makeOptionMandatory(),
  )
  .addOption(
    new Option('--number <count>', 'Number of keys to generate').argParser((value) => parseInt(value, 10)).default(4),
  )
  .description('Find seeds generating varied length encryption secret keys')
  .action((options: { key: 'shield-esk' | 'dust-pk'; number: number }) => {
    const seedMap = new Map<number, { seed: string; key: string }>();

    const generateShieldedESK = (seed: Buffer): Buffer => {
      const keys = ledger.ZswapSecretKeys.fromSeed(seed);
      return Buffer.from(keys.encryptionSecretKey.yesIKnowTheSecurityImplicationsOfThis_serialize());
    };

    const generateDustPK = (seed: Buffer): Buffer => {
      const keys = dustKeys(seed);
      const dustAddress = new DustAddress(keys.publicKey);
      return dustAddress.serialize();
    };

    const generateKey: (seed: Buffer) => Buffer = options.key === 'shield-esk' ? generateShieldedESK : generateDustPK;

    const insertIfNotPresent = <K extends number, V>(map: Map<K, V>, key: K, value: V): void => {
      if (!map.has(key)) {
        map.set(key, value);
        console.log(`Added key of length ${key}; now have ${map.size} keys`);
      }
    };

    while (seedMap.size < options.number) {
      const seed = crypto.randomBytes(32);
      const key = generateKey(seed);
      const length = key.length;

      insertIfNotPresent(seedMap, length, { seed: seed.toString('hex'), key: key.toString('hex') });
    }

    console.log('Resulting map:');
    for (const [length, { seed, key }] of seedMap.entries()) {
      console.log(`    length: ${length}\tseed: ${seed}\tkey: ${key}`);
    }
    process.exit(0);
  });

program.parse(process.argv);
