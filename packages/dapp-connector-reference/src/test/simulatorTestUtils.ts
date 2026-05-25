/**
 * Simulator-backed test infrastructure for the DApp Connector reference implementation.
 *
 * Creates a real WalletFacade backed by an in-memory Simulator, replacing the mock infrastructure that previously
 * hand-reimplemented facade behavior.
 *
 * Adapted from packages/facade/test/utils/helpers.ts (test code, not importable).
 */

import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import { type FacadeState, WalletFacade, type Clock } from '@midnight-ntwrk/wallet-sdk-facade';
import { CustomShieldedWallet, type ShieldedWalletAPI } from '@midnight-ntwrk/wallet-sdk-shielded';
import {
  Sync as ShieldedSync,
  TransactionHistory as ShieldedTransactionHistory,
  V1Builder as ShieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-shielded/v1';
import { CustomDustWallet, type DustWalletAPI } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import {
  SyncService as DustSyncService,
  TransactionHistory as DustTransactionHistory,
  V1Builder as DustV1Builder,
} from '@midnight-ntwrk/wallet-sdk-dust-wallet/v1';
import {
  CustomUnshieldedWallet,
  createKeystore,
  PublicKey,
  type UnshieldedWalletAPI,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { NoOpTransactionHistoryStorage, NetworkId } from '@midnight-ntwrk/wallet-sdk-abstractions';
import {
  Sync as UnshieldedSync,
  V1Builder as UnshieldedV1Builder,
} from '@midnight-ntwrk/wallet-sdk-unshielded-wallet/v1';
import * as Submission from '@midnight-ntwrk/wallet-sdk-capabilities/submission';
import {
  makeSimulatorProvingServiceEffect,
  type ProvingService,
  type UnboundTransaction,
} from '@midnight-ntwrk/wallet-sdk-capabilities/proving';
import {
  Simulator,
  immediateBlockProducer,
  type GenesisMint,
} from '@midnight-ntwrk/wallet-sdk-capabilities/simulation';
import type { SubmissionService } from '@midnight-ntwrk/wallet-sdk-capabilities';
import { Effect, Exit, Scope } from 'effect';
import * as rx from 'rxjs';

import type { WalletKeystore } from '../types.js';
import type {
  DappConnectorTestContext,
  CreateConnectedAPIOptions,
  ConnectedAPIInstance,
  TestEnvironment,
} from './context.js';
import { Connector, createMockProvingProviderFactory } from '../index.js';
import type {
  ConnectorConfiguration,
  TransactionHistoryServiceView,
  PaginatedHistoryResult,
  TransactionHistoryEntryView,
  WalletFacadeView,
} from '../types.js';
import type { TxStatus } from '@midnight-ntwrk/dapp-connector-api';
import { MidnightBech32m } from '@midnight-ntwrk/wallet-sdk-address-format';
import { defaultConnectorMetadataArbitrary, randomValue } from '../testing.js';
import {
  testShieldedWithKeys,
  testShieldedWithKeys2,
  testUnshieldedWithKeys,
  testUnshieldedWithKeys2,
} from './testUtils.js';

// =============================================================================
// HD Key Derivation (adapted from facade test helpers)
// =============================================================================

const getShieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  // Type cast required because: HDWallet.fromSeed returns a union type, we know the seed is valid
  const { hdWallet } = HDWallet.fromSeed(seedBuffer) as { type: 'seedOk'; hdWallet: HDWallet };
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Zswap).deriveKeyAt(0);
  if (derivationResult.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return Buffer.from(derivationResult.key);
};

const getUnshieldedSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  // Type cast required because: HDWallet.fromSeed returns a union type, we know the seed is valid
  const { hdWallet } = HDWallet.fromSeed(seedBuffer) as { type: 'seedOk'; hdWallet: HDWallet };
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.NightExternal).deriveKeyAt(0);
  if (derivationResult.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return derivationResult.key;
};

const getDustSeed = (seed: string): Uint8Array => {
  const seedBuffer = Buffer.from(seed, 'hex');
  // Type cast required because: HDWallet.fromSeed returns a union type, we know the seed is valid
  const { hdWallet } = HDWallet.fromSeed(seedBuffer) as { type: 'seedOk'; hdWallet: HDWallet };
  const derivationResult = hdWallet.selectAccount(0).selectRole(Roles.Dust).deriveKeyAt(0);
  if (derivationResult.type === 'keyOutOfBounds') throw new Error('Key derivation out of bounds');
  return derivationResult.key;
};

type WalletKeys = {
  shieldedKeys: ledger.ZswapSecretKeys;
  dustKey: ledger.DustSecretKey;
  unshieldedKeystore: ReturnType<typeof createKeystore>;
  unshieldedSeed: Uint8Array;
  signatureVerifyingKey: ledger.SignatureVerifyingKey;
  userAddress: ledger.UserAddress;
};

const deriveWalletKeys = (hexSeed: string, networkId: NetworkId.NetworkId): WalletKeys => {
  const shieldedSeed = getShieldedSeed(hexSeed);
  const dustSeed = getDustSeed(hexSeed);
  const unshieldedSeed = getUnshieldedSeed(hexSeed);

  const shieldedKeys = ledger.ZswapSecretKeys.fromSeed(shieldedSeed);
  const dustKey = ledger.DustSecretKey.fromSeed(dustSeed);
  const unshieldedKeystore = createKeystore(unshieldedSeed, networkId);
  const signatureVerifyingKey = ledger.signatureVerifyingKey(Buffer.from(unshieldedSeed).toString('hex'));
  const userAddress = ledger.addressFromKey(signatureVerifyingKey);

  return { shieldedKeys, dustKey, unshieldedKeystore, unshieldedSeed, signatureVerifyingKey, userAddress };
};

// =============================================================================
// Simulator Services (adapted from facade test helpers)
// =============================================================================

type SimulatorConfig = {
  simulator: Simulator;
  networkId: NetworkId.NetworkId;
  costParameters: { feeBlocksMargin: number };
};

const simulatorClock = (simulator: Simulator): Clock => ({
  now: () => Effect.runSync(simulator.query((s) => s.currentTime)),
});

const createSimulatorProvingService = (): ProvingService<UnboundTransaction> => {
  const effectService = makeSimulatorProvingServiceEffect();
  return {
    prove: (tx: ledger.UnprovenTransaction) =>
      // Type cast required because: simulator proving returns ProofErasedTransaction but facade expects UnboundTransaction — compatible at runtime
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return
      effectService.prove(tx).pipe(Effect.runPromise) as any,
  };
};

const createSimulatorSubmissionService = (simulator: Simulator): SubmissionService<ledger.FinalizedTransaction> => {
  const effectService = Submission.makeSimulatorSubmissionService<ledger.FinalizedTransaction>('InBlock')({
    // Type cast required because: simulator uses internal transaction types, compatible at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
    simulator: simulator as any,
  });
  return {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    submitTransaction: ((tx: ledger.FinalizedTransaction, waitFor?: 'Submitted' | 'InBlock' | 'Finalized') =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      effectService.submitTransaction(tx, waitFor ?? 'InBlock').pipe(Effect.runPromise)) as any,
    close: () => effectService.close().pipe(Effect.runPromise),
  };
};

type SimulatorWalletFactories = {
  createShieldedWallet: (keys: ledger.ZswapSecretKeys) => ShieldedWalletAPI;
  createDustWallet: (key: ledger.DustSecretKey, params: ledger.DustParameters) => DustWalletAPI;
  createUnshieldedWallet: (keystore: ReturnType<typeof createKeystore>) => UnshieldedWalletAPI;
};

const createSimulatorWalletFactories = (config: SimulatorConfig): SimulatorWalletFactories => {
  const ShieldedWalletFactory = CustomShieldedWallet(
    {
      ...config,
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      indexerClientConnection: { indexerHttpUrl: 'http://unused:0' },
    },
    new ShieldedV1Builder()
      .withDefaultTransactionType()
      .withSync(ShieldedSync.makeSimulatorSyncService, ShieldedSync.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistory(ShieldedTransactionHistory.makeSimulatorTransactionHistoryService)
      .withKeysDefaults()
      .withCoinSelectionDefaults(),
  );

  const DustWalletFactory = CustomDustWallet(
    config,
    new DustV1Builder()
      .withDefaultTransactionType()
      .withSync(DustSyncService.makeSimulatorSyncService, DustSyncService.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withTransactionHistory(DustTransactionHistory.makeSimulatorTransactionHistoryService)
      .withKeysDefaults()
      .withCoinSelectionDefaults(),
  );

  const UnshieldedWalletFactory = CustomUnshieldedWallet(
    { ...config, txHistoryStorage: new NoOpTransactionHistoryStorage() },
    new UnshieldedV1Builder()
      .withSync(UnshieldedSync.makeSimulatorSyncService, UnshieldedSync.makeSimulatorSyncCapability)
      .withSerializationDefaults()
      .withTransactingDefaults()
      .withCoinsAndBalancesDefaults()
      .withKeysDefaults()
      .withCoinSelectionDefaults()
      .withTransactionHistoryDefaults(),
  );

  return {
    createShieldedWallet: (keys) => ShieldedWalletFactory.startWithSecretKeys(keys),
    createDustWallet: (key, params) => DustWalletFactory.startWithSecretKey(key, params),
    createUnshieldedWallet: (keystore) => UnshieldedWalletFactory.startWithPublicKey(PublicKey.fromKeyStore(keystore)),
  };
};

const makeSimulatorFacade = (
  config: SimulatorConfig,
  keys: WalletKeys,
  factories: SimulatorWalletFactories,
): Effect.Effect<WalletFacade, never, Scope.Scope> => {
  const dustParameters = ledger.LedgerParameters.initialParameters().dust;
  const provingService = createSimulatorProvingService();
  const submissionService = createSimulatorSubmissionService(config.simulator);

  return Effect.acquireRelease(
    Effect.promise(async () => {
      const facade = await WalletFacade.init({
        configuration: {
          ...config,
          indexerClientConnection: { indexerHttpUrl: 'http://unused' },
          relayURL: new URL('ws://unused'),
          txHistoryStorage: new NoOpTransactionHistoryStorage(),
        },
        shielded: () => factories.createShieldedWallet(keys.shieldedKeys),
        unshielded: () => factories.createUnshieldedWallet(keys.unshieldedKeystore),
        dust: () => factories.createDustWallet(keys.dustKey, dustParameters),
        provingService: () => provingService,
        submissionService: () => submissionService,
        clock: () => simulatorClock(config.simulator),
      });

      await facade.start(keys.shieldedKeys, keys.dustKey);
      return facade;
    }),
    (facade) => Effect.promise(() => facade.stop()),
  );
};

const waitForShieldedCoins = (facade: WalletFacade): Effect.Effect<void> =>
  Effect.promise(() =>
    rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.shielded.availableCoins.length > 0))),
  ).pipe(Effect.asVoid);

const waitForUnshieldedBalance = (facade: WalletFacade, tokenType: string, minBalance: bigint): Effect.Effect<bigint> =>
  Effect.promise(() =>
    rx.firstValueFrom(
      facade.state().pipe(
        rx.map((s) => s.unshielded.balances[tokenType] ?? 0n),
        rx.filter((balance) => balance >= minBalance),
      ),
    ),
  );

const waitForDustAvailable = (facade: WalletFacade): Effect.Effect<void> =>
  Effect.promise(() => rx.firstValueFrom(facade.state().pipe(rx.filter((s) => s.dust.availableCoins.length > 0)))).pipe(
    Effect.asVoid,
  );

// =============================================================================
// WalletKeystore backed by real HD keys
// =============================================================================

class SimulatorWalletKeystore implements WalletKeystore {
  readonly #keys: WalletKeys;

  constructor(keys: WalletKeys) {
    this.#keys = keys;
  }

  getShieldedSecretKeys(): ledger.ZswapSecretKeys {
    return this.#keys.shieldedKeys;
  }

  getDustSecretKey(): ledger.DustSecretKey {
    return this.#keys.dustKey;
  }

  getUnshieldedSecretKey(): string {
    return Buffer.from(this.#keys.unshieldedSeed).toString('hex');
  }

  signData(data: Uint8Array): ledger.Signature {
    return ledger.signData(this.getUnshieldedSecretKey(), data);
  }
}

// =============================================================================
// Simulator Environment
// =============================================================================

const NETWORK_ID = NetworkId.NetworkId.Undeployed;
const WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const TOKEN_VALUE_MULTIPLIER = 10n ** 6n;
const tokenValue = (value: bigint): bigint => value * TOKEN_VALUE_MULTIPLIER;

export interface SimulatorEnv {
  readonly simulator: Simulator;
  readonly facade: WalletFacade;
  readonly keys: WalletKeys;
  readonly keystore: WalletKeystore;
  readonly networkId: typeof NETWORK_ID;
  readonly shieldedTokenType: string;
  readonly alternateTokenType: string;
  readonly nightTokenType: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Initialize a complete simulator environment with a funded wallet.
 *
 * Creates a Simulator with genesis mints for two shielded token types plus Night, registers Night for Dust generation,
 * and fast-forwards time to accumulate Dust.
 */
export const initSimulatorEnv = async (): Promise<SimulatorEnv> => {
  const keys = deriveWalletKeys(WALLET_SEED, NETWORK_ID);
  const shieldedTokenType = SHIELDED_TOKEN_TYPE;
  const alternateTokenType = ALTERNATE_TOKEN_TYPE;
  const nightTokenType = NIGHT_TOKEN_TYPE;

  const genesisMints: [GenesisMint, ...GenesisMint[]] = [
    { type: 'shielded', tokenType: shieldedTokenType, amount: tokenValue(1_000_000n), recipient: keys.shieldedKeys },
    { type: 'shielded', tokenType: alternateTokenType, amount: tokenValue(1_000_000n), recipient: keys.shieldedKeys },
    {
      type: 'unshielded',
      tokenType: nightTokenType,
      amount: tokenValue(100_000n),
      recipient: keys.userAddress,
      verifyingKey: keys.signatureVerifyingKey,
    },
  ];

  const scope = Effect.runSync(Scope.make());

  const { simulator, facade } = await Effect.gen(function* () {
    const sim = yield* Simulator.init({ genesisMints, blockProducer: immediateBlockProducer() });

    const simulatorConfig: SimulatorConfig = {
      simulator: sim,
      networkId: NETWORK_ID,
      costParameters: { feeBlocksMargin: 5 },
    };
    const factories = createSimulatorWalletFactories(simulatorConfig);
    const fcd = yield* makeSimulatorFacade(simulatorConfig, keys, factories);

    // Wait for wallet to sync genesis funds
    yield* waitForShieldedCoins(fcd);
    yield* waitForUnshieldedBalance(fcd, nightTokenType, 1n);

    // Fast-forward time so Night UTXOs accumulate Dust potential
    yield* sim.fastForward(10_000n);

    // Register Night UTXOs for Dust generation
    const senderState: FacadeState = yield* Effect.promise(() =>
      rx.firstValueFrom(fcd.state().pipe(rx.filter((s) => s.unshielded.availableCoins.length > 0))),
    );

    const nightUtxos = senderState.unshielded.availableCoins.filter(
      (coin) => coin.utxo.type === nightTokenType && coin.meta.registeredForDustGeneration === false,
    );

    if (nightUtxos.length > 0) {
      const dustRegistrationRecipe = yield* Effect.promise(() =>
        fcd.registerNightUtxosForDustGeneration(nightUtxos, keys.signatureVerifyingKey, (payload) =>
          keys.unshieldedKeystore.signData(payload),
        ),
      );
      const registrationTx = yield* Effect.promise(() => fcd.finalizeRecipe(dustRegistrationRecipe));
      yield* Effect.promise(() => fcd.submitTransaction(registrationTx));

      // Wait for Dust to be available
      yield* waitForDustAvailable(fcd);
    }

    return { simulator: sim, facade: fcd };
  }).pipe(Effect.provideService(Scope.Scope, scope), Effect.runPromise);

  const keystore = new SimulatorWalletKeystore(keys);

  return {
    simulator,
    facade,
    keys,
    keystore,
    networkId: NETWORK_ID,
    shieldedTokenType,
    alternateTokenType,
    nightTokenType,
    cleanup: () => Scope.close(scope, Exit.void).pipe(Effect.runPromise),
  };
};

// =============================================================================
// Transaction History adapter (WalletFacade.getAllFromTxHistory → connector view)
// =============================================================================

const mapWalletEntryStatus = (status: 'SUCCESS' | 'FAILURE' | 'PARTIAL_SUCCESS'): TxStatus => ({
  status: 'finalized',
  executionStatus: { 0: status === 'FAILURE' ? 'Failure' : 'Success' },
});

const createTransactionHistoryView = (facade: WalletFacade): TransactionHistoryServiceView => ({
  getHistory: async (pageNumber: number, pageSize: number): Promise<PaginatedHistoryResult> => {
    const allEntries = await facade.getAllFromTxHistory();
    const start = pageNumber * pageSize;
    const page = allEntries.slice(start, start + pageSize);
    const entries: readonly TransactionHistoryEntryView[] = page.map((entry) => ({
      txHash: entry.hash,
      txStatus: mapWalletEntryStatus(entry.status),
    }));
    return { entries, totalCount: allEntries.length };
  },
});

const facadeAsView = (facade: WalletFacade): WalletFacadeView => {
  const transactionHistory = createTransactionHistoryView(facade);
  // Type cast required because: WalletFacade.submitTransaction returns Promise<string>
  // (tx hash) but WalletFacadeView expects Promise<void> — structurally compatible
  // since the return value is ignored by the connector.
  const baseView = facade as unknown as WalletFacadeView;
  return new Proxy(baseView, {
    get: (target, prop, receiver) =>
      // Type cast required because: Reflect.get returns `any` by spec; structurally we
      // return the same shape Proxy expects.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      prop === 'transactionHistory' ? transactionHistory : Reflect.get(target, prop, receiver),
  });
};

// =============================================================================
// Test Context Factory
// =============================================================================

const mockProvingProviderFactory = createMockProvingProviderFactory(
  () => Promise.resolve([]),
  () => Promise.resolve(new Uint8Array([0x00, 0x01, 0x02, 0x03])),
);

// Pre-computed constants (don't depend on simulator instance)
const SHIELDED_TOKEN_TYPE = ledger.shieldedToken().raw;
const ALTERNATE_TOKEN_TYPE = ledger.sampleRawTokenType();
const NIGHT_TOKEN_TYPE = ledger.nativeToken().raw;
const NETWORK_ID_STRING: string = NETWORK_ID;

const defaultConnectorConfig: ConnectorConfiguration = {
  networkId: NETWORK_ID_STRING,
  indexerUri: 'http://unused:0',
  indexerWsUri: 'ws://unused:0',
  substrateNodeUri: 'ws://unused:0',
  provingProviderFactory: mockProvingProviderFactory,
};

const staticEnvironment: TestEnvironment = {
  networkId: NETWORK_ID_STRING,

  addresses: {
    shielded: MidnightBech32m.encode(NETWORK_ID_STRING, testShieldedWithKeys.address).asString(),
    shielded2: MidnightBech32m.encode(NETWORK_ID_STRING, testShieldedWithKeys2.address).asString(),
    unshielded: MidnightBech32m.encode(NETWORK_ID_STRING, testUnshieldedWithKeys.address).asString(),
    unshielded2: MidnightBech32m.encode(NETWORK_ID_STRING, testUnshieldedWithKeys2.address).asString(),
  },

  addressKeys: {
    shielded: testShieldedWithKeys,
    shielded2: testShieldedWithKeys2,
    unshielded: testUnshieldedWithKeys,
    unshielded2: testUnshieldedWithKeys2,
  },

  tokenTypes: {
    standard: SHIELDED_TOKEN_TYPE,
    alternate: ALTERNATE_TOKEN_TYPE,
  },

  // buildSealedTransaction/serializeTransaction intentionally omitted:
  // the simulator proving service erases proofs, so mock-built sealed
  // transactions cannot round-trip through strict (proof, binding)
  // deserialization. Tests that need them skip when these are undefined.
};

/**
 * Create a DappConnectorTestContext backed by the simulator environment.
 *
 * Accepts a lazy getter for the SimulatorEnv so the context can be created during describe() registration (synchronous)
 * while the actual env is initialized later in beforeAll (asynchronous). The env is only accessed inside
 * createConnector/createConnectedAPI which run during it() blocks.
 */
export const createSimulatorContext = (getEnv: () => SimulatorEnv): DappConnectorTestContext => {
  const context: DappConnectorTestContext = {
    implementationName: 'reference',
    environment: staticEnvironment,
    installTarget: {},

    createConnector: () => {
      const env = getEnv();
      const facade = facadeAsView(env.facade);
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      return new Connector(metadata, facade, env.keystore, defaultConnectorConfig);
    },

    createConnectedAPI: async (options?: CreateConnectedAPIOptions): Promise<ConnectedAPIInstance> => {
      const env = getEnv();
      const facade = facadeAsView(env.facade);
      const networkId = options?.networkId ?? defaultConnectorConfig.networkId;
      const connConfig: ConnectorConfiguration = { ...defaultConnectorConfig, networkId };
      const metadata = randomValue(defaultConnectorMetadataArbitrary);
      const connector = new Connector(metadata, facade, env.keystore, connConfig);
      const api = await connector.connect(networkId);

      // Type assertion: internal disconnect() not part of public WalletConnectedAPI
      const internalApi = api as unknown as { disconnect(): Promise<void> };

      return {
        api,
        disconnect: () => internalApi.disconnect(),
        networkId,
      };
    },
  };

  return context;
};
