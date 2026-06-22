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
import { logger } from '../logger.js';
import { BlockHash } from '@midnightntwrk/wallet-sdk-indexer-client';
import { QueryRunner } from '@midnightntwrk/wallet-sdk-indexer-client/effect';

export type MidnightNetwork = 'undeployed' | 'qanet' | 'devnet' | 'preview' | 'preprod';

export const sleep = (secs: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, secs * 1000));
};

const fetchBlockHeight = async (indexerHttpUrl: string): Promise<number> => {
  const result = await QueryRunner.runPromise(BlockHash, { offset: null }, { url: indexerHttpUrl });
  if (!result.block) throw new Error('No block returned from indexer');
  return result.block.height;
};

/**
 * Waits for the blockchain to produce at least one new block by polling the indexer for the current block height.
 * Resolves as soon as the height increases from its initial value.
 */
export const waitForBlockAdvancement = async (indexerHttpUrl: string, timeoutMs = 60_000): Promise<void> => {
  const initialHeight = await fetchBlockHeight(indexerHttpUrl);
  logger.info(`Waiting for block advancement beyond height ${initialHeight}...`);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(2);
    const currentHeight = await fetchBlockHeight(indexerHttpUrl);
    logger.info(`Current block height: ${currentHeight} (waiting for > ${initialHeight})`);
    if (currentHeight > initialHeight) {
      logger.info('Block advancement detected');
      return;
    }
  }
  throw new Error(`Timed out waiting for block advancement beyond height ${initialHeight} after ${timeoutMs}ms`);
};
