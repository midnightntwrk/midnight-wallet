/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { filter, firstValueFrom, tap, throttleTime } from 'rxjs';
import { WalletState, type Wallet } from '@midnight-ntwrk/wallet-api';
import { logger } from './logger.js';
import { TestContainersFixture } from './test-fixture.js';
import * as ledger from '@midnight-ntwrk/ledger-v6';
import { NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { existsSync } from 'node:fs';
import { exit } from 'node:process';
import * as fsAsync from 'node:fs/promises';
import * as fs from 'node:fs';
import { ShieldedWallet, ShieldedWalletClass, ShieldedWalletState } from '@midnight-ntwrk/wallet-sdk-shielded';
import { ShieldedAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { WalletFacade } from '@midnight-ntwrk/wallet-sdk-facade';
import {
  createKeystore,
  PublicKey,
  UnshieldedWallet,
  WalletBuilder as unshieldedWalletBuilder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';

// place this somewhere better?
export const Segments = {
  guaranteed: 0,
  fallible: 1,
};

export const waitForSyncProgress = async (wallet: Wallet) =>
  await firstValueFrom(
    wallet.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        logger.info(`Wallet behind by ${applyGap} indices, source behind by ${sourceGap} indices`);
      }),
      filter((state) => {
        // Let's allow progress only if syncProgress is defined
        return state.syncProgress !== undefined;
      }),
    ),
  );

export const isAnotherChain = async (wallet: ShieldedWallet, offset: number) => {
  const state = await wallet.waitForSyncedState();
  // allow for situations when there's no new index in the network between runs
  const applyGap = state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex;
  return applyGap <= offset - 1;
};

export const streamToString = async (stream: fs.ReadStream): Promise<string> => {
  const chunks: string[] = [];
  return await new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk as string));
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(chunks.join('')));
  });
};

export const provideWallet = async (
  filename: string,
  seed: string,
  wallet: ShieldedWalletClass,
): Promise<ShieldedWallet> => {
  let restoredWallet: ShieldedWallet;
  const walletSeed = getShieldedSeed(seed);
  const directoryPath = process.env['SYNC_CACHE'];
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }
  if (existsSync(`${directoryPath}/${filename}`)) {
    logger.info(`Attempting to restore state from ${directoryPath}/${filename}`);
    try {
      const serializedStream = fs.createReadStream(`${directoryPath}/${filename}`, 'utf-8');
      const serialized = await streamToString(serializedStream);
      serializedStream.on('finish', () => serializedStream.close());

      restoredWallet = wallet.restore(serialized);

      const stateObject = JSON.parse(serialized);
      if (await isAnotherChain(restoredWallet, stateObject.offset)) {
        logger.warn('The chain was reset, building wallet from scratch');
        restoredWallet = wallet.startWithShieldedSeed(walletSeed);
      } else {
        const newState = await restoredWallet.waitForSyncedState();
        const applyGap = newState.state?.progress.highestRelevantIndex - newState.state?.progress.appliedIndex;
        // allow for situations when there's no new index in the network between runs
        if ((applyGap ?? 0n) >= stateObject.offset - 1) {
          logger.info('Wallet was able to sync from restored state');
        } else {
          logger.info(`Offset: ${stateObject.offset}`);
          logger.info(`SyncProgress Apply Gap: ${applyGap}`);
          logger.warn('Wallet was not able to sync from restored state, building wallet from scratch');

          restoredWallet = wallet.startWithShieldedSeed(walletSeed);
        }
      }
    } catch (error: unknown) {
      if (typeof error === 'string') {
        logger.error(error);
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      logger.warn('Wallet was not able to restore using the stored state, building wallet from scratch');
      restoredWallet = wallet.startWithShieldedSeed(walletSeed);
    }
  } else {
    logger.info(`${directoryPath}/${filename} not present, building a wallet from scratch`);
    restoredWallet = wallet.startWithShieldedSeed(walletSeed);
  }
  return restoredWallet;
};

export const saveState = async (wallet: ShieldedWallet, filename: string) => {
  const directoryPath = process.env['SYNC_CACHE'];
  if (!directoryPath) {
    logger.warn('SYNC_CACHE env var not set');
    exit(1);
  }
  logger.info(`Saving state in ${directoryPath}/${filename}`);
  try {
    await fsAsync.mkdir(directoryPath, { recursive: true });
    const serializedState = await wallet.serializeState();
    logger.info('State serialized');
    const writer = fs.createWriteStream(`${directoryPath}/${filename}`);
    writer.write(serializedState);
    logger.info('State written to file');
    writer.on('finish', function () {
      logger.info(`File '${directoryPath}/${filename}' written successfully.`);
    });

    writer.on('error', function (err) {
      logger.error(err);
    });
    await new Promise((resolve) => writer.end(resolve));
  } catch (e) {
    if (typeof e === 'string') {
      logger.warn(e);
    } else if (e instanceof Error) {
      logger.warn(e.message);
    }
  }
};

export const buildWalletFacade = async (walletSeed: string, fixture: TestContainersFixture) => {
  const unshieldedKeyStore = createKeystore(getUnshieldedSeed(walletSeed), fixture.getNetworkId());
  const filenameWallet = `${walletSeed.substring(0, 7)}-${TestContainersFixture.deployment}.state`;

  const walletConfig = fixture.getWalletConfig(fixture.getNetworkId());
  const Wallet = ShieldedWallet(walletConfig);
  let shieldedWallet: ShieldedWallet;

  const directoryPath = process.env['SYNC_CACHE'];
  if (directoryPath) {
    // Attempt to restore shielded wallet from file, otherwise create a new one
    shieldedWallet = await provideWallet(filenameWallet, walletSeed, Wallet);
  } else {
    shieldedWallet = Wallet.startWithShieldedSeed(getShieldedSeed(walletSeed));
  }

  const unshieldedWallet = await unshieldedWalletBuilder.build({
    publicKey: PublicKey.fromKeyStore(unshieldedKeyStore),
    networkId: fixture.getNetworkId(),
    indexerUrl: fixture.getIndexerWsUri(),
  });

  const dustSeed = getDustSeed(walletSeed);
  const Dust = DustWallet({
    ...walletConfig,
    costParameters: {
      ledgerParams: ledger.LedgerParameters.initialParameters(),
      additionalFeeOverhead: 300_000_000_000_000n,
    },
  });
  const dustParameters = new ledger.DustParameters(5_000_000_000n, 8_267n, 3n * 60n * 60n);
  const dustWallet = Dust.startWithSeed(dustSeed, dustParameters, fixture.getNetworkId());

  return new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
};

export const closeWallet = async (wallet: WalletFacade) => {
  try {
    await wallet.stop();
  } catch (e: unknown) {
    if (typeof e === 'string') {
      logger.warn(e);
    } else if (e instanceof Error) {
      logger.warn(e.message);
    }
  }
};

export const waitForSyncUnshielded = (wallet: UnshieldedWallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.syncProgress?.applyGap;
        // const txs = state.transactionHistory.length;
        logger.info(`Wallet behind by ${applyGap} indices`);
      }),
      filter(
        (state) =>
          state.syncProgress !== undefined && state.syncProgress?.applyGap === 0 && state.syncProgress?.synced === true,
      ),
    ),
  );

export const waitForSyncShielded = (wallet: ShieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex;
        const sourceGap = state.state?.progress.highestIndex - state.state?.progress.highestRelevantIndex;
        // const txs = state.transactionHistory.length;
        logger.info(
          `Wallet behind by ${applyGap} indices, source behind by ${sourceGap}, synced = ${state.state?.progress.isStrictlyComplete()}`,
        );
      }),
      filter(
        (state) =>
          state.state?.progress !== undefined &&
          state.state?.progress.highestRelevantIndex - state.state?.progress.appliedIndex === 0n &&
          state.state?.progress.highestIndex - state.state?.progress.highestRelevantIndex <= 50n &&
          state.state?.progress.isStrictlyComplete() === true,
      ),
    ),
  );

export const waitForSyncOld = (wallet: Wallet) =>
  firstValueFrom(
    wallet.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
        const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
        const txs = state.transactionHistory.length;
        logger.info(`Wallet behind by ${applyGap} indices, source behind by ${sourceGap}, transactions=${txs}`);
      }),
      filter(
        (state) =>
          state.syncProgress !== undefined &&
          state?.syncProgress?.lag?.applyGap === 0n &&
          state?.syncProgress?.lag?.sourceGap <= 100n,
      ),
    ),
  );

export const waitForSyncFacade = async (facade: WalletFacade) =>
  await firstValueFrom(
    facade.state().pipe(
      throttleTime(5_000),
      tap((state) => {
        const applyGap = state.unshielded.syncProgress?.applyGap;
        logger.info(`Wallet facade behind by ${applyGap}`);
      }),
      filter(
        (state) =>
          state.dust.state.progress.isStrictlyComplete() &&
          state.shielded.state.progress.isStrictlyComplete() &&
          state.unshielded.syncProgress?.synced === true,
      ),
    ),
  );

export const waitForFacadePending = (wallet: WalletFacade) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins...`);
        const unshieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins...`);
      }),
      filter(
        (state) =>
          // Let's allow progress only if pendingCoins are present
          state.shielded.pendingCoins.length > 0 || state.unshielded.pendingCoins.length > 0,
      ),
    ),
  );

export const waitForFacadePendingClear = (wallet: WalletFacade) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const shieldedPending = state.shielded.pendingCoins.length;
        logger.info(`Shielded wallet pending coins: ${shieldedPending}, waiting for pending coins to clear...`);
        const unshieldedPending = state.unshielded.pendingCoins.length;
        logger.info(`Unshielded wallet pending coins: ${unshieldedPending}, waiting for pending coins to clear...`);
        const dustPending = state.dust.pendingCoins.length;
        logger.info(`Dust wallet pending coins: ${dustPending}, waiting for pending coins to clear...`);
      }),
      filter(
        (state) =>
          // Allow progress only if there are no pending coins
          state.shielded.pendingCoins.length == 0 &&
          state.unshielded.pendingCoins.length == 0 &&
          state.dust.pendingCoins.length == 0,
      ),
    ),
  );

export const waitForPending = (wallet: ShieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are present
        const pending = state.pendingCoins.length;
        return pending > 0;
      }),
    ),
  );

export const waitForBalanceUpdate = (wallet: UnshieldedWallet) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const balanceSize = state.balances.size;
        logger.info(`Balance size: ${balanceSize}, waiting for balance to update...`);
      }),
      filter((state) => {
        return state.balances.size > 0;
      }),
    ),
  );

export const waitForDustBalance = (wallet: WalletFacade, expectedDustBalance: bigint) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const dustBalance = state.dust.walletBalance(new Date(Date.now() + 60 * 60 * 1000));
        logger.info(`Dust balance: ${dustBalance}`);
      }),
      filter((state) => {
        return state.dust.walletBalance(new Date(Date.now() + 60 * 60 * 1000)) >= expectedDustBalance;
      }),
    ),
  );

export const waitForFinalizedBalanceUnshielded = (wallet: UnshieldedWallet) =>
  firstValueFrom(
    wallet.state().pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are cleared
        const pending = state.pendingCoins.length;
        return pending === 0;
      }),
    ),
  );

export const waitForFinalizedBalance = (wallet: ShieldedWallet) =>
  firstValueFrom(
    wallet.state.pipe(
      tap((state) => {
        const pending = state.pendingCoins.length;
        logger.info(`Wallet pending coins: ${pending}, waiting for pending coins cleared...`);
      }),
      filter((state) => {
        // Let's allow progress only if pendingCoins are cleared
        const pending = state.pendingCoins.length;
        return pending === 0;
      }),
    ),
  );

// export const waitForTxInHistory = async (txId: string, wallet: ShieldedWallet) =>
//   firstValueFrom(
//     wallet.state.pipe(
//       tap({
//         next: (state) => {
//           logger.info(`Current transactionHistory: ${state.transactionHistory}`);
//           state.transactionHistory.forEach((tx, idx) => {
//             logger.info(`Tx[${idx}] identifiers: ${JSON.stringify(tx.identifiers())}`);
//           });
//           const txFound = state.transactionHistory.some((tx) => tx.identifiers().includes(txId));
//           logger.info(`Transaction ${txId} found: ${txFound}`);
//         },
//       }),
//       filter((state) => state.transactionHistory.some((tx) => tx.identifiers().includes(txId))),
//     ),
//   );

// export const walletStateTrimmed = (state: ShieldedWalletState) => {
//   const { totalCoins, availableCoins, ...rest } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
//   return rest;
// };

// export function normalizeWalletState(state: ShieldedWalletState) {
//   const normalized = state.transactionHistory.map((txHistoryEntry: Transaction) => {
//     const { identifiers, ...otherProps } = txHistoryEntry; // eslint-disable-line @typescript-eslint/no-unused-vars
//     return otherProps;
//   });
//   const { transactionHistory, syncProgress, ...otherProps } = state; // eslint-disable-line @typescript-eslint/no-unused-vars
//   return { ...otherProps, normalized };
// }

export const getTransactionHistoryIds = (state: ShieldedWalletState) => {
  return state.transactionHistory.map((tx) => tx.identifiers());
};

// export function compareStates(state1: ShieldedWalletState, state2: ShieldedWalletState) {
//   const normalized1 = normalizeWalletState(state1);
//   const normalized2 = normalizeWalletState(state2);
//   expect(normalized1).toStrictEqual(normalized2);
// }

// Validate wallet transaction history after wallet has received token
export function validateWalletTxHistory(finalWalletState: WalletState, initialWalletState: WalletState) {
  expect(finalWalletState.availableCoins.length).toBe(initialWalletState.availableCoins.length + 1);
  expect(finalWalletState.pendingCoins.length).toBe(0);
  expect(finalWalletState.coins.length).toBeGreaterThanOrEqual(initialWalletState.coins.length + 1);
  expect(finalWalletState.nullifiers.length).toBeGreaterThanOrEqual(initialWalletState.nullifiers.length + 1);
  expect(finalWalletState.transactionHistory.length).toBeGreaterThanOrEqual(
    initialWalletState.transactionHistory.length + 1,
  );
}

export function validateNetworkInAddress(address: string) {
  switch (TestContainersFixture.network) {
    case 'testnet':
      expect(address).toContain('test');
      break;
    case 'devnet':
      expect(address).toContain('dev');
      break;
    case 'undeployed':
      expect(address).toContain('undeployed');
      break;
  }
}

export function getShieldedAddress(networkId: NetworkId.NetworkId, walletAddress: ShieldedAddress): string {
  return ShieldedAddress.codec.encode(networkId, walletAddress).asString();
}

export function getUnshieldedAddress(networkId: NetworkId.NetworkId, walletAddress: UnshieldedAddress): string {
  return UnshieldedAddress.codec.encode(networkId, walletAddress).asString();
}

export const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return Buffer.from(derivationResult.key);
};

export const getUnshieldedSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const getDustSeed = (seed: string): Uint8Array<ArrayBufferLike> => {
  const seedBuffer = Buffer.from(seed, 'hex');
  const hdWalletResult = HDWallet.fromSeed(seedBuffer);

  const { hdWallet } = hdWalletResult as {
    type: 'seedOk';
    hdWallet: HDWallet;
  };

  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);

  if (derivationResult.type === 'keyOutOfBounds') {
    throw new Error('Key derivation out of bounds');
  }

  return derivationResult.key;
};

export const isArrayUnique = (arr: any[]) => Array.isArray(arr) && new Set(arr).size === arr.length; // eslint-disable-line @typescript-eslint/no-explicit-any

export type MidnightNetwork = 'undeployed' | 'devnet' | 'testnet';

export type MidnightDeployment = 'preview' | 'qanet' | 'testnet' | 'local';
